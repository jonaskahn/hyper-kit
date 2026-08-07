import { describe, it, expect } from 'vitest';
import Immutable from 'seamless-immutable';

import { reduceTermGroups, REORDER_ACTION, computeInsertIndex } from '../../src/core/reorder';

function makeState(rootUids: string[], extras: Record<string, unknown> = {}) {
  const termGroups: Record<string, unknown> = {};
  const activeSessions: Record<string, string> = {};
  rootUids.forEach((uid) => {
    termGroups[uid] = { uid, sessionUid: 'session-' + uid, parentUid: null, children: [] };
    activeSessions[uid] = 'session-' + uid;
  });
  Object.assign(termGroups, extras);
  return Immutable({
    termGroups,
    activeSessions,
    activeRootGroup: rootUids[0],
  });
}

function rootOrder(state: any): string[] {
  return Object.keys(state.termGroups).filter((uid) => !state.termGroups[uid].parentUid);
}

describe('reduceTermGroups', () => {
  it('passes through actions that are not reorders', () => {
    const state = makeState(['a', 'b']);
    const next = reduceTermGroups(state, { type: 'SESSION_ADD', uid: 'x' });
    expect(next).toBe(state);
  });

  it('passes through malformed reorder actions', () => {
    const state = makeState(['a', 'b']);
    expect(reduceTermGroups(state, { type: REORDER_ACTION })).toBe(state);
    expect(reduceTermGroups(state, { type: REORDER_ACTION, order: 'ab' })).toBe(state);
    expect(reduceTermGroups(state, null)).toBe(state);
  });

  it('reorders root groups into the requested order', () => {
    const state = makeState(['a', 'b', 'c']);
    const next = reduceTermGroups(state, { type: REORDER_ACTION, order: ['c', 'a', 'b'] });
    expect(next).not.toBe(state);
    expect(rootOrder(next)).toEqual(['c', 'a', 'b']);
  });

  it('keeps non-root (split-pane) groups after the roots', () => {
    const split = {
      d: { uid: 'd', sessionUid: null, parentUid: 'a', children: [] },
    };
    const state = makeState(['a', 'b', 'c'], split);
    const next = reduceTermGroups(state, { type: REORDER_ACTION, order: ['b', 'c', 'a'] });
    expect(rootOrder(next)).toEqual(['b', 'c', 'a']);
    expect(Object.keys(next.termGroups)).toEqual(['b', 'c', 'a', 'd']);
    expect(next.termGroups.d).toBe(state.termGroups.d);
  });

  it('preserves activeSessions and activeRootGroup', () => {
    const state = makeState(['a', 'b']);
    const next = reduceTermGroups(state, { type: REORDER_ACTION, order: ['b', 'a'] });
    expect(next.activeRootGroup).toBe('a');
    expect(next.activeSessions.a).toBe('session-a');
    expect(next.activeSessions.b).toBe('session-b');
  });

  it('is a no-op when the order is unchanged (same state instance)', () => {
    const state = makeState(['a', 'b', 'c']);
    const next = reduceTermGroups(state, { type: REORDER_ACTION, order: ['a', 'b', 'c'] });
    expect(next).toBe(state);
  });

  it('ignores orders that are missing a root group', () => {
    const state = makeState(['a', 'b', 'c']);
    const next = reduceTermGroups(state, { type: REORDER_ACTION, order: ['b', 'a'] });
    expect(next).toBe(state);
  });

  it('ignores orders referencing unknown uids', () => {
    const state = makeState(['a', 'b']);
    const next = reduceTermGroups(state, { type: REORDER_ACTION, order: ['zzz', 'a', 'b'] });
    expect(next).toBe(state);
  });

  it('dedupes repeated uids and still requires a complete order', () => {
    const state = makeState(['a', 'b']);
    const next = reduceTermGroups(state, { type: REORDER_ACTION, order: ['a', 'b', 'a'] });
    expect(next).toBe(state);
  });
});

describe('computeInsertIndex', () => {
  it('inserts before the first tab whose midpoint is below the pointer', () => {
    const rects = [
      { top: 0, bottom: 60 },
      { top: 60, bottom: 120 },
      { top: 120, bottom: 180 },
    ];
    expect(computeInsertIndex(10, rects)).toBe(0);
    expect(computeInsertIndex(85, rects)).toBe(1);
    expect(computeInsertIndex(200, rects)).toBe(3);
  });

  it('returns 0 for a pointer above the list and len below it', () => {
    const rects = [{ top: 100, bottom: 160 }];
    expect(computeInsertIndex(5, rects)).toBe(0);
    expect(computeInsertIndex(999, rects)).toBe(1);
  });

  it('handles an empty rect list', () => {
    expect(computeInsertIndex(50, [])).toBe(0);
  });
});
