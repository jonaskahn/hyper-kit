import { DEFAULT_WIDTH } from '../config';

/* --- pane-count badge: small neon circle bottom-right, hidden at 1 pane,
   capped at 9+. Shared between the kit tab bar (embedded in CSS below) and
   Hyper's normal tab bar (injected standalone via injectPanesBadgeStyle). */
export const PANES_BADGE_CSS = `
.kit-tab-panes {
    position: absolute;
    right: 4px;
    bottom: 4px;
    min-width: 14px;
    height: 14px;
    box-sizing: border-box;
    padding: 0 3px;
    display: none;
    align-items: center;
    justify-content: center;
    border-radius: 7px;
    background: rgba(46, 230, 168, 0.14);
    border: 1px solid rgba(46, 230, 168, 0.5);
    color: #2ee6a8;
    font-family: -apple-system, BlinkMacSystemFont, sans-serif;
    font-size: 9px;
    font-weight: 600;
    line-height: 1;
    text-align: center;
    pointer-events: none;
    z-index: 2;
}
.kit-tab-panes.visible {
    display: flex;
}
/* Hyper's default .tab_tab has no positioning context; give it one */
.tab_tab {
    position: relative;
}
`;

/* --- close confirmation dialog: shown before closing a tab that is running
   a command; standalone-injectable so it also works with Hyper's normal tab
   bar (badge-only mode) */
const CLOSE_CONFIRM_CSS = `
.kit-close-confirm {
    position: fixed;
    inset: 0;
    z-index: 99999;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.55);
    -webkit-backdrop-filter: blur(4px);
    backdrop-filter: blur(4px);
}
.kit-close-confirm-card {
    width: min(340px, calc(100vw - 48px));
    box-sizing: border-box;
    padding: 18px 18px 14px;
    border-radius: 12px;
    background: #1b1e23;
    border: 1px solid rgba(255, 255, 255, 0.12);
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.6);
    font-family: -apple-system, BlinkMacSystemFont, sans-serif;
}
.kit-close-confirm-title {
    font-size: 14px;
    font-weight: 700;
    letter-spacing: 0.01em;
    color: rgba(255, 255, 255, 0.95);
}
.kit-close-confirm-body {
    margin-top: 6px;
    font-size: 12px;
    line-height: 1.5;
    color: rgba(255, 255, 255, 0.6);
}
.kit-close-confirm-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 16px;
}
.kit-close-confirm-cancel,
.kit-close-confirm-danger {
    appearance: none;
    border: 1px solid transparent;
    border-radius: 6px;
    padding: 5px 14px;
    font-family: inherit;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
}
.kit-close-confirm-cancel {
    background: rgba(255, 255, 255, 0.08);
    color: rgba(255, 255, 255, 0.85);
}
.kit-close-confirm-cancel:hover {
    background: rgba(255, 255, 255, 0.14);
}
.kit-close-confirm-danger {
    background: #e0453a;
    color: #ffffff;
}
.kit-close-confirm-danger:hover {
    background: #f0554a;
}
.kit-close-confirm-cancel:focus-visible,
.kit-close-confirm-danger:focus-visible {
    outline: 2px solid #2ee6a8;
    outline-offset: 1px;
}
`;

export const AGENT_MONITOR_CSS = `
/* --- agent monitor popups: permission / question cards for opencode ---
   Edge-docked drawer (config hyperKit.agentMonitor.position): the card is
   flush with the window's top or bottom edge, no dim backdrop. Clicking
   outside (invisible catcher) or Escape rejects. */
.kit-amon {
    position: fixed;
    inset: 0;
    z-index: 100000;
    display: flex;
    justify-content: center;
    pointer-events: none;
}
/* popup position: top / bottom dock the card flush to that edge */
.kit-amon-top {
    align-items: flex-start;
}
.kit-amon-bottom {
    align-items: flex-end;
}
/* invisible full-window catcher: rejects without a visible dim */
.kit-amon-backdrop {
    position: fixed;
    inset: 0;
    pointer-events: auto;
}
/* the card must stack ABOVE the fixed backdrop: the backdrop is a
   positioned element, so without a z-index here the (static) card would
   paint beneath it the moment the slide-in animation ends (the animation's
   transform is the only thing that lifts it otherwise) and swallow every
   click. */
.kit-amon-card {
    position: relative;
    z-index: 1;
    width: min(440px, calc(100vw - 48px));
    box-sizing: border-box;
    padding: 16px;
    background: rgba(16, 18, 20, 0.85);
    -webkit-backdrop-filter: blur(18px);
    backdrop-filter: blur(18px);
    border: 1px solid rgba(255, 255, 255, 0.1);
    font-family: -apple-system, BlinkMacSystemFont, sans-serif;
    pointer-events: auto;
}
/* balanced rhythm: every row (header, body, actions, status, footer) gets
   the same 12px separation instead of per-element margins that drift */
.kit-amon-card > * + * {
    margin-top: 12px;
}
/* flush with the edge: only the outer corners are rounded and the shadow
   falls away from the edge; entrance slides the card out of the window
   like a classic macOS drawer */
.kit-amon-top .kit-amon-card {
    border-radius: 0 0 12px 12px;
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.6);
    animation: kit-amon-drawer-in-top 0.28s cubic-bezier(0.22, 1, 0.36, 1);
}
.kit-amon-bottom .kit-amon-card {
    border-radius: 12px 12px 0 0;
    box-shadow: 0 -16px 48px rgba(0, 0, 0, 0.6);
    animation: kit-amon-drawer-in-bottom 0.28s cubic-bezier(0.22, 1, 0.36, 1);
}
/* closing: slide back into the edge before the node is removed */
.kit-amon-top.kit-amon-closing .kit-amon-card {
    animation: kit-amon-drawer-out-top 0.18s ease-in forwards;
}
.kit-amon-bottom.kit-amon-closing .kit-amon-card {
    animation: kit-amon-drawer-out-bottom 0.18s ease-in forwards;
}
@keyframes kit-amon-drawer-in-top {
    from { transform: translateY(-100%); }
    to { transform: translateY(0); }
}
@keyframes kit-amon-drawer-in-bottom {
    from { transform: translateY(100%); }
    to { transform: translateY(0); }
}
@keyframes kit-amon-drawer-out-top {
    from { transform: translateY(0); }
    to { transform: translateY(-100%); }
}
@keyframes kit-amon-drawer-out-bottom {
    from { transform: translateY(0); }
    to { transform: translateY(100%); }
}
/* risk tier -> accent color, driving both the icon badge and (via
   currentColor) anything else that wants to key off severity */
.kit-amon-risk-low {
    --kit-amon-accent: #2ee6a8;
}
.kit-amon-risk-medium {
    --kit-amon-accent: #f0b429;
}
.kit-amon-risk-high {
    --kit-amon-accent: #ff6b57;
}
.kit-amon-header {
    display: flex;
    align-items: flex-start;
    gap: 10px;
}
.kit-amon-icon {
    flex: 0 0 auto;
    width: 30px;
    height: 30px;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--kit-amon-accent, #2ee6a8);
}
.kit-amon-risk-low .kit-amon-icon {
    background: rgba(46, 230, 168, 0.14);
}
.kit-amon-risk-medium .kit-amon-icon {
    background: rgba(240, 180, 41, 0.16);
}
.kit-amon-risk-high .kit-amon-icon {
    background: rgba(255, 107, 87, 0.16);
}
.kit-amon-icon svg {
    width: 16px;
    height: 16px;
}
.kit-amon-title-col {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
}
.kit-amon-title {
    font-size: 15px;
    font-weight: 700;
    letter-spacing: 0.01em;
    color: rgba(255, 255, 255, 0.95);
}
.kit-amon-sub {
    font-size: 12px;
    font-weight: 500;
    color: rgba(255, 255, 255, 0.45);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.kit-amon-body {
    font-size: 13px;
    line-height: 1.5;
    color: rgba(255, 255, 255, 0.6);
}
.kit-amon-pattern {
    margin-top: 4px;
    padding: 4px 8px;
    border-radius: 6px;
    background: rgba(46, 230, 168, 0.08);
    border: 1px solid rgba(46, 230, 168, 0.18);
    color: #7df0c6;
    font-family: Menlo, Consolas, monospace;
    font-size: 12px;
    word-break: break-all;
}
.kit-amon-pattern-more {
    margin-top: 4px;
    font-size: 11px;
    color: rgba(255, 255, 255, 0.35);
}
.kit-amon-meta-row {
    display: flex;
    gap: 6px;
    align-items: baseline;
    margin-top: 6px;
    font-size: 12px;
}
.kit-amon-meta-label {
    flex: 0 0 auto;
    color: rgba(255, 255, 255, 0.4);
}
.kit-amon-meta-value {
    color: rgba(255, 255, 255, 0.75);
    font-family: Menlo, Consolas, monospace;
    word-break: break-all;
}
.kit-amon-details-toggle {
    appearance: none;
    border: none;
    background: none;
    margin-top: 8px;
    padding: 0;
    font-family: inherit;
    font-size: 12px;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.4);
    text-decoration: underline;
    cursor: pointer;
}
.kit-amon-details-toggle:hover {
    color: rgba(255, 255, 255, 0.65);
}
.kit-amon-meta {
    margin-top: 8px;
    padding: 6px 8px;
    border-radius: 6px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.08);
    font-family: Menlo, Consolas, monospace;
    font-size: 11px;
    white-space: pre-wrap;
    color: rgba(255, 255, 255, 0.5);
}
.kit-amon-status {
    font-size: 12px;
    color: rgba(255, 255, 255, 0.45);
}
.kit-amon-status-error {
    color: #ff8a7a;
}
.kit-amon-input {
    margin-top: 8px;
    width: 100%;
    box-sizing: border-box;
    padding: 6px 8px;
    border-radius: 6px;
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(255, 255, 255, 0.14);
    color: rgba(255, 255, 255, 0.9);
    font-family: inherit;
    font-size: 13px;
}
.kit-amon-input:focus {
    outline: 2px solid #2ee6a8;
    outline-offset: 1px;
}
.kit-amon-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
}
/* question answer chips: own class so the stretch rule above never
   re-sizes the option rows */
.kit-amon-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 8px;
}
.kit-amon-primary,
.kit-amon-secondary,
.kit-amon-danger,
.kit-amon-chip {
    appearance: none;
    border: 1px solid transparent;
    border-radius: 6px;
    padding: 5px 14px;
    font-family: inherit;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
}
/* action buttons stretch to fill the row in equal shares: 3 buttons take a
   third each, 2 buttons half each; wrapped rows fill full width too */
.kit-amon-primary,
.kit-amon-secondary,
.kit-amon-danger {
    flex: 1 1 0;
    min-width: 0;
    text-align: center;
    padding: 6px 12px;
}
.kit-amon-primary {
    background: #2ee6a8;
    color: #0b1210;
}
.kit-amon-primary:hover {
    background: #57edbc;
}
.kit-amon-secondary {
    background: rgba(255, 255, 255, 0.08);
    color: rgba(255, 255, 255, 0.85);
}
.kit-amon-secondary:hover {
    background: rgba(255, 255, 255, 0.14);
}
.kit-amon-danger {
    background: #e0453a;
    color: #ffffff;
}
.kit-amon-danger:hover {
    background: #f0554a;
}
.kit-amon-primary:disabled,
.kit-amon-secondary:disabled,
.kit-amon-danger:disabled,
.kit-amon-chip:disabled {
    opacity: 0.5;
    cursor: default;
}
.kit-amon-view {
    appearance: none;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(255, 255, 255, 0.06);
    border-radius: 6px;
    padding: 6px 12px;
    font-family: inherit;
    font-size: 12px;
    font-weight: 600;
    color: var(--kit-amon-accent, #2ee6a8);
    cursor: pointer;
    transition: background-color 0.15s ease, border-color 0.15s ease;
}
.kit-amon-view:hover {
    background: rgba(255, 255, 255, 0.1);
    border-color: var(--kit-amon-accent, #2ee6a8);
}
.kit-amon-view:disabled {
    opacity: 0.5;
    cursor: default;
    border-color: rgba(255, 255, 255, 0.12);
}
/* footer: dot divider above a row naming the asking agent (left) with the
   View Tab action (right). The dot takes the card's risk accent, tying the
   footer into the severity coding. */
.kit-amon-divider {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0 0 12px;
}
.kit-amon-divider::before,
.kit-amon-divider::after {
    content: '';
    flex: 1;
    height: 1px;
    background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.14));
}
.kit-amon-divider::after {
    transform: scaleX(-1);
}
.kit-amon-divider-dot {
    flex: 0 0 auto;
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--kit-amon-accent, #2ee6a8);
    box-shadow: 0 0 8px var(--kit-amon-accent, #2ee6a8);
}
.kit-amon-footer-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
}
.kit-amon-agent {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
}
.kit-amon-agent-icon {
    position: relative;
    flex: 0 0 auto;
    width: 18px;
    height: 18px;
    box-sizing: border-box;
    border-radius: 3px;
    background: var(--kit-agent-tile, rgba(255, 255, 255, 0.07));
    overflow: hidden;
}
.kit-amon-agent-icon::before {
    content: '';
    position: absolute;
    inset: 3px;
    background-image: var(--kit-agent-uri);
    background-repeat: no-repeat;
    background-position: center;
    background-size: contain;
}
/* single-color agent glyphs render as a mask tinted with the scheme-aware
   color, exactly like the tab-bar agent strip */
.kit-amon-agent-icon.kit-amon-agent-mask::before {
    background-image: none;
    background-color: var(--kit-agent-tint, #e6e6e6);
    -webkit-mask-image: var(--kit-agent-uri);
    mask-image: var(--kit-agent-uri);
    -webkit-mask-repeat: no-repeat;
    mask-repeat: no-repeat;
    -webkit-mask-position: center;
    mask-position: center;
    -webkit-mask-size: contain;
    mask-size: contain;
}
.kit-amon-agent-name {
    font-size: 12px;
    font-weight: 600;
    text-transform: capitalize;
    color: rgba(255, 255, 255, 0.6);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.kit-amon-chip {
    background: rgba(255, 255, 255, 0.06);
    color: rgba(255, 255, 255, 0.75);
}
.kit-amon-chip:hover {
    background: rgba(255, 255, 255, 0.12);
}
.kit-amon-chip-on {
    background: rgba(46, 230, 168, 0.18);
    border-color: rgba(46, 230, 168, 0.6);
    color: #7df0c6;
}
.kit-amon-question + .kit-amon-question {
    margin-top: 12px;
    padding-top: 12px;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
}
.kit-amon-primary:focus-visible,
.kit-amon-secondary:focus-visible,
.kit-amon-danger:focus-visible,
.kit-amon-chip:focus-visible,
.kit-amon-view:focus-visible {
    outline: 2px solid #2ee6a8;
    outline-offset: 1px;
}
`;

export const CSS = `
/* ============ hyper-kit: vertical frosted-glass tab bar ============ */
:root {
    --kit-tab-width: 240px;
    --kit-bottom-panel-height: 0px;
    --kit-top-panel-height: 0px;
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

/* --- tabs: two rows (title / pwd), rounded, fluid motion.
   Width is locked: tabs must never shrink when many tabs are open — they
   keep the full bar width (minus margins) and the list scrolls instead.
   flex: 0 0 auto + explicit width + height makes grow/shrink impossible in
   both the column (kit) and any leftover row (stock) layout. */
.tab_tab,
.tab_tab * {
    -webkit-app-region: no-drag;
}
.tab_tab {
    position: relative;
    z-index: 1;
    flex: 0 0 auto !important;
    width: calc(100% - 4px) !important;
    min-width: 0;
    box-sizing: border-box;
    height: 48px !important;
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

/* agent strip: the same row becomes a centered row of per-pane glyphs
   (agent logos or the bash chevron), replacing the cwd text. Icons are
   capped to the row's width — surplus panes collapse into a "+N" indicator,
   so the strip never overflows the tab. Every icon sits in a square tile:
   a subtle scheme-aware backdrop, and the glyph drawn on its own layer with
   a uniform 3px inset — so the inner art aligns identically inside every
   tile. */
.kit-tab-cwd.kit-tab-agents {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 5px;
    height: 18px;
    line-height: 18px;
    text-align: center;
    overflow: hidden;
}
.kit-tab-cwd.kit-tab-agents .kit-tab-agent {
    position: relative;
    width: 18px;
    height: 18px;
    min-width: 18px;
    box-sizing: border-box;
    border-radius: 3px;
    background: var(--kit-agent-tile, rgba(255, 255, 255, 0.07));
    overflow: hidden;
}
.kit-tab-cwd.kit-tab-agents .kit-tab-agent::before {
    content: '';
    position: absolute;
    inset: 3px;
    background-image: var(--kit-agent-uri);
    background-repeat: no-repeat;
    background-position: center;
    background-size: contain;
}
.kit-tab-cwd.kit-tab-agents .kit-tab-agent-more {
    font-size: 9px;
    font-weight: 600;
    line-height: 18px;
    color: rgba(255, 255, 255, 0.42);
    font-family: -apple-system, BlinkMacSystemFont, sans-serif;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    pointer-events: none;
}
/* single-color glyphs (cursor, windsurf, shell, ...) render as a mask tinted
   with the scheme-aware color — set from JS (--kit-agent-tint) so it works
   on older Chromium; the light-dark() fallback only applies if unset */
.kit-tab-cwd.kit-tab-agents .kit-tab-agent.kit-tab-agent-mask::before {
    background-image: none;
    background-color: var(--kit-agent-tint, light-dark(#1f2328, #e6e6e6));
    -webkit-mask-image: var(--kit-agent-uri);
    mask-image: var(--kit-agent-uri);
    -webkit-mask-repeat: no-repeat;
    mask-repeat: no-repeat;
    -webkit-mask-position: center;
    mask-position: center;
    -webkit-mask-size: contain;
    mask-size: contain;
}

/* --- pane-count badge: small neon circle bottom-right, hidden at 1 pane,
   capped at 9+ --- */
${PANES_BADGE_CSS}
/* keep the pwd row clear of the badge when it's showing */
.tab_tab:has(.kit-tab-panes.visible) .kit-tab-cwd {
    right: 26px;
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
    position: relative;
}
.kit-tab-single .tabs_title .kit-tab-cwd {
    position: static;
    display: block;
    margin-top: 2px;
}
/* pill mode: the strip must win the display fight against the block rule */
.kit-tab-single .tabs_title .kit-tab-cwd.kit-tab-agents {
    display: flex;
    justify-content: center;
    gap: 5px;
}
/* single-tab mode has no .tab_tab, so the pane-count badge lives in the
   pill; keep its cwd row clear of it */
.kit-tab-single .tabs_title .kit-tab-panes {
    right: 6px;
    bottom: 6px;
}
.kit-tab-single .tabs_title:has(.kit-tab-panes.visible) .kit-tab-cwd {
    padding-right: 22px;
}
/* --- bottom status panel: system info strip at the window's bottom edge,
   starting right of the vertical tab bar so it never covers the panels
   pinned at the bottom of the left panel --- */
[data-kit-tab-bottom-panel] {
    position: fixed;
    left: calc(var(--kit-tab-width, 240px) + 1px);
    right: 1px;
    bottom: 1px;
    height: var(--kit-bottom-panel-height, 32px);
    box-sizing: border-box;
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    column-gap: 14px;
    padding: 0 12px;
    background: rgba(16, 18, 20, 0.85);
    -webkit-backdrop-filter: blur(16px);
    border-top: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 0 0 8px 8px;
    font-family: -apple-system, BlinkMacSystemFont, sans-serif;
    font-size: 10.5px;
    color: rgba(255, 255, 255, 0.72);
    z-index: 9997;
    -webkit-app-region: no-drag;
    pointer-events: none;
}
[data-kit-tab-bottom-panel] .bp-group {
    display: flex;
    align-items: center;
    gap: 14px;
    min-width: 0;
    overflow: hidden;
}
[data-kit-tab-bottom-panel] .bp-group-left {
    justify-content: flex-start;
}
[data-kit-tab-bottom-panel] .bp-group-right {
    justify-content: flex-end;
}
[data-kit-tab-bottom-panel] .bp-seg {
    display: flex;
    align-items: baseline;
    white-space: nowrap;
}
[data-kit-tab-bottom-panel] .bp-label {
    color: rgba(255, 255, 255, 0.4);
    margin-right: 5px;
}
[data-kit-tab-bottom-panel] [data-bp-speed],
[data-kit-tab-bottom-panel] [data-bp-time],
[data-kit-tab-bottom-panel] [data-bp-battery],
[data-kit-tab-bottom-panel] [data-bp-cpu],
[data-kit-tab-bottom-panel] [data-bp-ram],
[data-kit-tab-bottom-panel] [data-bp-open] {
    font-variant-numeric: tabular-nums;
}
[data-kit-tab-bottom-panel] .bp-dir {
    max-width: 320px;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 5px;
}
[data-kit-tab-bottom-panel] .bp-dir [data-bp-dir] {
    overflow: hidden;
    text-overflow: ellipsis;
}
[data-kit-tab-bottom-panel] .bp-dir-open {
    width: 18px;
    height: 18px;
    flex: none;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 5px;
    background: transparent;
    color: rgba(255, 255, 255, 0.45);
    padding: 0;
    cursor: pointer;
    pointer-events: auto;
    -webkit-app-region: no-drag;
    transition: background 0.15s ease, color 0.15s ease;
}
[data-kit-tab-bottom-panel] .bp-dir-open:hover {
    background: rgba(255, 255, 255, 0.1);
    color: rgba(255, 255, 255, 0.95);
}
[data-kit-tab-bottom-panel] .bp-actions {
    display: flex;
    align-items: center;
    gap: 4px;
    flex: none;
}
[data-kit-tab-bottom-panel] .bp-icon-btn {
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: rgba(255, 255, 255, 0.65);
    padding: 0;
    cursor: pointer;
    pointer-events: auto;
    -webkit-app-region: no-drag;
    transition: background 0.15s ease, color 0.15s ease, transform 100ms ease-out;
}
[data-kit-tab-bottom-panel] .bp-icon-btn:hover {
    background: rgba(255, 255, 255, 0.1);
    color: rgba(255, 255, 255, 0.95);
}
[data-kit-tab-bottom-panel] .bp-icon-btn:active {
    transform: scale(0.9);
}

/* --- top status panel: 8-bit cat strip above the terminal area, flush
   with the window's top edge, starting right of the vertical tab bar. A
   black-and-white pixel cat (traced from RunCat_for_Linux's icon frames)
   sits pinned at the right edge and runs in place; playback speed and bob
   track live CPU usage (JS writes --kit-cat-duration on the panel). At
   near-idle CPU the cat swaps to a curled sleeping pose (JS toggles
   [data-cat-state] on .kit-dino-cat). When the panel is on, it replaces the
   titlebar strip and the terminal sits flush below it (--kit-term-top). --- */
[data-kit-tab-top-panel] {
    position: fixed;
    top: 1px;
    left: calc(var(--kit-tab-width, 240px) + 1px);
    right: 1px;
    height: var(--kit-top-panel-height, 34px);
    box-sizing: border-box;
    background: rgba(16, 18, 20, 0.85);
    -webkit-backdrop-filter: blur(16px);
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 8px 8px 0 0;
    overflow: hidden;
    z-index: 9997;
    -webkit-app-region: drag;
    pointer-events: none;
}
[data-kit-tab-top-panel] .kit-dino {
    position: absolute;
    inset: 0;
    overflow: hidden;
}
/* pinned at the right edge — it never travels across the strip, only the
   filmstrip inside it and the body bob move */
[data-kit-tab-top-panel] .kit-dino-cat {
    position: absolute;
    right: 10px;
    bottom: 6px;
    width: 32px;
    height: 20px;
    transform: scale(0.8);
    transform-origin: bottom right;
}
[data-kit-tab-top-panel] .kit-dino-bob {
    position: relative;
    width: 100%;
    height: 100%;
    animation: kit-dino-bob var(--kit-cat-duration, 2000ms) ease-in-out infinite;
}
/* clips the 5-frame filmstrip to a single frame; the strip steps left one
   frame-width per tick so the frames play back in sequence */
[data-kit-tab-top-panel] .kit-dino-strip {
    position: absolute;
    inset: 0;
    overflow: hidden;
}
/* frame stepping is driven from JS (see advanceFrame in top-panel.ts) via a
   plain inline transform, not a CSS animation — a live-updating
   --kit-cat-duration would otherwise rescale an in-flight CSS animation and
   jump the strip to an unrelated frame mid-stride every time CPU ticked */
[data-kit-tab-top-panel] .kit-dino-strip-svg {
    display: block;
    height: 100%;
}
/* curled sleeping pose, smaller than the run frames — anchored to the same
   bottom-right baseline instead of stretched to fill the strip's box */
[data-kit-tab-top-panel] .kit-dino-sleep {
    position: absolute;
    right: 0;
    bottom: 0;
    width: 48px;
    height: 14px;
    opacity: 0;
}
[data-kit-tab-top-panel] .kit-dino-sleep svg {
    width: 100%;
    height: 100%;
    display: block;
}
[data-kit-tab-top-panel] .kit-dino-cat[data-cat-state='sleep'] .kit-dino-strip {
    opacity: 0;
}
[data-kit-tab-top-panel] .kit-dino-cat[data-cat-state='sleep'] .kit-dino-sleep {
    opacity: 1;
}
@keyframes kit-dino-bob {
    0%, 100% {
        transform: translateY(0);
    }
    50% {
        transform: translateY(-1.5px);
    }
}

/* --- explorer / bookmark popovers: whole-disk folder tree & saved-folder
   grid, opened from the bottom panel's action buttons. Appended straight to
   document.body (siblings of the bottom panel, not descendants), so they
   are unaffected by its pointer-events: none. --- */
.kit-explorer,
.kit-bookmark {
    position: fixed;
    z-index: 9999;
    display: flex;
    flex-direction: column;
    background: #101214;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 10px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
    pointer-events: auto;
    -webkit-app-region: no-drag;
    font-family: -apple-system, BlinkMacSystemFont, sans-serif;
    color: rgba(255, 255, 255, 0.85);
    max-height: min(560px, calc(100vh - 80px));
}
.kit-explorer {
    width: min(400px, calc(100vw - 24px));
}
.kit-bookmark {
    width: min(440px, calc(100vw - 24px));
}
.kit-explorer-header,
.kit-bookmark-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 12px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    flex: none;
}
.kit-explorer-title,
.kit-bookmark-title {
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: rgba(255, 255, 255, 0.5);
}
.kit-explorer-close,
.kit-bookmark-close {
    width: 22px;
    height: 22px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: rgba(255, 255, 255, 0.5);
    font-size: 15px;
    line-height: 1;
    cursor: pointer;
    transition: background 0.15s ease, color 0.15s ease;
}
.kit-explorer-close:hover,
.kit-bookmark-close:hover {
    background: rgba(255, 255, 255, 0.1);
    color: rgba(255, 255, 255, 0.95);
}
.kit-explorer-header-actions,
.kit-bookmark-header-actions {
    display: flex;
    align-items: center;
    gap: 4px;
}
.kit-explorer-toggle-fulltree,
.kit-explorer-toggle-hidden {
    width: 22px;
    height: 22px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: rgba(255, 255, 255, 0.45);
    padding: 0;
    cursor: pointer;
    transition: background 0.15s ease, color 0.15s ease;
}
.kit-explorer-toggle-fulltree:hover,
.kit-explorer-toggle-hidden:hover {
    background: rgba(255, 255, 255, 0.1);
    color: rgba(255, 255, 255, 0.95);
}
.kit-explorer-toggle-on {
    color: #f5c451;
}
.kit-explorer-body,
.kit-bookmark-body {
    overflow-y: auto;
    padding: 8px;
}
.kit-explorer-row {
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 32px;
    border-radius: 6px;
    padding: 0 4px;
}
.kit-explorer-row:hover {
    background: rgba(255, 255, 255, 0.06);
}
.kit-explorer-chevron {
    width: 20px;
    height: 20px;
    flex: none;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    background: transparent;
    color: rgba(255, 255, 255, 0.45);
    padding: 0;
    cursor: pointer;
    transform: rotate(-90deg);
    transition: transform 120ms ease-out;
}
.kit-explorer-chevron-open {
    transform: rotate(0deg);
}
.kit-explorer-row-main {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 6px;
    border: none;
    background: transparent;
    color: inherit;
    padding: 2px 0;
    cursor: pointer;
    text-align: left;
}
.kit-explorer-icon {
    flex: none;
    display: flex;
    color: rgba(255, 255, 255, 0.55);
}
.kit-explorer-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 13px;
}
.kit-explorer-pin {
    width: 22px;
    height: 22px;
    flex: none;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    background: transparent;
    color: rgba(255, 255, 255, 0.35);
    padding: 0;
    cursor: pointer;
    transition: color 0.15s ease;
}
.kit-explorer-pin:hover {
    color: rgba(255, 255, 255, 0.7);
}
.kit-explorer-pin-active {
    color: #f5c451;
}
.kit-explorer-pin-active:hover {
    color: #f5c451;
}
.kit-explorer-terminal,
.kit-explorer-files,
.kit-explorer-split {
    width: 22px;
    height: 22px;
    flex: none;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    background: transparent;
    color: rgba(255, 255, 255, 0.35);
    padding: 0;
    cursor: pointer;
    transition: color 0.15s ease;
}
.kit-explorer-terminal:hover,
.kit-explorer-files:hover,
.kit-explorer-split:hover {
    color: rgba(255, 255, 255, 0.7);
}
.kit-explorer-children {
    margin-left: 16px;
}
.kit-explorer-empty,
.kit-explorer-loading,
.kit-explorer-error {
    padding: 6px 8px;
    font-size: 11px;
    font-style: italic;
    color: rgba(255, 255, 255, 0.4);
}
.kit-bookmark-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
    gap: 10px;
    padding: 4px;
}
.kit-bookmark-tile {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 14px 10px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.03);
    transition: background 0.15s ease;
}
.kit-bookmark-tile:hover,
.kit-bookmark-tile:focus-within {
    background: rgba(0, 0, 0, 0.3);
}
.kit-bookmark-tile-main {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    width: 100%;
    min-width: 0;
    border: none;
    background: transparent;
    color: inherit;
    padding: 0;
    cursor: pointer;
    transition: opacity 120ms ease-out;
}
/* on hover the tile darkens; dim its content too so the bright action
   buttons in the corner stand out */
.kit-bookmark-tile:hover .kit-bookmark-tile-main,
.kit-bookmark-tile:focus-within .kit-bookmark-tile-main {
    opacity: 0.4;
}
.kit-bookmark-tile-icon {
    color: rgba(255, 255, 255, 0.55);
}
.kit-bookmark-tile-name {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 13px;
}
.kit-bookmark-tile-path {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 9.5px;
    color: rgba(255, 255, 255, 0.4);
}
/* the marquee inner span: only this moves; the outer path element stays
   fixed inside the tile so the scroll is always clipped to the tile */
.kit-bookmark-tile-path-inner {
    display: block;
    white-space: nowrap;
}
.kit-bookmark-tile-remove {
    position: absolute;
    top: 4px;
    right: 4px;
    width: 20px;
    height: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid rgba(255, 255, 255, 0.35);
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.18);
    color: rgba(255, 255, 255, 0.95);
    font-size: 13px;
    line-height: 1;
    padding: 0;
    cursor: pointer;
    opacity: 0;
    transition: opacity 120ms ease-out, background 0.15s ease, color 0.15s ease;
}
.kit-bookmark-tile-remove:hover {
    background: rgba(255, 255, 255, 0.32);
    color: #fff;
}
.kit-bookmark-tile:hover .kit-bookmark-tile-remove,
.kit-bookmark-tile:focus-within .kit-bookmark-tile-remove {
    opacity: 1;
}
.kit-bookmark-tile-actions {
    position: absolute;
    bottom: 4px;
    right: 4px;
    display: flex;
    gap: 4px;
    opacity: 0;
    transition: opacity 120ms ease-out;
}
.kit-bookmark-tile:hover .kit-bookmark-tile-actions,
.kit-bookmark-tile:focus-within .kit-bookmark-tile-actions {
    opacity: 1;
}
.kit-bookmark-tile-action {
    width: 22px;
    height: 22px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid rgba(255, 255, 255, 0.35);
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.18);
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
    color: rgba(255, 255, 255, 0.95);
    padding: 0;
    cursor: pointer;
    transition: background 0.15s ease, color 0.15s ease;
}
.kit-bookmark-tile-action:hover {
    background: rgba(255, 255, 255, 0.32);
    color: #fff;
}
.kit-bookmark-empty {
    padding: 24px 16px;
    text-align: center;
    font-size: 11px;
    line-height: 1.4;
    color: rgba(255, 255, 255, 0.4);
}

/* --- env panel: tool inventory pinned at the bottom of the tab bar --- */
[data-kit-tab-env-panel] {
    width: 100%;
    box-sizing: border-box;
    background: rgba(16, 18, 20, 0.85);
    -webkit-backdrop-filter: blur(16px);
    border-top: 1px solid rgba(255, 255, 255, 0.08);
    font-family: -apple-system, BlinkMacSystemFont, sans-serif;
    pointer-events: none;
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
[data-kit-tab-env-panel] .env-empty {
    color: rgba(255, 255, 255, 0.3);
    font-size: 10px;
    line-height: 1.7;
}

/* --- env panel: centered loading indicator while the toolchain scan runs ---
   iOS 6 style: a hollow ring of twelve evenly spaced spokes that rotates
   slowly and steadily (one full turn every 2s) until detectEnv resolves */
[data-kit-tab-env-panel] .env-loading {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 12px 0;
}
[data-kit-tab-env-panel] .env-spinner {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: repeating-conic-gradient(
        from 0deg,
        rgba(255, 255, 255, 0.5) 0deg 15deg,
        rgba(255, 255, 255, 0.07) 15deg 30deg
    );
    -webkit-mask: radial-gradient(closest-side, transparent 58%, black 59%);
    mask: radial-gradient(closest-side, transparent 58%, black 59%);
    animation: kit-env-spin 2s linear infinite;
}
@keyframes kit-env-spin {
    to {
        transform: rotate(360deg);
    }
}

/* --- media panel: now-playing card pinned above the env panel --- */
/* themable via CSS custom properties (set from ~/.hyper.js user CSS or the
   hyperKit.leftPanel.mediaPanel.accent config); the defaults are the kit's neon identity */
[data-kit-tab-media-panel] {
    --mp-accent: #2ee6a8;
    --mp-bg: rgba(16, 18, 20, 0.85);
    --mp-cover-size: 32px;
    --mp-radius: 6px;
    --mp-title-size: 12px;
    --mp-artist-size: 10px;
    --mp-text: rgba(255, 255, 255, 0.92);
    --mp-muted: rgba(255, 255, 255, 0.45);
    --mp-btn-bg: rgba(255, 255, 255, 0.1);
    width: 100%;
    box-sizing: border-box;
    position: relative;
    background: var(--mp-bg);
    -webkit-backdrop-filter: blur(16px);
    border-top: 1px solid rgba(255, 255, 255, 0.08);
    font-family: -apple-system, BlinkMacSystemFont, sans-serif;
    pointer-events: none;
}
/* flex/grid display rules below would override the hidden attribute's UA
   display:none; re-assert it so toggles (volume popup, idle bar, cover vs
   note placeholder) actually hide */
[data-kit-tab-media-panel] [hidden] {
    display: none !important;
}
[data-kit-tab-media-panel] .mp-body {
    display: flex;
    flex-direction: column;
    gap: 7px;
    padding: 10px 14px 10px 10px;
    position: relative;
}
/* animated equalizer wave behind the card content: absolute layer under the
   text/controls rows. Heights are driven per-frame by media-panel.ts (a
   rAF loop while .mp-playing is set); the .running flag kills the settle
   transition so the loop tracks smoothly, and pausing transitions each bar
   back to its static baseline */
[data-kit-tab-media-panel] .mp-waves {
    position: absolute;
    inset: 0;
    z-index: 0;
    display: flex;
    align-items: flex-end;
    gap: 3px;
    padding: 0 10px;
    overflow: hidden;
    pointer-events: none;
}
[data-kit-tab-media-panel] .mp-waves span {
    flex: 1;
    min-width: 2px;
    height: 100%;
    border-radius: 2px 2px 0 0;
    background: linear-gradient(to top, transparent, var(--mp-accent));
    opacity: 0.2;
    transform-origin: bottom;
    transform: scaleY(0.15);
    transition: transform 0.45s ease;
}
[data-kit-tab-media-panel] .mp-waves.running span {
    transition: none;
}
[data-kit-tab-media-panel] .mp-row1 {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    position: relative;
    z-index: 1;
}
[data-kit-tab-media-panel] .mp-top {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    position: relative;
    z-index: 1;
}
[data-kit-tab-media-panel] .mp-cover {
    width: var(--mp-cover-size);
    height: var(--mp-cover-size);
    min-width: var(--mp-cover-size);
    border-radius: var(--mp-radius);
    object-fit: cover;
    flex: none;
    background: rgba(255, 255, 255, 0.06);
}
[data-kit-tab-media-panel] .mp-note {
    width: var(--mp-cover-size);
    height: var(--mp-cover-size);
    min-width: var(--mp-cover-size);
    flex: none;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--mp-radius);
    background: rgba(255, 255, 255, 0.06);
    color: var(--mp-accent);
    font-size: 14px;
}
[data-kit-tab-media-panel] .mp-picker-wrap {
    position: relative;
    flex: none;
    display: inline-flex;
    align-items: center;
}
[data-kit-tab-media-panel] .mp-picker {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    max-width: 100px;
    min-width: 0;
    font-size: 10px;
    line-height: 1.3;
    color: var(--mp-text);
    background-color: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: var(--mp-radius);
    padding: 2px 6px;
    cursor: pointer;
    pointer-events: auto;
    -webkit-app-region: no-drag;
    transition: background-color 0.15s ease, border-color 0.15s ease;
}
[data-kit-tab-media-panel] .mp-picker-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
[data-kit-tab-media-panel] .mp-picker-chev {
    display: flex;
    flex: none;
    pointer-events: none;
    color: rgba(255, 255, 255, 0.5);
}
[data-kit-tab-media-panel] .mp-picker:hover,
[data-kit-tab-media-panel] .mp-picker-wrap.open .mp-picker {
    background-color: rgba(255, 255, 255, 0.1);
    border-color: rgba(255, 255, 255, 0.18);
}
[data-kit-tab-media-panel] .mp-picker-menu {
    position: absolute;
    /* the panel is pinned at the bottom of the tab bar, so the menu
       drops UP instead of being clipped off-screen below it */
    top: auto;
    bottom: calc(100% + 4px);
    left: 0;
    z-index: 9999;
    min-width: 130px;
    max-width: 220px;
    max-height: 240px;
    overflow-y: auto;
    padding: 4px;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: var(--mp-radius);
    background: rgba(20, 22, 25, 0.96);
    -webkit-backdrop-filter: blur(12px);
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.45);
    pointer-events: auto;
    -webkit-app-region: no-drag;
}
[data-kit-tab-media-panel] .mp-picker-opt {
    display: block;
    width: 100%;
    text-align: left;
    font-size: 10.5px;
    line-height: 1.4;
    color: var(--mp-text);
    background: transparent;
    border: none;
    border-radius: 4px;
    padding: 4px 8px;
    cursor: pointer;
    pointer-events: auto;
    -webkit-app-region: no-drag;
    transition: background-color 0.1s ease;
}
[data-kit-tab-media-panel] .mp-picker-opt:hover {
    background: rgba(255, 255, 255, 0.08);
}
[data-kit-tab-media-panel] .mp-picker-opt[aria-selected='true'] {
    color: var(--mp-accent);
}
[data-kit-tab-media-panel] .mp-text {
    flex: 1;
    min-width: 0;
}
[data-kit-tab-media-panel] .mp-title {
    font-size: var(--mp-title-size);
    font-weight: 600;
    line-height: 1.35;
    color: var(--mp-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
[data-kit-tab-media-panel] .mp-artist {
    font-size: var(--mp-artist-size);
    line-height: 1.4;
    color: var(--mp-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
[data-kit-tab-media-panel] .mp-controls {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    flex: none;
}
[data-kit-tab-media-panel] .mp-btn {
    width: 26px;
    height: 26px;
    border: none;
    border-radius: var(--mp-radius);
    background: transparent;
    color: rgba(255, 255, 255, 0.65);
    font-size: 12px;
    line-height: 1;
    padding: 0;
    cursor: pointer;
    pointer-events: auto;
    -webkit-app-region: no-drag;
    transition: background 0.15s ease, color 0.15s ease, transform 100ms ease-out;
}
[data-kit-tab-media-panel] .mp-btn:hover:not(:disabled) {
    background: var(--mp-btn-bg);
    color: rgba(255, 255, 255, 0.95);
}
[data-kit-tab-media-panel] .mp-btn:active:not(:disabled) {
    transform: scale(0.92);
}
[data-kit-tab-media-panel] .mp-btn:disabled {
    color: rgba(255, 255, 255, 0.18);
    cursor: default;
}
[data-kit-tab-media-panel] .mp-play {
    width: 30px;
    height: 30px;
    color: var(--mp-accent);
    font-size: 13px;
    background: rgba(255, 255, 255, 0.06);
}
[data-kit-tab-media-panel] .mp-vol-row {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    justify-content: flex-end;
}
[data-kit-tab-media-panel] .mp-vol-toggle {
    width: 18px;
    height: 18px;
    flex: none;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: none;
    border-radius: var(--mp-radius);
    background: transparent;
    color: var(--mp-muted);
    cursor: pointer;
    pointer-events: auto;
    -webkit-app-region: no-drag;
    transition: background 0.15s ease, color 0.15s ease, transform 100ms ease-out;
}
[data-kit-tab-media-panel] .mp-vol-toggle:hover {
    background: var(--mp-btn-bg);
    color: var(--mp-text);
}
[data-kit-tab-media-panel] .mp-vol-toggle:active {
    transform: scale(0.92);
}
[data-kit-tab-media-panel] .mp-vol-toggle.open {
    color: var(--mp-accent);
}
[data-kit-tab-media-panel] .mp-vol {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    pointer-events: auto;
}
[data-kit-tab-media-panel] .mp-range {
    flex: 1;
    min-width: 0;
    height: 16px;
    margin: 0;
    background: transparent;
    -webkit-appearance: none;
    appearance: none;
    cursor: pointer;
    pointer-events: auto;
    -webkit-app-region: no-drag;
}
[data-kit-tab-media-panel] .mp-range:disabled {
    cursor: default;
    opacity: 0.35;
}
[data-kit-tab-media-panel] .mp-range::-webkit-slider-runnable-track {
    height: 3px;
    border-radius: 2px;
    background: rgba(255, 255, 255, 0.18);
}
[data-kit-tab-media-panel] .mp-range::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 11px;
    height: 11px;
    margin-top: -4px;
    border-radius: 50%;
    background: var(--mp-accent);
    border: none;
    box-shadow: 0 0 6px rgba(0, 0, 0, 0.35);
    transition: transform 100ms ease-out;
}
[data-kit-tab-media-panel] .mp-range:active::-webkit-slider-thumb {
    transform: scale(1.15);
}
[data-kit-tab-media-panel] .mp-idle {
    padding: 9px 10px;
    font-size: 10px;
    color: rgba(255, 255, 255, 0.35);
    letter-spacing: 0.04em;
}
[data-kit-tab-media-panel] .mp-hint {
    padding: 0 10px 8px;
    font-size: 9px;
    line-height: 1.5;
    color: rgba(255, 255, 255, 0.3);
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
    top: var(--kit-term-top, 28px) !important;
    right: 0 !important;
    bottom: var(--kit-bottom-panel-height, 0px) !important;
    left: calc(var(--kit-tab-width, 240px) + 1px) !important;
    margin: 0 !important;
    border: none !important;
    border-radius: 0 !important;
    overflow: hidden !important;
    padding: 0 !important;
    background: #141414 !important;
    animation: none !important;
}
.terms_terms .term_fit,
.terms_terms .term_wrapper,
.terms_terms .xterm {
    border-radius: 0 !important;
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
    [data-kit-tab-resize],
    [data-kit-tab-media-panel] .mp-btn,
    [data-kit-tab-media-panel] .mp-btn:active,
    [data-kit-tab-media-panel] .mp-vol-toggle,
    [data-kit-tab-media-panel] .mp-vol-toggle:active,
    [data-kit-tab-media-panel] .mp-range::-webkit-slider-thumb,
    [data-kit-tab-bottom-panel] .bp-icon-btn,
    [data-kit-tab-bottom-panel] .bp-icon-btn:active,
    [data-kit-tab-bottom-panel] .bp-dir-open,
    [data-kit-tab-bottom-panel] .bp-dir-open:active,
    [data-kit-tab-top-panel] .kit-dino-bob,
    [data-kit-tab-top-panel] .kit-dino-strip-svg {
        transition: none !important;
        transform: none !important;
        animation: none !important;
    }
    .kit-explorer-chevron,
    .kit-bookmark-tile-remove {
        /* these carry a meaningful resting transform/opacity (rotation =
           collapsed/expanded, opacity = hover-reveal) -- only the animated
           easing is disabled, not the state itself */
        transition: none !important;
    }
    [data-kit-tab-env-panel] .env-spinner {
        animation: none !important;
    }
    .kit-amon-card {
        animation: none !important;
    }
}
@media (prefers-reduced-transparency: reduce) {
    .header_header {
        background: #16181a !important;
    }
}
${CLOSE_CONFIRM_CSS}
${AGENT_MONITOR_CSS}
`;

/* Stylesheet injection, shared by the four entry points below: each appends
   its <style> once (guarded per id) and defers until the body exists.
   `skipWhenKitCss` no-ops when the full kit stylesheet is already present
   (it already carries the CSS these standalone sheets would add). */
const injectedIds = new Set<string>();

function injectCssOnce(id: string, attribute: string, css: string, skipWhenKitCss = false): void {
  if (injectedIds.has(id) || (skipWhenKitCss && document.querySelector('[data-kit-tab-css]'))) {
    return;
  }
  if (!document.body) {
    document.addEventListener('DOMContentLoaded', () =>
      injectCssOnce(id, attribute, css, skipWhenKitCss),
    );
    return;
  }
  injectedIds.add(id);
  const style = document.createElement('style');
  style.setAttribute(attribute, '');
  style.textContent = css;
  document.body.appendChild(style);
}

export function injectStyle(): void {
  injectCssOnce('kit-css', 'data-kit-tab-css', CSS);
}

/* Badge-only stylesheet for Hyper's normal tab bar (when the vertical kit
   chrome is off, so the full kit CSS must not be applied). */
export function injectPanesBadgeStyle(): void {
  injectCssOnce('panes-css', 'data-kit-panes-css', PANES_BADGE_CSS);
}

/* Close-confirmation dialog styles. A no-op when the full kit stylesheet is
   present (it already carries CLOSE_CONFIRM_CSS); injected standalone so the
   dialog is styled even in badge-only mode with Hyper's normal tab bar. */
export function injectCloseConfirmStyle(): void {
  injectCssOnce('close-css', 'data-kit-close-css', CLOSE_CONFIRM_CSS, true);
}

/* Agent-monitor popup styles. No-op when the full kit stylesheet is present
   (it carries AGENT_MONITOR_CSS); injected standalone otherwise. */
export function injectAgentMonitorStyle(): void {
  injectCssOnce('agent-monitor-css', 'data-kit-amon-css', AGENT_MONITOR_CSS, true);
}
