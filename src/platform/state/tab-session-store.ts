import { createKeyedStore } from '../../core/keyed-store';
import { getTermGroups } from '../hyper-store';

export type Status = 'running' | 'done';

/* Per-tab / per-session state -------------------------------------------------
   - cwdMap: keyed by *session* uid — a pane's shell keeps its uid even when
     Hyper re-parents it into a new term group on split, so its cwd survives
   - statusMap: keyed by tab *group* uid (what the UI renders)
   - sessionStart: keyed by *session* uid (what the middleware sees)
   - agentMap: keyed by *session* uid -> agent command currently foreground
     (e.g. 'claude'), set from typed input / OSC 0 titles, cleared on prompt
   - agentSource: how the agent was first detected — 'input' (typed command:
     codex's titles never name it, so only prompt/exit signals may clear) or
     'title' (its OSC 0 titles match, so a non-matching title clears it)
   - inputLines: rolling tail of typed input per session, enough to parse the
     last submitted command line across separate SESSION_USER_DATA chunks
*/
export const cwdMap = createKeyedStore<string>();
export const statusMap = createKeyedStore<Status>();
export const sessionStart = createKeyedStore<number>(); // session uid -> opened at
export const agentMap = createKeyedStore<string>();
export const agentSource = createKeyedStore<'input' | 'title'>();
/* agentSince: session uid -> ms epoch when the current agent was detected.
   Guards the prompt-clear path: an OSC 7 arriving within the launch grace
   window right after an input-detected agent (codex emits one at startup)
   is agent chatter, not a real shell prompt, and must not clear the badge. */
export const agentSince = createKeyedStore<number>();
export const inputLines = createKeyedStore<string>();
/* titleMap: session uid -> last OSC 0 window title (opencode names itself
   here, which lets the agent-monitor card label which session it belongs
   to instead of showing only a directory + port) */
export const titleMap = createKeyedStore<string>();

let lastCwd = '';

export function getLastCwd(): string {
  return lastCwd;
}

export function setLastCwd(cwd: string): void {
  lastCwd = cwd;
}

export function lookupSessionStart(uid?: string | null): number | null {
  if (!uid) {
    return null;
  }
  const startedAt = sessionStart.get(uid);
  if (startedAt !== undefined) {
    return startedAt;
  }
  const group = getTermGroups()[uid];
  const sessionUid = group?.sessionUid;
  return sessionUid ? (sessionStart.get(sessionUid) ?? null) : null;
}
