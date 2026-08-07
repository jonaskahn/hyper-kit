import { describe, it, expect } from 'vitest';

import {
  injectStyle,
  injectPanesBadgeStyle,
  CSS,
  PANES_BADGE_CSS,
  AGENT_MONITOR_CSS,
} from '../../src/platform/style-injector';

describe('style-injector', () => {
  it('injects the style element on demand', () => {
    injectStyle();
    const els = document.querySelectorAll('style[data-kit-tab-css]');
    expect(els.length).toBe(1);
    expect(els[0].textContent).toBe(CSS);
  });

  it('injectStyle is idempotent', () => {
    injectStyle();
    injectStyle();
    expect(document.querySelectorAll('style[data-kit-tab-css]').length).toBe(1);
  });

  it('re-asserts display:none for hidden elements inside the media panel', () => {
    injectStyle();
    const css = document.querySelector('style[data-kit-tab-css]')!.textContent!;
    expect(css).toContain('[data-kit-tab-media-panel] [hidden]');
    expect(css).toContain('display: none !important;');
  });

  it('injects the panes-only stylesheet separately for normal tabs', () => {
    injectPanesBadgeStyle();
    const els = document.querySelectorAll('style[data-kit-panes-css]');
    expect(els.length).toBe(1);
    expect(els[0].textContent).toBe(PANES_BADGE_CSS);
    // standalone stylesheet must not pull in the vertical kit chrome
    expect(els[0].textContent).not.toContain('.header_header');
  });

  it('injectPanesBadgeStyle is idempotent', () => {
    injectPanesBadgeStyle();
    injectPanesBadgeStyle();
    expect(document.querySelectorAll('style[data-kit-panes-css]').length).toBe(1);
  });

  it('embeds the shared badge rules in the main stylesheet', () => {
    expect(CSS).toContain('.kit-tab-panes');
    expect(CSS).toContain('.tab_tab:has(.kit-tab-panes.visible) .kit-tab-cwd');
  });

  it('stacks the agent-monitor card above its backdrop so clicks reach the buttons', () => {
    // The backdrop is position:fixed (a positioned element), which paints
    // above static siblings unless the card lifts itself with a z-index.
    // Without this, the transparent full-window catcher swallows every
    // click on the card the moment the slide-in animation ends.
    const backdropRule = AGENT_MONITOR_CSS.match(/\.kit-amon-backdrop\s*\{([^}]*)\}/)?.[1] ?? '';
    const cardRule = AGENT_MONITOR_CSS.match(/\.kit-amon-card\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(backdropRule).toContain('position: fixed');
    expect(cardRule).toContain('position: relative');
    expect(cardRule).toContain('z-index: 1');
    expect(cardRule).toContain('pointer-events: auto');
  });

  it('opts the bottom-panel action buttons into pointer events despite the panel-wide none', () => {
    // [data-kit-tab-bottom-panel] itself is pointer-events: none, so any
    // interactive descendant (like these buttons) must explicitly opt back
    // in or it silently becomes unclickable.
    const rule =
      CSS.match(/\[data-kit-tab-bottom-panel\]\s*\.bp-icon-btn\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(rule).toContain('pointer-events: auto');
  });

  it('gives the explorer and bookmark popovers their own overlay styling', () => {
    expect(CSS).toContain('.kit-explorer');
    expect(CSS).toContain('.kit-bookmark');
    expect(CSS).toContain('.kit-explorer-chevron');
    expect(CSS).toContain('.kit-bookmark-tile-remove');
  });

  it('disables the popover-specific transitions under reduced motion', () => {
    const reduceBlock =
      CSS.match(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(reduceBlock).toContain('.bp-icon-btn');
    expect(reduceBlock).toContain('.kit-explorer-chevron');
    expect(reduceBlock).toContain('.kit-bookmark-tile-remove');
  });
});
