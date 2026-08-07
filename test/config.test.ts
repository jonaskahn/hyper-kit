import { describe, it, expect } from 'vitest';

import {
  applyConfig,
  categorySettings,
  clampWidth,
  isDragDropTabsEnabled,
  isNewTabSameDirEnabled,
  isVerticalTabEnabled,
  readUiConfig,
  MIN_WIDTH,
  MAX_WIDTH,
} from '../src/config';

describe('config', () => {
  it('enables verticalTab, dragDropTabs, and newTabSameDir by default', () => {
    applyConfig(null);
    expect(isVerticalTabEnabled()).toBe(true);
    expect(isDragDropTabsEnabled()).toBe(true);
    expect(isNewTabSameDirEnabled()).toBe(true);
  });

  it('powers dragDropTabs down independently of verticalTab', () => {
    applyConfig({ hyperKit: { verticalTab: true, dragDropTabs: false } });
    expect(isVerticalTabEnabled()).toBe(true);
    expect(isDragDropTabsEnabled()).toBe(false);
  });

  it('powers newTabSameDir down independently', () => {
    applyConfig({ hyperKit: { verticalTab: true, newTabSameDir: false } });
    expect(isVerticalTabEnabled()).toBe(true);
    expect(isNewTabSameDirEnabled()).toBe(false);
  });
  it('uses defaults for unknown categories', () => {
    applyConfig(null);
    expect(categorySettings('Language')).toEqual({ limit: 10, order: null });
    expect(categorySettings('Unknown')).toEqual({ limit: 10, order: null });
  });

  it('applies tabUi overrides', () => {
    applyConfig({ tabUi: { maxLanguages: 3, languageOrder: ['Go', 'Rust'] } });
    expect(categorySettings('Language')).toEqual({ limit: 3, order: ['Go', 'Rust'] });
    expect(categorySettings('Tool')).toEqual({ limit: 10, order: null });
  });

  it('reads config from window.config at runtime', () => {
    (window as any).config = { getConfig: () => ({ tabUi: { maxAgents: 4 } }) };
    readUiConfig();
    expect(categorySettings('Agents').limit).toBe(4);
    delete (window as any).config;
  });

  it('clamps the tabbar width', () => {
    expect(clampWidth(100)).toBe(MIN_WIDTH);
    expect(clampWidth(9999)).toBe(MAX_WIDTH);
    expect(clampWidth(240)).toBe(240);
  });
});
