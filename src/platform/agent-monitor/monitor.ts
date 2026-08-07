/* Orchestrator: keeps a registry of opencode instances (discovered via
   mDNS browse + OS listener scans), subscribes to each one's SSE stream,
   queues permission/question requests, and drives the popup through
   focus-aware visibility rules (no popup for the tab the user is already
   looking at). */

import {
  getSession,
  listPermissions,
  listQuestions,
  listSessions,
  probeHealth,
  replyPermission as sendPermissionReply,
  replyQuestion,
  rejectQuestion,
  subscribeEvents,
} from './client';
import { browseMdns } from './mdns';
import {
  agentOfTab,
  cwdOfTab,
  isHyperOwned,
  matchTabForDirectory,
  scanListenerOwners,
  scanListenerPorts,
  tabsRunningAgent,
} from './discovery';
import { PendingStore, type PendingEntry } from './store';
import { getActiveSessionUid, getStore, listPaneSessions } from '../hyper-store';
import {
  getAgentMonitorDebounceMs,
  getAgentMonitorHeartbeatSec,
  getAgentMonitorPassword,
  getAgentMonitorPorts,
  getAgentMonitorScope,
  isAgentMonitorAutoDiscoverEnabled,
  isAgentMonitorHintEnabled,
  isAgentMonitorMdnsEnabled,
  isAgentMonitorOptimistic,
  isAgentMonitorPersistEnabled,
  isAgentMonitorPopupEnabled,
  isAgentMonitored,
} from '../../config';
import {
  isPermissionRequest,
  isQuestionRequest,
  type InstanceTarget,
  type PermissionReply,
  type PermissionRequest,
  type QuestionRequest,
  type SseEnvelope,
} from './types';

const INSTANCE_TTL_MS = 120000;
const SSE_MAX_RETRY_MS = 10000;
const HINT_GRACE_MS = 20000;
/* How long a dismissed request stays out of the popup queue even though it
   is still pending server-side. After this, it may return as a "still
   waiting" reminder. Kept in sync with the popup's own suppression TTL. */
const DISMISS_SUPPRESS_MS = 120000;

/* Union of PendingEntry minus the fields the instance supplies on arrival. */
type WithoutInstanceFields<T> = T extends PendingEntry
  ? Omit<T, 'target' | 'directory' | 'tabUid' | 'agent' | 'addedAt'>
  : never;
type PendingEntryInput = WithoutInstanceFields<PendingEntry>;

interface TrackedInstance extends InstanceTarget {
  version?: string;
  attached: boolean;
  lastSeen: number;
  retries: number;
  stopSse?: () => void;
  retryTimer?: ReturnType<typeof setTimeout>;
  /* sessionID -> directory, from the last listSessions() snapshot. One
     instance commonly hosts many unrelated project sessions at once, so
     there is no single instance-wide directory/tab to bind. */
  sessions: Map<string, string>;
  /* True while instance.sessions reflects a successful listSessions() call.
     A failed poll flips it false so the dead-session sweep never purges
     live entries against a stale snapshot. */
  sessionsFresh: boolean;
  /* When the current sessions snapshot was taken; entries added after it
     are judged on the next scan (a session born mid-scan is live, just not
     in this snapshot). */
  sessionsRefreshedAt: number;
}

export interface MonitorPopupHandlers {
  /* The popup should display this entry (or hide everything when null). */
  onShow(entry: PendingEntry | null): void;
  onShowHint(tabUid: string, directory: string | null): void;
}

class AgentMonitor {
  private readonly instances = new Map<number, TrackedInstance>();
  readonly pending = new PendingStore();
  /* requestIDs the server confirmed as answered/rejected (keyed by port).
     listPermissions/listQuestions replay those at attach/retry; without this
     tombstone a late replay would resurrect a dead card whose reply 404s.
     Cleared when an instance's SSE stream closes (a restarted server resets
     its request counter, so old ids may legitimately be reused). */
  private readonly answered = new Map<number, Set<string>>();
  private handlers: MonitorPopupHandlers | null = null;
  private disposers: (() => void)[] = [];
  private hintFirstSeen = new Map<string, number>();
  private hintShown = new Set<string>();
  private stopped = false;
  private started = false;
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  private scanDelay: ReturnType<typeof setTimeout> | undefined;
  /* requestID of the entry currently shown on the popup. With persist
     enabled the card stays on this request until the user interacts with it
     (answer or dismiss); only then does the queue advance. */
  private shownRequestID: string | null = null;
  /* requestID -> ms epoch until which the entry is kept out of the queue
     after the user dismissed it without answering. */
  private readonly dismissedUntil = new Map<string, number>();

  private markAnswered(port: number, requestID: string): void {
    let ids = this.answered.get(port);
    if (!ids) {
      ids = new Set();
      this.answered.set(port, ids);
    }
    ids.add(requestID);
  }

  private isAnswered(port: number, requestID: string): boolean {
    return this.answered.get(port)?.has(requestID) ?? false;
  }

  /* A reply the server actually recorded clears the local queue: the popup
     only advances on a confirmed success, so a network failure leaves the
     request pending (and visible again) instead of silently vanishing while
     the agent stays blocked. */
  private confirmed(entry: PendingEntry, ok: boolean): boolean {
    if (ok) {
      this.markAnswered(entry.target.port, entry.requestID);
      this.removePending(entry.requestID);
    }
    return ok;
  }

  start(handlers: MonitorPopupHandlers): void {
    if (this.started) {
      return;
    }
    this.started = true;
    this.stopped = false;
    this.handlers = handlers;
    const heartbeat = getAgentMonitorHeartbeatSec();
    if (heartbeat > 0) {
      this.heartbeatTimer = setInterval(() => this.requestScan(), heartbeat * 1000);
    }
    if (isAgentMonitorMdnsEnabled()) {
      this.disposers.push(
        browseMdns({
          onAdd: (service) => {
            void this.attachCandidate(service.host, service.port);
          },
          onRemove: (service) => {
            this.forgetPort(service.port);
          },
        }),
      );
    }
    this.requestScan();
  }

  stop(): void {
    if (!this.started) {
      return;
    }
    this.started = false;
    this.stopped = true;
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
    if (this.scanDelay) {
      clearTimeout(this.scanDelay);
      this.scanDelay = undefined;
    }
    for (const dispose of this.disposers) {
      dispose();
    }
    this.disposers = [];
    for (const instance of [...this.instances.values()]) {
      this.detach(instance);
    }
    this.instances.clear();
    this.answered.clear();
    this.pending.clear();
    this.hintFirstSeen.clear();
    this.hintShown.clear();
    this.shownRequestID = null;
    this.dismissedUntil.clear();
    this.handlers = null;
  }

  /* Debounced re-scan; call on tab activity (new tab, agent start). */
  requestScan(): void {
    if (this.stopped || this.scanDelay) {
      return;
    }
    const delay = getAgentMonitorDebounceMs();
    this.scanDelay = setTimeout(() => {
      this.scanDelay = undefined;
      void this.scan();
    }, delay);
  }

  /* Re-evaluate popup visibility; call when the focused tab changes. */
  onFocusChanged(): void {
    this.refreshPopup();
  }

  /* --- actions (invoked by the popup) ------------------------------------
     Each returns whether the server actually recorded the reply -- the
     local queue/popup only clears on a confirmed success, so a network
     failure leaves the request pending (and visible again) instead of
     silently vanishing while the agent stays blocked. With optimistic
     enabled, an unreachable/404 reply (request already answered another
     way, instance gone) is treated as accepted: any button then closes the
     card instead of erroring on a ghost request. */

  async replyPermission(
    entry: PendingEntry,
    reply: PermissionReply,
    message?: string,
  ): Promise<boolean> {
    const ok = await sendPermissionReply(entry.target, entry.requestID, reply, message);
    if (ok && reply === 'always' && entry.kind === 'permission') {
      await this.drainAlways(entry);
    }
    return this.confirmed(entry, ok || isAgentMonitorOptimistic());
  }

  /* "Always allow" should silence the kind, not just this one request: the
     server's own 'always' handling only auto-succeeds queued asks already
     covered by the persisted pattern (bash patterns are command-scoped), so
     a run of distinct commands would keep re-asking and cascade cards. Drain
     the other pending asks of the same permission kind from the same
     session -- the user just told us that kind is fine for this run. */
  private async drainAlways(entry: PendingEntry): Promise<void> {
    if (entry.kind !== 'permission') {
      return;
    }
    const target = entry.target;
    const sessionID = entry.request.sessionID;
    const permission = entry.request.permission;
    for (const other of this.pending.all) {
      if (other.kind !== 'permission') {
        continue;
      }
      if (other.requestID === entry.requestID) {
        continue;
      }
      if (other.target.host !== target.host || other.target.port !== target.port) {
        continue;
      }
      if (other.request.sessionID !== sessionID || other.request.permission !== permission) {
        continue;
      }
      const ok = await sendPermissionReply(other.target, other.requestID, 'always');
      if (ok) {
        this.confirmed(other, ok);
      }
    }
  }

  async answerQuestion(entry: PendingEntry, answers: string[][]): Promise<boolean> {
    const ok = await replyQuestion(entry.target, entry.requestID, answers);
    return this.confirmed(entry, ok || isAgentMonitorOptimistic());
  }

  async reject(entry: PendingEntry): Promise<boolean> {
    const ok =
      entry.kind === 'question'
        ? await rejectQuestion(entry.target, entry.requestID)
        : await sendPermissionReply(entry.target, entry.requestID, 'reject');
    return this.confirmed(entry, ok || isAgentMonitorOptimistic());
  }

  /* Hyper's SESSION_SET_ACTIVE action takes a *session* uid (it walks that
     session up to its root group to focus the tab) -- entry.tabUid is the
     root group uid itself, which is never a valid session uid, so it must
     be resolved to one of the tab's actual panes first. */
  viewTab(entry: PendingEntry): void {
    const tabUid = this.resolveTabForView(entry);
    const store = getStore();
    if (!tabUid || !store || typeof store.dispatch !== 'function') {
      try {
        window.focus();
      } catch {
        // focus is best-effort
      }
      return;
    }
    const sessionUid = getActiveSessionUid(tabUid) ?? listPaneSessions(tabUid)[0] ?? null;
    if (sessionUid) {
      store.dispatch({ type: 'SESSION_SET_ACTIVE', uid: sessionUid });
    }
    try {
      window.focus();
    } catch {
      // focus is best-effort
    }
  }

  /* The card's entry.tabUid can be null or stale (tab attribution needs the
     tab's cwd, which only arrives with OSC 7), so re-resolve the asking tab
     at click time: a fresh directory match first, then the recorded uid,
     then -- with one opencode per Hyper tab -- the unique agent tab as a
     last resort. Among several agent tabs, prefer a non-active one so
     "View tab" can never just land on the tab the user is already in. */
  private resolveTabForView(entry: PendingEntry): string | null {
    if (entry.directory) {
      const matched = matchTabForDirectory(entry.directory);
      if (matched) {
        return matched;
      }
    }
    if (entry.tabUid) {
      return entry.tabUid;
    }
    const agentTabs = tabsRunningAgent('opencode');
    if (agentTabs.length === 0) {
      return null;
    }
    const active = this.activeRootTab();
    return agentTabs.find((uid) => uid !== active) ?? agentTabs[0];
  }

  dismissHint(tabUid: string): void {
    this.hintShown.add(tabUid);
    this.hintFirstSeen.delete(tabUid);
  }

  /* The user dismissed the card without answering (Escape / backdrop).
     The request stays pending server-side, but with persist enabled the
     card must move on so later requests can still surface. */
  dismiss(entry: PendingEntry): void {
    this.dismissedUntil.set(entry.requestID, Date.now() + DISMISS_SUPPRESS_MS);
    if (this.shownRequestID === entry.requestID) {
      this.shownRequestID = null;
      this.refreshPopup();
    }
  }

  /* --- discovery ---------------------------------------------------------- */

  private async scan(): Promise<void> {
    if (this.stopped) {
      return;
    }
    const candidates = new Map<number, string>();
    for (const port of getAgentMonitorPorts()) {
      if (!candidates.has(port)) {
        candidates.set(port, '127.0.0.1');
      }
    }
    if (isAgentMonitorAutoDiscoverEnabled()) {
      for (const port of await scanListenerPorts()) {
        if (!candidates.has(port)) {
          candidates.set(port, '127.0.0.1');
        }
      }
    }
    for (const [port, host] of candidates) {
      await this.attachCandidate(host, port);
    }
    /* Refresh the session snapshots before reconciling so the dead-session
       sweep judges entries against the listSessions() that just ran, not a
       snapshot from the previous scan. */
    const refreshed: Promise<void>[] = [];
    for (const instance of this.instances.values()) {
      if (instance.attached) {
        refreshed.push(this.refreshSessions(instance));
      }
    }
    await Promise.all(refreshed);
    this.reconcile();
    this.updateHints();
  }

  /* Every healthy instance is attached unconditionally: a single opencode
     server commonly hosts many unrelated project sessions at once, so there
     is no single directory to gate attachment on. Tab attribution happens
     per pending request instead (see addPending). scope='all' is the one
     exception that skips this: 'hyper' and 'self' both require the instance's
     process tree to run inside a Hyper window -- plain-terminal instances
     (and mDNS finds from other machines/apps) never surface for either.
     'self' narrows further, per pending request, to this window's own tabs. */
  private async attachCandidate(host: string, port: number): Promise<void> {
    if (this.stopped || port <= 0 || port > 65535) {
      return;
    }
    if (getAgentMonitorScope() !== 'all') {
      const owners = await scanListenerOwners();
      const pid = owners.get(port);
      if (!pid || !(await isHyperOwned(pid))) {
        return; // not started from inside Hyper: out of scope
      }
    }
    const now = Date.now();
    const existing = this.instances.get(port);
    if (existing) {
      existing.lastSeen = now;
      return;
    }
    const target: InstanceTarget = { host, port, password: getAgentMonitorPassword() };
    const health = await probeHealth(target);
    if (!health || !health.healthy) {
      return;
    }
    const instance: TrackedInstance = {
      host,
      port,
      password: target.password,
      version: health.version,
      attached: false,
      lastSeen: now,
      retries: 0,
      sessions: new Map(),
      sessionsFresh: false,
      sessionsRefreshedAt: 0,
    };
    this.instances.set(port, instance);
    this.attach(instance);
  }

  private attach(instance: TrackedInstance): void {
    if (instance.attached || this.stopped) {
      return;
    }
    instance.attached = true;
    instance.retries = 0;
    instance.stopSse = subscribeEvents(instance, {
      onEvent: (event) => this.onSseEvent(instance, event),
      onClose: () => this.onSseClosed(instance),
    });
    void this.refreshSessions(instance);
    void listPermissions(instance).then(async (permissions) => {
      for (const permission of permissions ?? []) {
        if (this.stopped) {
          return;
        }
        await this.addPermission(instance, permission);
      }
    });
    void listQuestions(instance).then(async (questions) => {
      for (const question of questions ?? []) {
        if (this.stopped) {
          return;
        }
        await this.addQuestion(instance, question);
      }
    });
  }

  /* Keeps instance.sessions (sessionID -> directory) warm so pending
     requests can resolve their tab without a round trip on the common path.
     A failed listSessions leaves the previous snapshot in place but marks
     it stale, so the dead-session sweep can't trust it. */
  private async refreshSessions(instance: TrackedInstance): Promise<void> {
    const sessions = await listSessions(instance);
    if (this.stopped) {
      return;
    }
    if (!sessions) {
      instance.sessionsFresh = false;
      return;
    }
    instance.sessionsFresh = true;
    instance.sessionsRefreshedAt = Date.now();
    instance.sessions.clear();
    for (const session of sessions) {
      if (typeof session.directory === 'string') {
        instance.sessions.set(session.id, session.directory);
      }
    }
  }

  private detach(instance: TrackedInstance): void {
    if (instance.stopSse) {
      instance.stopSse();
      instance.stopSse = undefined;
    }
    if (instance.retryTimer) {
      clearTimeout(instance.retryTimer);
      instance.retryTimer = undefined;
    }
    instance.attached = false;
  }

  private forgetPort(port: number): void {
    const instance = this.instances.get(port);
    if (!instance) {
      return;
    }
    this.detach(instance);
    this.instances.delete(port);
    this.answered.delete(port);
    this.pending.removeForTarget(instance);
    this.refreshPopup();
  }

  /* Drop instances that stopped responding, and retry tab resolution for any
     pending entry that couldn't be bound to a tab yet (e.g. its Hyper tab
     hadn't appeared/reported its cwd when the request first arrived). Every
     reconcile also re-applies the admission gates: scope='self' sweeps
     entries that still attribute nowhere (foreign instance), and the
     per-agent toggle is re-read so a config flip (CONFIG_RELOAD) takes
     effect on queued requests. */
  private reconcile(): void {
    for (const instance of [...this.instances.values()]) {
      if (Date.now() - instance.lastSeen > INSTANCE_TTL_MS) {
        this.forgetPort(instance.port);
      }
    }
    this.sweepDeadSessions();
    const scope = getAgentMonitorScope();
    for (const entry of this.pending.all) {
      if (entry.tabUid === null && entry.directory) {
        const tabUid = matchTabForDirectory(entry.directory);
        if (tabUid !== null) {
          this.pending.setTabUid(entry.requestID, tabUid);
          this.pending.setAgent(entry.requestID, agentOfTab(tabUid) ?? 'opencode');
        }
      }
      const current = this.pending.get(entry.requestID);
      if (!current) {
        continue;
      }
      if (scope === 'self' && current.tabUid === null) {
        this.removePending(current.requestID);
        continue;
      }
      if (!isAgentMonitored(current.agent)) {
        this.removePending(current.requestID);
      }
    }
    this.refreshPopup();
  }

  /* The server's session list is authoritative: a pending request whose
     session no longer exists can never be answered (the asking agent is
     gone -- tab closed, session deleted), so it must not keep a card on
     screen or resurrect from a listPermissions/listQuestions replay. Only
     attached instances with a fresh snapshot are swept, and only entries
     that predate the snapshot -- a session born mid-scan is live, just not
     in it yet. Swept ids are tombstoned so replays within the stream's
     lifetime are ignored. */
  private sweepDeadSessions(): void {
    for (const instance of this.instances.values()) {
      if (!instance.attached || !instance.sessionsFresh) {
        continue;
      }
      for (const entry of this.pending.all) {
        if (entry.target.host !== instance.host || entry.target.port !== instance.port) {
          continue;
        }
        if (entry.addedAt >= instance.sessionsRefreshedAt) {
          continue;
        }
        if (instance.sessions.has(entry.request.sessionID)) {
          continue;
        }
        this.markAnswered(instance.port, entry.requestID);
        this.removePending(entry.requestID);
      }
    }
  }

  /* --- event stream -------------------------------------------------------- */

  private onSseEvent(instance: TrackedInstance, event: SseEnvelope): void {
    if (this.stopped) {
      return;
    }
    const type = event.payload?.type;
    if (type === 'permission.asked' && isPermissionRequest(event.payload.properties)) {
      void this.addPermission(instance, event.payload.properties, event.directory ?? null);
    } else if (type === 'question.asked' && isQuestionRequest(event.payload.properties)) {
      void this.addQuestion(instance, event.payload.properties, event.directory ?? null);
    } else if (
      type === 'permission.replied' ||
      type === 'question.replied' ||
      type === 'question.rejected'
    ) {
      const properties = event.payload.properties as { requestID?: unknown } | undefined;
      if (properties && typeof properties.requestID === 'string') {
        this.markAnswered(instance.port, properties.requestID);
        this.removePending(properties.requestID);
      }
    } else if (type === 'server.instance.disposed') {
      this.forgetPort(instance.port);
    }
  }

  private onSseClosed(instance: TrackedInstance): void {
    if (this.stopped) {
      return;
    }
    instance.attached = false;
    if (this.instances.get(instance.port) !== instance) {
      return;
    }
    /* A closed stream is usually a server restart -- its request counter
       resets, so the old answered-ids tombstones no longer apply. */
    this.answered.delete(instance.port);
    instance.retries += 1;
    const delay = Math.min(1000 * 2 ** Math.min(instance.retries - 1, 5), SSE_MAX_RETRY_MS);
    instance.retryTimer = setTimeout(() => {
      instance.retryTimer = undefined;
      if (this.stopped || !this.instances.has(instance.port)) {
        return;
      }
      /* Re-verify the server is actually alive before re-subscribing: an
         instance whose stream died on a gone server would otherwise retry
         forever, keeping dead pending requests on the popup. */
      void probeHealth(instance).then((health) => {
        if (this.stopped || !this.instances.has(instance.port)) {
          return;
        }
        if (!health || !health.healthy) {
          this.forgetPort(instance.port);
          return;
        }
        this.attach(instance);
      });
    }, delay);
  }

  private async addPermission(
    instance: TrackedInstance,
    request: PermissionRequest,
    directoryHint: string | null = null,
  ): Promise<void> {
    await this.addPending(
      instance,
      { requestID: request.id, kind: 'permission', request },
      request.sessionID,
      directoryHint,
    );
  }

  private async addQuestion(
    instance: TrackedInstance,
    request: QuestionRequest,
    directoryHint: string | null = null,
  ): Promise<void> {
    await this.addPending(
      instance,
      { requestID: request.id, kind: 'question', request },
      request.sessionID,
      directoryHint,
    );
  }

  /* Resolve the directory a single request belongs to via its own session
     (sessionID), not a directory cached once per HTTP instance -- one
     instance commonly hosts many unrelated project sessions at once. Prefers
     the SSE envelope's own directory (no round trip) over the cache, and
     falls back to a single-session lookup for a cache miss. */
  private async resolveSessionDirectory(
    instance: TrackedInstance,
    sessionID: string,
    directoryHint: string | null,
  ): Promise<string | null> {
    if (directoryHint) {
      instance.sessions.set(sessionID, directoryHint);
      return directoryHint;
    }
    const cached = instance.sessions.get(sessionID);
    if (cached) {
      return cached;
    }
    const session = await getSession(instance, sessionID);
    if (this.stopped || !session || typeof session.directory !== 'string') {
      return null;
    }
    instance.sessions.set(sessionID, session.directory);
    return session.directory;
  }

  private async addPending(
    instance: TrackedInstance,
    entry: PendingEntryInput,
    sessionID: string,
    directoryHint: string | null,
  ): Promise<void> {
    const directory = await this.resolveSessionDirectory(instance, sessionID, directoryHint);
    if (this.stopped) {
      return;
    }
    /* scope='self': only requests that can belong to this window's tabs are
       admitted. A request without any directory can never attribute to a
       tab, so it is foreign by definition. */
    if (getAgentMonitorScope() === 'self' && !directory) {
      return;
    }
    const tabUid = directory ? matchTabForDirectory(directory) : null;
    /* The asking agent: the agent running in the attributed tab (claude,
       codex, ... -- whatever owns that pane), falling back to 'opencode'
       for unattributed opencode-server requests. The per-agent monitor gate
       decides whether the request is worth a card at all. */
    const agent = tabUid ? (agentOfTab(tabUid) ?? 'opencode') : 'opencode';
    if (!isAgentMonitored(agent)) {
      return;
    }
    const full: PendingEntry = {
      ...entry,
      target: { host: instance.host, port: instance.port, password: instance.password },
      directory,
      tabUid,
      agent,
      addedAt: Date.now(),
    };
    if (this.isAnswered(instance.port, full.requestID)) {
      return;
    }
    if (this.pending.add(full) && isAgentMonitorPopupEnabled()) {
      this.refreshPopup();
    }
  }

  private removePending(requestID: string): void {
    if (this.shownRequestID === requestID) {
      this.shownRequestID = null;
    }
    this.dismissedUntil.delete(requestID);
    if (this.pending.remove(requestID)) {
      this.refreshPopup();
    }
  }

  /* --- popup visibility ------------------------------------------------------ */

  private activeRootTab(): string | null {
    const store = getStore();
    if (!store) {
      return null;
    }
    try {
      return store.getState().termGroups?.activeRootGroup ?? null;
    } catch {
      return null;
    }
  }

  private refreshPopup(): void {
    if (!this.handlers) {
      return;
    }
    /* Persist mode: the card stays on the request the user has been shown
       until they interact with it. Focus changes, heartbeat re-scans and
       unrelated pending-set churn must not swap or hide it under them --
       only answering (entry removed) or dismissing (monitor.dismiss) lets
       the queue advance. */
    if (isAgentMonitorPersistEnabled()) {
      const shown = this.shownRequestID ? this.pending.get(this.shownRequestID) : null;
      if (shown) {
        this.handlers.onShow(shown);
        return;
      }
      this.shownRequestID = null;
    }
    const visible = this.nextVisibleSkipDismissed();
    this.shownRequestID = visible?.requestID ?? null;
    this.handlers.onShow(visible);
  }

  /* nextVisible with the recently-dismissed entries excluded, so dismissing
     a card advances the queue instead of re-showing the same request. */
  private nextVisibleSkipDismissed(): PendingEntry | null {
    const now = Date.now();
    for (const [id, until] of this.dismissedUntil) {
      if (until <= now) {
        this.dismissedUntil.delete(id);
      }
    }
    const active = this.activeRootTab();
    /* If the user is sitting in a tab that runs opencode, a tabless request
       is that tab's own ask (attribution failed -- e.g. no OSC 7) and must
       not pop a card: the TUI prompt is already right in front of them.
       scope='self' additionally suppresses every tabless entry outright:
       until reconcile() resolves a directory to one of THIS window's tabs
       (or gives up and sweeps the entry), a tabless request is either not
       yet provably self or provably foreign -- either way it must never
       reach the popup while addPending's synchronous admission is still
       ahead of that check. */
    const suppressTabless =
      getAgentMonitorScope() === 'self' ||
      (active !== null && tabsRunningAgent('opencode').includes(active));
    return this.pending.nextVisible(active, suppressTabless, new Set(this.dismissedUntil.keys()));
  }

  /* --- hint ---------------------------------------------------------------- */

  private updateHints(): void {
    if (!isAgentMonitorHintEnabled() || !isAgentMonitored('opencode')) {
      return;
    }
    const matched = new Set<string>();
    for (const instance of this.instances.values()) {
      for (const directory of instance.sessions.values()) {
        const tabUid = matchTabForDirectory(directory);
        if (tabUid) {
          matched.add(tabUid);
        }
      }
    }
    const now = Date.now();
    for (const tabUid of tabsRunningAgent('opencode')) {
      if (matched.has(tabUid)) {
        this.hintFirstSeen.delete(tabUid);
        this.hintShown.delete(tabUid);
        continue;
      }
      if (this.hintShown.has(tabUid)) {
        continue;
      }
      const firstSeen = this.hintFirstSeen.get(tabUid) ?? now;
      this.hintFirstSeen.set(tabUid, firstSeen);
      if (now - firstSeen >= HINT_GRACE_MS) {
        this.hintShown.add(tabUid);
        this.handlers?.onShowHint(tabUid, cwdOfTab(tabUid));
      }
    }
  }
}

export const agentMonitor = new AgentMonitor();

export function startAgentMonitor(handlers: MonitorPopupHandlers): () => void {
  agentMonitor.start(handlers);
  return () => agentMonitor.stop();
}

export function agentMonitorOnFocusChanged(): void {
  agentMonitor.onFocusChanged();
}

export function agentMonitorRequestScan(): void {
  agentMonitor.requestScan();
}
