import { describe, it, expect, afterEach, vi } from 'vitest';

import {
  setStore,
  getStore,
  getTermGroups,
  findGroupUid,
  getActiveSessionUid,
  getFocusedSessionUid,
  rootGroupUid,
  rootGroupUidOfGroup,
  countPanesInTab,
  listPaneSessions,
  emitRpc,
} from '../../src/platform/hyper-store';

import { splitGroups, tabStore, unsplitGroup } from '../helpers/store';

function nestedSplitGroups(): Record<string, any> {
  return {
    g1: { uid: 'g1', sessionUid: null, parentUid: null, children: ['g2', 'g3'] },
    g2: { uid: 'g2', sessionUid: null, parentUid: 'g1', children: ['g4', 'g5'] },
    g3: { uid: 'g3', sessionUid: 's3', parentUid: 'g1', children: [] },
    g4: { uid: 'g4', sessionUid: 's4', parentUid: 'g2', children: [] },
    g5: { uid: 'g5', sessionUid: 's5', parentUid: 'g2', children: [] },
  };
}

afterEach(() => {
  setStore(null);
});

describe('hyper-store', () => {
  it('returns the store set via setStore', () => {
    const store = tabStore({}, {}, null);
    setStore(store as any);
    expect(getStore()).toBe(store);
  });

  it('getTermGroups falls back to an empty object when no store is set', () => {
    expect(getTermGroups()).toEqual({});
  });

  it('getTermGroups falls back to an empty object when the store throws', () => {
    setStore({ getState: () => ({}) } as any);
    expect(getTermGroups()).toEqual({});
  });

  it('findGroupUid maps a session uid to its term group', () => {
    setStore(tabStore({ g1: { sessionUid: 's1' } }, {}, null) as any);
    expect(findGroupUid('s1')).toBe('g1');
  });

  it('findGroupUid returns the input unchanged when no group matches', () => {
    setStore(tabStore({ g1: { sessionUid: 's1' } }, {}, null) as any);
    expect(findGroupUid('unknown')).toBe('unknown');
  });

  it('getActiveSessionUid reads the focused session of a tab', () => {
    setStore(tabStore({}, { g1: 's3' }, 'g1') as any);
    expect(getActiveSessionUid('g1')).toBe('s3');
  });

  it('getActiveSessionUid returns null without a store or an unknown tab', () => {
    expect(getActiveSessionUid('g1')).toBeNull();
    setStore(tabStore({}, {}, null) as any);
    expect(getActiveSessionUid('g1')).toBeNull();
  });

  it('getFocusedSessionUid reads the focused session via activeRootGroup', () => {
    setStore(tabStore({}, { g1: 's3' }, 'g1') as any);
    expect(getFocusedSessionUid()).toBe('s3');
  });

  it('getFocusedSessionUid returns null without a store or an active root', () => {
    expect(getFocusedSessionUid()).toBeNull();
    setStore(tabStore({}, {}, null) as any);
    expect(getFocusedSessionUid()).toBeNull();
  });

  it('rootGroupUid walks up to the root of a split tree', () => {
    setStore(tabStore(splitGroups()) as any);
    expect(rootGroupUid('s3')).toBe('g1');
  });

  it('rootGroupUid returns null when the session has no group yet', () => {
    expect(rootGroupUid('unknown')).toBeNull();
  });

  it('rootGroupUidOfGroup walks a group uid to its tab root', () => {
    setStore(tabStore(splitGroups(['g2'])) as any);
    expect(rootGroupUidOfGroup('g2')).toBe('g1');
    expect(rootGroupUidOfGroup('unknown')).toBeNull();
  });

  it('countPanesInTab counts leaves: 1 for an unsplit tab', () => {
    setStore(tabStore(unsplitGroup()) as any);
    expect(countPanesInTab('g1')).toBe(1);
  });

  it('countPanesInTab counts each split pane', () => {
    setStore(tabStore(splitGroups()) as any);
    expect(countPanesInTab('g1')).toBe(2);
  });

  it('countPanesInTab descends into nested splits', () => {
    setStore(tabStore(nestedSplitGroups()) as any);
    expect(countPanesInTab('g1')).toBe(3);
  });

  it('countPanesInTab returns 0 for an unknown tab', () => {
    expect(countPanesInTab('ghost')).toBe(0);
  });

  it('listPaneSessions returns the leaf session of an unsplit tab', () => {
    setStore(tabStore(unsplitGroup()) as any);
    expect(listPaneSessions('g1')).toEqual(['s1']);
  });

  it('listPaneSessions lists every pane of a split tab in tree order', () => {
    setStore(tabStore(splitGroups()) as any);
    expect(listPaneSessions('g1')).toEqual(['s2', 's3']);
  });

  it('listPaneSessions descends into nested splits', () => {
    setStore(tabStore(nestedSplitGroups()) as any);
    expect(listPaneSessions('g1')).toEqual(['s4', 's5', 's3']);
  });

  it('listPaneSessions returns an empty list for an unknown tab', () => {
    expect(listPaneSessions('ghost')).toEqual([]);
  });

  describe('emitRpc', () => {
    afterEach(() => {
      delete (window as any).rpc;
    });

    it('forwards to window.rpc.emit when the bridge is present', () => {
      const emit = vi.fn();
      (window as any).rpc = { emit };
      emitRpc('new', { cwd: '/tmp' });
      expect(emit).toHaveBeenCalledWith('new', { cwd: '/tmp' });
    });

    it('no-ops without a rpc bridge (tests, a host without it)', () => {
      expect(() => emitRpc('new', { cwd: '/tmp' })).not.toThrow();
    });

    it('no-ops when window.rpc.emit throws', () => {
      (window as any).rpc = {
        emit: () => {
          throw new Error('not ready');
        },
      };
      expect(() => emitRpc('new', { cwd: '/tmp' })).not.toThrow();
    });
  });
});
