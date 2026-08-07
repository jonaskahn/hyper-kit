import {
  DEFAULT_WIDTH,
  clampWidth,
  isPaneCountBadgeEnabled,
  isAgentIconsEnabled,
} from '../../config';
import { injectStyle } from '../../platform/style-injector';
import { loadSavedWidth, saveWidth } from '../../platform/width-storage';
import { SELECTORS, CLASSES, ATTRIBUTES } from '../../platform/dom-selectors';
import { initBottomPanel, reattachBottomPanel, updateBottomInfo } from '../bottom-panel';
import { initTopPanel, reattachTopPanel } from '../top-panel';
import { initEnvPanel, reattachEnvPanel } from './env-panel';
import { initMediaPanel, reattachMediaPanel } from './media-panel';
import { applyPaneBadge } from './tabs';
import { briefCwd } from '../../core/session';
import { onSchemeChanged } from '../../core/agent-icons';
import { renderAgentStrip } from '../../platform/agent-strip';
import { homeDir } from '../../platform/home-dir';
import { getLastCwd, agentMap } from '../../platform/state/tab-session-store';
import { startStaleSessionPruning } from './session-tracking';
import { setActiveTab, getActiveTab } from '../../platform/state/active-tab';
import { getTermGroups, countPanesInTab, listPaneSessions } from '../../platform/hyper-store';
import { onCwdChanged, onPanesChanged, onAgentsChanged } from '../../platform/event-bus';

const TERMINAL_FOCUS_DELAY_MS = 400;
const TAB_BAR_WATCHDOG_MS = 2000;

let disposeTitleResize: ResizeObserver | null = null;

function setTabbarWidth(px: number): void {
  document.documentElement.style.setProperty('--kit-tab-width', px + 'px');
}

function restoreTabbarWidth(): void {
  const saved = loadSavedWidth();
  setTabbarWidth(saved !== null ? clampWidth(saved) : DEFAULT_WIDTH);
}

export function attachControls(): () => void {
  injectStyle();
  restoreTabbarWidth();
  const disposeBottomPanel = initBottomPanel();
  const disposeTopPanel = initTopPanel();
  const disposeEnvPanel = initEnvPanel();
  const disposeMediaPanel = initMediaPanel();
  const disposePruning = startStaleSessionPruning();
  const disposeResizeHandle = attachResizeHandle();
  const disposeTabBarObserver = observeTabBar();
  const disposeCwdListener = onCwdChanged(updateTitleCwdRow);
  const disposePanesListener = onPanesChanged(() => {
    // the emit fires before Hyper's reducer applies the change; re-count on
    // the next tick so the store reflects the new tree
    queueMicrotask(() => {
      refreshTitlePanesBadge();
      refreshTitleAgentsRow();
    });
  });
  const disposeAgentsListener = onAgentsChanged(refreshTitleAgentsRow);
  const disposeSchemeListener = onSchemeChanged(refreshTitleAgentsRow);
  focusTerminalOnceMounted();

  return () => {
    disposeTabBarObserver();
    disposeCwdListener();
    disposePanesListener();
    disposeAgentsListener();
    disposeSchemeListener();
    disposeTitleResize?.disconnect();
    disposeTitleResize = null;
    disposeResizeHandle();
    disposeBottomPanel();
    disposeTopPanel();
    disposeEnvPanel();
    disposeMediaPanel();
    disposePruning();
  };
}

function syncTabBarDom(): void {
  const host =
    document.querySelector(SELECTORS.hyperMain) ||
    document.getElementById('hyper') ||
    document.documentElement;
  const hasTabs = document.querySelectorAll(SELECTORS.tab).length > 0;
  host.classList.toggle(CLASSES.singleTab, !hasTabs);
  enforceFixedTabSizes();
  reattachBottomPanel();
  reattachTopPanel();
  reattachEnvPanel();
  reattachMediaPanel();
  ensureTitleCwdRow();
  ensureTitlePanesBadge();
  if (!hasTabs) {
    adoptSoleSession();
  }
}

/* Belt-and-suspenders for the vertical layout: whatever the stylesheet
   cascade does (or doesn't) do, tabs must never shrink in width or height
   when many tabs are open — the list scrolls instead. Inline styles are
   applied imperatively on every sync, so even a stale/overridden stylesheet
   cannot leave Hyper's stock row layout in charge.
   Scope to the list: the drag ghost is a cloned .tab_tab parked on <body>,
   and CSSOM property setters preserve its !important priority, so touching
   it here would rewrite its pinned pixel width into calc(100% - 4px) that
   resolves against the viewport — a full-window ghost. */
export function enforceFixedTabSizes(): void {
  const list = document.querySelector(SELECTORS.tabsList);
  if (list instanceof HTMLElement) {
    list.style.flexFlow = 'column';
    list.style.width = '100%';
    list.style.maxHeight = 'none';
    const tabs = list.querySelectorAll<HTMLElement>(SELECTORS.tab);
    for (const tab of tabs) {
      if (tab.classList.contains(CLASSES.tabDragGhost)) {
        continue;
      }
      tab.style.flex = '0 0 auto';
      tab.style.width = 'calc(100% - 4px)';
      tab.style.height = '48px';
      tab.style.boxSizing = 'border-box';
    }
  }
}

function observeTabBar(): () => void {
  let target = document.querySelector(SELECTORS.headerHeader) || document.body;
  syncTabBarDom();
  // scope to the tab bar's own container, not the whole document: terminal
  // output (xterm.js) mutates the DOM continuously in a sibling subtree, and
  // watching document.body would re-sync on every keystroke
  const observer = new MutationObserver(syncTabBarDom);
  observer.observe(target, { childList: true, subtree: true });

  // if Hyper ever replaces .header_header wholesale instead of mutating its
  // children, the observer above keeps watching the now-detached old node
  // and never fires again — anything appended inside it (env/media panel)
  // would be orphaned forever with nothing left to reattach it. Catch that
  // by periodically checking element identity and re-targeting when it changes.
  const watchdog = setInterval(() => {
    const current = document.querySelector(SELECTORS.headerHeader) || document.body;
    if (current !== target) {
      observer.disconnect();
      target = current;
      observer.observe(target, { childList: true, subtree: true });
      syncTabBarDom();
    }
  }, TAB_BAR_WATCHDOG_MS);

  return () => {
    observer.disconnect();
    clearInterval(watchdog);
  };
}

function focusTerminalOnceMounted(): void {
  // wait for Hyper's terminal to mount before stealing focus to it
  setTimeout(() => {
    const textarea = document.querySelector<HTMLTextAreaElement>(SELECTORS.terminalTextarea);
    if (textarea && document.activeElement !== textarea) {
      textarea.focus();
    }
  }, TERMINAL_FOCUS_DELAY_MS);
}

function attachResizeHandle(): () => void {
  const handle = document.createElement('div');
  handle.setAttribute(ATTRIBUTES.tabbarResize, '');
  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const move = (ev: MouseEvent) => {
      setTabbarWidth(clampWidth(ev.clientX - 1));
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      const currentWidth = document.documentElement.style.getPropertyValue('--kit-tab-width');
      if (currentWidth) {
        saveWidth(parseInt(currentWidth, 10));
      }
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  });
  document.body.appendChild(handle);
  return () => handle.remove();
}

function briefLastCwd(): string {
  return briefCwd(getLastCwd(), homeDir());
}

function ensureTitleCwdRow(): void {
  const title = document.querySelector(SELECTORS.tabsTitle);
  if (!title || title.querySelector(`.${CLASSES.tabCwd}`)) {
    return;
  }
  const row = document.createElement('div');
  row.className = CLASSES.tabCwd;
  title.appendChild(row);
  // pill width changes re-plan how many icons fit
  if (typeof ResizeObserver !== 'undefined') {
    disposeTitleResize?.disconnect();
    disposeTitleResize = new ResizeObserver(refreshTitleAgentsRow);
    disposeTitleResize.observe(row);
  }
  if (isAgentIconsEnabled()) {
    refreshTitleAgentsRow();
  } else {
    row.textContent = briefLastCwd();
  }
}

function updateTitleCwdRow(): void {
  if (isAgentIconsEnabled()) {
    return;
  }
  const row = document.querySelector(`${SELECTORS.tabsTitle} .${CLASSES.tabCwd}`);
  if (row && getLastCwd()) {
    row.textContent = briefLastCwd();
  }
}

/* Single-tab pill mode renders the same per-pane icon strip as the vertical
   tab bar, capped to the pill's width with a "+N" overflow indicator (agents
   first). The signature guard on the row's data attribute keeps the
   observer (childList on the header subtree) from looping on our own
   mutations: content only changes when the rendered set actually changes. */
function refreshTitleAgentsRow(): void {
  const row = document.querySelector<HTMLDivElement>(`${SELECTORS.tabsTitle} .${CLASSES.tabCwd}`);
  if (!row || !isAgentIconsEnabled()) {
    return;
  }
  let sessions: string[] = [];
  const rootUid = soleRootGroupUid();
  if (rootUid) {
    sessions = listPaneSessions(rootUid);
  }
  const sig = renderAgentStrip(
    row,
    sessions.map((session) => agentMap.get(session) ?? null),
    row.clientWidth,
    row.dataset.kitAgentsSig ?? null,
  );
  if (sig !== null) {
    row.dataset.kitAgentsSig = sig;
  }
}

/* the only tab's root group (Hyper renders no .tab_tab when there's a single
   tab, so the tab chrome lives in the .tabs_title pill instead) */
function soleRootGroupUid(): string | null {
  const groups = getTermGroups();
  for (const key in groups) {
    if (!groups[key]?.parentUid) {
      return key;
    }
  }
  return null;
}

function ensureTitlePanesBadge(): void {
  const title = document.querySelector(SELECTORS.tabsTitle);
  if (!title) {
    return;
  }
  if (!isPaneCountBadgeEnabled()) {
    title.querySelector(`.${CLASSES.tabPanes}`)?.remove();
    return;
  }
  if (!title.querySelector(`.${CLASSES.tabPanes}`)) {
    const badge = document.createElement('div');
    badge.className = CLASSES.tabPanes;
    title.appendChild(badge);
  }
  refreshTitlePanesBadge();
}

function refreshTitlePanesBadge(): void {
  const badge = document.querySelector(`${SELECTORS.tabsTitle} .${CLASSES.tabPanes}`);
  if (!badge) {
    return;
  }
  const uid = soleRootGroupUid();
  applyPaneBadge(badge as HTMLElement, uid ? countPanesInTab(uid) : 0);
}

function adoptSoleSession(): void {
  const [uid] = Object.keys(getTermGroups());
  if (uid && uid !== getActiveTab().uid) {
    setActiveTab(uid, 0);
    updateBottomInfo();
  }
}
