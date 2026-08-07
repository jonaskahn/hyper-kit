import type { Status } from './state/tab-session-store';

const CWD_CHANGED = 'kit-tab-cwd';
const STATUS_CHANGED = 'kit-tab-status';

export function emitCwdChanged(uid: string, cwd: string): void {
  window.dispatchEvent(new CustomEvent(CWD_CHANGED, { detail: { uid, cwd } }));
}

export function onCwdChanged(handler: (uid: string, cwd: string) => void): () => void {
  const listener = (e: Event): void => {
    const detail = (e as CustomEvent<{ uid: string; cwd: string }>).detail;
    if (detail) {
      handler(detail.uid, detail.cwd);
    }
  };
  window.addEventListener(CWD_CHANGED, listener);
  return () => window.removeEventListener(CWD_CHANGED, listener);
}

export function emitStatusChanged(uid: string, status: Status): void {
  window.dispatchEvent(new CustomEvent(STATUS_CHANGED, { detail: { uid, status } }));
}

export function onStatusChanged(handler: (uid: string, status: Status) => void): () => void {
  const listener = (e: Event): void => {
    const detail = (e as CustomEvent<{ uid: string; status: Status }>).detail;
    if (detail) {
      handler(detail.uid, detail.status);
    }
  };
  window.addEventListener(STATUS_CHANGED, listener);
  return () => window.removeEventListener(STATUS_CHANGED, listener);
}
