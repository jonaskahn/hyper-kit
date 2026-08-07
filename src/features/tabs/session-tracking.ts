import { getStore, getTermGroups } from '../../platform/hyper-store';
import { emitCwdChanged, emitStatusChanged } from '../../platform/event-bus';
import {
  cwdMap,
  statusMap,
  sessionStart,
  setLastCwd,
  type Status,
} from '../../platform/state/tab-session-store';
import { parseOsc7 } from '../../core/session';
import { createKeyedStore } from '../../core/keyed-store';

export function findGroupUid(sessionUid: string): string {
  const groups = getTermGroups();
  for (const key in groups) {
    if (groups[key] && groups[key].sessionUid === sessionUid) {
      return key;
    }
  }
  return sessionUid;
}

export function lookupSessionStart(uid?: string | null): number | null {
  if (!uid) {
    return null;
  }
  if (sessionStart.has(uid)) {
    return sessionStart.get(uid)!;
  }
  const group = getTermGroups()[uid];
  if (group && sessionStart.has(group.sessionUid)) {
    return sessionStart.get(group.sessionUid)!;
  }
  return null;
}

/* Private, single-feature bookkeeping: session-uid-keyed timing state used
   only by the status heuristics below. pendingRun stays exported for direct
   test assertions on the in-flight debounce timer. */
const idleUntil = createKeyedStore<number>(); // session uid -> until when output is prompt echo
export const pendingRun = new Map<string, ReturnType<typeof setTimeout>>(); // session uid -> timeout id (debounced 'running')
const doneAt = createKeyedStore<number>(); // group uid -> when 'done' was set (grace for prompt redraws)
const firstPrompt = createKeyedStore<boolean>(); // session uid -> shell printed its first prompt

const SESSION_ADD_IDLE_MS = 500;
const RESIZE_IDLE_MS = 3000;
const PROMPT_IDLE_MS = 300;
const PROMPT_REDRAW_GRACE_MS = 1500;
const RUNNING_DEBOUNCE_MS = 350;
const STALE_SESSION_PRUNE_INTERVAL_MS = 30000;

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
  emitStatusChanged(groupUid, status);
}

function broadcastCwd(uid: string, cwd: string): void {
  if (!cwd || cwdMap.get(uid) === cwd) {
    return;
  }
  cwdMap.set(uid, cwd);
  setLastCwd(cwd);
  emitCwdChanged(uid, cwd);
}

export function onSessionAdd(uid: string, cwd?: string): void {
  sessionStart.set(uid, Date.now());
  if (cwd) {
    broadcastCwd(findGroupUid(uid), cwd);
  }
  idleUntil.set(uid, Date.now() + SESSION_ADD_IDLE_MS);
}

export function onSessionUserData(uid: string, data: string): void {
  // any keystroke cancels a pending debounced 'running' flip (the user is
  // actively typing, so stray echoed output shouldn't be read as a new run);
  // Enter/Return is the only thing that actually marks the tab running.
  clearPendingRun(uid);
  if (/\r|\n/.test(data)) {
    broadcastStatus(findGroupUid(uid), 'running');
  }
}

export function onSessionResize(uid: string): void {
  // resizing or activating a session re-renders/reprints its screen;
  // suppress the output-rule for a few seconds so the reflow reprint
  // never reads as command output
  idleUntil.set(uid, Date.now() + RESIZE_IDLE_MS);
}

export function onSessionPtyData(uid: string, data: string): void {
  const cwd = parseOsc7(data);
  if (cwd) {
    broadcastCwd(findGroupUid(uid), cwd);
  }
  if (hasPromptSignal(data)) {
    firstPrompt.set(uid, true);
    clearPendingRun(uid);
    const groupUid = findGroupUid(uid);
    if (statusMap.get(groupUid) === 'running') {
      broadcastStatus(groupUid, 'done');
    }
    idleUntil.set(uid, Date.now() + PROMPT_IDLE_MS);
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
    const sessionUid = groups[key] && groups[key].sessionUid;
    if (sessionUid) {
      live.add(sessionUid);
    }
  }
  cwdMap.prune(live);
  statusMap.prune(live);
  sessionStart.prune(live);
  idleUntil.prune(live);
  doneAt.prune(live);
  firstPrompt.prune(live);
  for (const [uid, timer] of Array.from(pendingRun.entries())) {
    if (!live.has(uid)) {
      clearTimeout(timer);
      pendingRun.delete(uid);
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
