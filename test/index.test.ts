import { describe, it, expect, vi, afterEach } from 'vitest';
import Module from 'node:module';

import {
  decorateConfig,
  decorateTab,
  getTabProps,
  middleware,
  onWindow,
  __debug,
} from '../src/index';
import {
  sessionStart,
  cwdMap,
  statusMap,
  agentMap,
  agentSource,
  setLastCwd,
} from '../src/platform/state/tab-session-store';
import { getStore, setStore } from '../src/platform/hyper-store';
import { removeCloseConfirmDialog, resetWindowCloseGuard } from '../src/features/close-confirm';
import { applyConfig } from '../src/config';
import { ipcMain as electronIpcMain, dialog as electronDialog } from 'electron';

// onWindow() requires 'electron' through Node's CJS loader (Vite's SSR
// pipeline does not intercept it), so route the request to the same shared
// mock the ESM import above resolves to.
const originalModuleLoad = Module._load;
Module._load = function (
  this: unknown,
  request: string,
  parent: NodeModule | null | undefined,
  isMain: boolean,
) {
  if (request === 'electron') {
    return { ipcMain: electronIpcMain, dialog: electronDialog };
  }
  return originalModuleLoad.call(this, request, parent, isMain);
} as typeof Module._load;

afterEach(() => {
  setStore(null);
  cwdMap.clear();
  statusMap.clear();
  sessionStart.clear();
  agentMap.clear();
  agentSource.clear();
  setLastCwd('');
  removeCloseConfirmDialog();
  resetWindowCloseGuard();
  delete (window as any).require;
  document.body.innerHTML = '';
});

describe('plugin entry', () => {
  it('decorateConfig applies the theme', () => {
    const out = decorateConfig({ fontSize: 20, tabUi: { maxTools: 5 } });
    expect(out.fontSize).toBe(14);
    expect(out.backgroundColor).toBe('#141414');
    expect(out.fontFamily).toContain('JetBrainsMono');
  });

  it('middleware records SESSION_ADD and forwards actions', () => {
    const store = {
      getState: () => ({
        termGroups: { termGroups: {} },
        ui: { cwd: '/work' },
      }),
    };
    const next = vi.fn((a: any) => a);
    const mw = middleware(store as any)(next);

    mw({ type: 'SESSION_ADD', uid: 's1' });
    expect(sessionStart.get('s1')).toBeGreaterThan(0);
    expect(cwdMap.get('s1')).toBe('/work');
    expect(getStore()).toBe(store);

    mw(null);
    expect(next).toHaveBeenCalledWith(null);

    mw({ type: 'UNKNOWN_ACTION' });
    expect(next).toHaveBeenCalledWith({ type: 'UNKNOWN_ACTION' });
  });

  it('getTabProps attaches the tab uid', () => {
    expect(getTabProps(null, {}, {}).uid).toBeUndefined();
    expect(getTabProps({ uid: 'u1' }, {}, {})._tabUid).toBe('u1');
  });

  it('decorateTab wraps for the vertical kit by default', () => {
    applyConfig(null);
    const Fake = () => null;
    expect(decorateTab(Fake)).not.toBe(Fake);
  });

  it('decorateTab passes tabs through when vertical chrome and badge are off', () => {
    applyConfig({ hyperKit: { leftPanel: { enable: false }, paneCountBadge: false } });
    const Fake = () => null;
    expect(decorateTab(Fake)).toBe(Fake);
  });

  it('decorateTab keeps only the pane-count badge on normal tabs', () => {
    applyConfig({ hyperKit: { leftPanel: { enable: false } } });
    const Fake = () => null;
    const Decorated = decorateTab(Fake);
    expect(Decorated).not.toBe(Fake);
    expect((Decorated as any).name).toBe('PanesBadgeTab');
  });

  it('badge-only mode still routes session events so the badge can update', () => {
    applyConfig({ hyperKit: { leftPanel: { enable: false } } });
    const store = { getState: () => ({ termGroups: { termGroups: {} }, ui: { cwd: '/work' } }) };
    const next = vi.fn((a: any) => a);
    const mw = middleware(store as any)(next);
    mw({ type: 'SESSION_ADD', uid: 's9' });
    expect(sessionStart.get('s9')).toBeGreaterThan(0); // tracking ran despite vertical chrome being off
    expect(next).toHaveBeenCalledWith({ type: 'SESSION_ADD', uid: 's9' });
  });

  it('TERM_GROUP_ADD inherits the last tracked cwd', () => {
    setLastCwd('/work/project');
    applyConfig(null);
    const store = {
      getState: () => ({ termGroups: { termGroups: {} }, ui: { cwd: '/work/project' } }),
    };
    const next = vi.fn((a: any) => a);
    const mw = middleware(store as any)(next);

    mw({ type: 'TERM_GROUP_ADD', uid: 't1' });
    expect(next).toHaveBeenCalledWith({ type: 'TERM_GROUP_ADD', uid: 't1', cwd: '/work/project' });
  });

  it('TERM_GROUP_ADD passes through without a tracked cwd', () => {
    applyConfig(null);
    const store = { getState: () => ({ termGroups: { termGroups: {} } }) };
    const next = vi.fn((a: any) => a);
    const mw = middleware(store as any)(next);

    mw({ type: 'TERM_GROUP_ADD', uid: 't1' });
    expect(next).toHaveBeenCalledWith({ type: 'TERM_GROUP_ADD', uid: 't1' });
    expect(next.mock.calls[0][0].cwd).toBeUndefined();
  });

  it('TERM_GROUP_ADD keeps an explicit cwd', () => {
    setLastCwd('/work/project');
    applyConfig(null);
    const store = {
      getState: () => ({ termGroups: { termGroups: {} }, ui: { cwd: '/work/project' } }),
    };
    const next = vi.fn((a: any) => a);
    const mw = middleware(store as any)(next);

    mw({ type: 'TERM_GROUP_ADD', uid: 't1', cwd: '/explicit/path' });
    expect(next).toHaveBeenCalledWith({ type: 'TERM_GROUP_ADD', uid: 't1', cwd: '/explicit/path' });
  });

  it('TERM_GROUP_ADD leaves cwd untouched when newTabSameDir is disabled', () => {
    setLastCwd('/work/project');
    applyConfig({ hyperKit: { newTabSameDir: false } });
    const store = {
      getState: () => ({ termGroups: { termGroups: {} }, ui: { cwd: '/work/project' } }),
    };
    const next = vi.fn((a: any) => a);
    const mw = middleware(store as any)(next);

    mw({ type: 'TERM_GROUP_ADD', uid: 't1' });
    expect(next).toHaveBeenCalledWith({ type: 'TERM_GROUP_ADD', uid: 't1' });
    expect(next.mock.calls[0][0].cwd).toBeUndefined();
  });

  it('exposes the __debug hook', () => {
    expect(__debug.cwdMap).toBeDefined();
    expect(__debug.statusMap).toBeDefined();
  });

  it('SESSION_SET_XTERM_TITLE routes to agent detection', () => {
    vi.useFakeTimers();
    applyConfig(null);
    const store = { getState: () => ({ termGroups: { termGroups: {} } }) };
    const next = vi.fn((a: any) => a);
    const mw = middleware(store as any)(next);

    mw({ type: 'SESSION_SET_XTERM_TITLE', uid: 's1', title: 'claude' });
    expect(agentMap.get('s1')).toBe('claude');

    mw({ type: 'SESSION_SET_XTERM_TITLE', uid: 's1', title: 'zsh' });
    expect(agentMap.get('s1')).toBe('claude'); // title-sourced clears are debounced
    vi.advanceTimersByTime(600);
    expect(agentMap.has('s1')).toBe(false);
    vi.useRealTimers();
    expect(next).toHaveBeenCalledWith({
      type: 'SESSION_SET_XTERM_TITLE',
      uid: 's1',
      title: 'zsh',
    });
  });

  it('SESSION_USER_DATA without a uid resolves to the focused session', () => {
    applyConfig(null);
    const store = {
      getState: () => ({
        termGroups: {
          termGroups: {
            g1: { uid: 'g1', sessionUid: 's1', parentUid: null, children: [] },
          },
          activeSessions: { g1: 's1' },
          activeRootGroup: 'g1',
        },
      }),
    };
    const next = vi.fn((a: any) => a);
    const mw = middleware(store as any)(next);

    mw({ type: 'SESSION_USER_DATA', data: 'claude\r' });
    expect(agentMap.get('s1')).toBe('claude');
    expect(next).toHaveBeenCalledWith({ type: 'SESSION_USER_DATA', data: 'claude\r' });
  });

  it('runs the cursor agent shim through to the cursor icon', () => {
    applyConfig(null);
    const store = {
      getState: () => ({
        termGroups: {
          termGroups: {
            g1: { uid: 'g1', sessionUid: 's1', parentUid: null, children: [] },
          },
          activeSessions: { g1: 's1' },
          activeRootGroup: 'g1',
        },
      }),
    };
    const next = vi.fn((a: any) => a);
    const mw = middleware(store as any)(next);

    mw({ type: 'SESSION_USER_DATA', data: 'agent\r' });
    expect(agentMap.get('s1')).toBe('cursor');
    // Cursor Agent's own title keeps it set
    mw({ type: 'SESSION_SET_XTERM_TITLE', uid: 's1', title: 'Cursor Agent' });
    expect(agentMap.get('s1')).toBe('cursor');
  });

  it('SESSION_USER_DATA stays silent when no focused session is known', () => {
    applyConfig(null);
    const store = {
      getState: () => ({
        termGroups: { termGroups: {}, activeSessions: {}, activeRootGroup: null },
      }),
    };
    const next = vi.fn((a: any) => a);
    const mw = middleware(store as any)(next);
    expect(() => mw({ type: 'SESSION_USER_DATA', data: 'claude\r' })).not.toThrow();
  });

  it('TERM_GROUP_EXIT is intercepted while the tab is running a command', () => {
    applyConfig(null);
    statusMap.set('g1', 'running');
    const store = {
      getState: () => ({
        termGroups: {
          termGroups: { g1: { uid: 'g1', sessionUid: 's1', parentUid: null, children: [] } },
          activeSessions: {},
          activeRootGroup: 'g1',
        },
      }),
    };
    const next = vi.fn((a: any) => a);
    const mw = middleware(store as any)(next);

    const result = mw({ type: 'TERM_GROUP_EXIT', uid: 'g1' });
    expect(result).toBeUndefined();
    expect(next).not.toHaveBeenCalled();
    expect(document.querySelector('.kit-close-confirm')).not.toBeNull();
  });

  it('TERM_GROUP_EXIT passes through when the tab is idle', () => {
    applyConfig(null);
    statusMap.set('g1', 'done');
    const store = {
      getState: () => ({
        termGroups: {
          termGroups: { g1: { uid: 'g1', sessionUid: 's1', parentUid: null, children: [] } },
          activeSessions: {},
          activeRootGroup: 'g1',
        },
      }),
    };
    const next = vi.fn((a: any) => a);
    const mw = middleware(store as any)(next);

    mw({ type: 'TERM_GROUP_EXIT', uid: 'g1' });
    expect(next).toHaveBeenCalledWith({ type: 'TERM_GROUP_EXIT', uid: 'g1' });
    expect(document.querySelector('.kit-close-confirm')).toBeNull();
  });

  it('TERM_GROUP_EXIT passes through when confirmClose is disabled', () => {
    applyConfig({ hyperKit: { confirmClose: false } });
    statusMap.set('g1', 'running');
    const store = {
      getState: () => ({
        termGroups: {
          termGroups: { g1: { uid: 'g1', sessionUid: 's1', parentUid: null, children: [] } },
          activeSessions: {},
          activeRootGroup: 'g1',
        },
      }),
    };
    const next = vi.fn((a: any) => a);
    const mw = middleware(store as any)(next);

    mw({ type: 'TERM_GROUP_EXIT', uid: 'g1' });
    expect(next).toHaveBeenCalledWith({ type: 'TERM_GROUP_EXIT', uid: 'g1' });
    expect(document.querySelector('.kit-close-confirm')).toBeNull();
  });

  it('a confirmed TERM_GROUP_EXIT re-dispatch passes through and strips the marker', () => {
    applyConfig(null);
    statusMap.set('g1', 'running');
    const store = {
      getState: () => ({
        termGroups: {
          termGroups: { g1: { uid: 'g1', sessionUid: 's1', parentUid: null, children: [] } },
          activeSessions: {},
          activeRootGroup: 'g1',
        },
      }),
    };
    const next = vi.fn((a: any) => a);
    const mw = middleware(store as any)(next);

    mw({ type: 'TERM_GROUP_EXIT', uid: 'g1', _kitConfirmed: true });
    expect(next).toHaveBeenCalledWith({ type: 'TERM_GROUP_EXIT', uid: 'g1' });
    expect(next.mock.calls[0][0]._kitConfirmed).toBeUndefined();
    expect(document.querySelector('.kit-close-confirm')).toBeNull();
  });

  it('intercepts closes even with the vertical chrome and badge off', () => {
    applyConfig({ hyperKit: { leftPanel: { enable: false }, paneCountBadge: false } });
    statusMap.set('g1', 'running');
    const store = {
      getState: () => ({
        termGroups: {
          termGroups: { g1: { uid: 'g1', sessionUid: 's1', parentUid: null, children: [] } },
          activeSessions: {},
          activeRootGroup: 'g1',
        },
      }),
    };
    const next = vi.fn((a: any) => a);
    const mw = middleware(store as any)(next);

    mw({ type: 'TERM_GROUP_EXIT', uid: 'g1' });
    expect(next).not.toHaveBeenCalled();
    expect(document.querySelector('.kit-close-confirm')).not.toBeNull();
  });

  it('syncs the window close guard state from the middleware', () => {
    const send = vi.fn();
    (window as any).require = (mod: string) =>
      mod === 'electron' ? { ipcRenderer: { send } } : undefined;
    statusMap.set('g1', 'running');
    applyConfig(null);
    const store = {
      getState: () => ({
        termGroups: {
          termGroups: { g1: { uid: 'g1', sessionUid: 's1', parentUid: null, children: [] } },
          activeSessions: {},
          activeRootGroup: 'g1',
        },
      }),
    };
    const next = vi.fn((a: any) => a);
    const mw = middleware(store as any)(next);

    mw({ type: 'SESSION_ADD', uid: 's1' });
    expect(send).toHaveBeenCalledWith('hyper-kit-close-guard-state', {
      enabled: true,
      running: 1,
    });
    delete (window as any).require;
  });
});

describe('onWindow (main process)', () => {
  let ipcHandlers: Record<string, (event: { sender: unknown }, state?: unknown) => void>;
  let closeHandlers: Array<(e: { preventDefault: () => void }) => void>;
  let closedHandlers: Array<() => void>;

  beforeEach(() => {
    ipcHandlers = {};
    closeHandlers = [];
    closedHandlers = [];
    electronIpcMain.on.mockReset();
    electronIpcMain.removeListener.mockReset();
    electronDialog.showMessageBox.mockReset();
    electronIpcMain.on.mockImplementation(
      (channel: string, listener: (event: { sender: unknown }, state?: unknown) => void) => {
        ipcHandlers[channel] = listener;
      },
    );
    electronIpcMain.removeListener.mockImplementation((channel: string, listener: unknown) => {
      if (ipcHandlers[channel] === listener) {
        delete ipcHandlers[channel];
      }
    });
  });

  function makeWin() {
    const win = {
      webContents: { id: 7 },
      close: vi.fn(),
      on: vi.fn((e: string, f: (...args: never[]) => void) => {
        if (e === 'close') {
          closeHandlers.push(f as (e: { preventDefault: () => void }) => void);
        }
        if (e === 'closed') {
          closedHandlers.push(f as () => void);
        }
      }),
      removeListener: vi.fn((e: string, f: (...args: never[]) => void) => {
        if (e === 'close') {
          closeHandlers = closeHandlers.filter((h) => h !== f);
        }
      }),
    };
    return win;
  }

  function prevented(): { preventDefault: () => void; called: boolean } {
    const e = { called: false, preventDefault: () => void (e.called = true) };
    return e;
  }

  function armGuard(running = 1): void {
    ipcHandlers['hyper-kit-close-guard-state']({ sender: { id: 7 } }, { enabled: true, running });
  }

  it('registers the guard-state channel', () => {
    const win = makeWin();
    onWindow(win as any);
    expect(ipcHandlers['hyper-kit-close-guard-state']).toBeTypeOf('function');
  });

  it('prevents the close and asks via a native dialog when a tab is running', () => {
    electronDialog.showMessageBox.mockResolvedValue({ response: 0 });
    const win = makeWin();
    onWindow(win as any);
    armGuard(1);
    const e = prevented();
    closeHandlers[0](e);
    expect(e.called).toBe(true);
    expect(electronDialog.showMessageBox).toHaveBeenCalledWith(
      win,
      expect.objectContaining({
        buttons: ['Cancel', 'Quit Anyway'],
        message: 'Processes still running',
      }),
    );
    expect(win.close).not.toHaveBeenCalled();
  });

  it('closes the window when the dialog is confirmed', async () => {
    electronDialog.showMessageBox.mockResolvedValue({ response: 1 });
    const win = makeWin();
    onWindow(win as any);
    armGuard(1);
    closeHandlers[0](prevented());
    await Promise.resolve();
    expect(win.close).toHaveBeenCalledTimes(1);
    // the confirmed close passes through the close handler without re-asking
    const e = prevented();
    closeHandlers[0](e);
    expect(e.called).toBe(false);
  });

  it('keeps the window open when the dialog is cancelled', async () => {
    electronDialog.showMessageBox.mockResolvedValue({ response: 0 });
    const win = makeWin();
    onWindow(win as any);
    armGuard(1);
    closeHandlers[0](prevented());
    await Promise.resolve();
    expect(win.close).not.toHaveBeenCalled();
  });

  it('lets the close through when no tab is running', () => {
    const win = makeWin();
    onWindow(win as any);
    armGuard(0);
    const e = prevented();
    closeHandlers[0](e);
    expect(e.called).toBe(false);
    expect(electronDialog.showMessageBox).not.toHaveBeenCalled();
  });

  it('lets the close through when confirmClose is disabled', () => {
    const win = makeWin();
    onWindow(win as any);
    ipcHandlers['hyper-kit-close-guard-state'](
      { sender: { id: 7 } },
      { enabled: false, running: 1 },
    );
    const e = prevented();
    closeHandlers[0](e);
    expect(e.called).toBe(false);
  });

  it('never traps the close before the renderer reported state', () => {
    const win = makeWin();
    onWindow(win as any);
    const e = prevented();
    closeHandlers[0](e);
    expect(e.called).toBe(false);
    expect(electronDialog.showMessageBox).not.toHaveBeenCalled();
  });

  it('ignores guard-state messages from other windows', () => {
    const win = makeWin();
    onWindow(win as any);
    ipcHandlers['hyper-kit-close-guard-state'](
      { sender: { id: 99 } },
      { enabled: true, running: 1 },
    );
    const e = prevented();
    closeHandlers[0](e);
    expect(e.called).toBe(false);
  });

  it('removes listeners once the window is closed', () => {
    const win = makeWin();
    onWindow(win as any);
    closedHandlers[0]();
    expect(ipcHandlers['hyper-kit-close-guard-state']).toBeUndefined();
    expect(closeHandlers.length).toBe(0);
  });
});
