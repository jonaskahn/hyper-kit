import {
  getStore,
  getTermGroups,
  findGroupUid,
  rootGroupUid,
  rootGroupUidOfGroup,
} from '../../platform/hyper-store';
import {
  emitCwdChanged,
  emitActiveSessionChanged,
  emitPanesChanged,
  emitAgentsChanged,
} from '../../platform/event-bus';
import {
  cwdMap,
  statusMap,
  sessionStart,
  agentMap,
  agentSource,
  agentSince,
  inputLines,
  titleMap,
  setLastCwd,
  type Status,
} from '../../platform/state/tab-session-store';
import { parseOsc7, parseOsc0 } from '../../core/session';
import { parseAgentCommand, matchAgentTitle } from '../../core/agent-detect';
import { createKeyedStore } from '../../core/keyed-store';

/* Private, single-feature bookkeeping: session-uid-keyed timing state used
   only by the status heuristics below. pendingRun stays exported for direct
   test assertions on the in-flight debounce timer. */
const idleUntil = createKeyedStore<number>(); // session uid -> until when output is prompt echo
export const pendingRun = new Map<string, ReturnType<typeof setTimeout>>(); // session uid -> timeout id (debounced 'running')
export const pendingAgentClear = new Map<string, ReturnType<typeof setTimeout>>(); // session uid -> timeout id (debounced agent clear)
const doneAt = createKeyedStore<number>(); // group uid -> when 'done' was set (grace for prompt redraws)
const firstPrompt = createKeyedStore<boolean>(); // session uid -> shell printed its first prompt

const SESSION_ADD_IDLE_MS = 500;
const RESIZE_IDLE_MS = 3000;
const PROMPT_IDLE_MS = 300;
const PROMPT_REDRAW_GRACE_MS = 1500;
const RUNNING_DEBOUNCE_MS = 350;
/* An OSC 7 that arrives this soon after an agent was detected from typed
   input is the agent's own startup chatter (codex emits a cwd sequence when
   it launches), not the shell's fresh prompt — skip the agent clear. A real
   exit prompt lands after the agent actually ran. */
const AGENT_PROMPT_CLEAR_GRACE_MS = 2000;
const STALE_SESSION_PRUNE_INTERVAL_MS = 30000;
const INPUT_BUFFER_MAX = 512;

function clearPendingRun(uid: string): void {
  const t = pendingRun.get(uid);
  if (t) {
    clearTimeout(t);
    pendingRun.delete(uid);
  }
}

function hasPromptSignal(data: string): boolean {
  // only OSC 7 (pwd) marks a prompt: preexec emits OSC 0 titles, which would
  // falsely flip running -> done right when a command starts
  return /\x1b\]7;/.test(data);
}

function broadcastStatus(groupUid?: string, status?: Status): void {
  if (!groupUid || !status) {
    return;
  }
  const prev = statusMap.get(groupUid);
  if (prev === status) {
    return;
  }
  statusMap.set(groupUid, status);
  if (status === 'done') {
    doneAt.set(groupUid, Date.now());
  }
}

/* cwd belongs to the shell, not to its term group: key by the session uid
   (stable across splits — Hyper re-parents the existing session into a new
   group uid when the pane is split, which would orphan a group-keyed entry) */
function broadcastCwd(uid: string, cwd: string): void {
  if (!cwd || cwdMap.get(uid) === cwd) {
    return;
  }
  cwdMap.set(uid, cwd);
  setLastCwd(cwd);
  emitCwdChanged(uid, cwd);
}

/* --- agent detection -------------------------------------------------------
   An agent is "running" in a pane when the pane's last submitted command (or
   the OSC 0 window title) names a known agent binary. The pane keeps the
   agent until the shell draws a fresh prompt (OSC 7) — and, for agents whose
   own titles match (claude, opencode), until the title stops matching.
   Deliberately NOT on non-agent submissions: while agent TUIs own the screen,
   their raw-mode keystrokes (confirmations, "exit") also surface as
   SESSION_USER_DATA and must never clear the badge.

   Codex never names itself in the title (it shows the project directory with
   a spinner), so agents first detected from typed input are pinned to the
   'input' source and only ever cleared by the prompt/exit signals — title
   chatter can never kill them. 'title'-sourced agents clear as soon as a
   non-matching title proves the shell (or another program) reclaimed it. */

type AgentSource = 'input' | 'title';

function broadcastAgent(uid: string, agent: string, source: AgentSource): void {
  cancelAgentClear(uid);
  agentSince.set(uid, Date.now());
  if (agentMap.get(uid) === agent) {
    return;
  }
  agentMap.set(uid, agent);
  agentSource.set(uid, source);
  const root = rootGroupUid(uid);
  if (root) {
    emitAgentsChanged(root);
  }
}

/* Title-sourced badges are cleared when the title stops matching, but agent
   TUIs re-title on every redraw and can emit a transient non-matching title
   (modal, subprocess) mid-session — so the clear is debounced and a matching
   redraw cancels it. A real exit leaves a non-matching precmd title in place,
   so the badge is still cleared shortly after. */
const AGENT_CLEAR_DEBOUNCE_MS = 600;

function clearAgent(uid: string): void {
  if (!agentMap.has(uid)) {
    return;
  }
  agentMap.delete(uid);
  agentSource.delete(uid);
  agentSince.delete(uid);
  const root = rootGroupUid(uid);
  if (root) {
    emitAgentsChanged(root);
  }
}

function scheduleAgentClear(uid: string): void {
  if (pendingAgentClear.has(uid)) {
    return;
  }
  const timer = setTimeout(() => {
    pendingAgentClear.delete(uid);
    clearAgent(uid);
  }, AGENT_CLEAR_DEBOUNCE_MS);
  pendingAgentClear.set(uid, timer);
}

function cancelAgentClear(uid: string): void {
  const timer = pendingAgentClear.get(uid);
  if (timer) {
    clearTimeout(timer);
    pendingAgentClear.delete(uid);
  }
}

/* Shared by the SESSION_SET_XTERM_TITLE action and the raw-PTY OSC 0
   fallback: matching titles set (or confirm) the agent and cancel any pending
   debounced clear, non-matching titles only clear agents that were detected
   from titles in the first place — and only after the debounce, so a single
   stray redraw title can't kill the badge while the TUI still owns the
   screen. */
function applyXtermTitle(uid: string, title: string): void {
  const trimmed = title.trim();
  if (!trimmed) {
    return; // no title signal — leave the current agent alone
  }
  titleMap.set(uid, trimmed);
  const agent = matchAgentTitle(trimmed);
  if (agent) {
    cancelAgentClear(uid);
    broadcastAgent(uid, agent, 'title');
  } else if (agentMap.has(uid) && agentSource.get(uid) === 'title') {
    scheduleAgentClear(uid);
  }
}

/* SESSION_USER_DATA arrives in chunks ('claude', then '\r' on Enter), so keep
   a rolling tail of typed input per session and only ever parse the last
   complete line. */
function appendInput(uid: string, data: string): void {
  const next = ((inputLines.get(uid) || '') + data).slice(-INPUT_BUFFER_MAX);
  inputLines.set(uid, next);
}

function lastSubmittedLine(uid: string): string {
  const lines = (inputLines.get(uid) || '').split(/\r\n|\r|\n/);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (lines[i].trim().length > 0) {
      return lines[i];
    }
  }
  return '';
}

export function onSessionAdd(uid: string, cwd?: string): void {
  sessionStart.set(uid, Date.now());
  if (cwd) {
    broadcastCwd(uid, cwd);
  }
  idleUntil.set(uid, Date.now() + SESSION_ADD_IDLE_MS);
}

export function onSessionUserData(uid: string, data: string): void {
  // any keystroke cancels a pending debounced 'running' flip (the user is
  // actively typing, so stray echoed output shouldn't be read as a new run);
  // Enter/Return is the only thing that actually marks the tab running.
  clearPendingRun(uid);
  appendInput(uid, data);
  if (/\r|\n/.test(data)) {
    broadcastStatus(findGroupUid(uid), 'running');
    const agent = parseAgentCommand(lastSubmittedLine(uid));
    if (agent) {
      broadcastAgent(uid, agent, 'input');
    }
  }
}

/* Hyper parses OSC 0 window titles itself (xterm onTitleChange) and routes
   them here with the session uid. The shell's preexec hook titles the window
   with the running command ("claude", "cursor agent", ...), so an agent
   title means an agent owns the screen. Claude Code re-titles every redraw
   ("⠂ Claude Code"); codex titles the project directory instead — that's
   why title-detected agents clear on non-matching titles while
   input-detected ones (codex) only clear on a fresh prompt. */
export function onSessionXtermTitle(uid: string, title: string): void {
  applyXtermTitle(uid, title);
}

export function onSessionResize(uid: string): void {
  // resizing or activating a session re-renders/reprints its screen;
  // suppress the output-rule for a few seconds so the reflow reprint
  // never reads as command output
  idleUntil.set(uid, Date.now() + RESIZE_IDLE_MS);
}

/* A session gained keyboard focus (pane click, tab switch). Besides the
   resize-style idle suppression, tell panels that this tab's active pane
   changed. The event carries the session uid directly because it fires
   before Hyper's reducer records it in the store. */
export function onSessionSetActive(uid: string): void {
  onSessionResize(uid);
  const root = rootGroupUid(uid);
  if (root) {
    emitActiveSessionChanged(root, uid);
  }
}

/* A tab was split: the brand-new session (uid) becomes the tab's focused
   pane. Its group doesn't exist in the store yet, but the pre-split active
   session (activeUid) still roots to the tab being split. */
export function onSessionSplit(uid: string, activeUid: string): void {
  onSessionResize(uid);
  const root = rootGroupUid(activeUid);
  if (root) {
    emitActiveSessionChanged(root, uid);
    emitPanesChanged(root);
  }
}

/* A pane was closed (user close or shell exit both surface as
   TERM_GROUP_EXIT with the group uid). The group still exists pre-reducer,
   so the root walk works; subscribers re-count after the reducer ran. */
export function onTermGroupExit(uid: string): void {
  const root = rootGroupUidOfGroup(uid);
  if (root) {
    emitPanesChanged(root);
  }
}

export function onSessionPtyData(uid: string, data: string): void {
  const cwd = parseOsc7(data);
  if (cwd) {
    broadcastCwd(uid, cwd);
  }
  const title = parseOsc0(data);
  if (title !== null) {
    // fallback for title chunks Hyper's onTitleChange might miss; the
    // SESSION_SET_XTERM_TITLE action is the authoritative path
    applyXtermTitle(uid, title);
  }
  if (hasPromptSignal(data)) {
    firstPrompt.set(uid, true);
    clearPendingRun(uid);
    const groupUid = findGroupUid(uid);
    if (statusMap.get(groupUid) === 'running') {
      broadcastStatus(groupUid, 'done');
    }
    idleUntil.set(uid, Date.now() + PROMPT_IDLE_MS);
    // the shell drew a fresh prompt, so no agent owns the screen anymore.
    // Same signal the status rule trusts, same unconditional read — except
    // within the launch grace window: an input-detected agent (codex) emits
    // its own OSC 7 at startup, which is chatter, not a real prompt. And
    // unless the last OSC 0 title stopped matching: agents whose TUI emits
    // cwd sequences mid-session (opencode) would otherwise be cleared while
    // still running, because a real prompt is always preceded by the shell's
    // non-matching precmd title.
    const since = agentSince.get(uid) ?? 0;
    const titleStillMatches =
      agentSource.get(uid) === 'title' && matchAgentTitle(titleMap.get(uid) ?? '') !== null;
    const inputGraceActive =
      agentSource.get(uid) === 'input' && Date.now() - since < AGENT_PROMPT_CLEAR_GRACE_MS;
    if (!inputGraceActive && !titleStillMatches) {
      clearAgent(uid);
    }
  } else if (firstPrompt.get(uid) && /[^\x00-\x1f\x7f-\x9f]/.test(data)) {
    // ignore pure control/redraw chunks (e.g. terminal resize reflow)
    const idle = idleUntil.get(uid) || 0;
    if (Date.now() >= idle && !pendingRun.has(uid)) {
      scheduleRunningFlip(uid, findGroupUid(uid));
    }
  }
}

function scheduleRunningFlip(sessionUid: string, groupUid: string): void {
  const done = doneAt.get(groupUid) || 0;
  if (statusMap.get(groupUid) === 'done' && Date.now() - done < PROMPT_REDRAW_GRACE_MS) {
    // prompt redraw grace: ignore stray output shortly after a prompt
    return;
  }
  const timer = setTimeout(() => {
    pendingRun.delete(sessionUid);
    broadcastStatus(groupUid, 'running');
  }, RUNNING_DEBOUNCE_MS);
  pendingRun.set(sessionUid, timer);
}

/* Closed tabs/sessions never fire a dedicated action we can hook, so sweep
   stale map entries against the store's live uids instead of letting these
   maps grow for the process's life. */
export function pruneStaleSessions(): void {
  if (!getStore()) {
    return; // store not ready yet; don't prune against an empty guess
  }
  const groups = getTermGroups();
  const live = new Set<string>();
  for (const key in groups) {
    live.add(key);
    const sessionUid = groups[key]?.sessionUid;
    if (sessionUid) {
      live.add(sessionUid);
    }
  }
  cwdMap.prune(live);
  statusMap.prune(live);
  sessionStart.prune(live);
  agentMap.prune(live);
  agentSource.prune(live);
  agentSince.prune(live);
  inputLines.prune(live);
  titleMap.prune(live);
  idleUntil.prune(live);
  doneAt.prune(live);
  firstPrompt.prune(live);
  for (const [uid, timer] of Array.from(pendingRun.entries())) {
    if (!live.has(uid)) {
      clearTimeout(timer);
      pendingRun.delete(uid);
    }
  }
  for (const [uid, timer] of Array.from(pendingAgentClear.entries())) {
    if (!live.has(uid)) {
      clearTimeout(timer);
      pendingAgentClear.delete(uid);
    }
  }
}

let pruneTimer: ReturnType<typeof setInterval> | null = null;

export function startStaleSessionPruning(): () => void {
  if (pruneTimer) {
    clearInterval(pruneTimer);
  }
  pruneTimer = setInterval(pruneStaleSessions, STALE_SESSION_PRUNE_INTERVAL_MS);
  return () => {
    if (pruneTimer) {
      clearInterval(pruneTimer);
      pruneTimer = null;
    }
  };
}
