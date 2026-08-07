import { describe, it, expect } from 'vitest';

import {
  parseMprisPlayers,
  parseMprisProperties,
  decodeDbusString,
  parseMacMediaLine,
  parseMacMediaLines,
  parseSmtcOutput,
  parseBrowserTabTitle,
  macFetchScript,
  macFetchBlocks,
  macLineToSource,
  remoteLineToSource,
  setMediaVolume,
} from '../../src/platform/now-playing';

const MPRIS_PLAYING_OUTPUT = [
  'method return time=1712222222.123456 sender=:1.57 -> destination=:1.99 serial=42 reply_serial=43',
  '   variant       array [',
  '      dict entry(',
  '         string "Metadata"',
  '         variant       array [',
  '            dict entry(',
  '               string "xesam:title"',
  '               variant             string "Chandelier"',
  '            )',
  '            dict entry(',
  '               string "xesam:artist"',
  '               variant             array [',
  '                  string "Sia"',
  '                  string "Maddie Ziegler"',
  '               ]',
  '            )',
  '            dict entry(',
  '               string "mpris:artUrl"',
  '               variant             string "https://example.com/art.jpg"',
  '            )',
  '         ]',
  '      )',
  '      dict entry(',
  '         string "PlaybackStatus"',
  '         variant             string "Playing"',
  '      )',
  '      dict entry(',
  '         string "Volume"',
  '         variant             double 0.65500000000000003',
  '      )',
  '   ]',
].join('\n');

const MPRIS_PAUSED_OUTPUT = MPRIS_PLAYING_OUTPUT.replace(
  'string "Playing"',
  'string "Paused"',
).replace('double 0.65500000000000003', 'double 0.25');

describe('parseMprisPlayers', () => {
  it('extracts and dedupes MPRIS destinations from ListNames output', () => {
    const out = [
      '   string "org.freedesktop.DBus"',
      '   string "org.mpris.MediaPlayer2.chromium.instance1234"',
      '   string "org.mpris.MediaPlayer2.spotify"',
      '   string "org.mpris.MediaPlayer2.spotify"',
    ].join('\n');
    expect(parseMprisPlayers(out)).toEqual([
      'org.mpris.MediaPlayer2.chromium.instance1234',
      'org.mpris.MediaPlayer2.spotify',
    ]);
  });

  it('returns an empty list when no players are registered', () => {
    expect(parseMprisPlayers('method return time=... array [ ]')).toEqual([]);
  });
});

describe('parseMprisProperties', () => {
  it('reads title, first artist, artUrl, status and volume', () => {
    const props = parseMprisProperties(MPRIS_PLAYING_OUTPUT);
    expect(props).toEqual({
      title: 'Chandelier',
      artist: 'Sia',
      artUrl: 'https://example.com/art.jpg',
      playing: true,
      volume: 66,
    });
  });

  it('maps a paused status to playing false', () => {
    const props = parseMprisProperties(MPRIS_PAUSED_OUTPUT);
    expect(props.playing).toBe(false);
    expect(props.volume).toBe(25);
  });

  it('returns nulls for an empty or failed response', () => {
    expect(parseMprisProperties(null)).toEqual({
      title: null,
      artist: null,
      artUrl: null,
      playing: null,
      volume: null,
    });
  });
});

describe('decodeDbusString', () => {
  it('unescapes quotes, slashes and control characters', () => {
    expect(decodeDbusString('He said \\"hi\\" \\\\ fine\\ntab\\t')).toBe(
      'He said "hi" \\ fine\ntab\t',
    );
  });
});

describe('parseMacMediaLine', () => {
  it('parses a Spotify line with player and system volume', () => {
    expect(
      parseMacMediaLine('spotify\tChandelier\tSia\thttps://example.com/art.jpg\tplaying\t45\t57'),
    ).toEqual({
      backend: 'spotify',
      title: 'Chandelier',
      artist: 'Sia',
      coverUrl: 'https://example.com/art.jpg',
      playing: true,
      playerVolume: 45,
      sysVolume: 57,
      url: null,
      jsOk: false,
      isPaused: null,
      canNext: false,
      canPrev: false,
      winIdx: null,
      tabIdx: null,
    });
  });

  it('parses a paused Music line', () => {
    const line = parseMacMediaLine('music\tAlbum\tsomeArtist\t\tpaused\t30\t57');
    expect(line).toMatchObject({ backend: 'music', playing: false, coverUrl: null });
    expect(line!.title).toBe('Album');
  });

  it('parses a Chromium line with jsOk, page volume, transport flags and tab target', () => {
    expect(
      parseMacMediaLine(
        'chrome\tChandelier - Sia - YouTube\thttps://youtube.com/watch?v=1\tfalse\t1\t67\ttrue\ttrue\t1\t1\t57',
      ),
    ).toEqual({
      backend: 'chrome',
      title: 'Chandelier - Sia - YouTube',
      artist: '',
      coverUrl: null,
      playing: true,
      playerVolume: 67,
      sysVolume: 57,
      url: 'https://youtube.com/watch?v=1',
      jsOk: true,
      isPaused: false,
      canNext: true,
      canPrev: true,
      winIdx: 1,
      tabIdx: 1,
    });
  });

  it('parses a paused Chromium tab and a Safari tab', () => {
    const paused = parseMacMediaLine(
      'brave\tClip\thttps://x.test/v\ttrue\t1\t-1\tfalse\tfalse\t2\t3\t42',
    );
    expect(paused).toMatchObject({
      backend: 'brave',
      playing: false,
      isPaused: true,
      jsOk: true,
      winIdx: 2,
      tabIdx: 3,
    });
    const safari = parseMacMediaLine(
      'safari\tHome\thttps://example.com\t\t0\t\tfalse\tfalse\t\t\t42',
    );
    expect(safari).toMatchObject({
      backend: 'safari',
      playing: true,
      jsOk: false,
      url: 'https://example.com',
      winIdx: null,
      tabIdx: null,
    });
  });

  it('parses beta/dev/canary channel builds and other Chromium forks', () => {
    const beta = parseMacMediaLine(
      'chrome-beta\tBeta Tab\thttps://x.test/v\ttrue\t1\t-1\tfalse\tfalse\t1\t1\t42',
    );
    expect(beta).toMatchObject({ backend: 'chrome-beta', jsOk: true });
    const nightly = parseMacMediaLine(
      'brave-nightly\tNightly Tab\thttps://x.test/v\ttrue\t1\t-1\tfalse\tfalse\t1\t1\t42',
    );
    expect(nightly).toMatchObject({ backend: 'brave-nightly', jsOk: true });
    expect(
      parseMacMediaLine('whale\tWhale Tab\thttps://x.test/v\ttrue\t1\t-1\tfalse\tfalse\t1\t1\t42'),
    ).toMatchObject({ backend: 'whale' });
    expect(
      parseMacMediaLine(
        'yandex\tYandex Tab\thttps://x.test/v\ttrue\t1\t-1\tfalse\tfalse\t1\t1\t42',
      ),
    ).toMatchObject({ backend: 'yandex' });
  });

  it('returns null for an empty response or unknown backends', () => {
    expect(parseMacMediaLine('')).toBeNull();
    expect(parseMacMediaLine('notabrowser\tSome Tab\turl\t\t0\t\tfalse\tfalse\t\t\t57')).toBeNull();
  });
});

describe('parseSmtcOutput', () => {
  it('reads a playing session with title, artist, status and thumbnail', () => {
    expect(
      parseSmtcOutput('Chandelier\tSia\tPlaying\tfile:///C:/temp/hyper-kit-cover.jpg'),
    ).toEqual({
      title: 'Chandelier',
      artist: 'Sia',
      playing: true,
      coverUrl: 'file:///C:/temp/hyper-kit-cover.jpg',
    });
  });

  it('maps a paused status to playing false', () => {
    expect(parseSmtcOutput('Chandelier\tSia\tPaused\t')).toEqual({
      title: 'Chandelier',
      artist: 'Sia',
      playing: false,
      coverUrl: null,
    });
  });

  it('returns null when there is no media session', () => {
    expect(parseSmtcOutput('none')).toBeNull();
  });

  it('returns null when the session has no title', () => {
    expect(parseSmtcOutput('--\t--\tPlaying\t')).toBeNull();
  });
});

describe('macFetchScript', () => {
  it('collects every matching app into a shared linefeed result', () => {
    const script = macFetchScript(false);
    expect(script).toContain('set theResult to ""');
    expect(script).toContain(
      'set theResult to theResult & line1 & tab & (my sysVolume()) & linefeed',
    );
    expect(script).not.toContain('return line1');
  });

  it('splits each app into its own runnable script so a hanging app is isolated', () => {
    const blocks = macFetchBlocks(false);
    expect(blocks).toHaveLength(2);
    for (const block of blocks) {
      expect(block).toContain('on run');
      expect(block).toContain('end run');
      expect(block).toContain('on sysVolume()');
    }
    const withBrowser = macFetchBlocks(true);
    expect(withBrowser).toHaveLength(32);
    const combined = macFetchScript(true);
    for (const block of withBrowser) {
      const inner = block.slice(block.indexOf('  try'), block.indexOf('\n  return theResult'));
      expect(combined).toContain(inner);
    }
  });

  it('emits the Spotify and Music app blocks', () => {
    const script = macFetchScript(false);
    expect(script).toContain('application "Spotify" is running');
    expect(script).toContain('application "Music" is running');
  });

  it('omits browser blocks when includeBrowser is false', () => {
    const script = macFetchScript(false);
    expect(script).not.toContain('Google Chrome');
    expect(script).not.toContain('Safari');
    expect(script).not.toContain('execute t javascript');
  });

  it('emits a Safari block and one block per Chromium app when enabled', () => {
    const script = macFetchScript(true);
    expect(script).toContain('application "Safari" is running');
    expect(script).toContain('name of current tab of front window as text');
    expect(script).toContain('application "Google Chrome" is running');
    expect(script).toContain('application "Brave Browser" is running');
    expect(script).toContain('application "Microsoft Edge" is running');
    expect(script).toContain('application "Arc" is running');
    expect(script).toContain('application "Dia" is running');
    expect(script).toContain('application "Google Chrome Beta" is running');
    expect(script).toContain('application "Microsoft Edge Canary" is running');
    expect(script).toContain('application "Brave Browser Nightly" is running');
    expect(script).toContain('application "Opera GX" is running');
    expect(script).toContain('application "Vivaldi Snapshot" is running');
    expect(script).toContain('application "Whale" is running');
    expect(script).toContain('application "Yandex" is running');
    expect(script).toContain('execute tab t of window w javascript');
    expect(script).toContain("!!document.querySelector('video')");
  });

  it('reports the window/tab index of the playing tab so commands can target it', () => {
    const script = macFetchScript(true);
    expect(script).toContain('repeat with w from 1 to (count of windows)');
    expect(script).toContain('repeat with t from 1 to (count of tabs of window w)');
    expect(script).toContain('execute tab t of window w javascript');
    expect(script).toContain('& sep & wIdx & sep & tIdx');
  });

  it('wraps every app block in try so an uninstalled app cannot abort the script', () => {
    const script = macFetchScript(true);
    const blocks = script.match(/\n  try\n    if application "[^"]+" is running then/g) || [];
    expect(blocks.length).toBeGreaterThan(0);
    expect(script).toContain('end try');
  });

  it('avoids the shadowable tab constant inside app blocks', () => {
    const script = macFetchScript(true);
    const runScripts = script.match(/run script "(?:[^"\\]|\\.)+"/g) || [];
    expect(runScripts.length).toBeGreaterThan(0);
    for (const block of runScripts) {
      expect(block).toContain('set sep to ASCII character 9');
      expect(block).not.toContain('& tab &');
    }
  });

  it('matches tabs by video element — playing or paused — so a paused video stays resumable', () => {
    const script = macFetchScript(true);
    expect(script).toContain('set vExists to (execute tab t of window w javascript');
    expect(script).toContain("!!document.querySelector('video')");
    expect(script).toContain('if vExists is \\"true\\" then');
    expect(script).toContain(
      "\\\"!!document.querySelector('video') && document.querySelector('video').paused\\\"",
    );
  });

  it('falls back to the active tab title when no tab holds a video element', () => {
    const script = macFetchScript(true);
    expect(script).toContain('if foundTab is false then');
    expect(script).toContain('set tTitle to title of active tab of front window as text');
  });
});

describe('parseMacMediaLines', () => {
  it('parses one line per running app in output order', () => {
    const output = [
      'spotify\tChandelier\tSia\thttps://example.com/art.jpg\tplaying\t45\t57',
      'music\tAlbum\tsomeArtist\t\tpaused\t30\t57',
    ].join('\n');
    const lines = parseMacMediaLines(output);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ backend: 'spotify', title: 'Chandelier', playing: true });
    expect(lines[1]).toMatchObject({ backend: 'music', title: 'Album', playing: false });
  });

  it('skips empty lines and unparseable backends', () => {
    expect(parseMacMediaLines('\n\n')).toEqual([]);
    expect(parseMacMediaLines('random\tjunk\nmusic\tA\tB\t\tplaying\t30\t57')).toHaveLength(1);
  });

  it('returns an empty list for null output', () => {
    expect(parseMacMediaLines(null)).toEqual([]);
  });
});

describe('parseBrowserTabTitle', () => {
  it('parses a YouTube tab title into track and artist', () => {
    expect(
      parseBrowserTabTitle('Chandelier - Sia - YouTube', 'https://www.youtube.com/watch?v=1'),
    ).toEqual({ track: 'Chandelier', artist: 'Sia' });
  });

  it('parses a YouTube Music tab title', () => {
    expect(
      parseBrowserTabTitle(
        'Blinding Lights - The Weeknd - YouTube Music',
        'https://music.youtube.com/watch?v=2',
      ),
    ).toEqual({ track: 'Blinding Lights', artist: 'The Weeknd' });
  });

  it('returns null for non-music sites and generic titles', () => {
    expect(parseBrowserTabTitle('Some Page', 'https://example.com/docs')).toBeNull();
    expect(parseBrowserTabTitle('YouTube', 'https://www.youtube.com/')).toBeNull();
    expect(parseBrowserTabTitle('Chandelier - Sia - YouTube', 'not-a-url')).toBeNull();
  });
});

describe('macLineToSource', () => {
  it('maps a spotify line to a full-control source at the system volume', () => {
    const source = macLineToSource(
      parseMacMediaLine('spotify\tChandelier\tSia\thttps://example.com/art.jpg\tplaying\t45\t57')!,
    );
    expect(source).toMatchObject({
      id: 'spotify',
      player: 'Spotify',
      title: 'Chandelier',
      artist: 'Sia',
      volume: 57,
      controls: 'all',
      canVolume: true,
    });
  });

  it('maps a paused music line with a null system volume', () => {
    const source = macLineToSource(parseMacMediaLine('music\tAlbum\tsomeArtist\t\tpaused\t30\t')!);
    expect(source).toMatchObject({
      id: 'music',
      playing: false,
      volume: null,
      canVolume: false,
      controls: 'all',
    });
  });

  it('maps a jsOk Chromium tab to a source with parsed track, controls and page volume', () => {
    const source = macLineToSource(
      parseMacMediaLine(
        'chrome\tChandelier - Sia - YouTube\thttps://youtube.com/watch?v=1\tfalse\t1\t67\ttrue\ttrue\t1\t1\t57',
      )!,
    );
    expect(source).toMatchObject({
      id: 'chrome',
      player: 'Chrome',
      title: 'Chandelier',
      artist: 'Sia',
      playing: true,
      volume: 67,
      controls: 'all',
      canVolume: true,
    });
  });

  it('degrades a Chromium tab without JS permission to title-only', () => {
    const source = macLineToSource(
      parseMacMediaLine('edge\tSome Page\thttps://example.com\t\t0\t\tfalse\tfalse\t\t\t57')!,
    );
    expect(source).toMatchObject({
      id: 'edge',
      player: 'Edge',
      title: 'Some Page',
      controls: 'none',
      canVolume: false,
    });
  });

  it('maps a Safari tab to an always-pickable transport-less source', () => {
    const source = macLineToSource(
      parseMacMediaLine('safari\tHome\thttps://example.com\t\t0\t\tfalse\tfalse\t\t\t57')!,
    );
    expect(source).toMatchObject({
      id: 'safari',
      player: 'Safari',
      title: 'Home',
      playing: true,
      controls: 'none',
      canVolume: false,
    });
  });
});

describe('remoteLineToSource', () => {
  const line = {
    app: 'Chrome',
    title: 'Chandelier',
    artist: 'Sia',
    playing: true,
    artUrl: 'file:///tmp/hyper-kit-cover-remote.jpg',
  };

  it('maps a MediaRemote session to a source keyed by app name', () => {
    expect(remoteLineToSource(line, 57)).toMatchObject({
      id: 'Chrome',
      player: 'Chrome',
      title: 'Chandelier',
      artist: 'Sia',
      playing: true,
      volume: 57,
      coverUrl: 'file:///tmp/hyper-kit-cover-remote.jpg',
      controls: 'all',
      canVolume: true,
    });
  });

  it('keeps a paused session pickable with accurate state', () => {
    const source = remoteLineToSource({ ...line, playing: false }, 40);
    expect(source.playing).toBe(false);
    expect(source.controls).toBe('all');
  });

  it('disables volume when the OS volume probe is unavailable', () => {
    const source = remoteLineToSource({ ...line, artUrl: null }, null);
    expect(source.volume).toBeNull();
    expect(source.canVolume).toBe(false);
  });
});

describe('setMediaVolume', () => {
  it('resolves without throwing in a non-Electron environment', async () => {
    await expect(setMediaVolume(45)).resolves.toBeUndefined();
  });
});
