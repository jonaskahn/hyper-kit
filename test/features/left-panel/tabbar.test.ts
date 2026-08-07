import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { attachControls, enforceFixedTabSizes } from '../../../src/features/left-panel/tabbar';
import { STORAGE_KEY } from '../../../src/config';
import { setStore } from '../../../src/platform/hyper-store';
import { agentMap } from '../../../src/platform/state/tab-session-store';
import { splitGroups, tabStore, unsplitGroup } from '../../helpers/store';

let dispose: (() => void) | null = null;

function mockStoreTree(split: boolean): any {
  return tabStore(split ? splitGroups() : unsplitGroup());
}

beforeEach(() => {
  document.body.innerHTML = '<div class="hyper_main"></div><div class="header_header"></div>';
  localStorage.clear();
});

afterEach(() => {
  // attachControls() starts real setInterval timers (bottom panel refresh,
  // stale-session pruning); leaving them running across tests leaks timers
  // and can keep the process alive, so always tear down what was started.
  if (dispose) {
    dispose();
    dispose = null;
  }
  setStore(null);
  agentMap.clear();
});

describe('tabbar controls', () => {
  it('creates the resize handle and removes it on dispose', () => {
    dispose = attachControls();
    expect(document.querySelector('[data-kit-tab-resize]')).not.toBeNull();
    dispose();
    dispose = null;
    expect(document.querySelector('[data-kit-tab-resize]')).toBeNull();
  });

  it('restores the saved width from localStorage', () => {
    localStorage.setItem(STORAGE_KEY, '350');
    dispose = attachControls();
    expect(document.documentElement.style.getPropertyValue('--kit-tab-width')).toBe('350px');
  });

  it('clamps an out-of-range saved width', () => {
    localStorage.setItem(STORAGE_KEY, '9999');
    dispose = attachControls();
    expect(document.documentElement.style.getPropertyValue('--kit-tab-width')).toBe('420px');
  });

  it('leaves the drag ghost width untouched while pinning real tab sizes', () => {
    // the drag ghost is a cloned .tab_tab parked on <body>; CSSOM property
    // setters preserve its !important priority, so a global re-sizer would
    // rewrite its pinned pixel width into calc(100% - 4px) against the
    // viewport — a full-window ghost
    const header = document.querySelector('.header_header')!;
    const list = document.createElement('div');
    list.className = 'tabs_list';
    header.appendChild(list);
    const tab = document.createElement('div');
    tab.className = 'tab_tab';
    list.appendChild(tab);

    const ghost = document.createElement('div');
    ghost.className = 'tab_tab kit-tab-drag-ghost';
    ghost.style.setProperty('width', '236px', 'important');
    document.body.appendChild(ghost);

    enforceFixedTabSizes();

    expect(ghost.style.getPropertyValue('width')).toBe('236px');
    expect(ghost.style.getPropertyPriority('width')).toBe('important');
    expect(tab.style.width).toBe('calc(100% - 4px)');
  });

  it('toggles single-tab state when tabs appear/disappear', async () => {
    dispose = attachControls();
    const main = document.querySelector('.hyper_main')!;
    const headerHeader = document.querySelector('.header_header')!;
    expect(main.classList.contains('kit-tab-single')).toBe(true);

    // the MutationObserver is scoped to .header_header (not document.body,
    // which would also catch unrelated terminal-output churn), so the tab
    // has to be inserted where real Hyper markup actually puts tabs
    const tab = document.createElement('div');
    tab.className = 'tab_tab';
    headerHeader.appendChild(tab);
    await vi.waitFor(() => expect(main.classList.contains('kit-tab-single')).toBe(false));

    tab.remove();
    await vi.waitFor(() => expect(main.classList.contains('kit-tab-single')).toBe(true));
  });

  it('dispose() stops the panel refresh, pruning, and watchdog intervals', () => {
    const clearIntervalSpy = vi.spyOn(global, 'clearInterval');
    dispose = attachControls();
    dispose();
    dispose = null;
    // bottom-panel time/speed/system refresh + top-panel cpu refresh + media
    // panel poll + stale-session pruning + the tab-bar watchdog = 7 intervals
    // torn down
    expect(clearIntervalSpy).toHaveBeenCalledTimes(7);
    clearIntervalSpy.mockRestore();
  });

  it('recovers panels appended inside .header_header if Hyper replaces it wholesale', async () => {
    vi.useFakeTimers();
    dispose = attachControls();
    await vi.advanceTimersByTimeAsync(0); // let the initial detectEnv() promise resolve
    const envPanel = document.querySelector('[data-kit-tab-env-panel]');
    expect(envPanel?.isConnected).toBe(true);

    const oldHeader = document.querySelector('.header_header')!;
    const newHeader = document.createElement('div');
    newHeader.className = 'header_header';
    oldHeader.replaceWith(newHeader);
    expect(envPanel?.isConnected).toBe(false);

    await vi.advanceTimersByTimeAsync(2000);
    expect(envPanel?.isConnected).toBe(true);
    expect(envPanel?.parentElement).toBe(newHeader);
    vi.useRealTimers();
  });

  it('shows the pane-count badge in the title pill when the sole tab is split', () => {
    setStore(mockStoreTree(true));
    const header = document.querySelector('.header_header')!;
    const title = document.createElement('div');
    title.className = 'tabs_title';
    header.appendChild(title);
    dispose = attachControls();
    const badge = document.querySelector('.tabs_title .kit-tab-panes');
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toBe('2');
    expect(badge!.classList.contains('visible')).toBe(true);
  });

  it('hides the title badge for an unsplit sole tab', () => {
    setStore(mockStoreTree(false));
    const header = document.querySelector('.header_header')!;
    const title = document.createElement('div');
    title.className = 'tabs_title';
    header.appendChild(title);
    dispose = attachControls();
    const badge = document.querySelector('.tabs_title .kit-tab-panes');
    expect(badge).not.toBeNull();
    expect(badge!.classList.contains('visible')).toBe(false);
  });

  it('refreshes the title badge when the sole tab is split or closed', async () => {
    setStore(mockStoreTree(false));
    const header = document.querySelector('.header_header')!;
    const title = document.createElement('div');
    title.className = 'tabs_title';
    header.appendChild(title);
    dispose = attachControls();
    const badge = document.querySelector('.tabs_title .kit-tab-panes')!;
    expect(badge.classList.contains('visible')).toBe(false);

    setStore(mockStoreTree(true));
    window.dispatchEvent(new CustomEvent('kit-tab-panes-changed', { detail: { rootUid: 'g1' } }));
    await vi.waitFor(() => expect(badge.textContent).toBe('2'));
    expect(badge.classList.contains('visible')).toBe(true);
  });

  it('locks tab sizes imperatively so many tabs scroll instead of shrinking', () => {
    const header = document.querySelector('.header_header')!;
    const list = document.createElement('ul');
    list.className = 'tabs_list';
    for (let i = 0; i < 3; i += 1) {
      const tab = document.createElement('div');
      tab.className = 'tab_tab';
      list.appendChild(tab);
    }
    header.appendChild(list);
    dispose = attachControls();
    expect(list.style.flexFlow).toBe('column');
    for (const tab of list.querySelectorAll('.tab_tab') as unknown as HTMLElement[]) {
      expect(tab.style.flex).toBe('0 0 auto');
      expect(tab.style.width).toBe('calc(100% - 4px)');
      expect(tab.style.height).toBe('48px');
    }
  });

  it('renders the centered agent strip in the title pill, one icon per pane', () => {
    setStore(mockStoreTree(true)); // split: sessions s2, s3
    const header = document.querySelector('.header_header')!;
    const title = document.createElement('div');
    title.className = 'tabs_title';
    header.appendChild(title);
    dispose = attachControls();
    const row = document.querySelector('.tabs_title .kit-tab-cwd')!;
    expect(row.classList.contains('kit-tab-agents')).toBe(true);
    expect(row.querySelectorAll('.kit-tab-agent').length).toBe(2);
  });

  it('shows the agent glyph for a pane running an agent', () => {
    setStore(mockStoreTree(false)); // unsplit: session s1
    agentMap.set('s1', 'codex');
    const header = document.querySelector('.header_header')!;
    const title = document.createElement('div');
    title.className = 'tabs_title';
    header.appendChild(title);
    dispose = attachControls();
    const row = document.querySelector('.tabs_title .kit-tab-cwd')!;
    const icon = row.querySelector('.kit-tab-agent') as HTMLElement;
    expect(icon).not.toBeNull();
    expect(icon.style.getPropertyValue('--kit-agent-uri')).toContain('url(');
  });

  it('updates the title strip when the agent set changes', async () => {
    setStore(mockStoreTree(false)); // session s1
    const header = document.querySelector('.header_header')!;
    const title = document.createElement('div');
    title.className = 'tabs_title';
    header.appendChild(title);
    dispose = attachControls();
    const row = document.querySelector('.tabs_title .kit-tab-cwd')!;
    expect(row.querySelectorAll('.kit-tab-agent').length).toBe(1);

    agentMap.set('s1', 'claude');
    window.dispatchEvent(new CustomEvent('kit-tab-agents-changed', { detail: { rootUid: 'g1' } }));
    await vi.waitFor(() => {
      const icon = row.querySelector('.kit-tab-agent') as HTMLElement;
      expect(icon).not.toBeNull();
      expect(icon.style.getPropertyValue('--kit-agent-uri')).toContain('url(');
    });
  });
});
