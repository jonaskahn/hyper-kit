import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { applyConfig } from '../../../src/config';
import {
  renderEnvPanel,
  updateEnvInfo,
  getEnvPanelEl,
} from '../../../src/features/verticalTabs/env-panel';
import { cwdMap, statusMap, sessionStart } from '../../../src/platform/state/tab-session-store';
import { setActiveTab } from '../../../src/platform/state/active-tab';
import { setStore } from '../../../src/platform/hyper-store';

beforeEach(() => {
  document.body.innerHTML = '<div class="header_header"></div>';
  applyConfig(null);
  setActiveTab(null, 0);
  cwdMap.clear();
  statusMap.clear();
  sessionStart.clear();
});

afterEach(() => {
  setStore(null);
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

  it('shows the active tab dir and open duration', () => {
    renderEnvPanel([]);
    setActiveTab('g1');
    cwdMap.set('g1', '/tmp/x');
    sessionStart.set('g1', Date.now() - 5000);
    updateEnvInfo();
    const panel = getEnvPanelEl()!;
    expect(panel.querySelector('[data-kit-tab-env-dir]')!.textContent).toBe('/tmp/x');
    expect(panel.querySelector('[data-kit-tab-env-open]')!.textContent).toBe('5s');
  });

  it('falls back to ~ and an em dash without an active tab', () => {
    renderEnvPanel([]);
    updateEnvInfo();
    const panel = getEnvPanelEl()!;
    expect(panel.querySelector('[data-kit-tab-env-dir]')!.textContent).toBe('~');
    expect(panel.querySelector('[data-kit-tab-env-open]')!.textContent).toBe('—');
  });
});
