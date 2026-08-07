import { describe, it, expect, vi, afterEach } from 'vitest';

import { setStore } from '../../../src/platform/hyper-store';
import {
  onSessionAdd,
  onSessionUserData,
  onSessionResize,
  onSessionSetActive,
  onSessionSplit,
  onTermGroupExit,
  onSessionPtyData,
  onSessionXtermTitle,
  pruneStaleSessions,
  pendingRun,
  pendingAgentClear,
} from '../../../src/features/left-panel/session-tracking';
import {
  cwdMap,
  statusMap,
  sessionStart,
  agentMap,
  agentSource,
  agentSince,
  inputLines,
  getLastCwd,
} from '../../../src/platform/state/tab-session-store';
import { splitGroups, tabStore } from '../../helpers/store';

function mockStore(mapping: Record<string, any>): any {
  return tabStore(mapping, {}, null);
}

/* g1 (root) -> g2 (session s2) and g3 (session s3), as after a split */
function mockSplitTree() {
  return tabStore(splitGroups());
}

afterEach(() => {
  setStore(null);
  cwdMap.clear();
  statusMap.clear();
  sessionStart.clear();
  agentMap.clear();
  agentSource.clear();
  agentSince.clear();
  inputLines.clear();
  for (const timer of pendingRun.values()) {
    clearTimeout(timer);
  }
  pendingRun.clear();
  for (const timer of pendingAgentClear.values()) {
    clearTimeout(timer);
  }
  pendingAgentClear.clear();
});

describe('session lifecycle', () => {
  it('SESSION_ADD seeds cwd (keyed by session uid) and start time (keyed by session uid)', () => {
    setStore(mockStore({ g1: { sessionUid: 's1' } }));
    onSessionAdd('s1', '/Users/test/proj');
    expect(sessionStart.get('s1')).toBeGreaterThan(0);
    expect(cwdMap.get('s1')).toBe('/Users/test/proj');
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
    expect(cwdMap.get('s4')).toBe('/x');
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

describe('active pane tracking', () => {
  it('SESSION_SET_ACTIVE announces the focused session with its tab root', () => {
    setStore(mockSplitTree());
    const spy = vi.spyOn(window, 'dispatchEvent');
    onSessionSetActive('s3');
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'kit-tab-active-session',
        detail: { rootUid: 'g1', sessionUid: 's3' },
      }),
    );
  });

  it('SESSION_SET_ACTIVE stays silent for a session without a group yet', () => {
    setStore(mockStore({ g1: { sessionUid: 's1' } }));
    const spy = vi.spyOn(window, 'dispatchEvent');
    onSessionSetActive('ghost');
    expect(spy).not.toHaveBeenCalled();
  });

  it('a split announces the brand-new session as focused for the split tab', () => {
    setStore(mockSplitTree());
    const spy = vi.spyOn(window, 'dispatchEvent');
    onSessionSplit('s4', 's2'); // s2 roots at g1, the tab being split
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'kit-tab-active-session',
        detail: { rootUid: 'g1', sessionUid: 's4' },
      }),
    );
  });

  it('a split also announces a possible pane-count change', () => {
    setStore(mockSplitTree());
    const spy = vi.spyOn(window, 'dispatchEvent');
    onSessionSplit('s4', 's2');
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'kit-tab-panes-changed', detail: { rootUid: 'g1' } }),
    );
  });

  it('TERM_GROUP_EXIT announces a pane-count change for its tab', () => {
    setStore(mockSplitTree());
    const spy = vi.spyOn(window, 'dispatchEvent');
    onTermGroupExit('g3');
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'kit-tab-panes-changed', detail: { rootUid: 'g1' } }),
    );
  });

  it('TERM_GROUP_EXIT stays silent for an unknown group', () => {
    setStore(mockSplitTree());
    const spy = vi.spyOn(window, 'dispatchEvent');
    onTermGroupExit('ghost');
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('agent detection', () => {
  it('sets an agent when a submitted command starts with one (split across chunks)', () => {
    setStore(mockStore({ g1: { sessionUid: 's1' } }));
    const spy = vi.spyOn(window, 'dispatchEvent');
    onSessionUserData('s1', 'claude');
    onSessionUserData('s1', '\r');
    expect(agentMap.get('s1')).toBe('claude');
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'kit-tab-agents-changed',
        detail: { rootUid: 'g1' },
      }),
    );
  });

  it('keeps no agent for ordinary commands', () => {
    setStore(mockStore({ g1: { sessionUid: 's1' } }));
    onSessionUserData('s1', 'git status\r');
    expect(agentMap.has('s1')).toBe(false);
  });

  it('never clears on raw-mode keystrokes while an agent runs', () => {
    setStore(mockStore({ g1: { sessionUid: 's1' } }));
    onSessionUserData('s1', 'claude\r');
    onSessionUserData('s1', 'y\r'); // confirmation inside the agent TUI
    onSessionUserData('s1', 'exit\r');
    expect(agentMap.get('s1')).toBe('claude');
  });

  it('switches to a new agent command once the previous one is gone', () => {
    setStore(mockStore({ g1: { sessionUid: 's1' } }));
    onSessionUserData('s1', 'claude\r');
    onSessionUserData('s1', 'codex\r');
    expect(agentMap.get('s1')).toBe('codex');
  });

  it('clears the agent when the shell draws a fresh prompt (OSC 7)', () => {
    vi.useFakeTimers();
    setStore(mockStore({ g1: { sessionUid: 's1' } }));
    onSessionAdd('s1');
    onSessionUserData('s1', 'claude\r');
    expect(agentMap.get('s1')).toBe('claude');
    // the prompt must arrive outside the launch grace window to count
    vi.advanceTimersByTime(2000);
    onSessionPtyData('s1', '\x1b]7;file:///Users/test\x07');
    expect(agentMap.has('s1')).toBe(false);
    vi.useRealTimers();
  });

  it('does not clear a fresh input-detected agent on startup OSC 7 (codex)', () => {
    setStore(mockStore({ g1: { sessionUid: 's1' } }));
    onSessionAdd('s1');
    onSessionUserData('s1', 'codex\r');
    expect(agentMap.get('s1')).toBe('codex');
    // codex emits its own OSC 7 (cwd tracking) right at launch: this is
    // agent chatter, not a shell prompt, and must not kill the badge
    onSessionPtyData('s1', '\x1b]7;file:///Users/test\x07');
    expect(agentMap.get('s1')).toBe('codex');
  });

  it('clears a title-detected agent once a real prompt follows the shell title', () => {
    setStore(mockStore({ g1: { sessionUid: 's1' } }));
    onSessionPtyData('s1', '\x1b]0;claude\x07');
    expect(agentMap.get('s1')).toBe('claude');
    // a real exit: the shell's non-matching precmd title, then the prompt
    onSessionPtyData('s1', '\x1b]0;zsh\x07');
    onSessionPtyData('s1', '\x1b]7;file:///Users/test\x07');
    expect(agentMap.has('s1')).toBe(false);
  });

  it('keeps a title-detected agent across an OSC 7 while its title still matches', () => {
    setStore(mockStore({ g1: { sessionUid: 's1' } }));
    onSessionPtyData('s1', '\x1b]0;opencode\x07');
    expect(agentMap.get('s1')).toBe('opencode');
    // opencode emits cwd sequences mid-session; the TUI title still names
    // it, so this is chatter, not a shell prompt, and must not kill it
    onSessionPtyData('s1', '\x1b]7;file:///Users/test\x07');
    onSessionPtyData('s1', '\x1b]7;file:///Users/test\x07');
    expect(agentMap.get('s1')).toBe('opencode');
  });

  it('clears a title-detected agent once the title stops matching (debounced)', () => {
    vi.useFakeTimers();
    setStore(mockStore({ g1: { sessionUid: 's1' } }));
    onSessionPtyData('s1', '\x1b]0;claude\x07');
    expect(agentMap.get('s1')).toBe('claude');
    onSessionPtyData('s1', '\x1b]0;zsh\x07');
    expect(agentMap.get('s1')).toBe('claude'); // debounce window
    vi.advanceTimersByTime(600);
    expect(agentMap.has('s1')).toBe(false);
    expect(pendingAgentClear.has('s1')).toBe(false);
    vi.useRealTimers();
  });

  it('keeps a title-detected agent across a transient non-matching redraw', () => {
    vi.useFakeTimers();
    setStore(mockStore({ g1: { sessionUid: 's1' } }));
    onSessionPtyData('s1', '\x1b]0;opencode\x07');
    expect(agentMap.get('s1')).toBe('opencode');
    // one stray non-matching title (modal redraw), then the TUI re-titles
    onSessionPtyData('s1', '\x1b]0;choose an option\x07');
    expect(agentMap.get('s1')).toBe('opencode');
    vi.advanceTimersByTime(300);
    onSessionPtyData('s1', '\x1b]0;⠂ opencode\x07');
    vi.advanceTimersByTime(1000);
    expect(agentMap.get('s1')).toBe('opencode');
    expect(pendingAgentClear.has('s1')).toBe(false);
    vi.useRealTimers();
  });

  it('sets an agent from an OSC 0 title and clears once the title change holds', () => {
    vi.useFakeTimers();
    setStore(mockStore({ g1: { sessionUid: 's1' } }));
    onSessionPtyData('s1', '\x1b]0;claude\x07');
    expect(agentMap.get('s1')).toBe('claude');
    onSessionPtyData('s1', '\x1b]0;zsh\x07');
    expect(agentMap.get('s1')).toBe('claude');
    vi.advanceTimersByTime(600);
    expect(agentMap.has('s1')).toBe(false);
    vi.useRealTimers();
  });

  it('matches OSC 0 titles that start with the agent, ignores lookalikes', () => {
    vi.useFakeTimers();
    setStore(mockStore({ g1: { sessionUid: 's1' } }));
    onSessionPtyData('s1', '\x1b]0;Claude Code\x07');
    expect(agentMap.get('s1')).toBe('claude');
    onSessionPtyData('s1', '\x1b]0;grep claude file.txt\x07');
    expect(agentMap.get('s1')).toBe('claude');
    vi.advanceTimersByTime(600);
    expect(agentMap.has('s1')).toBe(false);
    vi.useRealTimers();
  });

  it('emits nothing when the detected agent does not change', () => {
    setStore(mockStore({ g1: { sessionUid: 's1' } }));
    onSessionUserData('s1', 'claude\r');
    const spy = vi.spyOn(window, 'dispatchEvent');
    onSessionUserData('s1', 'claude\r');
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('agent detection via window titles (SESSION_SET_XTERM_TITLE)', () => {
  it('sets the agent when the title names one, with its tab root', () => {
    setStore(mockStore({ g1: { sessionUid: 's1' } }));
    const spy = vi.spyOn(window, 'dispatchEvent');
    onSessionXtermTitle('s1', 'claude');
    expect(agentMap.get('s1')).toBe('claude');
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'kit-tab-agents-changed',
        detail: { rootUid: 'g1' },
      }),
    );
  });

  it('clears the agent once a non-agent title holds (debounced)', () => {
    vi.useFakeTimers();
    setStore(mockStore({ g1: { sessionUid: 's1' } }));
    onSessionXtermTitle('s1', 'Claude Code');
    expect(agentMap.get('s1')).toBe('claude');
    onSessionXtermTitle('s1', 'vim');
    expect(agentMap.get('s1')).toBe('claude');
    vi.advanceTimersByTime(600);
    expect(agentMap.has('s1')).toBe(false);
    vi.useRealTimers();
  });

  it('keeps the agent across spinner-prefixed redraw titles', () => {
    setStore(mockStore({ g1: { sessionUid: 's1' } }));
    onSessionUserData('s1', 'claude\r');
    const spy = vi.spyOn(window, 'dispatchEvent');
    onSessionXtermTitle('s1', '⠂ Claude Code');
    onSessionXtermTitle('s1', '⠐ Claude Code');
    onSessionXtermTitle('s1', '✳ Claude Code');
    expect(agentMap.get('s1')).toBe('claude');
    expect(spy).not.toHaveBeenCalled();
  });

  it('never clears an input-detected agent on non-matching title chatter (codex)', () => {
    setStore(mockStore({ g1: { sessionUid: 's1' } }));
    onSessionUserData('s1', 'codex\r');
    expect(agentMap.get('s1')).toBe('codex');
    const spy = vi.spyOn(window, 'dispatchEvent');
    // codex titles the project directory, with a spinner, on every redraw
    onSessionXtermTitle('s1', 'hyper-kit');
    onSessionXtermTitle('s1', '⠼ hyper-kit');
    onSessionXtermTitle('s1', '⠴ hyper-kit');
    expect(agentMap.get('s1')).toBe('codex');
    expect(spy).not.toHaveBeenCalled();
  });

  it('clears an input-detected agent once the shell draws a fresh prompt', () => {
    vi.useFakeTimers();
    setStore(mockStore({ g1: { sessionUid: 's1' } }));
    onSessionAdd('s1');
    onSessionUserData('s1', 'codex\r');
    onSessionXtermTitle('s1', '⠼ hyper-kit');
    expect(agentMap.get('s1')).toBe('codex');
    vi.advanceTimersByTime(2000); // leave the launch grace window
    onSessionPtyData('s1', '\x1b]7;file:///Users/test\x07');
    expect(agentMap.has('s1')).toBe(false);
    vi.useRealTimers();
  });

  it('clears a title-detected agent once a non-matching title holds', () => {
    vi.useFakeTimers();
    setStore(mockStore({ g1: { sessionUid: 's1' } }));
    onSessionXtermTitle('s1', '⠂ Claude Code');
    expect(agentMap.get('s1')).toBe('claude');
    onSessionXtermTitle('s1', 'zsh');
    expect(agentMap.get('s1')).toBe('claude');
    vi.advanceTimersByTime(600);
    expect(agentMap.has('s1')).toBe(false);
    vi.useRealTimers();
  });

  it('keeps the agent when a matching redraw cancels the pending clear', () => {
    vi.useFakeTimers();
    setStore(mockStore({ g1: { sessionUid: 's1' } }));
    onSessionXtermTitle('s1', '⠂ Claude Code');
    onSessionXtermTitle('s1', 'zsh'); // stray title schedules the clear
    expect(pendingAgentClear.has('s1')).toBe(true);
    onSessionXtermTitle('s1', '⠐ Claude Code'); // redraw cancels it
    expect(pendingAgentClear.has('s1')).toBe(false);
    vi.advanceTimersByTime(2000);
    expect(agentMap.get('s1')).toBe('claude');
    vi.useRealTimers();
  });

  it('keeps no agent for titles that only contain an agent word', () => {
    setStore(mockStore({ g1: { sessionUid: 's1' } }));
    onSessionXtermTitle('s1', 'grep claude file.txt');
    expect(agentMap.has('s1')).toBe(false);
  });

  it('ignores empty titles without touching the current agent', () => {
    setStore(mockStore({ g1: { sessionUid: 's1' } }));
    onSessionXtermTitle('s1', 'claude');
    const spy = vi.spyOn(window, 'dispatchEvent');
    onSessionXtermTitle('s1', '');
    expect(agentMap.get('s1')).toBe('claude');
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('pruneStaleSessions', () => {
  it('drops map entries for uids no longer present in the store, keeps live ones', () => {
    setStore(mockStore({ g1: { sessionUid: 's1' } }));
    onSessionAdd('s1', '/Users/test/proj');
    cwdMap.set('ghost-group', '/nowhere');
    sessionStart.set('ghost-session', Date.now());
    statusMap.set('ghost-group', 'running');
    agentMap.set('ghost-session', 'claude');
    agentSource.set('ghost-session', 'input');
    agentSince.set('ghost-session', Date.now());
    inputLines.set('ghost-session', 'claude\r');

    pruneStaleSessions();

    expect(cwdMap.has('ghost-group')).toBe(false);
    expect(sessionStart.has('ghost-session')).toBe(false);
    expect(statusMap.has('ghost-group')).toBe(false);
    expect(agentMap.has('ghost-session')).toBe(false);
    expect(agentSource.has('ghost-session')).toBe(false);
    expect(agentSince.has('ghost-session')).toBe(false);
    expect(inputLines.has('ghost-session')).toBe(false);
    expect(cwdMap.get('s1')).toBe('/Users/test/proj');
    expect(sessionStart.get('s1')).toBeGreaterThan(0);
  });

  it('does nothing when the store is unavailable', () => {
    setStore(null);
    cwdMap.set('g1', '/keep-me');
    expect(() => pruneStaleSessions()).not.toThrow();
    expect(cwdMap.get('g1')).toBe('/keep-me');
  });
});
