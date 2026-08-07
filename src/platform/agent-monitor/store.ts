/* Pending permission/question requests from opencode instances, queued for
   popup display. Requests are deduped by id and routed back to the instance
   that produced them (reply against the same host/port). */

import type { InstanceTarget, PermissionRequest, QuestionRequest } from './types';

export interface PermissionPendingEntry {
  requestID: string;
  kind: 'permission';
  request: PermissionRequest;
  target: InstanceTarget;
  directory: string | null;
  tabUid: string | null;
  /* Agent the request belongs to (the agent running in the attributed tab,
     or 'opencode' for unattributed opencode-server requests). Drives the
     per-agent monitor gate and the card footer label. */
  agent: string;
  addedAt: number;
}

export interface QuestionPendingEntry {
  requestID: string;
  kind: 'question';
  request: QuestionRequest;
  target: InstanceTarget;
  directory: string | null;
  tabUid: string | null;
  agent: string;
  addedAt: number;
}

export type PendingEntry = PermissionPendingEntry | QuestionPendingEntry;

export class PendingStore {
  private entries: PendingEntry[] = [];

  get size(): number {
    return this.entries.length;
  }

  get all(): PendingEntry[] {
    return this.entries.slice();
  }

  /* Returns false when a request with the same id is already queued. */
  add(entry: PendingEntry): boolean {
    if (this.entries.some((e) => e.requestID === entry.requestID)) {
      return false;
    }
    this.entries.push(entry);
    return true;
  }

  get(requestID: string): PendingEntry | null {
    return this.entries.find((e) => e.requestID === requestID) ?? null;
  }

  remove(requestID: string): PendingEntry | null {
    const index = this.entries.findIndex((e) => e.requestID === requestID);
    if (index < 0) {
      return null;
    }
    return this.entries.splice(index, 1)[0];
  }

  removeForTarget(target: InstanceTarget): PendingEntry[] {
    const kept: PendingEntry[] = [];
    const removed: PendingEntry[] = [];
    for (const entry of this.entries) {
      if (entry.target.host === target.host && entry.target.port === target.port) {
        removed.push(entry);
      } else {
        kept.push(entry);
      }
    }
    this.entries = kept;
    return removed;
  }

  clear(): void {
    this.entries = [];
  }

  /* Retarget a single pending entry once its tab can be resolved (or is lost).
     Unlike the old instance-wide rebind, one server instance can host many
     unrelated sessions/tabs, so entries must be retargeted individually. */
  setTabUid(requestID: string, tabUid: string | null): boolean {
    const entry = this.entries.find((e) => e.requestID === requestID);
    if (!entry || entry.tabUid === tabUid) {
      return false;
    }
    entry.tabUid = tabUid;
    return true;
  }

  /* Re-assign the asking agent once the tab (and therefore the agent) is
     known — a tab-resolved entry may no longer be the opencode fallback. */
  setAgent(requestID: string, agent: string): boolean {
    const entry = this.entries.find((e) => e.requestID === requestID);
    if (!entry || entry.agent === agent) {
      return false;
    }
    entry.agent = agent;
    return true;
  }

  /* The request that should be shown right now: the oldest entry whose tab
     is not the focused tab. Requests from the focused tab are skipped so the
     user answers them in the terminal instead of a popup. Entries with no
     resolved tab (foreign window/instance, or not yet bound) are shown only
     when nothing else can be shown -- hiding them forever left the agent
     silently blocked whenever tab attribution failed (a shell without OSC 7,
     a session whose tab closed, ...), so they must surface rather than
     vanish. `suppressTabless` hides those unresolved entries entirely: when
     the focused tab runs an opencode agent, a tabless request is almost
     certainly that very tab's own ask (attribution just failed), and the
     user answers it in the terminal -- popping a card there is the bug.
     `excluded` additionally removes entries by requestID (recently
     dismissed without answering). */
  nextVisible(
    activeTabUid: string | null,
    suppressTabless = false,
    excluded: ReadonlySet<string> = EMPTY,
  ): PendingEntry | null {
    const eligible =
      excluded.size === 0 ? this.entries : this.entries.filter((e) => !excluded.has(e.requestID));
    const otherTab = eligible.find((e) => e.tabUid !== null && e.tabUid !== activeTabUid);
    if (otherTab) {
      return otherTab;
    }
    if (suppressTabless) {
      return null;
    }
    return eligible.find((e) => e.tabUid === null) ?? null;
  }
}

const EMPTY: ReadonlySet<string> = new Set();
