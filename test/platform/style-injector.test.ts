import { describe, it, expect } from 'vitest';

import { injectStyle, CSS } from '../../src/platform/style-injector';

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
});
