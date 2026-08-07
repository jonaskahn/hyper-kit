import { describe, it, expect, vi, afterEach } from 'vitest';

import { setStore } from '../../../src/platform/hyper-store';
import {
  findGroupUid,
  onSessionAdd,
  onSessionUserData,
  onSessionResize,
  onSessionPtyData,
  pruneStaleSessions,
  pendingRun,
} from '../../../src/features/verticalTabs/session-tracking';
import {
  cwdMap,
  statusMap,
  sessionStart,
  getLastCwd,
} from '../../../src/platform/state/tab-session-store';

function mockStore(mapping: Record<string, string>) {
  return {
    getState: () => ({ termGroups: { termGroups: mapping } }),
  };
}

afterEach(() => {
  setStore(null);
  cwdMap.clear();
  statusMap.clear();
  sessionStart.clear();
  for (const timer of pendingRun.values()) {
    clearTimeout(timer);
  }
  pendingRun.clear();
});

describe('findGroupUid', () => {
  it('maps a session uid to its term group', () => {
    setStore(mockStore({ g1: { sessionUid: 's1' } }));
    expect(findGroupUid('s1')).toBe('g1');
    expect(findGroupUid('unknown')).toBe('unknown');
  });
});

describe('session lifecycle', () => {
  it('SESSION_ADD seeds cwd (keyed by group uid) and start time (keyed by session uid)', () => {
    setStore(mockStore({ g1: { sessionUid: 's1' } }));
    onSessionAdd('s1', '/Users/test/proj');
    expect(sessionStart.get('s1')).toBeGreaterThan(0);
    expect(cwdMap.get('g1')).toBe('/Users/test/proj');
    expect(getLastCwd()).toBe('/Users/test/proj');
  });

  it('SESSION_USER_DATA marks running on submit without retaining the typed text', () => {
    setStore(mockStore({ g1: { sessionUid: 's1' } }));
    onSessionUserData('s1', 'git status');
    onSessionUserData('s1', '\r');
    expect(statusMap.get('g1')).toBe('running');
  });

  it('SESSION_RESIZE suppresses the output rule', () => {
    vi.useFakeTimers();
    setStore(mockStore({ g2: { sessionUid: 's3' } }));
    onSessionAdd('s3');
    onSessionUserData('s3', 'cmd\n');
    onSessionPtyData('s3', '\x1b]7;file:///Users/test\x07');
    expect(statusMap.get('g2')).toBe('done');

    onSessionResize('s3');
    onSessionPtyData('s3', 'reflow reprint');
    expect(statusMap.get('g2')).toBe('done');
    vi.useRealTimers();
  });

  it('a prompt after a command flips running -> done', () => {
    setStore(mockStore({ g3: { sessionUid: 's4' } }));
    onSessionAdd('s4', '/x');
    onSessionUserData('s4', 'sleep 1\n');
    expect(statusMap.get('g3')).toBe('running');
    onSessionPtyData('s4', '\x1b]7;file:///x\x07');
    expect(statusMap.get('g3')).toBe('done');
    expect(cwdMap.get('g3')).toBe('/x');
  });

  it('output after the prompt-redraw grace debounces to running', () => {
    vi.useFakeTimers();
    setStore(mockStore({ g4: { sessionUid: 's5' } }));
    onSessionAdd('s5');
    onSessionUserData('s5', 'cmd\n');
    onSessionPtyData('s5', '\x1b]7;file:///Users/test\x07');
    expect(statusMap.get('g4')).toBe('done');

    vi.advanceTimersByTime(400); // leave the prompt-redraw grace window
    onSessionPtyData('s5', 'output text');
    expect(statusMap.get('g4')).toBe('done');

    vi.advanceTimersByTime(2000); // leave the doneAt grace
    onSessionPtyData('s5', 'more output');
    expect(pendingRun.has('s5')).toBe(true);
    expect(statusMap.get('g4')).toBe('done');

    vi.advanceTimersByTime(350); // debounce fires
    expect(statusMap.get('g4')).toBe('running');
    expect(pendingRun.has('s5')).toBe(false);
    vi.useRealTimers();
  });
});

describe('pruneStaleSessions', () => {
  it('drops map entries for uids no longer present in the store, keeps live ones', () => {
    setStore(mockStore({ g1: { sessionUid: 's1' } }));
    onSessionAdd('s1', '/Users/test/proj');
    cwdMap.set('ghost-group', '/nowhere');
    sessionStart.set('ghost-session', Date.now());
    statusMap.set('ghost-group', 'running');

    pruneStaleSessions();

    expect(cwdMap.has('ghost-group')).toBe(false);
    expect(sessionStart.has('ghost-session')).toBe(false);
    expect(statusMap.has('ghost-group')).toBe(false);
    expect(cwdMap.get('g1')).toBe('/Users/test/proj');
    expect(sessionStart.get('s1')).toBeGreaterThan(0);
  });

  it('does nothing when the store is unavailable', () => {
    setStore(null);
    cwdMap.set('g1', '/keep-me');
    expect(() => pruneStaleSessions()).not.toThrow();
    expect(cwdMap.get('g1')).toBe('/keep-me');
  });
});
