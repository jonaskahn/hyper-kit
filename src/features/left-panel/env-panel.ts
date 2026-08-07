import { isEnvPanelEnabled, readUiConfig } from '../../config';
import {
  orderDetectedByCategory,
  type CategorySection,
  type EnvEntry,
} from '../../core/env-entries';
import { SELECTORS, ATTRIBUTES } from '../../platform/dom-selectors';
import { detectEnv, resetEnvCache } from '../../platform/tool-probe';

const PENDING_HTML =
  '<div class="env-loading" role="status" aria-label="Scanning toolchain">' +
  '<span class="env-spinner" aria-hidden="true"></span>' +
  '</div>';
const EMPTY_HTML = '<div class="env-empty">— no toolchain detected —</div>';

let envPanelEl: HTMLElement | null = null;

export function getEnvPanelEl(): HTMLElement | null {
  return envPanelEl;
}

/* never fall back to document.body: Hyper's .hyper_main is a fixed overlay
   that covers the viewport, so a panel parked on the body is hidden behind
   it forever. If the header isn't in the DOM yet the panel stays detached
   and reattachEnvPanel() attaches it once the header appears. */
function panelHost(): Element | null {
  return document.querySelector(SELECTORS.headerHeader);
}

function buildEnvPanel(): HTMLElement {
  if (envPanelEl) {
    reattachEnvPanel();
    return envPanelEl;
  }
  const panel = document.createElement('div');
  panel.setAttribute(ATTRIBUTES.envPanel, '');
  panel.innerHTML = '<div class="env-cats" data-kit-tab-env-cats>' + PENDING_HTML + '</div>';
  const host = panelHost();
  if (host) {
    host.appendChild(panel);
  }
  envPanelEl = panel;
  return panel;
}

/* a plain isConnected check isn't enough: a panel parked on document.body
   (from before the header existed) stays "connected" forever and would never
   move — so compare against the current correct host instead */
export function reattachEnvPanel(): void {
  if (!envPanelEl) {
    return;
  }
  const host = panelHost();
  if (host && envPanelEl.parentElement !== host) {
    host.appendChild(envPanelEl);
  }
}

function renderEntry([name, version]: EnvEntry): string {
  return `<span class="env-name">${name}</span> <span class="env-version">${version}</span>`;
}

function renderCategory(section: CategorySection): string {
  const entries = section.entries.map(renderEntry).join('<span class="env-sep"> · </span>');
  const more =
    section.remainder > 0 ? `<span class="env-more"> · +${section.remainder} more</span>` : '';
  return (
    `<div class="env-cat">` +
    `<div class="env-cat-label">${section.category}</div>` +
    `<div class="env-cat-entries">${entries}${more}</div>` +
    `</div>`
  );
}

export function renderEnvPanel(rows: EnvEntry[]): void {
  const panel = buildEnvPanel();
  const categoriesEl = panel.querySelector('[data-kit-tab-env-cats]');
  if (categoriesEl) {
    const html = orderDetectedByCategory(rows).map(renderCategory).join('');
    categoriesEl.innerHTML = html || EMPTY_HTML;
  }
}

export function disposeEnvPanel(): void {
  if (envPanelEl) {
    envPanelEl.remove();
    envPanelEl = null;
  }
}

export function initEnvPanel(): () => void {
  readUiConfig();
  if (!isEnvPanelEnabled()) {
    return () => undefined;
  }
  buildEnvPanel();
  detectEnv().then(renderEnvPanel);
  return disposeEnvPanel;
}

export function reloadEnvPanel(): void {
  readUiConfig();
  if (!isEnvPanelEnabled()) {
    disposeEnvPanel();
    return;
  }
  resetEnvCache();
  if (!envPanelEl) {
    initEnvPanel();
    return;
  }
  detectEnv().then(renderEnvPanel);
}
