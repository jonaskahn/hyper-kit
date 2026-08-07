/* One host capability: reading system-wide "now playing" metadata and
   sending transport commands, per platform. Like system-info.ts, every
   probe is best-effort (any failure resolves to null) and parsers are
   exported so the shell-output contracts stay unit-testable. Linux uses
   dbus-send against MPRIS, macOS uses osascript for Spotify/Music plus a
   compiled MediaRemote helper (media-remote.ts) for every other app's
   media session, Windows uses PowerShell against the SMTC WinRT API.
   Volume is always the OS-wide output volume (system-volume.ts). */

import { getManualBrowser, isBrowserMediaEnabled, type ManualBrowser } from '../config';
import { execToString, hasNodeRuntime, runScriptFile } from './exec';
import { COMMAND_JS, probeFirefoxMedia, sendFirefoxCommand, volumeJs } from './firefox-cdp';
import { probeMediaRemote, sendMediaRemoteCommand, type RemoteSourceLine } from './media-remote';
import { fetchSystemVolume, setSystemVolume } from './system-volume';

export type MediaCommand = 'prev' | 'playPause' | 'next' | 'volDown' | 'volUp';

type MediaControls = 'all' | 'playPause' | 'none';

interface NowPlayingInfo {
  player: string;
  title: string;
  artist: string;
  playing: boolean;
  volume: number | null;
  coverUrl: string | null;
  controls: MediaControls;
  canVolume: boolean;
}

/* a NowPlayingInfo plus a stable id so the panel can target commands at the
   exact source the user picked (mpris destination, mac backend name, ...) */
export interface NowPlayingSource extends NowPlayingInfo {
  id: string;
}

interface MprisProperties {
  title: string | null;
  artist: string | null;
  artUrl: string | null;
  playing: boolean | null;
  volume: number | null;
}

type BrowserBackend =
  | 'chrome'
  | 'chrome-beta'
  | 'chrome-dev'
  | 'chrome-canary'
  | 'safari'
  | 'brave'
  | 'brave-beta'
  | 'brave-dev'
  | 'brave-nightly'
  | 'edge'
  | 'edge-beta'
  | 'edge-dev'
  | 'edge-canary'
  | 'chromium'
  | 'arc'
  | 'vivaldi'
  | 'vivaldi-snapshot'
  | 'opera'
  | 'opera-beta'
  | 'opera-developer'
  | 'opera-gx'
  | 'dia'
  | 'whale'
  | 'yandex'
  | 'maxthon'
  | 'puffin'
  | 'avast'
  | 'coc-coc'
  | 'epic'
  | 'sleipnir';

interface MacMediaLine {
  backend: 'spotify' | 'music' | BrowserBackend;
  title: string;
  artist: string;
  coverUrl: string | null;
  playing: boolean;
  playerVolume: number | null;
  sysVolume: number | null;
  url: string | null;
  jsOk: boolean;
  isPaused: boolean | null;
  canNext: boolean;
  canPrev: boolean;
  winIdx: number | null;
  tabIdx: number | null;
}

interface SmtcInfo {
  title: string;
  artist: string;
  playing: boolean | null;
  coverUrl: string | null;
}

const LIST_PLAYERS_CMD =
  'dbus-send --session --print-reply --dest=org.freedesktop.DBus ' +
  '/org/freedesktop/DBus org.freedesktop.DBus.ListNames';

const MPRIS_DEST_PREFIX = 'org.mpris.MediaPlayer2.';
const MPRIS_METHODS: Record<MediaCommand, string> = {
  prev: 'Previous',
  playPause: 'PlayPause',
  next: 'Next',
  volDown: '',
  volUp: '',
};

let mprisDest: string | null = null;
let lastProbeError: string | null = null;

/* Chrome only allows AppleScript JS when the user enables View > "Allow
   JavaScript from Apple Events"; a failed probe/control call flips this
   flag so the transport buttons degrade instead of erroring on every poll */
let macChromeJsOk = true;

/* the probe reports which window/tab holds the playing video; transport
   commands must target that exact tab (the active tab usually has none),
   so the last-seen indices are cached per backend and refreshed every poll */
let macBrowserTargets: Record<string, { win: number; tab: number }> = {};

export function getLastProbeError(): string | null {
  return lastProbeError;
}

function noteProbeError(message: string): void {
  lastProbeError = message;
}

/* --- dbus string unescaping (dbus-send prints C-style escapes) ---------- */

export function decodeDbusString(value: string): string {
  return value
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\r/g, '\r')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
}

/* --- MPRIS (Linux, universal across GNOME/KDE/browsers) ------------------ */

export function parseMprisPlayers(output: string | null): string[] {
  const names = String(output || '').match(/"org\.mpris\.MediaPlayer2\.[^"]+"/g) || [];
  const deduped = names.map((n) => n.slice(1, -1));
  return deduped.filter((n, i) => deduped.indexOf(n) === i);
}

function dbusStringValue(key: string, output: string): string | null {
  const m = new RegExp('"' + key + '"[\\s\\S]*?variant\\s+string "((?:[^"\\\\]|\\\\.)*)"').exec(
    output,
  );
  return m ? decodeDbusString(m[1]) : null;
}

export function parseMprisProperties(output: string | null): MprisProperties {
  const text = String(output || '');
  const artistMatch = /"xesam:artist"\s+variant\s+array\s*\[[^\]]*?string "((?:[^"\\]|\\.)*)"/.exec(
    text,
  );
  const statusMatch = /"PlaybackStatus"\s+variant\s+string "(\w+)"/.exec(text);
  const volumeMatch = /"Volume"\s+variant\s+(?:double|int32|int64|uint32)\s+([0-9.]+)/.exec(text);
  const status = statusMatch ? statusMatch[1] : null;
  const volume = volumeMatch ? parseFloat(volumeMatch[1]) : NaN;
  return {
    title: dbusStringValue('xesam:title', text),
    artist: artistMatch ? decodeDbusString(artistMatch[1]) : null,
    artUrl: dbusStringValue('mpris:artUrl', text),
    playing: status === 'Playing' ? true : status === 'Paused' ? false : null,
    volume: isNaN(volume) ? null : Math.round(volume * 100),
  };
}

function mprisPropsCommand(dest: string): string {
  return (
    'dbus-send --session --print-reply --dest=' +
    dest +
    ' /org/mpris/MediaPlayer2 org.freedesktop.DBus.Properties.GetAll ' +
    'string:org.mpris.MediaPlayer2.Player'
  );
}

function mprisMethodCommand(dest: string, method: string): string {
  return 'dbus-send --session --print-reply --dest=' + dest + ' /org/mpris/MediaPlayer2 ' + method;
}

function friendlyMprisName(dest: string): string {
  const name = dest.slice(MPRIS_DEST_PREFIX.length).split('.')[0];
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : 'Player';
}

async function fetchLinux(): Promise<NowPlayingSource[] | null> {
  const players = parseMprisPlayers(
    await execToString(LIST_PLAYERS_CMD, 3000, { onError: noteProbeError }),
  ).filter((dest) => dest !== MPRIS_DEST_PREFIX + 'playerctld');
  const playing: NowPlayingSource[] = [];
  const paused: NowPlayingSource[] = [];
  /* volume is the OS-wide sink level, not the per-player MPRIS Volume */
  const { volume } = await fetchSystemVolume();
  for (const dest of players) {
    const props = parseMprisProperties(
      await execToString(mprisPropsCommand(dest), 3000, { onError: noteProbeError }),
    );
    if (!props.title) {
      continue;
    }
    const source: NowPlayingSource = {
      id: dest,
      player: friendlyMprisName(dest),
      title: props.title,
      artist: props.artist || '',
      playing: props.playing === true,
      volume,
      coverUrl: props.artUrl,
      controls: 'all',
      canVolume: volume !== null,
    };
    (props.playing === true ? playing : paused).push(source);
  }
  mprisDest = playing.length > 0 ? playing[0].id : paused.length > 0 ? paused[0].id : null;
  return playing.concat(paused).length > 0 ? playing.concat(paused) : null;
}

/* --- macOS: osascript (Spotify, Music, then Chromium/Safari tabs) -------- */

/* every Chromium browser ships the same AppleScript dictionary as Chrome
   (windows/tabs/execute javascript), so one shared probe body works for all
   of them; only the app name differs. One row per macOS app: stable channel,
   beta/dev/canary/nightly variants, and other Chromium forks — each is
   guarded by an is-running check, so rows for browsers that aren't installed
   cost nothing and never abort the probe. label is what the panel shows */
const CHROMIUM_APPS: { backend: BrowserBackend; appName: string; label: string }[] = [
  { backend: 'chrome', appName: 'Google Chrome', label: 'Chrome' },
  { backend: 'chrome-beta', appName: 'Google Chrome Beta', label: 'Chrome Beta' },
  { backend: 'chrome-dev', appName: 'Google Chrome Dev', label: 'Chrome Dev' },
  { backend: 'chrome-canary', appName: 'Google Chrome Canary', label: 'Chrome Canary' },
  { backend: 'edge', appName: 'Microsoft Edge', label: 'Edge' },
  { backend: 'edge-beta', appName: 'Microsoft Edge Beta', label: 'Edge Beta' },
  { backend: 'edge-dev', appName: 'Microsoft Edge Dev', label: 'Edge Dev' },
  { backend: 'edge-canary', appName: 'Microsoft Edge Canary', label: 'Edge Canary' },
  { backend: 'brave', appName: 'Brave Browser', label: 'Brave' },
  { backend: 'brave-beta', appName: 'Brave Browser Beta', label: 'Brave Beta' },
  { backend: 'brave-dev', appName: 'Brave Browser Dev', label: 'Brave Dev' },
  { backend: 'brave-nightly', appName: 'Brave Browser Nightly', label: 'Brave Nightly' },
  { backend: 'opera', appName: 'Opera', label: 'Opera' },
  { backend: 'opera-beta', appName: 'Opera Beta', label: 'Opera Beta' },
  { backend: 'opera-developer', appName: 'Opera Developer', label: 'Opera Developer' },
  { backend: 'opera-gx', appName: 'Opera GX', label: 'Opera GX' },
  { backend: 'vivaldi', appName: 'Vivaldi', label: 'Vivaldi' },
  { backend: 'vivaldi-snapshot', appName: 'Vivaldi Snapshot', label: 'Vivaldi Snapshot' },
  { backend: 'chromium', appName: 'Chromium', label: 'Chromium' },
  { backend: 'arc', appName: 'Arc', label: 'Arc' },
  { backend: 'dia', appName: 'Dia', label: 'Dia' },
  { backend: 'whale', appName: 'Whale', label: 'Whale' },
  { backend: 'yandex', appName: 'Yandex', label: 'Yandex' },
  { backend: 'maxthon', appName: 'Maxthon', label: 'Maxthon' },
  { backend: 'puffin', appName: 'Puffin', label: 'Puffin' },
  { backend: 'avast', appName: 'Avast Secure Browser', label: 'Avast Secure Browser' },
  { backend: 'coc-coc', appName: 'Cốc Cốc', label: 'Cốc Cốc' },
  { backend: 'epic', appName: 'Epic', label: 'Epic' },
  { backend: 'sleipnir', appName: 'Sleipnir', label: 'Sleipnir' },
];

const BROWSER_PLAYER_NAMES: Record<string, string> = Object.fromEntries(
  CHROMIUM_APPS.map((app) => [app.backend, app.label]),
);
BROWSER_PLAYER_NAMES.safari = 'Safari';

const BROWSER_BACKENDS = new Set<string>([...CHROMIUM_APPS.map((app) => app.backend), 'safari']);

function isBrowserBackend(backend: string): boolean {
  return BROWSER_BACKENDS.has(backend);
}

/* Safari's dictionary has no execute javascript, so transport only works on
   the Chromium family */
function isChromiumBackend(backend: string): boolean {
  return BROWSER_BACKENDS.has(backend) && backend !== 'safari';
}

function chromiumAppName(backend: string): string | null {
  const app = CHROMIUM_APPS.find((a) => a.backend === backend);
  return app ? app.appName : null;
}

/* MediaRemote never reports browsers, but if one ever registers a session,
   its source would duplicate the AppleScript/CDP layer — skip them all */
const REMOTE_SKIP_APPS = new Set([
  'Spotify',
  'Music',
  'Safari',
  'Firefox',
  ...CHROMIUM_APPS.map((app) => app.appName),
]);

/* every app block is wrapped in run script so it only compiles when that
   app is actually running — a plain tell block fails to parse on machines
   where the app (and its scripting dictionary) isn't installed, which
   would break the whole probe script. Each block appends its line to the
   shared result so every running app shows up as a selectable source */
function macAppBlock(appName: string, body: string): string {
  /* "tab" is a browser-tab object in Chrome/Safari's dictionaries, so the
     tab constant must not be used inside tell blocks — it coerces to the
     literal text "tab"; ASCII character 9 is not shadowable */
  const safeBody = 'set sep to ASCII character 9\n' + body.replace(/& tab &/g, '& sep &');
  /* the is-running guard itself sits inside try: an app that isn't
     installed must never abort the whole probe script */
  return (
    '  try\n' +
    '    if application "' +
    appName +
    '" is running then\n' +
    '      set line1 to run script "tell application \\"' +
    appName +
    '\\"\n' +
    safeBody +
    '\nend tell"\n' +
    '      if line1 is not "" then set theResult to theResult & line1 & tab & (my sysVolume()) & linefeed\n' +
    '    end if\n' +
    '  end try'
  );
}

/* the shared Chromium probe body: scan every window/tab with execute
   javascript and report the first tab that holds a video element — playing
   OR paused — plus its window/tab index (transport commands need the exact
   tab, not the active one). A paused video must stay a source so the user
   can resume it; the paused state lives in isPaused. Without the page-level
   permission ("Allow JavaScript from Apple Events") the executes throw and
   the block falls back to the active tab's title with jsOk = 0 */
function macChromiumBody(backend: BrowserBackend): string {
  const body = [
    'set tTitle to \\"\\"',
    'set tUrl to \\"\\"',
    'set isPaused to \\"\\"',
    'set canNext to \\"false\\"',
    'set canPrev to \\"false\\"',
    'set pageVol to \\"-1\\"',
    'set jsOk to 0',
    'set foundTab to false',
    'set wIdx to \\"\\"',
    'set tIdx to \\"\\"',
    'try',
    '  repeat with w from 1 to (count of windows)',
    '    repeat with t from 1 to (count of tabs of window w)',
    '      try',
    '        set vExists to (execute tab t of window w javascript \\"!!document.querySelector(\'video\')\\") as text',
    '      on error',
    '        set vExists to \\"false\\"',
    '      end try',
    '      if vExists is \\"true\\" then',
    '        set tTitle to title of tab t of window w as text',
    '        set tUrl to URL of tab t of window w as text',
    "        set isPaused to (execute tab t of window w javascript \\\"!!document.querySelector('video') && document.querySelector('video').paused\\\") as text",
    '        set canNext to (execute tab t of window w javascript \\"!!document.querySelector(\'[data-testid^=control-button-skip-forward], .ytp-next-button, [aria-label^=Next]\')\\") as text',
    '        set canPrev to (execute tab t of window w javascript \\"!!document.querySelector(\'[data-testid^=control-button-skip-back], .ytp-prev-button, [aria-label^=Previous]\')\\") as text',
    "        set pageVol to (execute tab t of window w javascript \\\"Math.round((document.querySelector('video')?document.querySelector('video').volume*100:-1))\\\") as text",
    '        set jsOk to 1',
    '        set wIdx to w',
    '        set tIdx to t',
    '        set foundTab to true',
    '        exit repeat',
    '      end if',
    '    end repeat',
    '    if foundTab then exit repeat',
    '  end repeat',
    'end try',
    'if foundTab is false then',
    '  set tTitle to title of active tab of front window as text',
    '  set tUrl to URL of active tab of front window as text',
    'end if',
    'return \\"' +
      backend +
      '\\" & sep & tTitle & sep & tUrl & sep & isPaused & sep & (jsOk as text) & sep & pageVol & sep & canNext & sep & canPrev & sep & wIdx & sep & tIdx',
  ].join('\n');
  return body;
}

/* Safari exposes no page JS, so the source is the current tab's title; it
   always appears as a pickable (transport-less) source. The line carries
   empty win/tab fields so every browser line shares the 10-field shape. */
function macSafariBody(): string {
  const body = [
    'set tTitle to name of current tab of front window as text',
    'set tUrl to URL of current tab of front window as text',
    'return \\"safari\\" & sep & tTitle & sep & tUrl & sep & \\"\\" & sep & \\"0\\" & sep & \\"\\" & sep & \\"false\\" & sep & \\"false\\" & sep & \\"\\" & sep & \\"\\"',
  ].join('\n');
  return body;
}

function macAppBlocks(includeBrowser: boolean): { app: string; body: string }[] {
  const apps = [
    {
      app: 'Spotify',
      body: [
        'set ps to player state as text',
        'if ps is \\"playing\\" or ps is \\"paused\\" then',
        '  return \\"spotify\\" & tab & (name of current track as text) & tab & (artist of current track as text) & tab & (artwork url of current track as text) & tab & ps & tab & (sound volume as text)',
        'end if',
        'return \\"\\"',
      ].join('\n'),
    },
    {
      app: 'Music',
      body: [
        'set ps to player state as text',
        'if ps is \\"playing\\" or ps is \\"paused\\" then',
        '  set artUrl to \\"\\"',
        '  try',
        '    set artData to data of artwork 1 of current track',
        '    set artFile to \\"/tmp/hyper-kit-cover-music.jpg\\"',
        '    set f to open for access (POSIX file artFile) with write permission',
        '    write artData to f',
        '    close access f',
        '    set artUrl to \\"file://\\" & artFile',
        '  end try',
        '  return \\"music\\" & tab & (name of current track as text) & tab & (artist of current track as text) & tab & artUrl & tab & ps & tab & (sound volume as text)',
        'end if',
        'return \\"\\"',
      ].join('\n'),
    },
  ];
  if (includeBrowser) {
    apps.push({ app: 'Safari', body: macSafariBody() });
    for (const app of CHROMIUM_APPS) {
      apps.push({ app: app.appName, body: macChromiumBody(app.backend) });
    }
  }
  return apps;
}

const MAC_SCRIPT_FOOTER =
  'on sysVolume()\n' +
  '  try\n' +
  '    return (output volume of (get volume settings)) as text\n' +
  '  on error\n' +
  '    return ""\n' +
  '  end try\n' +
  'end sysVolume\n';

export function macFetchScript(includeBrowser: boolean): string {
  const blocks = macAppBlocks(includeBrowser).map((b) => macAppBlock(b.app, b.body));
  return (
    'on run\n' +
    '  set theResult to ""\n' +
    blocks.join('\n') +
    '\n  return theResult\n' +
    'end run\n' +
    MAC_SCRIPT_FOOTER
  );
}

/* one runnable script per app, so a hanging app (Music artwork fetch, a
   browser with hundreds of tabs) can only delay itself — fetchMac runs them
   in parallel, each with its own timeout */
function singleAppScript(app: string, body: string): string {
  return (
    'on run\n' +
    '  set theResult to ""\n' +
    macAppBlock(app, body) +
    '\n  return theResult\n' +
    'end run\n' +
    MAC_SCRIPT_FOOTER
  );
}

export function macFetchBlocks(includeBrowser: boolean): string[] {
  return macAppBlocks(includeBrowser).map((b) => singleAppScript(b.app, b.body));
}

function intOrNull(value: string): number | null {
  const n = parseInt(value, 10);
  return isNaN(n) ? null : n;
}

export function parseMacMediaLine(output: string | null): MacMediaLine | null {
  const fields = String(output || '').split('\t');
  const backend = fields[0];
  if (backend === 'spotify' || backend === 'music') {
    return {
      backend,
      title: fields[1] || '',
      artist: fields[2] || '',
      coverUrl: fields[3] || null,
      playing: fields[4] === 'playing',
      playerVolume: intOrNull(fields[5] || ''),
      sysVolume: intOrNull(fields[6] || ''),
      url: null,
      jsOk: false,
      isPaused: null,
      canNext: false,
      canPrev: false,
      winIdx: null,
      tabIdx: null,
    };
  }
  if (!isBrowserBackend(backend)) {
    return null;
  }
  return {
    backend: backend as BrowserBackend,
    title: fields[1] || '',
    artist: '',
    coverUrl: null,
    playing: fields[3] !== 'true',
    playerVolume: intOrNull(fields[5] || ''),
    sysVolume: intOrNull(fields[10] || ''),
    url: fields[2] || null,
    jsOk: fields[4] === '1',
    isPaused: fields[3] === 'true' ? true : fields[3] === 'false' ? false : null,
    canNext: fields[6] === 'true',
    canPrev: fields[7] === 'true',
    winIdx: intOrNull(fields[8] || ''),
    tabIdx: intOrNull(fields[9] || ''),
  };
}

/* the fetch script emits one tab-separated line per running app; each line
   keeps the existing single-line contract so parseMacMediaLine stays the
   single parser */
export function parseMacMediaLines(output: string | null): MacMediaLine[] {
  const lines = String(output || '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const result: MacMediaLine[] = [];
  for (const line of lines) {
    const parsed = parseMacMediaLine(line);
    if (parsed) {
      result.push(parsed);
    }
  }
  return result;
}

/* browser music: only sites that update document.title with the track, and
   only titles that parse — browser tabs on other sites fall through */
const MUSIC_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'open.spotify.com',
  'play.spotify.com',
  'soundcloud.com',
  'm.soundcloud.com',
  'music.apple.com',
  'itunes.apple.com',
  'play.google.com',
  'music.google.com',
  'deezer.com',
  'www.deezer.com',
  'tidal.com',
  'listen.tidal.com',
  'bandcamp.com',
  'music.bandcamp.com',
  'music.amazon.com',
]);

const SITE_SUFFIXES = [
  /\s+-\s+YouTube Music\s*$/i,
  /\s+-\s+YouTube\s*$/i,
  /\s+-\s+Spotify\s*$/i,
  /\s+-\s+SoundCloud\s*$/i,
  /\s+-\s+Apple Music\s*$/i,
  /\s+-\s+Deezer\s*$/i,
  /\s+-\s+Tidal\s*$/i,
  /\s+-\s+Bandcamp\s*$/i,
  /\s+-\s+Google Play Music\s*$/i,
];

const GENERIC_TITLES = new Set([
  'YouTube',
  'Spotify',
  'SoundCloud',
  'New Tab',
  'Home',
  'Music',
  'Apple Music',
  'Web Player',
  'YouTube Music',
]);

export function parseBrowserTabTitle(
  title: string,
  url: string,
): { track: string; artist: string } | null {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  const hostBase = host.startsWith('www.') ? host.slice(4) : host;
  if (!MUSIC_HOSTS.has(host) && !MUSIC_HOSTS.has(hostBase)) {
    return null;
  }
  let text = String(title || '').trim();
  for (const suffix of SITE_SUFFIXES) {
    text = text.replace(suffix, '').trim();
  }
  if (!text || GENERIC_TITLES.has(text)) {
    return null;
  }
  const parts = text.split(/\s+[–—|-]\s+/);
  const track = parts[0].trim();
  if (!track) {
    return null;
  }
  return { track, artist: parts.length > 1 ? parts.slice(1).join(' - ').trim() : '' };
}

/* converts one probe line into a selectable source; browser lines always
   produce a source so Chromium/Safari stay pickable — music-site tabs get
   their parsed track/artist and full controls, any other tab shows the raw
   tab title with whatever controls the page actually exposes */
export function macLineToSource(line: MacMediaLine): NowPlayingSource | null {
  if (isBrowserBackend(line.backend)) {
    const parsed = parseBrowserTabTitle(line.title, line.url || '');
    const jsOk = isChromiumBackend(line.backend) && line.jsOk && macChromeJsOk;
    const player = BROWSER_PLAYER_NAMES[line.backend] || line.backend;
    const playing = isChromiumBackend(line.backend) && line.jsOk ? line.isPaused !== true : true;
    const controls: MediaControls = !jsOk
      ? 'none'
      : line.canNext || line.canPrev
        ? 'all'
        : 'playPause';
    return {
      id: line.backend,
      player,
      title: parsed?.track || line.title || player,
      artist: parsed ? parsed.artist : '',
      playing,
      volume:
        line.playerVolume !== null && line.playerVolume >= 0 ? line.playerVolume : line.sysVolume,
      coverUrl: null,
      controls,
      canVolume: jsOk,
    };
  }
  return {
    id: line.backend,
    player: line.backend === 'spotify' ? 'Spotify' : 'Music',
    title: line.title,
    artist: line.artist,
    playing: line.playing,
    volume: line.sysVolume,
    coverUrl: line.coverUrl,
    controls: 'all',
    canVolume: line.sysVolume !== null,
  };
}

/* maps the MediaRemote probe line into a selectable source; MediaRemote
   exposes no volume control, so the slider value comes from the OS-wide
   probe instead */
export function remoteLineToSource(
  line: RemoteSourceLine,
  sysVolume: number | null,
): NowPlayingSource {
  return {
    id: line.app,
    player: line.app,
    title: line.title,
    artist: line.artist,
    playing: line.playing,
    volume: sysVolume,
    coverUrl: line.artUrl,
    controls: 'all',
    canVolume: sysVolume !== null,
  };
}

/* Firefox source built from the CDP probe; CDP gives full JS control of the
   page, so the source gets transport + page volume like a Chromium tab */
async function firefoxSource(): Promise<NowPlayingSource | null> {
  const firefox = await probeFirefoxMedia();
  if (!firefox) {
    return null;
  }
  const { volume } = await fetchSystemVolume();
  return {
    id: 'firefox',
    player: 'Firefox',
    title: firefox.title,
    artist: '',
    playing: firefox.playing,
    volume: firefox.pageVolume !== null && firefox.pageVolume >= 0 ? firefox.pageVolume : volume,
    coverUrl: null,
    controls: 'all',
    canVolume: firefox.pageVolume !== null,
  };
}

/* the manual fallback: a lightweight AppleScript probe that reads only the
   active tab's title — works without the "Allow JavaScript from Apple
   Events" permission; transport and volume degrade to none. Firefox has no
   AppleScript at all, so its manual path is the CDP probe itself */
async function fetchManualBrowserSource(manual: ManualBrowser): Promise<NowPlayingSource | null> {
  if (manual === 'firefox') {
    return firefoxSource();
  }
  const appName = manual === 'chrome' ? 'Google Chrome' : 'Safari';
  const tabRef = manual === 'chrome' ? 'active tab of front window' : 'current tab of front window';
  const body =
    'return \\"' +
    manual +
    '\\" & sep & (name of ' +
    tabRef +
    ' as text) & sep & (URL of ' +
    tabRef +
    ' as text) & sep & \\"\\" & sep & \\"0\\" & sep & \\"\\" & sep & \\"false\\" & sep & \\"false\\" & sep & \\"\\" & sep & \\"\\"';
  const output = await runScriptFile(
    'hyper-kit-media-',
    'media.sh',
    singleAppScript(appName, body),
    (scriptPath) => 'osascript "' + scriptPath + '"',
    5000,
    noteProbeError,
  );
  const lines = parseMacMediaLines(output);
  return lines.length > 0 ? macLineToSource(lines[0]) : null;
}

async function fetchMac(): Promise<NowPlayingSource[] | null> {
  const browserMedia = isBrowserMediaEnabled();
  macBrowserTargets = {};
  /* each app runs as its own osascript with its own timeout, in parallel:
     a slow app (Music artwork fetch, a browser with many tabs) can only
     cost itself — it can never stall the other sources */
  const outputs = await Promise.all(
    macFetchBlocks(browserMedia).map((script) =>
      runScriptFile(
        'hyper-kit-media-',
        'media.sh',
        script,
        (scriptPath) => 'osascript "' + scriptPath + '"',
        6000,
        noteProbeError,
      ),
    ),
  );
  const output = outputs.join('\n');
  const sources: NowPlayingSource[] = [];
  for (const line of parseMacMediaLines(output)) {
    /* remember the exact window/tab so transport commands hit the tab the
       probe found, not whatever happens to be active */
    if (line.winIdx !== null && line.tabIdx !== null) {
      macBrowserTargets[line.backend] = { win: line.winIdx, tab: line.tabIdx };
    }
    const source = macLineToSource(line);
    if (source) {
      sources.push(source);
    }
  }
  /* browsers don't register a MediaRemote session, so their layer is the
     AppleScript scan above plus the Firefox CDP probe (only active when
     Firefox runs with --remote-debugging-port); a manual override in
     ~/.hyper.js forces a tab-title-only source when auto-detection failed */
  if (browserMedia) {
    const hasBrowser = sources.some((s) => isBrowserBackend(s.id));
    if (!hasBrowser) {
      const manual = getManualBrowser();
      if (manual) {
        const manualSource = await fetchManualBrowserSource(manual);
        if (manualSource) {
          sources.push(manualSource);
        }
      }
      const firefox = await firefoxSource();
      if (firefox) {
        sources.push(firefox);
      }
    }
  }
  /* MediaRemote covers every app that registers a media session; Spotify,
     Music and the browsers are already handled by the layers above, so
     their sessions are skipped to avoid a duplicate source */
  if (browserMedia) {
    const remote = await probeMediaRemote();
    if (remote && !REMOTE_SKIP_APPS.has(remote.app)) {
      const { volume } = await fetchSystemVolume();
      sources.push(remoteLineToSource(remote, volume));
    }
  }
  sources.sort((a, b) => (a.playing === b.playing ? 0 : a.playing ? -1 : 1));
  return sources.length > 0 ? sources : null;
}
/* --- Windows: PowerShell SMTC + winmm master volume ---------------------- */

const SMTC_FETCH_SCRIPT = [
  "$ErrorActionPreference = 'SilentlyContinue'",
  'try {',
  '  $mgr = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]::RequestAsync().GetAwaiter().GetResult()',
  '  $sess = $mgr.GetCurrentSession()',
  '  if ($null -eq $sess) { Write-Output "none"; exit 0 }',
  '  $info = $sess.GetPlaybackInfo()',
  '  $status = "unknown"',
  '  if ($null -ne $info) { $status = [string]$info.PlaybackStatus }',
  '  $props = $sess.TryGetMediaPropertiesAsync().GetAwaiter().GetResult()',
  '  $title = "--"; $artist = "--"; $thumb = ""',
  '  if ($null -ne $props) {',
  '    $title = [string]$props.Title',
  '    $artist = [string](($props.Artist -join ", "))',
  '    try {',
  '      $ref = $props.Thumbnail',
  '      if ($null -ne $ref) {',
  '        $stream = $ref.TryGetThumbnailAsync().GetAwaiter().GetResult()',
  '        if ($null -ne $stream) {',
  '          $tmp = Join-Path $env:TEMP "hyper-kit-cover.jpg"',
  '          $input = [Windows.Storage.Streams.WindowsRuntimeStreamExtensions, Windows.Storage.Streams, ContentType = WindowsRuntime]::AsStreamForRead($stream)',
  '          $fs = [IO.File]::Open($tmp, [IO.FileMode]::Create)',
  '          $input.CopyTo($fs)',
  '          $fs.Dispose()',
  '          $thumb = "file:///" + ($tmp -replace "\\\\", "/")',
  '        }',
  '      }',
  '    } catch {}',
  '  }',
  '  Write-Output ($title + "`t" + $artist + "`t" + $status + "`t" + $thumb)',
  '  exit 0',
  '} catch { Write-Output "none"; exit 0 }',
].join('\n');

export function parseSmtcOutput(output: string | null): SmtcInfo | null {
  const text = String(output || '');
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && line !== 'none');
  const session = lines.find((line) => line.indexOf('\t') >= 0);
  if (!session) {
    return null;
  }
  const fields = session.split('\t');
  const title = fields[0] || '';
  const artist = fields[1] || '';
  const status = fields[2] || '';
  const coverUrl = fields[3] || null;
  if (!title || title === '--') {
    return null;
  }
  return {
    title,
    artist,
    playing: status === 'Playing' ? true : status === 'Paused' ? false : null,
    coverUrl,
  };
}

async function fetchWindows(): Promise<NowPlayingSource[] | null> {
  const output = await runScriptFile(
    'hyper-kit-media-',
    'media.sh',
    SMTC_FETCH_SCRIPT,
    (scriptPath) => 'powershell -NoProfile -ExecutionPolicy Bypass -File "' + scriptPath + '"',
    8000,
    noteProbeError,
  );
  const smtc = parseSmtcOutput(output);
  if (!smtc || smtc.playing === null) {
    return null;
  }
  const { volume } = await fetchSystemVolume();
  return [
    {
      id: 'windows',
      player: 'Windows',
      title: smtc.title,
      artist: smtc.artist,
      playing: smtc.playing,
      volume,
      coverUrl: smtc.coverUrl,
      controls: 'all',
      canVolume: volume !== null,
    },
  ];
}

/* --- public API ----------------------------------------------------------- */

export async function fetchNowPlayingSources(): Promise<NowPlayingSource[]> {
  lastProbeError = null;
  if (!hasNodeRuntime() || typeof process === 'undefined') {
    return [];
  }
  if (process.platform === 'linux') {
    return (await fetchLinux()) || [];
  }
  if (process.platform === 'darwin') {
    return (await fetchMac()) || [];
  }
  if (process.platform === 'win32') {
    return (await fetchWindows()) || [];
  }
  return [];
}

/* browser skip/volume JS uses selectors without quotes so the whole snippet
   stays free of double quotes (which would need triple-level escaping) */
const CHROME_JS: Record<MediaCommand, string | null> = {
  ...COMMAND_JS,
  volUp: "var v=document.querySelector('video');if(v){v.volume=Math.min(1,v.volume+0.1)}",
  volDown: "var v=document.querySelector('video');if(v){v.volume=Math.max(0,v.volume-0.1)}",
};

/* runs a Chromium JS snippet in the tab the probe found; returns false when
   the osascript call fails (usually the user disabled "Allow JavaScript from
   Apple Events") so callers can degrade the transport buttons */
async function runChromeJs(appName: string, backend: string, js: string): Promise<boolean> {
  const target = macBrowserTargets[backend];
  const jsPart = '\\"' + js + '\\"';
  const scripts: string[] = [];
  if (target) {
    scripts.push(
      'if application "' +
        appName +
        '" is running then\n' +
        '  run script "tell application \\"' +
        appName +
        '\\" to execute tab ' +
        target.tab +
        ' of window ' +
        target.win +
        ' javascript ' +
        jsPart +
        '"\n' +
        'end if',
    );
  }
  /* fallback (no target cached yet, or the tab was closed since the probe):
     the active tab; a stale target failing is not a permission problem, so
     only a failure of this fallback flips macChromeJsOk */
  scripts.push(
    'if application "' +
      appName +
      '" is running then\n' +
      '  run script "tell application \\"' +
      appName +
      '\\" to execute front window\'s active tab javascript ' +
      jsPart +
      '"\n' +
      'end if',
  );
  if (target) {
    const targeted = await runScriptFile(
      'hyper-kit-media-',
      'media.sh',
      scripts[0],
      (scriptPath) => 'osascript "' + scriptPath + '"',
      3000,
      noteProbeError,
    );
    if (targeted !== null) {
      return true;
    }
    delete macBrowserTargets[backend];
  }
  const fallback = await runScriptFile(
    'hyper-kit-media-',
    'media.sh',
    scripts[scripts.length - 1],
    (scriptPath) => 'osascript "' + scriptPath + '"',
    3000,
    noteProbeError,
  );
  return fallback !== null;
}

function macControlScript(backend: 'spotify' | 'music', command: MediaCommand): string | null {
  /* the running guard keeps a stale backend (app quit since the last poll)
     from making osascript launch or hang on the app */
  const verb =
    command === 'prev' ? 'previous track' : command === 'next' ? 'next track' : 'playpause';
  return (
    'if application "' +
    (backend === 'spotify' ? 'Spotify' : 'Music') +
    '" is running then\n' +
    '  run script "tell application \\"' +
    (backend === 'spotify' ? 'Spotify' : 'Music') +
    '\\" to ' +
    verb +
    '"\n' +
    'end if'
  );
}

function clampVolume(volume: number | null, up: boolean): number | null {
  if (volume === null || isNaN(volume)) {
    return null;
  }
  const step = 10;
  return Math.max(0, Math.min(100, up ? volume + step : volume - step));
}

function smtcControlScript(command: MediaCommand): string {
  const action =
    command === 'prev'
      ? 'TrySkipPreviousAsync'
      : command === 'next'
        ? 'TrySkipNextAsync'
        : 'status-based';
  const lines = [
    "$ErrorActionPreference = 'SilentlyContinue'",
    'try {',
    '  $mgr = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]::RequestAsync().GetAwaiter().GetResult()',
    '  $sess = $mgr.GetCurrentSession()',
    '  if ($null -eq $sess) { exit 0 }',
  ];
  if (action === 'status-based') {
    lines.push(
      '  $info = $sess.GetPlaybackInfo()',
      '  if ([string]$info.PlaybackStatus -eq "Playing") { $null = $sess.TryPauseAsync().GetAwaiter().GetResult() }',
      '  else { $null = $sess.TryPlayAsync().GetAwaiter().GetResult() }',
    );
  } else {
    lines.push('  $null = $sess.' + action + '().GetAwaiter().GetResult()');
  }
  lines.push('} catch {}');
  return lines.join('\n');
}

export async function sendMediaCommand(
  command: MediaCommand,
  volume: number | null = null,
  sourceId: string | null = null,
): Promise<void> {
  if (!hasNodeRuntime() || typeof process === 'undefined') {
    return;
  }
  if (command === 'volUp' || command === 'volDown') {
    const target = clampVolume(volume, command === 'volUp');
    if (target !== null) {
      /* browser sources nudge the page's video volume, everything else is
         the OS-wide output level */
      if (process.platform === 'darwin' && sourceId === 'firefox') {
        await sendFirefoxCommand(command, target);
      } else if (process.platform === 'darwin' && sourceId && isChromiumBackend(sourceId)) {
        const appName = chromiumAppName(sourceId);
        if (appName && macChromeJsOk) {
          const ok = await runChromeJs(appName, sourceId, volumeJs(target));
          if (!ok) {
            macChromeJsOk = false;
          }
        }
      } else {
        await setSystemVolume(target);
      }
    }
    return;
  }
  const linuxDest = sourceId || mprisDest;
  if (process.platform === 'linux' && linuxDest) {
    await execToString(mprisMethodCommand(linuxDest, MPRIS_METHODS[command]), 3000, {
      onError: noteProbeError,
    });
    return;
  }
  if (process.platform === 'darwin') {
    if (sourceId === 'spotify' || sourceId === 'music') {
      const script = macControlScript(sourceId, command);
      if (script) {
        await runScriptFile(
          'hyper-kit-media-',
          'media.sh',
          script,
          (scriptPath) => 'osascript "' + scriptPath + '"',
          3000,
          noteProbeError,
        );
      }
    } else if (sourceId === 'firefox') {
      await sendFirefoxCommand(command);
    } else if (sourceId !== null && isChromiumBackend(sourceId)) {
      const js = CHROME_JS[command];
      const appName = chromiumAppName(sourceId);
      if (js && appName && macChromeJsOk) {
        const ok = await runChromeJs(appName, sourceId, js);
        if (!ok) {
          macChromeJsOk = false;
        }
      }
    } else {
      await sendMediaRemoteCommand(command);
    }
    return;
  }
  if (process.platform === 'win32') {
    await runScriptFile(
      'hyper-kit-media-',
      'media.sh',
      smtcControlScript(command),
      (scriptPath) => 'powershell -NoProfile -ExecutionPolicy Bypass -File "' + scriptPath + '"',
      8000,
      noteProbeError,
    );
  }
}

export function resetMediaSession(): void {
  mprisDest = null;
  macChromeJsOk = true;
  macBrowserTargets = {};
}

/* absolute volume set, used by the media panel's slider; browser sources
   set the page's video volume (Chromium via AppleScript JS, Firefox via
   CDP), everything else targets the OS-wide output volume since per-app
   control is not available on macOS MediaRemote or Windows SMTC */
export async function setMediaVolume(
  volume: number,
  sourceId: string | null = null,
): Promise<void> {
  if (!hasNodeRuntime() || typeof process === 'undefined') {
    return;
  }
  const target = Math.max(0, Math.min(100, Math.round(volume)));
  if (process.platform === 'darwin' && sourceId !== null) {
    if (sourceId === 'firefox') {
      await sendFirefoxCommand('volUp', target);
      return;
    }
    if (isChromiumBackend(sourceId) && macChromeJsOk) {
      const appName = chromiumAppName(sourceId);
      if (appName) {
        const ok = await runChromeJs(appName, sourceId, volumeJs(target));
        if (!ok) {
          macChromeJsOk = false;
        }
        return;
      }
    }
  }
  await setSystemVolume(target);
}

export function cleanupTempCovers(): void {
  if (!hasNodeRuntime() || typeof process === 'undefined') {
    return;
  }
  try {
    const fs: any = window.require('fs');
    const path: any = window.require('path');
    const files =
      process.platform === 'darwin'
        ? ['/tmp/hyper-kit-cover-music.jpg', '/tmp/hyper-kit-cover-remote.jpg']
        : process.platform === 'win32'
          ? [path.join(window.require('os').tmpdir(), 'hyper-kit-cover.jpg')]
          : [];
    for (const file of files) {
      try {
        fs.unlinkSync(file);
      } catch {
        // cover file may never have been written; nothing to clean
      }
    }
  } catch {
    // fs may be unavailable outside Electron; cleanup is best-effort
  }
}
