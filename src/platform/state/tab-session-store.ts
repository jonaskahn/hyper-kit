import { createKeyedStore } from '../../core/keyed-store';

export type Status = 'running' | 'done';

/* Per-tab / per-session state -------------------------------------------------
   - cwdMap / statusMap: keyed by tab *group* uid (what the UI renders)
   - everything else: keyed by *session* uid (what the middleware sees)
*/
export const cwdMap = createKeyedStore<string>();
export const statusMap = createKeyedStore<Status>();
export const sessionStart = createKeyedStore<number>(); // session uid -> opened at

let lastCwd = '';

export function getLastCwd(): string {
  return lastCwd;
}

export function setLastCwd(cwd: string): void {
  lastCwd = cwd;
}
