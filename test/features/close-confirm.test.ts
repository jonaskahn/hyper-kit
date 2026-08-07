import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  interceptGroupExit,
  showConfirmDialog,
  removeCloseConfirmDialog,
  syncWindowCloseGuardState,
  resetWindowCloseGuard,
} from '../../src/features/close-confirm';
import { setStore } from '../../src/platform/hyper-store';
import { statusMap } from '../../src/platform/state/tab-session-store';
import { applyConfig } from '../../src/config';
import { splitGroups, tabStore } from '../helpers/store';

function mockStore(groups: Record<string, any> = splitGroups(), dispatch?: any): any {
  return { ...tabStore(groups), dispatch: dispatch || (() => {}) };
}

function overlay(): Element | null {
  return document.querySelector('.kit-close-confirm');
}

beforeEach(() => {
  document.body.innerHTML = '';
  statusMap.clear();
});

afterEach(() => {
  setStore(null);
  removeCloseConfirmDialog();
});

describe('interceptGroupExit', () => {
  it('swallows the close of a tab that is running a command and shows the dialog', () => {
    setStore(mockStore());
    statusMap.set('g1', 'running');
    const result = interceptGroupExit({ type: 'TERM_GROUP_EXIT', uid: 'g1' });
    expect(result).toBe(true);
    const el = overlay();
    expect(el).not.toBeNull();
    expect(el!.textContent).toContain('Command still running');
  });

  it('passes through the close of an idle tab without a dialog', () => {
    setStore(mockStore());
    statusMap.set('g1', 'done');
    expect(interceptGroupExit({ type: 'TERM_GROUP_EXIT', uid: 'g1' })).toBe(false);
    expect(overlay()).toBeNull();
  });

  it('passes through when the tab status is unknown', () => {
    setStore(mockStore());
    expect(interceptGroupExit({ type: 'TERM_GROUP_EXIT', uid: 'g1' })).toBe(false);
    expect(overlay()).toBeNull();
  });

  it('passes through when the group is not in the store', () => {
    setStore(mockStore({}));
    statusMap.set('g1', 'running');
    expect(interceptGroupExit({ type: 'TERM_GROUP_EXIT', uid: 'g1' })).toBe(false);
    expect(overlay()).toBeNull();
  });

  it('guards a pane close in a split tab while the tab is running', () => {
    setStore(mockStore());
    statusMap.set('g1', 'running');
    expect(interceptGroupExit({ type: 'TERM_GROUP_EXIT', uid: 'g2' })).toBe(true);
    expect(overlay()).not.toBeNull();
  });

  it('lets confirmed re-dispatches through and strips the marker', () => {
    setStore(mockStore());
    statusMap.set('g1', 'running');
    const action: any = { type: 'TERM_GROUP_EXIT', uid: 'g1', _kitConfirmed: true };
    expect(interceptGroupExit(action)).toBe(false);
    expect(action._kitConfirmed).toBeUndefined();
    expect(overlay()).toBeNull();
  });

  it('passes through close actions without a uid', () => {
    setStore(mockStore());
    expect(interceptGroupExit({ type: 'TERM_GROUP_EXIT' })).toBe(false);
    expect(overlay()).toBeNull();
  });
});

describe('close confirmation dialog', () => {
  it('cancel dismisses the dialog and the close stays swallowed', () => {
    setStore(mockStore());
    statusMap.set('g1', 'running');
    expect(interceptGroupExit({ type: 'TERM_GROUP_EXIT', uid: 'g1' })).toBe(true);
    (overlay()!.querySelector('.kit-close-confirm-cancel') as HTMLButtonElement).click();
    expect(overlay()).toBeNull();
  });

  it('Escape cancels the dialog', () => {
    setStore(mockStore());
    statusMap.set('g1', 'running');
    interceptGroupExit({ type: 'TERM_GROUP_EXIT', uid: 'g1' });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(overlay()).toBeNull();
  });

  it('clicking outside the card cancels the dialog', () => {
    setStore(mockStore());
    statusMap.set('g1', 'running');
    interceptGroupExit({ type: 'TERM_GROUP_EXIT', uid: 'g1' });
    overlay()!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(overlay()).toBeNull();
  });

  it('clicking inside the card does not cancel', () => {
    setStore(mockStore());
    statusMap.set('g1', 'running');
    interceptGroupExit({ type: 'TERM_GROUP_EXIT', uid: 'g1' });
    (overlay()!.querySelector('.kit-close-confirm-card') as HTMLElement).dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true }),
    );
    expect(overlay()).not.toBeNull();
  });

  it('Close Tab re-dispatches the close with the confirm marker', () => {
    const dispatch = vi.fn();
    setStore(mockStore(splitGroups(), dispatch));
    statusMap.set('g1', 'running');
    interceptGroupExit({ type: 'TERM_GROUP_EXIT', uid: 'g1' });
    (overlay()!.querySelector('.kit-close-confirm-danger') as HTMLButtonElement).click();
    expect(overlay()).toBeNull();
    expect(dispatch).toHaveBeenCalledWith({
      type: 'TERM_GROUP_EXIT',
      uid: 'g1',
      _kitConfirmed: true,
    });
  });

  it('keeps a single dialog open while one is showing', () => {
    setStore(mockStore());
    statusMap.set('g1', 'running');
    interceptGroupExit({ type: 'TERM_GROUP_EXIT', uid: 'g1' });
    showConfirmDialog({ type: 'TERM_GROUP_EXIT', uid: 'g1' });
    expect(document.querySelectorAll('.kit-close-confirm').length).toBe(1);
  });

  it('focuses the safe default (Cancel) on open', () => {
    setStore(mockStore());
    statusMap.set('g1', 'running');
    interceptGroupExit({ type: 'TERM_GROUP_EXIT', uid: 'g1' });
    expect(document.activeElement).toBe(overlay()!.querySelector('.kit-close-confirm-cancel'));
  });
});

describe('window close guard state sync', () => {
  let send: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    applyConfig(null);
    resetWindowCloseGuard();
    send = vi.fn();
    (window as any).require = (mod: string) =>
      mod === 'electron' ? { ipcRenderer: { send } } : undefined;
  });

  afterEach(() => {
    resetWindowCloseGuard();
    delete (window as any).require;
  });

  function stateSent(index = 0): { enabled: boolean; running: number } {
    return send.mock.calls[index][1];
  }

  it('reports idle tabs to the main process', () => {
    setStore(mockStore());
    syncWindowCloseGuardState();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toBe('hyper-kit-close-guard-state');
    expect(stateSent()).toEqual({ enabled: true, running: 0 });
  });

  it('reports a running tab when one appears', () => {
    setStore(mockStore());
    syncWindowCloseGuardState();
    statusMap.set('g1', 'running');
    syncWindowCloseGuardState();
    expect(send).toHaveBeenCalledTimes(2);
    expect(stateSent(1)).toEqual({ enabled: true, running: 1 });
  });

  it('stays silent while nothing changes', () => {
    setStore(mockStore());
    syncWindowCloseGuardState();
    syncWindowCloseGuardState();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('reports when confirmClose is toggled off', () => {
    setStore(mockStore());
    statusMap.set('g1', 'running');
    syncWindowCloseGuardState();
    applyConfig({ hyperKit: { confirmClose: false } });
    syncWindowCloseGuardState();
    expect(stateSent(1)).toEqual({ enabled: false, running: 1 });
  });

  it('counts only root groups (tabs), not panes', () => {
    const groups = {
      g1: { uid: 'g1', sessionUid: null, parentUid: null, children: ['g2'] },
      g2: { uid: 'g2', sessionUid: 's2', parentUid: 'g1', children: [] },
    };
    setStore(mockStore(groups));
    statusMap.set('g1', 'running');
    statusMap.set('g2', 'running');
    syncWindowCloseGuardState();
    expect(stateSent()).toEqual({ enabled: true, running: 1 });
  });

  it('does nothing outside Electron', () => {
    setStore(mockStore());
    delete (window as any).require;
    syncWindowCloseGuardState();
    expect(send).not.toHaveBeenCalled();
  });
});
