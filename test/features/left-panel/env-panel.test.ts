import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { applyConfig } from '../../../src/config';
import {
  renderEnvPanel,
  getEnvPanelEl,
  reattachEnvPanel,
} from '../../../src/features/left-panel/env-panel';

beforeEach(() => {
  document.body.innerHTML = '<div class="header_header"></div>';
  applyConfig(null);
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('env panel', () => {
  it('renders detected tools grouped by category', () => {
    renderEnvPanel([
      ['Node', '20.1.0'],
      ['Git', '2.40.0'],
      ['Claude', '1.2.3'],
    ]);
    const html = getEnvPanelEl()!.querySelector('[data-kit-tab-env-cats]')!.innerHTML;
    expect(html).toContain('Language');
    expect(html).toContain('Tool');
    expect(html).toContain('Agents');
    expect(html).toContain('20.1.0');
    expect(html).toContain('2.40.0');
    expect(html).toContain('1.2.3');
  });

  it('skips categories with no detected entries', () => {
    renderEnvPanel([['Node', '20.1.0']]);
    const html = getEnvPanelEl()!.querySelector('[data-kit-tab-env-cats]')!.innerHTML;
    expect(html).toContain('Language');
    expect(html).not.toContain('Agents');
    expect(html).not.toContain('Runtime');
  });

  it('caps entries per category and shows the remainder', () => {
    applyConfig({ tabUi: { maxLanguages: 2 } });
    renderEnvPanel([
      ['Node', '20.1.0'],
      ['Python', '3.12.0'],
      ['Go', '1.22.0'],
      ['Rust', '1.76.0'],
    ]);
    const html = getEnvPanelEl()!.querySelector('[data-kit-tab-env-cats]')!.innerHTML;
    expect(html).toContain('+2 more');
  });

  it('respects a configured priority order', () => {
    applyConfig({ tabUi: { languageOrder: ['Rust', 'Go', 'Python', 'Node'] } });
    renderEnvPanel([
      ['Node', '20.1.0'],
      ['Python', '3.12.0'],
      ['Go', '1.22.0'],
      ['Rust', '1.76.0'],
    ]);
    const html = getEnvPanelEl()!.querySelector('[data-kit-tab-env-cats]')!.innerHTML;
    expect(html.indexOf('Rust')).toBeLessThan(html.indexOf('Go'));
    expect(html.indexOf('Go')).toBeLessThan(html.indexOf('Python'));
  });

  it('appends the panel to the tab bar header', () => {
    renderEnvPanel([]);
    expect(document.querySelector('.header_header [data-kit-tab-env-panel]')).not.toBeNull();
  });

  it('reattach moves a panel stuck under document.body back into .header_header', () => {
    renderEnvPanel([]);
    const panel = getEnvPanelEl()!;
    // simulate the moment .header_header was momentarily missing when the
    // panel last attached, leaving it parked on the document.body fallback
    document.body.appendChild(panel);
    expect(panel.isConnected).toBe(true);
    expect(panel.parentElement).toBe(document.body);

    reattachEnvPanel();

    expect(panel.parentElement).toBe(document.querySelector('.header_header'));
  });
});
