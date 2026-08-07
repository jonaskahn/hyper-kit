/* Hyper's own generated DOM structure and attribute contract that this
   plugin hooks into (or asks Hyper's built-in CSS to expose), plus this
   plugin's own class/attribute names that get created in one place and
   queried or toggled in another. Centralized here so those strings never
   drift out of sync between files. */

export const SELECTORS = {
  headerHeader: '.header_header',
  hyperMain: '.hyper_main',
  tab: '.tab_tab',
  tabIcon: '.tab_icon',
  tabsTitle: '.tabs_title',
  terminalTextarea: '.terminal textarea',
} as const;

export const CLASSES = {
  tabActive: 'tab_active',
  tabCwd: 'kit-tab-cwd',
  tabStatus: 'kit-tab-status',
  dragging: 'kit-tab-dragging',
  singleTab: 'kit-tab-single',
  tabDragGhost: 'kit-tab-drag-ghost',
  tabDropIndicator: 'kit-tab-drop-indicator',
} as const;

export const ATTRIBUTES = {
  tabbarResize: 'data-kit-tab-resize',
  envPanel: 'data-kit-tab-env-panel',
} as const;
