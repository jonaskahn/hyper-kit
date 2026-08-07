import { DEFAULT_WIDTH } from '../config';

export const CSS = `
/* ============ hyper-kit: vertical frosted-glass tab bar ============ */
:root {
    --kit-tab-width: 240px;
    color-scheme: light dark;
}

/* --- tab bar --- */
.header_header {
    position: fixed !important;
    top: 1px !important;
    left: 1px !important;
    bottom: 1px !important;
    right: auto !important;
    width: var(--kit-tab-width, 240px);
    display: flex !important;
    flex-direction: column !important;
    background: transparent !important;
    border: none !important;
    border-right: 1px solid rgba(255, 255, 255, 0.06) !important;
    -webkit-app-region: drag;
}

.tabs_nav {
    position: static !important;
    top: auto !important;
    height: auto !important;
    width: 100%;
    padding: 30px 10px 10px !important;
    line-height: 36px !important;
    display: flex !important;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    overflow: hidden;
    -webkit-user-select: none;
}

.tabs_title {
    padding: 0 10px !important;
    font-family: -apple-system, BlinkMacSystemFont, sans-serif;
    font-size: 12px;
    letter-spacing: 0.02em;
}

.tabs_list {
    max-height: none !important;
    flex-flow: column !important;
    margin-left: 0 !important;
    width: 100%;
    padding: 8px 4px 0 !important;
    align-items: stretch;
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    mask-image: linear-gradient(to bottom, black 0, black calc(100% - 18px), transparent 100%);
    -webkit-mask-image: linear-gradient(to bottom, black 0, black calc(100% - 18px), transparent 100%);
    scrollbar-width: thin;
    scrollbar-color: rgba(255, 255, 255, 0.14) transparent;
}
.tabs_list::-webkit-scrollbar {
    width: 5px;
}
.tabs_list::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.14);
    border-radius: 3px;
}
.tabs_list::-webkit-scrollbar-track {
    background: transparent;
}

/* --- tabs: two rows (title / pwd), rounded, fluid motion --- */
.tab_tab,
.tab_tab * {
    -webkit-app-region: no-drag;
}
.tab_tab {
    position: relative;
    z-index: 1;
    flex-grow: 0 !important;
    height: 48px;
    margin: 0 2px 6px 2px !important;
    border: none !important;
    border-radius: 8px !important;
    background: rgba(255, 255, 255, 0.006) !important;
    box-shadow: none !important;
    font-family: -apple-system, BlinkMacSystemFont, sans-serif;
    font-size: 12px;
    letter-spacing: 0.02em;
    transition: transform 0.25s cubic-bezier(0.25, 0.8, 0.25, 1), background 0.2s ease;
    -webkit-app-region: no-drag;
}
.tab_tab:active {
    transform: scale(0.98);
    transition: transform 100ms ease-out;
}
.tab_tab:hover {
    transform: translateX(2px);
    background: rgba(255, 255, 255, 0.02) !important;
}
.tab_tab.tab_active {
    transform: translateX(2px);
    background: rgba(255, 255, 255, 0.09) !important;
    border: 1px solid light-dark(rgba(0, 0, 0, 0.45), rgba(255, 255, 255, 0.45)) !important;
}

/* title row */
.tab_text {
    height: 26px !important;
}
.tab_textInner {
    text-align: center !important;
    left: 12px !important;
    right: 12px !important;
    top: 4px !important;
    bottom: auto !important;
    height: 15px;
    line-height: 15px;
    font-size: 12.5px;
    font-weight: 500;
    overflow: hidden !important;
    text-overflow: ellipsis !important;
    white-space: nowrap !important;
}

/* pwd row */
.kit-tab-cwd {
    position: absolute;
    left: 12px;
    right: 12px;
    bottom: 4px;
    font-size: 10.5px;
    line-height: 12px;
    font-family: 'JetBrainsMono Nerd Font Mono', -apple-system, BlinkMacSystemFont, monospace;
    color: rgba(255, 255, 255, 0.42);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    text-align: left;
    pointer-events: none;
}

/* --- close button: small flat red circle with white minus (subtract) --- */
.tab_icon {
    right: -3px !important;
    top: -3px !important;
    width: 12px !important;
    height: 12px !important;
    border-radius: 50% !important;
    background: #e0453a !important;
}
.tab_icon svg {
    display: none !important;
}
.tab_icon::after {
    content: '';
    position: absolute;
    left: 50%;
    top: 50%;
    width: 7px;
    height: 1.5px;
    margin: -0.75px 0 0 -3.5px;
    border-radius: 1px;
    background: #ffffff;
}

/* --- command status icon: spinner while running, teal check when done (inactive tabs only) --- */
.kit-tab-status {
    position: absolute;
    top: -3px;
    left: -3px;
    width: 10px;
    height: 10px;
    z-index: 2;
    pointer-events: none;
    display: none;
}
.kit-tab-status.spin {
    display: block;
    background: #2ee6a8;
    border-radius: 50%;
    animation: kit-tab-status-pulse 2s ease-in-out infinite;
}
.kit-tab-status.done {
    display: block;
    background: url("data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PGNpcmNsZSBjeD0iMTIiIGN5PSIxMiIgcj0iMTAuNSIgZmlsbD0iIzJlZTZhOCIvPjxwYXRoIGQ9Ik03LjUgMTIuNSBMMTAuNSAxNS41IEwxNi41IDkiIGZpbGw9Im5vbmUiIHN0cm9rZT0iIzA3MTEwZCIgc3Ryb2tlLXdpZHRoPSIyLjgiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCIvPjwvc3ZnPg==") center / contain no-repeat;
}
@keyframes kit-tab-status-pulse {
    0%   { opacity: 0.1; }
    20%  { opacity: 1; }
    40%  { opacity: 0.15; }
    55%  { opacity: 1; }
    75%  { opacity: 0.1; }
    100% { opacity: 0.1; }
}

/* --- active tab: hide status icon (dot is the indicator), restore on blur --- */
.tab_tab.tab_active .kit-tab-status {
    display: none !important;
}

/* --- drag & drop reorder --- */
.tabs_list {
    position: relative;
}
.tab_tab.kit-tab-dragging {
    opacity: 0.3 !important;
    transform: scale(0.97);
}
.kit-tab-drag-ghost {
    position: fixed;
    z-index: 9999;
    pointer-events: none;
    opacity: 0.85;
    transform: rotate(2deg) scale(1.03);
    background: rgba(24, 26, 30, 0.9) !important;
    -webkit-backdrop-filter: blur(16px);
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5);
}
.kit-tab-drop-indicator {
    position: absolute;
    left: 10px;
    right: 10px;
    height: 2px;
    border-radius: 1px;
    background: #2ee6a8;
    box-shadow: 0 0 10px rgba(46, 230, 168, 0.8);
    pointer-events: none;
    z-index: 3;
}

/* --- typography --- */
.tab_tab,
.tab_tab:hover {
    color: rgba(255, 255, 255, 0.55) !important;
}
.tab_tab.tab_active,
.tab_tab.tab_active:hover {
    color: rgba(255, 255, 255, 0.95) !important;
}

/* --- kit-tab-single state: pill + two rows + dot --- */
.kit-tab-single .tabs_title {
    margin: 0 2px 8px 2px;
    min-height: 52px;
    line-height: 26px;
    padding: 6px 10px 8px;
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.09);
    border: 1px solid light-dark(rgba(0, 0, 0, 0.45), rgba(255, 255, 255, 0.45));
}
.kit-tab-single .tabs_title .kit-tab-cwd {
    position: static;
    display: block;
    margin-top: 2px;
}
/* --- env panel: live tab-info panel pinned at the bottom of the bar --- */
[data-kit-tab-env-panel] {
    width: 100%;
    box-sizing: border-box;
    background: rgba(16, 18, 20, 0.85);
    -webkit-backdrop-filter: blur(16px);
    border-top: 1px solid rgba(255, 255, 255, 0.08);
    font-family: -apple-system, BlinkMacSystemFont, sans-serif;
    pointer-events: none;
}
[data-kit-tab-env-panel] .env-head {
    padding: 6px 10px 7px;
    display: grid;
    grid-template-columns: 48px 1fr;
    row-gap: 4px;
    align-items: baseline;
    font-size: 10.5px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.07);
}
[data-kit-tab-env-panel] .env-head-label {
    color: rgba(255, 255, 255, 0.4);
}
[data-kit-tab-env-panel] .env-head-value {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
[data-kit-tab-env-panel] [data-kit-tab-env-time],
[data-kit-tab-env-panel] [data-kit-tab-env-open] {
    font-variant-numeric: tabular-nums;
}
[data-kit-tab-env-panel] .env-cats {
    padding: 8px 10px 10px;
    font-size: 10px;
}
[data-kit-tab-env-panel] .env-cat {
    margin-bottom: 6px;
}
[data-kit-tab-env-panel] .env-cat-label {
    font-size: 9px;
    letter-spacing: 0.08em;
    color: #2ee6a8;
    text-transform: uppercase;
    line-height: 1.6;
    margin-bottom: 2px;
}
[data-kit-tab-env-panel] .env-cat-entries {
    font-size: 10px;
    line-height: 1.7;
}
[data-kit-tab-env-panel] .env-name {
    display: inline-block;
    color: rgba(255, 255, 255, 0.55);
}
[data-kit-tab-env-panel] .env-version {
    color: rgba(255, 255, 255, 0.9);
}
[data-kit-tab-env-panel] .env-sep {
    color: rgba(255, 255, 255, 0.2);
}
[data-kit-tab-env-panel] .env-more {
    color: rgba(255, 255, 255, 0.25);
}

/* --- resize handle affordance --- */
[data-kit-tab-resize] {
    position: fixed;
    top: 0;
    bottom: 0;
    left: calc(var(--kit-tab-width, ${DEFAULT_WIDTH}px) + 1px);
    width: 6px;
    cursor: col-resize;
    z-index: 9998;
    transition: background 0.15s ease;
}
[data-kit-tab-resize]:hover {
    background: rgba(255, 255, 255, 0.06);
}

/* --- terminal area --- */
.hyper_main {
    background: #0d0e10 !important;
}
.terms_terms {
    position: absolute !important;
    top: 28px !important;
    right: 12px !important;
    bottom: 4px !important;
    left: calc(var(--kit-tab-width, 240px) + 12px) !important;
    margin: 0 !important;
    border: none !important;
    border-radius: 8px !important;
    overflow: hidden !important;
    padding: 2px !important;
    background: #141414 !important;
    animation: none !important;
}
.terms_terms .term_fit,
.terms_terms .term_wrapper,
.terms_terms .xterm {
    border-radius: 8px !important;
    overflow: hidden !important;
}
.terms_terms .xterm {
    padding: 0 !important;
}
.terms_terms.terms_termsShifted,
.terms_terms.terms_termsNotShifted {
    margin: 0 !important;
    animation: none !important;
}

/* --- reduced motion & transparency --- */
@media (prefers-reduced-motion: reduce) {
    .tab_tab,
    .tab_tab:active,
    .kit-tab-drag-ghost,
    [data-kit-tab-resize] {
        transition: none !important;
        transform: none !important;
    }
}
@media (prefers-reduced-transparency: reduce) {
    .header_header {
        background: #16181a !important;
    }
}
`;

let cssInjected = false;

export function injectStyle(): void {
  if (cssInjected) {
    return;
  }
  if (!document.body) {
    document.addEventListener('DOMContentLoaded', injectStyle);
    return;
  }
  cssInjected = true;
  const style = document.createElement('style');
  style.setAttribute('data-kit-tab-css', '');
  style.textContent = CSS;
  document.body.appendChild(style);
}
