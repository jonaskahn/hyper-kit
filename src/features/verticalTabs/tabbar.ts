import { DEFAULT_WIDTH, clampWidth } from '../../config';
import { injectStyle } from '../../platform/style-injector';
import { loadSavedWidth, saveWidth } from '../../platform/width-storage';
import { SELECTORS, CLASSES, ATTRIBUTES } from '../../platform/dom-selectors';
import { initEnvPanel, reattachEnvPanel, updateEnvInfo } from './env-panel';
import { briefCwd } from '../../core/session';
import { homeDir } from '../../platform/home-dir';
import { getLastCwd } from '../../platform/state/tab-session-store';
import { startStaleSessionPruning } from './session-tracking';
import { setActiveTab, getActiveTab } from '../../platform/state/active-tab';
import { getTermGroups } from '../../platform/hyper-store';
import { onCwdChanged } from '../../platform/event-bus';

const TERMINAL_FOCUS_DELAY_MS = 400;

export function setTabbarWidth(px: number): void {
  document.documentElement.style.setProperty('--kit-tab-width', px + 'px');
}

export function restoreTabbarWidth(): void {
  const saved = loadSavedWidth();
  setTabbarWidth(saved !== null ? clampWidth(saved) : DEFAULT_WIDTH);
}

function firstTermGroupUid(): string | null {
  const ids = Object.keys(getTermGroups());
  return ids.length ? ids[0] : null;
}

export function attachControls(): () => void {
  injectStyle();
  restoreTabbarWidth();
  const disposeEnvPanel = initEnvPanel();
  const disposePruning = startStaleSessionPruning();
  const disposeResizeHandle = attachResizeHandle();

  const syncSingleTab = () => {
    const host =
      document.querySelector(SELECTORS.hyperMain) ||
      document.getElementById('hyper') ||
      document.documentElement;
    const hasTabs = document.querySelectorAll(SELECTORS.tab).length > 0;
    host.classList.toggle(CLASSES.singleTab, !hasTabs);
    reattachEnvPanel();
    ensureTitleCwdRow();
    if (!hasTabs) {
      adoptSoleSession();
    }
  };
  syncSingleTab();
  // scope to the tab bar's own container, not the whole document: terminal
  // output (xterm.js) mutates the DOM continuously in a sibling subtree, and
  // watching document.body would re-run syncSingleTab on every keystroke
  const observeTarget = document.querySelector(SELECTORS.headerHeader) || document.body;
  const observer = new MutationObserver(syncSingleTab);
  observer.observe(observeTarget, { childList: true, subtree: true });

  const disposeCwdListener = onCwdChanged(() => {
    const row = document.querySelector(`${SELECTORS.tabsTitle} .${CLASSES.tabCwd}`);
    if (row && getLastCwd()) {
      row.textContent = briefCwd(getLastCwd(), homeDir());
    }
  });

  // wait for Hyper's terminal to mount before stealing focus to it
  setTimeout(() => {
    const textarea = document.querySelector(SELECTORS.terminalTextarea);
    if (textarea && document.activeElement !== textarea) {
      (textarea as HTMLTextAreaElement).focus();
    }
  }, TERMINAL_FOCUS_DELAY_MS);

  return () => {
    observer.disconnect();
    disposeCwdListener();
    disposeResizeHandle();
    disposeEnvPanel();
    disposePruning();
  };
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

function ensureTitleCwdRow(): void {
  const title = document.querySelector(SELECTORS.tabsTitle);
  if (title && !title.querySelector('.' + CLASSES.tabCwd)) {
    const row = document.createElement('div');
    row.className = CLASSES.tabCwd;
    row.textContent = briefCwd(getLastCwd(), homeDir());
    title.appendChild(row);
  }
}

function adoptSoleSession(): void {
  const uid = firstTermGroupUid();
  if (uid && uid !== getActiveTab().uid) {
    setActiveTab(uid, 0);
    updateEnvInfo();
  }
}
