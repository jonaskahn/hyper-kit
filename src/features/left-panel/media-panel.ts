import {
  MEDIA_REFRESH_MS,
  getMediaAccent,
  isBrowserMediaEnabled,
  isMediaArtistVisible,
  isMediaPanelEnabled,
  isMediaWaveEnabled,
  readUiConfig,
} from '../../config';
import { ATTRIBUTES, SELECTORS } from '../../platform/dom-selectors';
import {
  cleanupTempCovers,
  fetchNowPlayingSources,
  getLastProbeError,
  resetMediaSession,
  sendMediaCommand,
  setMediaVolume,
  type MediaCommand,
  type NowPlayingSource,
} from '../../platform/now-playing';
import { getEnvPanelEl } from './env-panel';

/* volume-reactive speaker icon: base cone plus zero-to-three waves that
   grow with the volume; muted shows an X instead of waves */
const VOL_ICONS: Record<string, string> = {
  base: '<path d="M2 5.5v5h2.8L9 13.5v-11L4.8 5.5H2z" fill="currentColor"/>',
  muted:
    '<path d="M11.5 6.5l4 3M15.5 6.5l-4 3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
  low: '<path d="M11 6.2a2.4 2.4 0 0 1 0 3.6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
  mid: '<path d="M12.5 4.5a4.5 4.5 0 0 1 0 7" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
  high: '<path d="M14 3a7 7 0 0 1 0 10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
};

let panelEl: HTMLElement | null = null;
let pollInterval: ReturnType<typeof setInterval> | null = null;
let lastCoverUrl: string | null = null;
let lastVolume: number | null = null;
let lastAccent: string | null = null;
let lastArtistVisible: boolean | null = null;
let sliderDragging = false;
let sliderOpen = false;
let volumeDebounce: ReturnType<typeof setTimeout> | null = null;
let refreshing = false;
let pickerOpen = false;
let sources: NowPlayingSource[] = [];
let selectedId: string | null = null;

/* equalizer bars behind the card content, driven by a requestAnimationFrame
   loop while the panel carries the mp-playing class. Hyper cannot capture
   another app's PCM audio, so instead of a real spectrum each bar runs a
   per-track-seeded mix of sines (deterministic per song: same title/artist
   always produces the same "shape"), which restarts whenever the track
   changes and freezes to a static baseline on pause. The loop only runs
   while playing; reduced-motion users get the static baseline only. */
const MP_WAVE_BARS = 21;
let waveLoopId: number | null = null;
let waveSeed = 0;
let waveTrackKey: string | null = null;
let waveBars: HTMLElement[] = [];

function hashString(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function waveBarParams(
  seed: number,
  index: number,
): { freq: number; phase: number; amp: number; base: number } {
  let state = (seed ^ Math.imul(index + 1, 2654435761)) >>> 0;
  const next = (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
  return {
    freq: 0.9 + next() * 2.2,
    phase: next() * Math.PI * 2,
    amp: 0.4 + next() * 0.4,
    base: 0.1 + next() * 0.08,
  };
}

function tickWave(now: number): void {
  const t = now / 1000;
  for (let i = 0; i < waveBars.length; i++) {
    const p = waveBarParams(waveSeed, i);
    /* fast beat layered with a slow "breathing" wave so bars never sync into
       an obvious repeating loop */
    const fast = 0.5 + 0.5 * Math.sin(t * p.freq + p.phase);
    const slow = 0.6 + 0.4 * Math.sin(t * p.freq * 0.35 + p.phase * 2.3);
    const scale = Math.min(0.95, Math.max(0.05, p.base + p.amp * fast * slow));
    waveBars[i].style.transform = 'scaleY(' + scale.toFixed(3) + ')';
  }
  waveLoopId = requestAnimationFrame(tickWave);
}

function settleWave(): void {
  for (let i = 0; i < waveBars.length; i++) {
    const p = waveBarParams(waveSeed, i);
    waveBars[i].style.transform = 'scaleY(' + (p.base * 0.75).toFixed(3) + ')';
  }
}

function stopWave(): void {
  if (waveLoopId !== null && typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(waveLoopId);
  }
  waveLoopId = null;
  const waves = panelEl?.querySelector<HTMLElement>('.mp-waves');
  if (waves) {
    waves.classList.remove('running');
  }
  settleWave();
}

function prefersReducedMotion(): boolean {
  try {
    return (
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    );
  } catch {
    return false;
  }
}

function syncWave(playing: boolean, trackKey: string | null): void {
  const waves = panelEl?.querySelector<HTMLElement>('.mp-waves');
  if (!waves || waves.hidden) {
    stopWave();
    return;
  }
  if (trackKey !== null && trackKey !== waveTrackKey) {
    waveTrackKey = trackKey;
    waveSeed = hashString(trackKey);
  }
  if (playing && !prefersReducedMotion() && typeof requestAnimationFrame === 'function') {
    waves.classList.add('running');
    if (waveLoopId === null) {
      waveLoopId = requestAnimationFrame(tickWave);
    }
  } else {
    stopWave();
  }
}

function volumeIconLevel(volume: number | null): 'muted' | 'low' | 'mid' | 'high' {
  if (volume === null || volume <= 0) {
    return 'muted';
  }
  if (volume < 35) {
    return 'low';
  }
  if (volume < 70) {
    return 'mid';
  }
  return 'high';
}

function setVolumeIcon(volume: number | null): void {
  const icon = panelEl?.querySelector('[data-mp-vol-icon]');
  if (!icon) {
    return;
  }
  const html = VOL_ICONS.base + VOL_ICONS[volumeIconLevel(volume)];
  if (icon.innerHTML !== html) {
    icon.innerHTML = html;
  }
}

export function getMediaPanelEl(): HTMLElement | null {
  return panelEl;
}

function mountPanel(): void {
  if (!panelEl) {
    return;
  }
  /* never fall back to document.body: Hyper's .hyper_main is a fixed overlay
     that covers the viewport, so a panel parked on the body is hidden behind
     it forever. If the header isn't in the DOM yet the panel stays detached
     and reattachMediaPanel() mounts it once the header appears. */
  const headerHost = document.querySelector(SELECTORS.headerHeader);
  if (!headerHost) {
    return;
  }
  const envEl = getEnvPanelEl();
  if (envEl && envEl.isConnected && envEl.parentElement === headerHost) {
    /* gate the reposition: inserting an already-correctly-placed node still
       fires a childList mutation in jsdom, and doing that on every sync
       would loop forever (observer -> sync -> insert -> observer -> ...) */
    if (panelEl.parentElement !== headerHost || panelEl.nextSibling !== envEl) {
      headerHost.insertBefore(panelEl, envEl);
    }
  } else if (panelEl.parentElement !== headerHost) {
    headerHost.appendChild(panelEl);
  }
}

function selectSource(id: string): void {
  if (!sources.some((s) => s.id === id)) {
    return;
  }
  selectedId = id;
  const info = sources.find((s) => s.id === id)!;
  renderInfo(info);
  renderPicker();
}

function setPickerOpen(open: boolean): void {
  pickerOpen = open;
  const wrap = panelEl?.querySelector<HTMLElement>('[data-mp-picker-wrap]');
  const trigger = panelEl?.querySelector<HTMLButtonElement>('[data-mp-picker]');
  const menu = panelEl?.querySelector<HTMLElement>('[data-mp-picker-menu]');
  if (wrap) {
    wrap.classList.toggle('open', open);
  }
  if (trigger) {
    trigger.setAttribute('aria-expanded', String(open));
  }
  if (menu) {
    menu.hidden = !open;
  }
}

function buildMediaPanel(): HTMLElement {
  if (panelEl) {
    mountPanel();
    return panelEl;
  }
  const panel = document.createElement('div');
  panel.setAttribute(ATTRIBUTES.mediaPanel, '');
  panel.innerHTML =
    '<div class="mp-body">' +
    '<div class="mp-waves" data-mp-waves aria-hidden="true"' +
    (isMediaWaveEnabled() ? '' : ' hidden') +
    '>' +
    '<span></span>'.repeat(MP_WAVE_BARS) +
    '</div>' +
    '<div class="mp-row1">' +
    '<div class="mp-picker-wrap" data-mp-picker-wrap>' +
    '<button class="mp-picker" data-mp-picker aria-haspopup="listbox" aria-expanded="false" title="Choose provider" aria-label="Choose provider" type="button">' +
    '<span class="mp-picker-label" data-mp-picker-label>—</span>' +
    '<span class="mp-picker-chev" aria-hidden="true"><svg width="8" height="6" viewBox="0 0 8 6"><path d="M0 6l4-6 4 6z" fill="currentColor"/></svg></span>' +
    '</button>' +
    '<div class="mp-picker-menu" data-mp-picker-menu role="listbox" hidden></div>' +
    '</div>' +
    '<div class="mp-vol-row">' +
    '<div class="mp-vol" data-mp-vol-wrap hidden>' +
    '<input class="mp-range" data-mp-vol type="range" min="0" max="100" step="5" value="0" aria-label="Volume" disabled />' +
    '</div>' +
    '<button class="mp-vol-toggle" data-mp-vol-toggle aria-expanded="false" aria-haspopup="true" title="Volume" aria-label="Volume" type="button">' +
    '<svg data-mp-vol-icon width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">' +
    VOL_ICONS.base +
    '</svg>' +
    '</button>' +
    '</div>' +
    '</div>' +
    '<div class="mp-top">' +
    '<img class="mp-cover" data-mp-cover alt="" hidden />' +
    '<span class="mp-note" data-mp-note hidden>♪</span>' +
    '<div class="mp-text">' +
    '<div class="mp-title" data-mp-title>—</div>' +
    '<div class="mp-artist" data-mp-artist></div>' +
    '</div>' +
    '<div class="mp-controls">' +
    '<button class="mp-btn" data-mp-cmd="prev" title="Previous" type="button">⏮</button>' +
    '<button class="mp-btn mp-play" data-mp-cmd="playPause" title="Play / Pause" type="button">▶</button>' +
    '<button class="mp-btn" data-mp-cmd="next" title="Next" type="button">⏭</button>' +
    '</div>' +
    '</div>' +
    '</div>' +
    '<div class="mp-idle" data-mp-idle hidden>♪ No media playing</div>' +
    '<div class="mp-hint" data-mp-hint hidden></div>';
  panel.querySelectorAll<HTMLButtonElement>('.mp-btn').forEach((button) => {
    button.addEventListener('click', () => {
      if (button.dataset['mpCmd'] === 'playPause') {
        /* optimistic flip: give instant feedback while the async probe
           catches up; the next refresh() re-syncs to the real state */
        const nowPlaying = !panel.classList.contains('mp-playing');
        panel.classList.toggle('mp-playing', nowPlaying);
        syncWave(nowPlaying, waveTrackKey);
      }
      sendMediaCommand(button.dataset['mpCmd'] as MediaCommand, lastVolume, selectedId);
      refresh();
    });
  });
  const toggle = panel.querySelector<HTMLButtonElement>('[data-mp-vol-toggle]');
  if (toggle) {
    toggle.addEventListener('click', () => {
      sliderOpen = !sliderOpen;
      setSliderOpen(sliderOpen);
    });
  }
  const slider = panel.querySelector<HTMLInputElement>('[data-mp-vol]');
  if (slider) {
    slider.addEventListener('input', () => {
      sliderDragging = true;
      const value = parseInt(slider.value, 10);
      lastVolume = value;
      if (volumeDebounce) {
        clearTimeout(volumeDebounce);
      }
      volumeDebounce = setTimeout(() => {
        volumeDebounce = null;
        setMediaVolume(value, selectedId);
      }, 250);
    });
    slider.addEventListener('change', () => {
      const value = parseInt(slider.value, 10);
      lastVolume = value;
      if (volumeDebounce) {
        clearTimeout(volumeDebounce);
        volumeDebounce = null;
      }
      sliderDragging = false;
      setMediaVolume(value, selectedId);
      refresh();
    });
  }
  const trigger = panel.querySelector<HTMLButtonElement>('[data-mp-picker]');
  if (trigger) {
    trigger.addEventListener('click', () => {
      setPickerOpen(!pickerOpen);
    });
  }
  const menu = panel.querySelector<HTMLElement>('[data-mp-picker-menu]');
  if (menu) {
    menu.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const option = target.closest('[data-mp-option]');
      if (!option) {
        return;
      }
      selectSource(option.getAttribute('data-id') || '');
      setPickerOpen(false);
    });
  }
  const closePickerOnOutside = (e: MouseEvent) => {
    if (!pickerOpen) {
      return;
    }
    const wrap = panel.querySelector('[data-mp-picker-wrap]');
    if (wrap && wrap.contains(e.target as Node)) {
      return;
    }
    setPickerOpen(false);
  };
  const closePickerOnEscape = (e: KeyboardEvent) => {
    if (pickerOpen && e.key === 'Escape') {
      setPickerOpen(false);
    }
  };
  document.addEventListener('mousedown', closePickerOnOutside);
  document.addEventListener('keydown', closePickerOnEscape);
  const cover = panel.querySelector<HTMLImageElement>('[data-mp-cover]');
  if (cover) {
    cover.addEventListener('error', () => {
      lastCoverUrl = null;
      setCoverVisible(false);
    });
  }
  panelEl = panel;
  waveBars = Array.from(panel.querySelectorAll<HTMLElement>('.mp-waves span'));
  mountPanel();
  return panel;
}

function setSliderOpen(open: boolean): void {
  const wrap = panelEl?.querySelector<HTMLElement>('[data-mp-vol-wrap]');
  const toggle = panelEl?.querySelector<HTMLButtonElement>('[data-mp-vol-toggle]');
  if (wrap) {
    wrap.hidden = !open;
  }
  if (toggle) {
    toggle.setAttribute('aria-expanded', String(open));
    toggle.classList.toggle('open', open);
  }
}

function renderPicker(): void {
  const label = panelEl?.querySelector<HTMLElement>('[data-mp-picker-label]');
  const menu = panelEl?.querySelector<HTMLElement>('[data-mp-picker-menu]');
  const selected = sources.find((s) => s.id === selectedId);
  if (label) {
    label.textContent = selected ? selected.player : '—';
  }
  if (menu) {
    menu.innerHTML = '';
    for (const source of sources) {
      const option = document.createElement('button');
      option.type = 'button';
      option.className = 'mp-picker-opt';
      option.dataset['mpOption'] = '';
      option.setAttribute('data-id', source.id);
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', String(source.id === selectedId));
      option.textContent = source.player;
      menu.appendChild(option);
    }
  }
}

function setTextIfChanged(selector: string, text: string): void {
  const el = panelEl?.querySelector(selector);
  if (el && el.textContent !== text) {
    el.textContent = text;
  }
}

function setCoverVisible(visible: boolean): void {
  if (!panelEl) {
    return;
  }
  const cover = panelEl.querySelector<HTMLImageElement>('[data-mp-cover]');
  const note = panelEl.querySelector<HTMLElement>('[data-mp-note]');
  if (cover) {
    cover.hidden = !visible;
  }
  if (note) {
    note.hidden = visible;
  }
}

function setCover(src: string | null): void {
  const cover = panelEl?.querySelector<HTMLImageElement>('[data-mp-cover]');
  if (!cover) {
    return;
  }
  if (src === lastCoverUrl) {
    return;
  }
  lastCoverUrl = src;
  if (!src) {
    cover.removeAttribute('src');
    setCoverVisible(false);
    return;
  }
  cover.src = src;
  setCoverVisible(true);
}
function setControls(controls: NowPlayingSource['controls']): void {
  panelEl?.querySelectorAll<HTMLButtonElement>('.mp-btn').forEach((button) => {
    const cmd = button.dataset['mpCmd'] as MediaCommand;
    const available = controls === 'all' || (controls === 'playPause' && cmd === 'playPause');
    button.disabled = !available;
  });
}

function setVolumeControl(canVolume: boolean, volume: number | null): void {
  const slider = panelEl?.querySelector<HTMLInputElement>('[data-mp-vol]');
  if (!slider) {
    return;
  }
  slider.disabled = !canVolume || volume === null;
  if (volume !== null && !sliderDragging) {
    const rounded = Math.round(volume);
    if (parseInt(slider.value, 10) !== rounded) {
      slider.value = String(rounded);
    }
  }
}

function applyPanelTheme(): void {
  if (!panelEl) {
    return;
  }
  const accent = getMediaAccent();
  if (accent !== lastAccent) {
    panelEl.style.setProperty('--mp-accent', accent);
    lastAccent = accent;
  }
  const showArtist = isMediaArtistVisible();
  if (showArtist !== lastArtistVisible) {
    const artist = panelEl.querySelector<HTMLElement>('[data-mp-artist]');
    if (artist) {
      artist.hidden = !showArtist;
    }
    lastArtistVisible = showArtist;
  }
}

function renderIdle(): void {
  if (!panelEl) {
    return;
  }
  const body = panelEl.querySelector<HTMLElement>('.mp-body');
  const idle = panelEl.querySelector<HTMLElement>('[data-mp-idle]');
  panelEl.classList.remove('mp-playing');
  stopWave();
  if (body) {
    body.hidden = true;
  }
  if (idle) {
    idle.hidden = false;
  }
  /* when nothing is playing, tell the user how to make browsers show up:
     Chrome needs the JS-from-Apple-Events permission, Firefox needs the
     remote-debugging launch flag, or force a tab via mediaPanel.manualBrowser */
  const hint = panelEl.querySelector<HTMLElement>('[data-mp-hint]');
  if (hint) {
    const enabled = isBrowserMediaEnabled();
    hint.textContent = enabled
      ? 'Browser media: enable JS from Apple Events in Chrome (View menu), run Firefox with --remote-debugging-port, or set mediaPanel.manualBrowser'
      : '';
    hint.hidden = !enabled;
  }
}

function resolveSelectedId(): string | null {
  if (sources.length === 0) {
    return null;
  }
  if (selectedId !== null && sources.some((s) => s.id === selectedId)) {
    return selectedId;
  }
  const playing = sources.find((s) => s.playing);
  return playing ? playing.id : sources[0].id;
}

function renderInfo(info: NowPlayingSource): void {
  setTextIfChanged('[data-mp-title]', info.title);
  setTextIfChanged('[data-mp-artist]', info.artist || info.player);
  lastVolume = info.volume;
  const playButton = panelEl?.querySelector<HTMLButtonElement>('[data-mp-cmd="playPause"]');
  const glyph = info.playing ? '⏸' : '▶';
  if (playButton && playButton.textContent !== glyph) {
    playButton.textContent = glyph;
  }
  /* drive the background wave from the source's real state; a pause freezes
     the bars, play starts the animation loop, a new track reseeds its shape */
  panelEl?.classList.toggle('mp-playing', info.playing);
  syncWave(info.playing, info.title + '|' + info.artist);
  setCover(info.coverUrl);
  setControls(info.controls);
  setVolumeControl(info.canVolume, info.volume);
  setVolumeIcon(info.volume);
}

export function renderMediaPanel(nextSources: NowPlayingSource[]): void {
  const panel = buildMediaPanel();
  applyPanelTheme();
  if (nextSources.length === 0) {
    sources = [];
    renderPicker();
    renderIdle();
    return;
  }
  sources = nextSources;
  selectedId = resolveSelectedId();
  renderPicker();
  const idle = panel.querySelector<HTMLElement>('[data-mp-idle]');
  const body = panel.querySelector<HTMLElement>('.mp-body');
  const hint = panel.querySelector<HTMLElement>('[data-mp-hint]');
  if (idle) {
    idle.hidden = true;
  }
  if (hint) {
    hint.hidden = true;
  }
  if (body) {
    body.hidden = false;
  }
  renderInfo(sources.find((s) => s.id === selectedId) || sources[0]);
}

async function refresh(): Promise<void> {
  if (!panelEl || refreshing) {
    return;
  }
  refreshing = true;
  let nextSources: NowPlayingSource[] = [];
  let error: string | null = null;
  try {
    nextSources = await fetchNowPlayingSources();
  } catch (err) {
    error = String(err);
    console.error('hyper-kit media probe failed:', err);
  }
  refreshing = false;
  /* transient probe failures (osascript/dbus hiccups) must not collapse the
     card to the idle bar — keep showing the last-known sources instead */
  if (
    nextSources.length === 0 &&
    sources.length > 0 &&
    (error !== null || getLastProbeError() !== null)
  ) {
    nextSources = sources;
  }
  if (panelEl && panelEl.isConnected) {
    renderMediaPanel(nextSources);
  }
}

/* mountPanel() always re-derives the host and fixes the position when the
   panel is stuck elsewhere (document.body fallback, stale detached header),
   while leaving an already-correctly-placed panel alone — so delegate
   straight to it rather than gating on isConnected, which can't tell a
   correctly-parented panel from one stuck under a stale document.body
   fallback (see reattachEnvPanel for the bug this avoids) */
export function reattachMediaPanel(): void {
  mountPanel();
}

export function disposeMediaPanel(): void {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
  if (volumeDebounce) {
    clearTimeout(volumeDebounce);
    volumeDebounce = null;
  }
  stopWave();
  waveTrackKey = null;
  waveSeed = 0;
  waveBars = [];
  if (panelEl) {
    panelEl.remove();
    panelEl = null;
  }
  lastCoverUrl = null;
  lastVolume = null;
  lastAccent = null;
  lastArtistVisible = null;
  sliderDragging = false;
  sliderOpen = false;
  pickerOpen = false;
  sources = [];
  selectedId = null;
  resetMediaSession();
  cleanupTempCovers();
}

export function initMediaPanel(): () => void {
  readUiConfig();
  if (!isMediaPanelEnabled()) {
    return () => undefined;
  }
  buildMediaPanel();
  refresh();
  pollInterval = setInterval(refresh, MEDIA_REFRESH_MS);
  return disposeMediaPanel;
}

export function reloadMediaPanel(): void {
  readUiConfig();
  if (!isMediaPanelEnabled()) {
    disposeMediaPanel();
    return;
  }
  if (!panelEl) {
    initMediaPanel();
    return;
  }
  refresh();
}
