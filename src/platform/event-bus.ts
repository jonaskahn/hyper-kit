const CWD_CHANGED = 'kit-tab-cwd';
const ACTIVE_SESSION_CHANGED = 'kit-tab-active-session';
const PANES_CHANGED = 'kit-tab-panes-changed';
const AGENTS_CHANGED = 'kit-tab-agents-changed';

function subscribe<T>(name: string, toArgs: (detail: T) => void): () => void {
  const listener = (e: Event): void => {
    const detail = (e as CustomEvent<T>).detail;
    if (detail) {
      toArgs(detail);
    }
  };
  window.addEventListener(name, listener);
  return () => window.removeEventListener(name, listener);
}

export function emitCwdChanged(uid: string, cwd: string): void {
  window.dispatchEvent(new CustomEvent(CWD_CHANGED, { detail: { uid, cwd } }));
}

export function onCwdChanged(handler: (uid: string, cwd: string) => void): () => void {
  return subscribe<{ uid: string; cwd: string }>(CWD_CHANGED, (detail) =>
    handler(detail.uid, detail.cwd),
  );
}

/* A different terminal pane inside a tab got keyboard focus. rootUid is the
   tab (root term group), sessionUid the pane that is now active. */
export function emitActiveSessionChanged(rootUid: string, sessionUid: string): void {
  window.dispatchEvent(
    new CustomEvent(ACTIVE_SESSION_CHANGED, { detail: { rootUid, sessionUid } }),
  );
}

export function onActiveSessionChanged(
  handler: (rootUid: string, sessionUid: string) => void,
): () => void {
  return subscribe<{ rootUid: string; sessionUid: string }>(ACTIVE_SESSION_CHANGED, (detail) =>
    handler(detail.rootUid, detail.sessionUid),
  );
}

/* A tab's pane count may have changed (split or close). Subscribers should
   re-read the store on the next tick: this fires before Hyper's reducer
   applies the change. */
export function emitPanesChanged(rootUid: string): void {
  window.dispatchEvent(new CustomEvent(PANES_CHANGED, { detail: { rootUid } }));
}

export function onPanesChanged(handler: (rootUid: string) => void): () => void {
  return subscribe<{ rootUid: string }>(PANES_CHANGED, (detail) => handler(detail.rootUid));
}

/* A pane inside the tab rooted at `rootUid` started or stopped running an
   agent (or the tab's pane set changed and agents should be re-read). */
export function emitAgentsChanged(rootUid: string): void {
  window.dispatchEvent(new CustomEvent(AGENTS_CHANGED, { detail: { rootUid } }));
}

export function onAgentsChanged(handler: (rootUid: string) => void): () => void {
  return subscribe<{ rootUid: string }>(AGENTS_CHANGED, (detail) => handler(detail.rootUid));
}
