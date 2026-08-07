export const STORAGE_KEY = 'kit-tab-width';
export const MIN_WIDTH = 120;
export const MAX_WIDTH = 420;
export const DEFAULT_WIDTH = 240;

export const FONT_FAMILY =
  '"JetBrainsMono Nerd Font Mono", Menlo, "DejaVu Sans Mono", Consolas, monospace';

/* env panel caps + priority order, overridable via tabUi in ~/.hyper.js:
   maxLanguages / maxTools / maxRuntimes / maxAgents: display caps (default 10)
   languageOrder / toolOrder / runtimeOrder / agentOrder: priority order arrays */
export const DEFAULT_UI_CONFIG: Record<string, number | string[] | null> = {
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

let uiConfig: Record<string, number | string[] | null> = Object.assign({}, DEFAULT_UI_CONFIG);
let verticalTabEnabled = true;
let dragDropTabsEnabled = true;

export function applyConfig(config?: Record<string, any> | null): void {
  uiConfig = Object.assign({}, DEFAULT_UI_CONFIG, (config && config.tabUi) || {});
  verticalTabEnabled = !config || config.hyperKit?.verticalTab !== false;
  dragDropTabsEnabled = !config || config.hyperKit?.dragDropTabs !== false;
}

export function isVerticalTabEnabled(): boolean {
  return verticalTabEnabled;
}

export function isDragDropTabsEnabled(): boolean {
  return dragDropTabsEnabled;
}

export function readUiConfig(): void {
  let config: Record<string, any> = {};
  try {
    if (typeof window !== 'undefined' && window.config && window.config.getConfig) {
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
