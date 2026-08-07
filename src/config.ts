export const STORAGE_KEY = 'kit-tab-width';
export const BOOKMARKS_STORAGE_KEY = 'kit-tab-bookmarks';
export const EXPLORER_SHOW_HIDDEN_STORAGE_KEY = 'kit-tab-explorer-show-hidden';
export const EXPLORER_FULL_TREE_STORAGE_KEY = 'kit-tab-explorer-full-tree';
export const MIN_WIDTH = 180;
export const MAX_WIDTH = 420;
export const DEFAULT_WIDTH = 240;

export const MEDIA_REFRESH_MS = 3000;

export const FONT_FAMILY =
  '"JetBrainsMono Nerd Font Mono", Menlo, "DejaVu Sans Mono", Consolas, monospace';

/* every key here is overridable per-user under `tabUi` in ~/.hyper.js */
const DEFAULT_UI_CONFIG: Record<string, number | string[] | null> = {
  maxAgents: 10,
  maxLanguages: 10,
  maxTools: 10,
  maxRuntimes: 10,
  agentOrder: null,
  languageOrder: null,
  toolOrder: null,
  runtimeOrder: null,
};

const CATEGORY_KEYS: Record<string, [string, string]> = {
  Agents: ['maxAgents', 'agentOrder'],
  Language: ['maxLanguages', 'languageOrder'],
  Tool: ['maxTools', 'toolOrder'],
  Runtime: ['maxRuntimes', 'runtimeOrder'],
};

export type ManualBrowser = 'chrome' | 'safari' | 'firefox';

interface MediaPanelConfig {
  enabled: boolean;
  browserMedia: boolean;
  showArtist: boolean;
  accent: string;
  manualBrowser: ManualBrowser | null;
  wave: boolean;
}

const DEFAULT_MEDIA_PANEL_CONFIG: MediaPanelConfig = {
  enabled: true,
  browserMedia: true,
  showArtist: true,
  accent: '#2ee6a8',
  manualBrowser: null,
  wave: true,
};

/* the top strip holds the running cat (RunCat-style CPU meter); enabled
   switches the whole strip on/off, runningCat hides just the cat (the strip
   stays, keeping the terminal margin) */
interface TopPanelConfig {
  enabled: boolean;
  runningCat: boolean;
}

const DEFAULT_TOP_PANEL_CONFIG: TopPanelConfig = {
  enabled: true,
  runningCat: true,
};

type AgentMonitorPosition = 'top' | 'bottom';

/* Which opencode instances the agent monitor catches:
   - 'all'   — every instance, in any kind of terminal (any Hyper window,
               Terminal.app, iTerm, ...)
   - 'hyper' — instances whose process tree runs inside any Hyper instance
               (plain terminals are ignored)
   - 'self'  — only instances whose requests attribute to a tab of THIS
               Hyper window; every window runs its own separated monitor */
export type AgentMonitorScope = 'all' | 'hyper' | 'self';

/* Per-agent monitor toggles. The monitor only speaks opencode's HTTP/SSE
   protocol today, so requests always arrive from an opencode server; the
   agent key used for the gate is the agent running in the tab the request
   attributes to (falling back to 'opencode' when attribution fails). The
   alias commands 'cursor'/'cursor-agent' are normalized to 'agent'. */
const DEFAULT_MONITORED_AGENTS: Record<string, boolean> = {
  opencode: true,
  claude: true,
  codex: true,
  agent: true,
  agy: true,
  gemini: false,
  copilot: false,
  aider: false,
  amp: false,
  goose: false,
  devin: false,
  qwen: false,
  kiro: false,
  kimi: false,
  openhands: false,
  zed: false,
  windsurf: false,
  trae: false,
};

const AGENT_ALIAS_KEYS: Record<string, string> = {
  agent: 'agent',
  'cursor-agent': 'agent',
  cursor: 'agent',
};

interface AgentMonitorConfig {
  enabled: boolean;
  popup: boolean;
  hint: boolean;
  mdns: boolean;
  autoDiscover: boolean;
  /* Seconds between periodic re-scans of the OS listener table + session
     refreshes. This is how fast a request surfaces when the SSE stream
     isn't the trigger (stream down/retrying, instance started outside
     mDNS). Lower = snappier popups, slightly more probing. */
  heartbeatSec: number;
  /* Debounce for coalescing re-scans (new tab, agent detected, focus). */
  debounceMs: number;
  ports: number[];
  position: AgentMonitorPosition;
  password?: string;
  /* Keep the permission card visible until the user interacts with it
     (allow/deny/dismiss). When false, the card hides on its own -- e.g.
     when the asking tab gains focus or the pending set changes. */
  persist: boolean;
  scope: AgentMonitorScope;
  /* When a reply can't reach the server (request already answered another
     way, instance gone), treat the pressed button as accepted instead of
     erroring and keeping the card. */
  optimistic: boolean;
  agents: Record<string, boolean>;
}

const DEFAULT_AGENT_MONITOR_CONFIG: AgentMonitorConfig = {
  enabled: true,
  popup: true,
  hint: true,
  mdns: true,
  autoDiscover: true,
  heartbeatSec: 15,
  debounceMs: 150,
  ports: [4096],
  position: 'top',
  password: undefined,
  persist: true,
  scope: 'self',
  optimistic: true,
  agents: Object.assign({}, DEFAULT_MONITORED_AGENTS),
};

let uiConfig: Record<string, number | string[] | null> = Object.assign({}, DEFAULT_UI_CONFIG);
let leftPanelEnabled = true;
let envPanelEnabled = true;
let paneCountBadgeEnabled = true;
let agentIconsEnabled = true;
let agentIconUrls: Record<string, string> = {};
let mediaPanelConfig: MediaPanelConfig = Object.assign({}, DEFAULT_MEDIA_PANEL_CONFIG);
let topPanelConfig: TopPanelConfig = Object.assign({}, DEFAULT_TOP_PANEL_CONFIG);
let bottomPanelEnabled = true;
let explorerEnabled = true;
let bookmarksEnabled = true;
let newTabSameDirEnabled = true;
let confirmCloseEnabled = true;
let agentMonitorConfig: AgentMonitorConfig = Object.assign({}, DEFAULT_AGENT_MONITOR_CONFIG);
let monitoredAgents: Record<string, boolean> = Object.assign({}, DEFAULT_MONITORED_AGENTS);

export function applyConfig(config?: Record<string, any> | null): void {
  const hyperKit = config?.hyperKit;
  const leftPanel = hyperKit?.leftPanel;
  uiConfig = Object.assign({}, DEFAULT_UI_CONFIG, config?.tabUi || {});
  leftPanelEnabled = leftPanel?.enable !== false;
  envPanelEnabled = leftPanel?.envPanel !== false;
  mediaPanelConfig = Object.assign({}, DEFAULT_MEDIA_PANEL_CONFIG, leftPanel?.mediaPanel || {});
  bottomPanelEnabled = hyperKit?.bottomPanel !== false;
  const topPanel = hyperKit?.topPanel;
  topPanelConfig = {
    enabled: topPanel === false ? false : topPanel?.enabled !== false,
    runningCat:
      topPanel === false || topPanel?.enabled === false ? false : topPanel?.runningCat !== false,
  };
  explorerEnabled = hyperKit?.explorer !== false;
  bookmarksEnabled = hyperKit?.bookmarks !== false;
  paneCountBadgeEnabled = hyperKit?.paneCountBadge !== false;
  newTabSameDirEnabled = hyperKit?.newTabSameDir !== false;
  agentIconsEnabled = hyperKit?.agentIcons !== false;
  agentIconUrls = Object.assign({}, hyperKit?.agentIconUrls || {});
  confirmCloseEnabled = hyperKit?.confirmClose !== false;
  const monitor = hyperKit?.agentMonitor || {};
  agentMonitorConfig = {
    enabled: monitor.enabled !== false,
    popup: monitor.popup !== false,
    hint: monitor.hint !== false,
    mdns: monitor.mdns !== false,
    autoDiscover: monitor.autoDiscover !== false,
    heartbeatSec: typeof monitor.heartbeatSec === 'number' ? Math.max(0, monitor.heartbeatSec) : 15,
    debounceMs: typeof monitor.debounceMs === 'number' ? Math.max(0, monitor.debounceMs) : 150,
    ports: Array.isArray(monitor.ports)
      ? monitor.ports.filter((p: unknown): p is number => typeof p === 'number')
      : [4096],
    position: monitor.position === 'bottom' ? 'bottom' : 'top',
    password: typeof monitor.password === 'string' ? monitor.password : undefined,
    persist: monitor.persist !== false,
    scope: monitor.scope === 'all' || monitor.scope === 'hyper' ? monitor.scope : 'self',
    optimistic: monitor.optimistic !== false,
    agents: Object.assign({}, DEFAULT_MONITORED_AGENTS, monitor.agents || {}),
  };
  monitoredAgents = agentMonitorConfig.agents;
}

/* master switch for the whole left panel: vertical tabs + kit chrome.
   When off, Hyper keeps its stock horizontal tab bar */
export function isLeftPanelEnabled(): boolean {
  return leftPanelEnabled;
}

export function isEnvPanelEnabled(): boolean {
  return envPanelEnabled;
}

export function isPaneCountBadgeEnabled(): boolean {
  return paneCountBadgeEnabled;
}

export function isNewTabSameDirEnabled(): boolean {
  return newTabSameDirEnabled;
}

export function isAgentIconsEnabled(): boolean {
  return agentIconsEnabled;
}

/* ask for confirmation before closing a tab that is running a command */
export function isConfirmCloseEnabled(): boolean {
  return confirmCloseEnabled;
}

/* per-agent icon URL overrides/additions, e.g. new icons from
   dashboardicons.com — merged over the built-in map by agent-icons.ts */
export function getAgentIconUrls(): Record<string, string> {
  return agentIconUrls;
}

export function isBottomPanelEnabled(): boolean {
  return bottomPanelEnabled;
}

export function isTopPanelEnabled(): boolean {
  return topPanelConfig.enabled;
}

/* the running cat inside the top strip (RunCat-style CPU meter) */
export function isRunningCatEnabled(): boolean {
  return topPanelConfig.runningCat;
}

export function isExplorerEnabled(): boolean {
  return explorerEnabled;
}

export function isBookmarksEnabled(): boolean {
  return bookmarksEnabled;
}

export function isMediaPanelEnabled(): boolean {
  return mediaPanelConfig.enabled;
}

export function isBrowserMediaEnabled(): boolean {
  return mediaPanelConfig.browserMedia;
}

export function getManualBrowser(): ManualBrowser | null {
  return mediaPanelConfig.manualBrowser;
}

export function isMediaArtistVisible(): boolean {
  return mediaPanelConfig.showArtist;
}

export function isMediaWaveEnabled(): boolean {
  return mediaPanelConfig.wave;
}

export function getMediaAccent(): string {
  return mediaPanelConfig.accent;
}

export function isAgentMonitorEnabled(): boolean {
  return agentMonitorConfig.enabled;
}

export function isAgentMonitorPopupEnabled(): boolean {
  return agentMonitorConfig.popup;
}

export function isAgentMonitorHintEnabled(): boolean {
  return agentMonitorConfig.hint;
}

export function isAgentMonitorMdnsEnabled(): boolean {
  return agentMonitorConfig.mdns;
}

export function isAgentMonitorAutoDiscoverEnabled(): boolean {
  return agentMonitorConfig.autoDiscover;
}

export function getAgentMonitorHeartbeatSec(): number {
  return agentMonitorConfig.heartbeatSec;
}

export function getAgentMonitorDebounceMs(): number {
  return agentMonitorConfig.debounceMs;
}

export function getAgentMonitorPorts(): number[] {
  return agentMonitorConfig.ports;
}

export function getAgentMonitorPassword(): string | undefined {
  return agentMonitorConfig.password;
}

export function getAgentMonitorPosition(): AgentMonitorPosition {
  return agentMonitorConfig.position;
}

export function isAgentMonitorPersistEnabled(): boolean {
  return agentMonitorConfig.persist;
}

export function getAgentMonitorScope(): AgentMonitorScope {
  return agentMonitorConfig.scope;
}

export function isAgentMonitorOptimistic(): boolean {
  return agentMonitorConfig.optimistic;
}

/* Per-agent monitor toggle. Alias commands normalize to their canonical
   config key ('agent'/'cursor-agent'/'cursor' -> 'agent'); anything without
   an explicit entry (unknown agents) is not monitored. */
export function isAgentMonitored(command: string | null | undefined): boolean {
  if (!command) {
    return false;
  }
  const key = AGENT_ALIAS_KEYS[command] ?? command;
  return monitoredAgents[key] === true;
}

export function readUiConfig(): void {
  let config: Record<string, any> = {};
  try {
    if (typeof window !== 'undefined' && window.config?.getConfig) {
      config = window.config.getConfig();
    }
  } catch {
    // window.config may be unavailable during startup; falling back to defaults is safe
  }
  applyConfig(config);
}

export function categorySettings(label: string): {
  limit: number;
  order: string[] | null;
} {
  const [limitKey, orderKey] = CATEGORY_KEYS[label] || CATEGORY_KEYS.Tool;
  return {
    limit: uiConfig[limitKey] as number,
    order: uiConfig[orderKey] as string[] | null,
  };
}

export function clampWidth(px: number): number {
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, px));
}
