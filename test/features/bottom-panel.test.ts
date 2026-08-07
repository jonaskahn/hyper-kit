import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../src/platform/system-open', () => ({
  openInFileManager: vi.fn(),
}));

import { applyConfig } from '../../src/config';
import {
  updateBottomInfo,
  getBottomPanelEl,
  initBottomPanel,
  reloadBottomPanel,
  BOTTOM_PANEL_HEIGHT_PX,
} from '../../src/features/bottom-panel';
import { cwdMap, statusMap, sessionStart } from '../../src/platform/state/tab-session-store';
import { setActiveTab } from '../../src/platform/state/active-tab';
import { setStore } from '../../src/platform/hyper-store';
import { splitGroups, tabStore, unsplitGroup } from '../helpers/store';
import { openInFileManager } from '../../src/platform/system-open';

let dispose: (() => void) | null = null;

function mountPanel(): void {
  dispose = initBottomPanel();
}

/* single pane: root group g1 owns session s1 */
function mockUnsplitStore(): any {
  return tabStore(unsplitGroup(), { g1: 's1' });
}

/* g1 (root) -> g2 (session s2) and g3 (session s3), as after a split */
function mockSplitStore(activeSession: string): any {
  return tabStore(splitGroups(), { g1: activeSession });
}

beforeEach(() => {
  document.body.innerHTML = '<div class="header_header"></div>';
  applyConfig(null);
  setActiveTab(null, 0);
  cwdMap.clear();
  statusMap.clear();
  sessionStart.clear();
  (window as any).config = undefined;
});

afterEach(() => {
  if (dispose) {
    dispose();
    dispose = null;
  }
  setStore(null);
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

describe('bottom panel', () => {
  it('shows the active tab dir', () => {
    mountPanel();
    setStore(mockUnsplitStore());
    setActiveTab('g1');
    cwdMap.set('s1', '/tmp/x');
    updateBottomInfo();
    expect(getBottomPanelEl()!.querySelector('[data-bp-dir]')!.textContent).toBe('/tmp/x');
  });

  it('shows the active session open duration', () => {
    mountPanel();
    setStore(mockUnsplitStore());
    setActiveTab('g1');
    sessionStart.set('s1', Date.now() - 5000);
    updateBottomInfo();
    expect(getBottomPanelEl()!.querySelector('[data-bp-open]')!.textContent).toBe('5s');
  });

  it('shows the focused pane dir when the tab is split', () => {
    mountPanel();
    setStore(mockSplitStore('s3'));
    setActiveTab('g1');
    cwdMap.set('s2', '/left');
    cwdMap.set('s3', '/right');
    updateBottomInfo();
    expect(getBottomPanelEl()!.querySelector('[data-bp-dir]')!.textContent).toBe('/right');
  });

  it('shows the focused pane open duration when the tab is split', () => {
    mountPanel();
    setStore(mockSplitStore('s2'));
    setActiveTab('g1');
    sessionStart.set('s2', Date.now() - 5000);
    updateBottomInfo();
    expect(getBottomPanelEl()!.querySelector('[data-bp-open]')!.textContent).toBe('5s');
  });

  it('follows the focused pane instantly on a focus event', () => {
    mountPanel();
    setStore(mockSplitStore('s2'));
    setActiveTab('g1');
    cwdMap.set('s2', '/left');
    cwdMap.set('s3', '/right');
    window.dispatchEvent(
      new CustomEvent('kit-tab-active-session', { detail: { rootUid: 'g1', sessionUid: 's3' } }),
    );
    expect(getBottomPanelEl()!.querySelector('[data-bp-dir]')!.textContent).toBe('/right');
    window.dispatchEvent(
      new CustomEvent('kit-tab-active-session', { detail: { rootUid: 'g1', sessionUid: 's2' } }),
    );
    expect(getBottomPanelEl()!.querySelector('[data-bp-dir]')!.textContent).toBe('/left');
  });

  it('ignores focus events from another tab', () => {
    mountPanel();
    setStore(mockSplitStore('s3'));
    setActiveTab('g1');
    cwdMap.set('s2', '/left');
    cwdMap.set('s3', '/right');
    updateBottomInfo();
    expect(getBottomPanelEl()!.querySelector('[data-bp-dir]')!.textContent).toBe('/right');
    window.dispatchEvent(
      new CustomEvent('kit-tab-active-session', {
        detail: { rootUid: 'other-tab', sessionUid: 's9' },
      }),
    );
    expect(getBottomPanelEl()!.querySelector('[data-bp-dir]')!.textContent).toBe('/right');
  });

  it('falls back to ~ and an em dash without an active tab', () => {
    mountPanel();
    updateBottomInfo();
    const panel = getBottomPanelEl()!;
    expect(panel.querySelector('[data-bp-dir]')!.textContent).toBe('~');
    expect(panel.querySelector('[data-bp-open]')!.textContent).toBe('—');
  });

  it('renders a files button that opens the current dir in the file manager', () => {
    mountPanel();
    setStore(mockUnsplitStore());
    setActiveTab('g1');
    cwdMap.set('s1', '/tmp/x');
    updateBottomInfo();
    const btn = getBottomPanelEl()!.querySelector<HTMLButtonElement>('[data-bp-dir-open]')!;
    expect(btn).not.toBeNull();
    btn.click();
    expect(openInFileManager).toHaveBeenCalledWith('/tmp/x');
  });

  it('does not open a dir in the file manager before any dir is known', () => {
    mountPanel();
    updateBottomInfo();
    getBottomPanelEl()!.querySelector<HTMLButtonElement>('[data-bp-dir-open]')!.click();
    expect(openInFileManager).not.toHaveBeenCalled();
  });

  it('hides the dir files button on linux', () => {
    const original = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    try {
      mountPanel();
      expect(
        getBottomPanelEl()!.querySelector<HTMLButtonElement>('[data-bp-dir-open]')!.hidden,
      ).toBe(true);
    } finally {
      if (original) {
        Object.defineProperty(process, 'platform', original);
      }
    }
  });

  it('initializes the panel, height variable, and system placeholders', async () => {
    mountPanel();
    const panel = getBottomPanelEl()!;
    expect(panel).not.toBeNull();
    expect(document.documentElement.style.getPropertyValue('--kit-bottom-panel-height')).toBe(
      BOTTOM_PANEL_HEIGHT_PX + 'px',
    );
    expect(panel.querySelector('[data-bp-time]')!.textContent).not.toBe('—');
    await vi.waitFor(() => expect(panel.querySelector('[data-bp-net]')!.textContent).toBe('Wired'));
    expect(panel.querySelector('[data-bp-battery]')!.textContent).toBe('—');
    expect(panel.querySelector('[data-bp-cpu]')!.textContent).toBe('—');
    expect(panel.querySelector('[data-bp-ram]')!.textContent).toBe('—');
  });

  it('does not build a panel when bottomPanel is disabled', () => {
    (window as any).config = { getConfig: () => ({ hyperKit: { bottomPanel: false } }) };
    applyConfig({ hyperKit: { bottomPanel: false } });
    mountPanel();
    expect(getBottomPanelEl()).toBeNull();
    expect(document.documentElement.style.getPropertyValue('--kit-bottom-panel-height')).not.toBe(
      BOTTOM_PANEL_HEIGHT_PX + 'px',
    );
  });

  it('dispose removes the panel and resets the height variable', () => {
    mountPanel();
    dispose!();
    dispose = null;
    expect(document.querySelector('[data-kit-tab-bottom-panel]')).toBeNull();
    expect(document.documentElement.style.getPropertyValue('--kit-bottom-panel-height')).toBe(
      '0px',
    );
  });

  it('reload hides the panel when the config disables it', () => {
    mountPanel();
    (window as any).config = { getConfig: () => ({ hyperKit: { bottomPanel: false } }) };
    reloadBottomPanel();
    expect(getBottomPanelEl()!.style.display).toBe('none');
    expect(document.documentElement.style.getPropertyValue('--kit-bottom-panel-height')).toBe(
      '0px',
    );
  });

  describe('explorer / bookmark action buttons', () => {
    it('renders both buttons, visible by default', () => {
      mountPanel();
      const panel = getBottomPanelEl()!;
      const explorerBtn = panel.querySelector<HTMLButtonElement>('[data-bp-explorer]');
      const bookmarkBtn = panel.querySelector<HTMLButtonElement>('[data-bp-bookmark]');
      expect(explorerBtn).not.toBeNull();
      expect(bookmarkBtn).not.toBeNull();
      expect(explorerBtn!.hidden).toBe(false);
      expect(bookmarkBtn!.hidden).toBe(false);
    });

    it('hides the explorer button independently when disabled', () => {
      (window as any).config = { getConfig: () => ({ hyperKit: { explorer: false } }) };
      applyConfig({ hyperKit: { explorer: false } });
      mountPanel();
      const panel = getBottomPanelEl()!;
      expect(panel.querySelector<HTMLButtonElement>('[data-bp-explorer]')!.hidden).toBe(true);
      expect(panel.querySelector<HTMLButtonElement>('[data-bp-bookmark]')!.hidden).toBe(false);
    });

    it('hides the bookmark button independently when disabled', () => {
      (window as any).config = { getConfig: () => ({ hyperKit: { bookmarks: false } }) };
      applyConfig({ hyperKit: { bookmarks: false } });
      mountPanel();
      const panel = getBottomPanelEl()!;
      expect(panel.querySelector<HTMLButtonElement>('[data-bp-bookmark]')!.hidden).toBe(true);
      expect(panel.querySelector<HTMLButtonElement>('[data-bp-explorer]')!.hidden).toBe(false);
    });

    it('opens the explorer popover on click, and opening bookmark closes it (mutual exclusivity)', () => {
      mountPanel();
      const panel = getBottomPanelEl()!;
      panel.querySelector<HTMLButtonElement>('[data-bp-explorer]')!.click();
      expect(document.querySelector('.kit-explorer')).not.toBeNull();
      panel.querySelector<HTMLButtonElement>('[data-bp-bookmark]')!.click();
      expect(document.querySelector('.kit-explorer')).toBeNull();
      expect(document.querySelector('.kit-bookmark')).not.toBeNull();
    });

    it('toggles the same popover closed on a second click', () => {
      mountPanel();
      const explorerBtn =
        getBottomPanelEl()!.querySelector<HTMLButtonElement>('[data-bp-explorer]')!;
      explorerBtn.click();
      expect(document.querySelector('.kit-explorer')).not.toBeNull();
      explorerBtn.click();
      expect(document.querySelector('.kit-explorer')).toBeNull();
    });

    it('dispose removes any open popover from the document', () => {
      mountPanel();
      getBottomPanelEl()!.querySelector<HTMLButtonElement>('[data-bp-explorer]')!.click();
      expect(document.querySelector('.kit-explorer')).not.toBeNull();
      dispose!();
      dispose = null;
      expect(document.querySelector('.kit-explorer')).toBeNull();
      expect(document.querySelector('.kit-bookmark')).toBeNull();
    });
  });
});
