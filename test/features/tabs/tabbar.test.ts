import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { attachControls } from '../../../src/features/tabs/tabbar';
import { STORAGE_KEY } from '../../../src/config';

let dispose: (() => void) | null = null;

beforeEach(() => {
  document.body.innerHTML = '<div class="hyper_main"></div><div class="header_header"></div>';
  localStorage.clear();
});

afterEach(() => {
  // attachControls() starts real setInterval timers (env panel refresh,
  // stale-session pruning); leaving them running across tests leaks timers
  // and can keep the process alive, so always tear down what was started.
  if (dispose) {
    dispose();
    dispose = null;
  }
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

  it('dispose() stops the env-panel refresh and stale-session pruning intervals', () => {
    const clearIntervalSpy = vi.spyOn(global, 'clearInterval');
    dispose = attachControls();
    dispose();
    dispose = null;
    // env panel refresh + stale-session pruning = 2 intervals torn down
    expect(clearIntervalSpy).toHaveBeenCalledTimes(2);
    clearIntervalSpy.mockRestore();
  });
});
