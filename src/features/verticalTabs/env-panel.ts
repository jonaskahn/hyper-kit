import { readUiConfig } from '../../config';
import { orderDetectedByCategory, type EnvEntry } from '../../core/env-entries';
import { cwdMap } from '../../platform/state/tab-session-store';
import { lookupSessionStart } from './session-tracking';
import { getActiveTab } from '../../platform/state/active-tab';
import { SELECTORS, ATTRIBUTES } from '../../platform/dom-selectors';
import { detectEnv, resetEnvCache } from '../../platform/tool-probe';

const PANEL_REFRESH_MS = 1000;

let envPanelEl: HTMLElement | null = null;

export function getEnvPanelEl(): HTMLElement | null {
  return envPanelEl;
}

function buildEnvPanel(): HTMLElement {
  if (envPanelEl) {
    return envPanelEl;
  }
  const panel = document.createElement('div');
  panel.setAttribute(ATTRIBUTES.envPanel, '');
  panel.innerHTML =
    '<div class="env-head">' +
    '<span class="env-head-label">Dir</span><span class="env-head-value" data-kit-tab-env-dir></span>' +
    '<span class="env-head-label">Time</span><span data-kit-tab-env-time></span>' +
    '<span class="env-head-label">Open</span><span data-kit-tab-env-open></span>' +
    '</div>' +
    '<div class="env-cats" data-kit-tab-env-cats></div>';
  const host = document.querySelector(SELECTORS.headerHeader) || document.body;
  host.appendChild(panel);
  envPanelEl = panel;
  return panel;
}

export function reattachEnvPanel(): void {
  if (envPanelEl && !envPanelEl.isConnected) {
    const headerHost = document.querySelector(SELECTORS.headerHeader);
    if (headerHost) {
      headerHost.appendChild(envPanelEl);
    }
  }
}

export function updateEnvInfo(): void {
  if (!envPanelEl) {
    return;
  }
  const { uid, mountAt } = getActiveTab();
  const dir = uid ? cwdMap.get(uid) : undefined;
  envPanelEl.querySelector('[data-kit-tab-env-dir]')!.textContent = dir || '~';
  envPanelEl.querySelector('[data-kit-tab-env-time]')!.textContent =
    new Date().toLocaleTimeString();
  const start = (uid ? lookupSessionStart(uid) : null) || mountAt || 0;
  envPanelEl.querySelector('[data-kit-tab-env-open]')!.textContent =
    start > 0 ? formatOpen(Date.now() - start) : '—';
}

function formatOpen(ms: number): string {
  const secs = Math.floor(ms / 1000);
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return (h ? h + 'h ' : '') + (h || m ? m + 'm ' : '') + s + 's';
}

export function renderEnvPanel(rows: EnvEntry[]): void {
  const panel = buildEnvPanel();
  let html = '';
  for (const section of orderDetectedByCategory(rows)) {
    const entriesHtml = section.entries
      .map(
        ([name, version]) =>
          '<span class="env-name">' +
          name +
          '</span> <span class="env-version">' +
          version +
          '</span>',
      )
      .join('<span class="env-sep"> · </span>');
    html +=
      '<div class="env-cat">' +
      '<div class="env-cat-label">' +
      section.category +
      '</div>' +
      '<div class="env-cat-entries">' +
      entriesHtml +
      (section.remainder > 0
        ? '<span class="env-more"> · +' + section.remainder + ' more</span>'
        : '') +
      '</div></div>';
  }
  const categoriesEl = panel.querySelector('[data-kit-tab-env-cats]');
  if (categoriesEl) {
    categoriesEl.innerHTML = html;
  }
  updateEnvInfo();
}

let panelInterval: ReturnType<typeof setInterval> | null = null;

export function initEnvPanel(): () => void {
  readUiConfig();
  buildEnvPanel();
  updateEnvInfo();
  if (panelInterval) {
    clearInterval(panelInterval);
  }
  panelInterval = setInterval(updateEnvInfo, PANEL_REFRESH_MS);
  detectEnv().then(renderEnvPanel);
  return () => {
    if (panelInterval) {
      clearInterval(panelInterval);
      panelInterval = null;
    }
  };
}

export function reloadEnvPanel(): void {
  resetEnvCache();
  detectEnv().then(renderEnvPanel);
}
