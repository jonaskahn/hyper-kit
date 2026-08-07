import { describe, it, expect, afterEach } from 'vitest';

import { setStore } from '../../../src/platform/hyper-store';
import {
  sessionStart,
  getLastCwd,
  setLastCwd,
  lookupSessionStart,
} from '../../../src/platform/state/tab-session-store';

afterEach(() => {
  setStore(null);
  sessionStart.clear();
  setLastCwd('');
});

describe('tab-session-store', () => {
  it('tracks the last cwd', () => {
    setLastCwd('/work/project');
    expect(getLastCwd()).toBe('/work/project');
  });

  it('lookupSessionStart returns null for a missing uid', () => {
    expect(lookupSessionStart(null)).toBeNull();
    expect(lookupSessionStart('unknown')).toBeNull();
  });

  it('lookupSessionStart resolves directly when the uid is a session uid', () => {
    sessionStart.set('s1', 1000);
    expect(lookupSessionStart('s1')).toBe(1000);
  });

  it('lookupSessionStart resolves via the term group when the uid is a group uid', () => {
    setStore({
      getState: () => ({ termGroups: { termGroups: { g1: { sessionUid: 's1' } } } }),
    } as any);
    sessionStart.set('s1', 1000);
    expect(lookupSessionStart('g1')).toBe(1000);
  });
});
