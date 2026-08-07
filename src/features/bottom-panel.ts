import {
  isBookmarksEnabled,
  isBottomPanelEnabled,
  isExplorerEnabled,
  readUiConfig,
} from '../config';
import { cwdMap, lookupSessionStart } from '../platform/state/tab-session-store';
import { getActiveTab } from '../platform/state/active-tab';
import { getActiveSessionUid } from '../platform/hyper-store';
import { onActiveSessionChanged } from '../platform/event-bus';
import { ATTRIBUTES } from '../platform/dom-selectors';
import { openInFileManager } from '../platform/system-open';
import {
  CpuMeter,
  detectBattery,
  detectNetworkName,
  readRam,
  SpeedMeter,
  type BatteryInfo,
} from '../platform/system-info';
import {
  createBookmarkPopover,
  type BookmarkPopoverController,
} from './bottom-panel/bookmark-popover';
import {
  createExplorerPopover,
  type ExplorerPopoverController,
} from './bottom-panel/explorer-popover';

const EXPLORER_ICON_SVG =
  '<svg width="15" height="15" viewBox="0 0 16 16"><path d="M1 4.5A1.75 1.75 0 0 1 2.75 2.75h3.129a1.75 1.75 0 0 1 1.238.512l1.06 1.06a1.75 1.75 0 0 0 1.238.512H13.5A1.5 1.5 0 0 1 15 6.3v6a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 1 12.25v-7.75z" fill="currentColor"/></svg>';
const BOOKMARK_ICON_SVG =
  '<svg width="15" height="15" viewBox="0 0 16 16"><path d="M8 .7l1.94 4.63 5.003.414-3.864 3.276 1.152 4.887L8 11.3l-4.231 2.607 1.152-4.887L1.057 5.744l5.003-.414L8 .7z" fill="currentColor"/></svg>';
const FILES_ICON_SVG =
  '<svg width="12" height="12" viewBox="0 0 16 16"><path d="M1 3.5A1.5 1.5 0 0 1 2.5 2h3.379a1.5 1.5 0 0 1 1.06.44L8.06 3.56a1.5 1.5 0 0 0 1.06.44H13.5A1.5 1.5 0 0 1 15 5.5v7A1.5 1.5 0 0 1 13.5 14h-11A1.5 1.5 0 0 1 1 12.5v-9z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M8 10.5V6.5M6 8l2-2 2 2" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const TIME_REFRESH_MS = 1000;
const SPEED_REFRESH_MS = 2000;
const SYSTEM_REFRESH_MS = 30000;
export const BOTTOM_PANEL_HEIGHT_PX = 32;

let panelEl: HTMLElement | null = null;
let speedMeter: SpeedMeter | null = null;
let cpuMeter: CpuMeter | null = null;
let refreshTimers: ReturnType<typeof setInterval>[] = [];
let disposeActiveSessionListener: (() => void) | null = null;
let explorerPopover: ExplorerPopoverController | null = null;
let bookmarkPopover: BookmarkPopoverController | null = null;
let lastDir: string | null = null;

export function getBottomPanelEl(): HTMLElement | null {
  return panelEl;
}

function buildBottomPanel(): HTMLElement {
  if (panelEl) {
    return panelEl;
  }
  const panel = document.createElement('div');
  panel.setAttribute(ATTRIBUTES.bottomPanel, '');
  panel.innerHTML =
    '<div class="bp-group bp-group-left">' +
    '<div class="bp-seg"><span class="bp-label">Net</span><span data-bp-net>—</span></div>' +
    '<div class="bp-seg"><span class="bp-label">Speed</span><span data-bp-speed>—</span></div>' +
    '<div class="bp-seg"><span class="bp-label">Bat</span><span data-bp-battery>—</span></div>' +
    '<div class="bp-seg"><span class="bp-label">CPU</span><span data-bp-cpu>—</span></div>' +
    '<div class="bp-seg"><span class="bp-label">RAM</span><span data-bp-ram>—</span></div>' +
    '</div>' +
    '<div class="bp-actions">' +
    `<button type="button" class="bp-icon-btn" data-bp-explorer aria-label="Explorer" title="Explorer">${EXPLORER_ICON_SVG}</button>` +
    `<button type="button" class="bp-icon-btn" data-bp-bookmark aria-label="Bookmarks" title="Bookmarks">${BOOKMARK_ICON_SVG}</button>` +
    '</div>' +
    '<div class="bp-group bp-group-right">' +
    '<div class="bp-seg bp-dir"><span class="bp-label">Dir</span><span data-bp-dir>~</span>' +
    `<button type="button" class="bp-dir-open" data-bp-dir-open aria-label="Reveal in file manager" title="Reveal in file manager">${FILES_ICON_SVG}</button>` +
    '</div>' +
    '<div class="bp-seg"><span class="bp-label">Open</span><span data-bp-open>—</span></div>' +
    '<div class="bp-seg"><span class="bp-label">Time</span><span data-bp-time>—</span></div>' +
    '</div>';
  document.body.appendChild(panel);
  panelEl = panel;
  const dirOpenBtn = panel.querySelector<HTMLButtonElement>('[data-bp-dir-open]');
  dirOpenBtn?.addEventListener('click', () => {
    if (lastDir) {
      openInFileManager(lastDir);
    }
  });
  if (process.platform === 'linux' && dirOpenBtn) {
    dirOpenBtn.hidden = true;
  }
  const explorerBtn = panel.querySelector<HTMLButtonElement>('[data-bp-explorer]');
  explorerBtn?.addEventListener('click', () => {
    bookmarkPopover?.close();
    explorerPopover?.toggle(explorerBtn);
  });
  const bookmarkBtn = panel.querySelector<HTMLButtonElement>('[data-bp-bookmark]');
  bookmarkBtn?.addEventListener('click', () => {
    explorerPopover?.close();
    bookmarkPopover?.toggle(bookmarkBtn);
  });
  return panel;
}

/* creates/destroys each popover's controller to match its own config flag,
   and hides/shows its toolbar button to match -- called on init and on
   every config reload so toggling a flag takes effect without a rebuild */
function syncActionButtons(): void {
  if (!panelEl) {
    return;
  }
  const explorerBtn = panelEl.querySelector<HTMLButtonElement>('[data-bp-explorer]');
  if (isExplorerEnabled()) {
    if (!explorerPopover) {
      explorerPopover = createExplorerPopover();
    }
    if (explorerBtn) {
      explorerBtn.hidden = false;
    }
  } else {
    explorerPopover?.destroy();
    explorerPopover = null;
    if (explorerBtn) {
      explorerBtn.hidden = true;
    }
  }
  const bookmarkBtn = panelEl.querySelector<HTMLButtonElement>('[data-bp-bookmark]');
  if (isBookmarksEnabled()) {
    if (!bookmarkPopover) {
      bookmarkPopover = createBookmarkPopover();
    }
    if (bookmarkBtn) {
      bookmarkBtn.hidden = false;
    }
  } else {
    bookmarkPopover?.destroy();
    bookmarkPopover = null;
    if (bookmarkBtn) {
      bookmarkBtn.hidden = true;
    }
  }
}

export function reattachBottomPanel(): void {
  if (panelEl && !panelEl.isConnected) {
    document.body.appendChild(panelEl);
  }
}

function setText(root: HTMLElement, selector: string, text: string): void {
  const el = root.querySelector(selector);
  if (el) {
    el.textContent = text;
  }
}

/* `activeSession` hints the pane to show (passed straight from Hyper's focus
   event, which fires before the store records it). Without a hint the store's
   activeSessions map is read — it is always fresh by the time tab switches
   and the 1s timer re-run it. cwdMap is keyed by session uid, which is
   stable across splits. */
export function updateBottomInfo(activeSession?: string | null): void {
  if (!panelEl) {
    return;
  }
  const { uid, mountAt } = getActiveTab();
  const session = activeSession ?? getActiveSessionUid(uid);
  const dir = uid && session ? cwdMap.get(session) : undefined;
  const startKey = session || uid;
  const start = (startKey ? lookupSessionStart(startKey) : null) || mountAt || 0;
  lastDir = dir || null;
  setText(panelEl, '[data-bp-dir]', dir || '~');
  setText(panelEl, '[data-bp-open]', start > 0 ? formatOpen(Date.now() - start) : '—');
  setText(panelEl, '[data-bp-time]', new Date().toLocaleTimeString());
}

function formatOpen(ms: number): string {
  const secs = Math.floor(ms / 1000);
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return (h ? h + 'h ' : '') + (h || m ? m + 'm ' : '') + s + 's';
}

function formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec >= 1024 * 1024) {
    return (bytesPerSec / (1024 * 1024)).toFixed(1) + ' MB/s';
  }
  if (bytesPerSec >= 1024) {
    return (bytesPerSec / 1024).toFixed(0) + ' KB/s';
  }
  return Math.round(bytesPerSec) + ' B/s';
}

function formatBattery(battery: BatteryInfo): string {
  return battery.charging ? battery.level + '% · charging' : battery.level + '%';
}

function formatRam(used: number, total: number): string {
  const gb = (bytes: number, digits: number) => (bytes / 1024 ** 3).toFixed(digits) + 'G';
  return gb(used, 1) + ' / ' + gb(total, 0);
}

async function refreshSpeed(): Promise<void> {
  if (!speedMeter) {
    return;
  }
  const sample = await speedMeter.sample();
  if (!panelEl) {
    return;
  }
  setText(
    panelEl,
    '[data-bp-speed]',
    sample ? '↓ ' + formatSpeed(sample.down) + '  ↑ ' + formatSpeed(sample.up) : '—',
  );
}

function refreshUsage(): void {
  if (!panelEl || !cpuMeter) {
    return;
  }
  const cpu = cpuMeter.sample();
  const ram = readRam();
  setText(panelEl, '[data-bp-cpu]', cpu !== null ? Math.round(cpu) + '%' : '—');
  setText(panelEl, '[data-bp-ram]', ram ? formatRam(ram.used, ram.total) : '—');
}

async function refreshSystemInfo(): Promise<void> {
  if (!panelEl) {
    return;
  }
  const [network, battery] = await Promise.all([detectNetworkName(), detectBattery()]);
  if (!panelEl) {
    return;
  }
  setText(panelEl, '[data-bp-net]', network || 'Wired');
  setText(panelEl, '[data-bp-battery]', battery ? formatBattery(battery) : '—');
}

function setPanelVisible(visible: boolean): void {
  document.documentElement.style.setProperty(
    '--kit-bottom-panel-height',
    visible ? BOTTOM_PANEL_HEIGHT_PX + 'px' : '0px',
  );
  if (panelEl) {
    panelEl.style.display = visible ? '' : 'none';
  }
}

function refreshAll(): void {
  updateBottomInfo();
  refreshSpeed();
  refreshUsage();
  refreshSystemInfo();
}

function startRefreshTimers(): void {
  refreshTimers = [
    setInterval(updateBottomInfo, TIME_REFRESH_MS),
    setInterval(() => {
      refreshSpeed();
      refreshUsage();
    }, SPEED_REFRESH_MS),
    setInterval(refreshSystemInfo, SYSTEM_REFRESH_MS),
  ];
}

function stopRefreshTimers(): void {
  refreshTimers.forEach((timer) => clearInterval(timer));
  refreshTimers = [];
}

function disposeBottomPanel(): void {
  stopRefreshTimers();
  speedMeter = null;
  cpuMeter = null;
  disposeActiveSessionListener?.();
  disposeActiveSessionListener = null;
  explorerPopover?.destroy();
  explorerPopover = null;
  bookmarkPopover?.destroy();
  bookmarkPopover = null;
  if (panelEl) {
    panelEl.remove();
    panelEl = null;
  }
  setPanelVisible(false);
}

export function initBottomPanel(): () => void {
  readUiConfig();
  if (!isBottomPanelEnabled()) {
    return () => undefined;
  }
  buildBottomPanel();
  syncActionButtons();
  speedMeter = new SpeedMeter();
  cpuMeter = new CpuMeter();
  setPanelVisible(true);
  disposeActiveSessionListener = onActiveSessionChanged((rootUid, sessionUid) => {
    if (rootUid === getActiveTab().uid) {
      updateBottomInfo(sessionUid);
    }
  });
  refreshAll();
  startRefreshTimers();
  return disposeBottomPanel;
}

export function reloadBottomPanel(): void {
  readUiConfig();
  setPanelVisible(isBottomPanelEnabled());
  syncActionButtons();
}
