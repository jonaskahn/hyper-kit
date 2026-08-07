import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { applyConfig } from '../../../src/config';
import {
  initMediaPanel,
  disposeMediaPanel,
  renderMediaPanel,
  getMediaPanelEl,
  reloadMediaPanel,
  reattachMediaPanel,
} from '../../../src/features/left-panel/media-panel';
import { initEnvPanel, getEnvPanelEl } from '../../../src/features/left-panel/env-panel';
import type { NowPlayingSource } from '../../../src/platform/now-playing';

const SPOTIFY: NowPlayingSource = {
  id: 'spotify',
  player: 'Spotify',
  title: 'Chandelier',
  artist: 'Sia',
  playing: true,
  volume: 45,
  coverUrl: 'https://example.com/art.jpg',
  controls: 'all',
  canVolume: true,
};

const MUSIC: NowPlayingSource = {
  id: 'music',
  player: 'Music',
  title: 'All Too Well',
  artist: 'Taylor Swift',
  playing: false,
  volume: 60,
  coverUrl: null,
  controls: 'all',
  canVolume: true,
};

const CHROME: NowPlayingSource = {
  id: 'chrome',
  player: 'Chrome',
  title: 'Numb',
  artist: 'Linkin Park',
  playing: true,
  volume: 70,
  coverUrl: null,
  controls: 'playPause',
  canVolume: true,
};

beforeEach(() => {
  document.body.innerHTML = '<div class="header_header"></div>';
  applyConfig(null);
  initEnvPanel();
});

afterEach(() => {
  disposeMediaPanel();
  document.body.innerHTML = '';
});

function query<T extends HTMLElement = HTMLElement>(selector: string): T | null {
  const panel = getMediaPanelEl();
  return panel ? panel.querySelector<T>(selector) : null;
}

function selectOption(id: string): void {
  const option = query('[data-mp-picker-menu]')!.querySelector<HTMLButtonElement>(
    '[data-mp-option][data-id="' + id + '"]',
  )!;
  option.click();
}

describe('media panel', () => {
  it('mounts above the env panel in the tab bar', () => {
    renderMediaPanel([SPOTIFY]);
    const panel = getMediaPanelEl()!;
    expect(panel.getAttribute('data-kit-tab-media-panel')).toBe('');
    expect(panel.nextElementSibling).toBe(getEnvPanelEl());
  });

  it('renders title, artist, volume slider and a pause glyph while playing', () => {
    renderMediaPanel([SPOTIFY]);
    expect(query('[data-mp-title]')!.textContent).toBe('Chandelier');
    expect(query('[data-mp-artist]')!.textContent).toBe('Sia');
    expect(query<HTMLInputElement>('[data-mp-vol]')!.value).toBe('45');
    expect(query('[data-mp-cmd="playPause"]')!.textContent).toBe('⏸');
    expect(query('[data-mp-idle]')!.hidden).toBe(true);
  });

  it('shows a play glyph and the player name when paused without artist', () => {
    renderMediaPanel([{ ...SPOTIFY, playing: false, artist: '', volume: null }]);
    expect(query('[data-mp-cmd="playPause"]')!.textContent).toBe('▶');
    expect(query('[data-mp-artist]')!.textContent).toBe('Spotify');
    expect(query<HTMLInputElement>('[data-mp-vol]')!.disabled).toBe(true);
  });

  it('renders an equalizer wave layer behind the card', () => {
    renderMediaPanel([SPOTIFY]);
    const waves = query('[data-mp-waves]')!;
    expect(waves.getAttribute('aria-hidden')).toBe('true');
    expect(waves.querySelectorAll('span').length).toBe(21);
  });

  it('hides the wave layer when mediaPanel.wave is disabled', () => {
    applyConfig({ hyperKit: { leftPanel: { mediaPanel: { wave: false } } } });
    renderMediaPanel([SPOTIFY]);
    expect(query('[data-mp-waves]')!.hidden).toBe(true);
  });

  it('freezes the wave to a static baseline when paused', () => {
    renderMediaPanel([{ ...SPOTIFY, playing: false }]);
    const waves = query('[data-mp-waves]')!;
    expect(waves.classList.contains('running')).toBe(false);
    expect(waves.querySelectorAll('span').length).toBe(21);
    const first = waves.querySelector('span')!;
    expect(first.style.transform).toMatch(/scaleY\(0\.\d+\)/);
    expect(first.style.transform).not.toMatch(/scaleY\(0\.000\)/);
  });

  it('animates the wave while playing and freezes it when paused', () => {
    renderMediaPanel([SPOTIFY]);
    expect(getMediaPanelEl()!.classList.contains('mp-playing')).toBe(true);
    renderMediaPanel([{ ...SPOTIFY, playing: false }]);
    expect(getMediaPanelEl()!.classList.contains('mp-playing')).toBe(false);
    renderMediaPanel([{ ...SPOTIFY, playing: true }]);
    expect(getMediaPanelEl()!.classList.contains('mp-playing')).toBe(true);
  });

  it('clears the wave state when nothing is playing', () => {
    renderMediaPanel([SPOTIFY]);
    renderMediaPanel([]);
    expect(getMediaPanelEl()!.classList.contains('mp-playing')).toBe(false);
  });

  it('flips the wave state optimistically on play/pause click', () => {
    renderMediaPanel([SPOTIFY]);
    query<HTMLButtonElement>('[data-mp-cmd="playPause"]')!.click();
    expect(getMediaPanelEl()!.classList.contains('mp-playing')).toBe(false);
    query<HTMLButtonElement>('[data-mp-cmd="playPause"]')!.click();
    expect(getMediaPanelEl()!.classList.contains('mp-playing')).toBe(true);
  });

  it('shows the idle bar when nothing is playing', () => {
    renderMediaPanel([]);
    expect(query('[data-mp-idle]')!.hidden).toBe(false);
    expect(query('.mp-body')!.hidden).toBe(true);
    expect(query('[data-mp-picker-menu]')!.querySelectorAll('[data-mp-option]').length).toBe(0);
  });

  it('shows a browser setup hint in the idle bar and hides it with sources', () => {
    renderMediaPanel([]);
    const hint = query('[data-mp-hint]')!;
    expect(hint.hidden).toBe(false);
    expect(hint.textContent).toContain('Browser media');
    renderMediaPanel([SPOTIFY]);
    expect(query('[data-mp-hint]')!.hidden).toBe(true);
  });

  it('hides the browser hint when browserMedia is disabled', () => {
    applyConfig({ hyperKit: { leftPanel: { mediaPanel: { browserMedia: false } } } });
    renderMediaPanel([]);
    expect(query('[data-mp-hint]')!.hidden).toBe(true);
  });

  it('enables all buttons for full controls', () => {
    renderMediaPanel([SPOTIFY]);
    const buttons = getMediaPanelEl()!.querySelectorAll<HTMLButtonElement>('.mp-btn');
    buttons.forEach((button) => expect(button.disabled).toBe(false));
  });

  it('enables only play/pause for browser controls', () => {
    renderMediaPanel([{ ...SPOTIFY, controls: 'playPause' }]);
    expect(query<HTMLButtonElement>('[data-mp-cmd="prev"]')!.disabled).toBe(true);
    expect(query<HTMLButtonElement>('[data-mp-cmd="playPause"]')!.disabled).toBe(false);
    expect(query<HTMLButtonElement>('[data-mp-cmd="next"]')!.disabled).toBe(true);
  });

  it('enables the volume slider only when the backend supports volume', () => {
    renderMediaPanel([{ ...SPOTIFY, canVolume: true }]);
    expect(query<HTMLInputElement>('[data-mp-vol]')!.disabled).toBe(false);
    renderMediaPanel([{ ...SPOTIFY, canVolume: false }]);
    expect(query<HTMLInputElement>('[data-mp-vol]')!.disabled).toBe(true);
  });

  it('disables the volume slider when the volume is unknown', () => {
    renderMediaPanel([{ ...SPOTIFY, volume: null, canVolume: true }]);
    expect(query<HTMLInputElement>('[data-mp-vol]')!.disabled).toBe(true);
  });

  it('renders a volume icon that reacts to the volume level', () => {
    renderMediaPanel([{ ...SPOTIFY, volume: 0 }]);
    expect(query('[data-mp-vol-icon]')!.innerHTML).toContain('M11.5 6.5l4 3');
    renderMediaPanel([{ ...SPOTIFY, volume: 20 }]);
    expect(query('[data-mp-vol-icon]')!.innerHTML).toContain('M11 6.2');
    renderMediaPanel([{ ...SPOTIFY, volume: 45 }]);
    expect(query('[data-mp-vol-icon]')!.innerHTML).toContain('M12.5 4.5');
    renderMediaPanel([{ ...SPOTIFY, volume: 80 }]);
    expect(query('[data-mp-vol-icon]')!.innerHTML).toContain('M14 3a7 7');
  });

  it('shows a muted volume icon when the volume is unknown', () => {
    renderMediaPanel([{ ...SPOTIFY, volume: null }]);
    expect(query('[data-mp-vol-icon]')!.innerHTML).toContain('M11.5 6.5l4 3');
  });

  it('keeps the dragged slider value and commits on release', () => {
    renderMediaPanel([SPOTIFY]);
    const slider = query<HTMLInputElement>('[data-mp-vol]')!;
    slider.value = '60';
    slider.dispatchEvent(new Event('input'));
    expect(slider.value).toBe('60');
    slider.dispatchEvent(new Event('change'));
    expect(slider.value).toBe('60');
    expect(query<HTMLInputElement>('[data-mp-vol]')!.disabled).toBe(false);
  });

  it('ignores poll updates while the user is dragging the slider', () => {
    renderMediaPanel([SPOTIFY]);
    const slider = query<HTMLInputElement>('[data-mp-vol]')!;
    slider.value = '80';
    slider.dispatchEvent(new Event('input'));
    renderMediaPanel([{ ...SPOTIFY, volume: 30 }]);
    expect(slider.value).toBe('80');
    slider.dispatchEvent(new Event('change'));
    renderMediaPanel([{ ...SPOTIFY, volume: 30 }]);
    expect(slider.value).toBe('30');
  });

  it('disables every button when the backend has no controls', () => {
    renderMediaPanel([{ ...SPOTIFY, controls: 'none', canVolume: false }]);
    getMediaPanelEl()!
      .querySelectorAll<HTMLButtonElement>('.mp-btn')
      .forEach((button) => expect(button.disabled).toBe(true));
    expect(query<HTMLInputElement>('[data-mp-vol]')!.disabled).toBe(true);
  });

  it('shows the cover image when a cover url is present and hides it otherwise', () => {
    renderMediaPanel([SPOTIFY]);
    const cover = query<HTMLImageElement>('[data-mp-cover]')!;
    expect(cover.hidden).toBe(false);
    expect(cover.src).toBe('https://example.com/art.jpg');
    renderMediaPanel([{ ...SPOTIFY, coverUrl: null }]);
    expect(cover.hidden).toBe(true);
  });

  it('hides the cover and shows the note when switching to a source without art', () => {
    renderMediaPanel([SPOTIFY, CHROME]);
    const cover = query<HTMLImageElement>('[data-mp-cover]')!;
    const note = query<HTMLElement>('[data-mp-note]')!;
    expect(cover.hidden).toBe(false);
    expect(note.hidden).toBe(true);
    selectOption('chrome');
    expect(cover.hidden).toBe(true);
    expect(cover.getAttribute('src')).toBeNull();
    expect(note.hidden).toBe(false);
  });

  it('lists every source in the provider picker and defaults to the playing source', () => {
    renderMediaPanel([SPOTIFY, MUSIC]);
    const options =
      query('[data-mp-picker-menu]')!.querySelectorAll<HTMLButtonElement>('[data-mp-option]');
    expect(options.length).toBe(2);
    expect(Array.from(options).map((o) => o.textContent)).toEqual(['Spotify', 'Music']);
    expect(query('[data-mp-picker-label]')!.textContent).toBe('Spotify');
    expect(options[0].getAttribute('aria-selected')).toBe('true');
  });

  it('the provider picker opens on click and closes after picking', () => {
    renderMediaPanel([SPOTIFY, MUSIC]);
    const menu = query<HTMLElement>('[data-mp-picker-menu]')!;
    const trigger = query<HTMLButtonElement>('[data-mp-picker]')!;
    expect(menu.hidden).toBe(true);
    trigger.click();
    expect(menu.hidden).toBe(false);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    selectOption('music');
    expect(menu.hidden).toBe(true);
  });

  it('switching the provider picker shows the selected source', () => {
    renderMediaPanel([SPOTIFY, MUSIC]);
    selectOption('music');
    expect(query('[data-mp-title]')!.textContent).toBe('All Too Well');
    expect(query('[data-mp-artist]')!.textContent).toBe('Taylor Swift');
    expect(query('[data-mp-cmd="playPause"]')!.textContent).toBe('▶');
    expect(query<HTMLInputElement>('[data-mp-vol]')!.value).toBe('60');
    expect(query('[data-mp-picker-label]')!.textContent).toBe('Music');
  });

  it('keeps the selected source across polls and falls back when it disappears', () => {
    renderMediaPanel([SPOTIFY, MUSIC]);
    selectOption('music');
    renderMediaPanel([SPOTIFY, MUSIC]);
    expect(query('[data-mp-picker-label]')!.textContent).toBe('Music');
    renderMediaPanel([SPOTIFY]);
    expect(query('[data-mp-picker-label]')!.textContent).toBe('Spotify');
    expect(query('[data-mp-title]')!.textContent).toBe('Chandelier');
  });

  it('volume toggle hides the slider by default and shows it on press', () => {
    renderMediaPanel([SPOTIFY]);
    const wrap = query<HTMLElement>('[data-mp-vol-wrap]')!;
    const toggle = query<HTMLButtonElement>('[data-mp-vol-toggle]')!;
    expect(wrap.hidden).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    toggle.click();
    expect(wrap.hidden).toBe(false);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    toggle.click();
    expect(wrap.hidden).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('dispatches a control command on button click', () => {
    renderMediaPanel([SPOTIFY]);
    const prev = query<HTMLButtonElement>('[data-mp-cmd="prev"]')!;
    expect(() => prev.click()).not.toThrow();
  });

  it('init builds the panel and dispose removes it', () => {
    const dispose = initMediaPanel();
    expect(getMediaPanelEl()).not.toBeNull();
    dispose();
    expect(getMediaPanelEl()).toBeNull();
    expect(document.querySelector('[data-kit-tab-media-panel]')).toBeNull();
  });

  it('reload respects the config toggle', () => {
    initMediaPanel();
    Object.defineProperty(window, 'config', {
      value: { getConfig: () => ({ hyperKit: { leftPanel: { mediaPanel: { enabled: false } } } }) },
      configurable: true,
    });
    reloadMediaPanel();
    expect(getMediaPanelEl()).toBeNull();
    Object.defineProperty(window, 'config', {
      value: { getConfig: () => ({ hyperKit: { leftPanel: { mediaPanel: { enabled: true } } } }) },
      configurable: true,
    });
    reloadMediaPanel();
    expect(getMediaPanelEl()).not.toBeNull();
    Object.defineProperty(window, 'config', { value: undefined, configurable: true });
  });

  it('reattach re-mounts a detached panel above the env panel', () => {
    renderMediaPanel([SPOTIFY]);
    const panel = getMediaPanelEl()!;
    panel.remove();
    expect(panel.isConnected).toBe(false);
    reattachMediaPanel();
    expect(panel.isConnected).toBe(true);
    expect(panel.nextElementSibling).toBe(getEnvPanelEl());
  });

  it('reattach moves a panel stuck under document.body back into .header_header', () => {
    renderMediaPanel([SPOTIFY]);
    const panel = getMediaPanelEl()!;
    // simulate the moment .header_header was momentarily missing when the
    // panel last attached, leaving it parked on the document.body fallback
    document.body.appendChild(panel);
    expect(panel.isConnected).toBe(true);
    expect(panel.parentElement).toBe(document.body);

    reattachMediaPanel();

    expect(panel.parentElement).toBe(document.querySelector('.header_header'));
  });

  it('hides the artist line when showArtist is disabled', () => {
    applyConfig({ hyperKit: { leftPanel: { mediaPanel: { showArtist: false } } } });
    renderMediaPanel([SPOTIFY]);
    expect(query<HTMLElement>('[data-mp-artist]')!.hidden).toBe(true);
    applyConfig({ hyperKit: { leftPanel: { mediaPanel: { showArtist: true } } } });
    renderMediaPanel([SPOTIFY]);
    expect(query<HTMLElement>('[data-mp-artist]')!.hidden).toBe(false);
  });

  it('applies the mediaPanel accent config as the --mp-accent variable', () => {
    applyConfig({ hyperKit: { leftPanel: { mediaPanel: { accent: '#ff8800' } } } });
    renderMediaPanel([SPOTIFY]);
    expect(getMediaPanelEl()!.style.getPropertyValue('--mp-accent')).toBe('#ff8800');
  });
});
