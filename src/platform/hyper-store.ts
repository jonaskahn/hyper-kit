import { HyperStore, TermGroup } from '../types';

let appStore: HyperStore | null = null;

export function setStore(store: HyperStore | null): void {
  appStore = store;
}

export function getStore(): HyperStore | null {
  return appStore;
}

/* Hyper exposes its internal main<->renderer RPC client as window.rpc (see
   Hyper's PLUGINS.md) -- the same channel Cmd+T ('termgroup add req') and
   Cmd+D ('split request vertical') use to ask the main process to spawn a
   real pty. This is the actual supported way to open a tab/pane at an
   arbitrary cwd: there is no plain-object action a plugin can dispatch for
   this (TERM_GROUP_ADD is not a real Hyper action, and SESSION_PTY_DATA is
   pty *output*, not input -- see explorer-popover.ts's openInThisTab for
   the full story). */
export function emitRpc(event: string, data?: unknown): void {
  try {
    (window as unknown as { rpc?: { emit: (ev: string, d?: unknown) => void } }).rpc?.emit(
      event,
      data,
    );
  } catch {
    // best effort: no rpc bridge (tests, a host without it) -- harmless no-op
  }
}

export function getTermGroups(): Record<string, TermGroup> {
  if (!appStore) {
    return {};
  }
  try {
    return appStore.getState().termGroups.termGroups;
  } catch {
    // the store may not be ready during startup; an empty result is a harmless fallback
    return {};
  }
}

export function findGroupUid(sessionUid: string): string {
  const groups = getTermGroups();
  for (const key in groups) {
    if (groups[key]?.sessionUid === sessionUid) {
      return key;
    }
  }
  return sessionUid;
}

/* The session currently focused inside the tab rooted at `tabUid`. Hyper
   maintains this map itself on every focus/split/close, so reading it here
   is always consistent with the real UI state. */
export function getActiveSessionUid(tabUid: string | null | undefined): string | null {
  if (!tabUid || !appStore) {
    return null;
  }
  try {
    return appStore.getState().termGroups?.activeSessions?.[tabUid] ?? null;
  } catch {
    // the store may not be ready during startup; null is a harmless fallback
    return null;
  }
}

/* The session that currently has keyboard focus anywhere in the window.
   SESSION_USER_DATA carries no uid of its own, so consumers resolve the
   focused session from the store's own active-tab bookkeeping. */
export function getFocusedSessionUid(): string | null {
  if (!appStore) {
    return null;
  }
  try {
    const termGroups = appStore.getState().termGroups;
    const root = termGroups?.activeRootGroup;
    return root ? (termGroups?.activeSessions?.[root] ?? null) : null;
  } catch {
    // the store may not be ready during startup; null is a harmless fallback
    return null;
  }
}

/* Walk the parentUid chain from any group up to its root (tab) group. */
function walkToRoot(groups: Record<string, TermGroup>, startUid: string): string {
  let uid = startUid;
  let guard = 0;
  while (guard++ < 100) {
    const parent = groups[uid]?.parentUid;
    if (!parent) {
      break;
    }
    uid = parent;
  }
  return uid;
}

/* Root (tab) group that contains the given session, by walking the parentUid
   chain up the group tree. Returns null when the session isn't in a group
   yet (e.g. its group is created by the reducer after our middleware). */
export function rootGroupUid(sessionUid: string): string | null {
  const groups = getTermGroups();
  const uid = findGroupUid(sessionUid);
  if (uid === sessionUid) {
    return null; // no group for this session yet
  }
  return walkToRoot(groups, uid);
}

/* Same walk, but starting from a group uid (TERM_GROUP_EXIT reports the
   group, not the session). Returns null when the group is unknown. */
export function rootGroupUidOfGroup(groupUid: string): string | null {
  const groups = getTermGroups();
  if (!groups[groupUid]) {
    return null;
  }
  return walkToRoot(groups, groupUid);
}

/* Number of terminal panes in the tab rooted at `tabUid`: leaf groups hold a
   sessionUid, parent groups get '' once split, so count truthy sessionUids
   in the subtree. An unsplit tab counts 1. */
export function countPanesInTab(tabUid: string): number {
  return listPaneSessions(tabUid).length;
}

/* Session uids of every terminal pane in the tab rooted at `tabUid`, in tree
   order. Leaf groups hold a sessionUid; parent groups get '' once split. */
export function listPaneSessions(tabUid: string): string[] {
  const groups = getTermGroups();
  if (!groups[tabUid]) {
    return [];
  }
  const sessions: string[] = [];
  const visit = (uid: string, depth: number): void => {
    if (depth > 100) {
      return; // cycle guard, never expected in Hyper's tree
    }
    const group = groups[uid];
    if (!group) {
      return;
    }
    if (group.sessionUid) {
      sessions.push(group.sessionUid);
    }
    for (const child of group.children ?? []) {
      visit(child, depth + 1);
    }
  };
  visit(tabUid, 0);
  return sessions;
}
