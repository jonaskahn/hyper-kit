import { describe, it, expect } from 'vitest';

import {
  applyConfig,
  categorySettings,
  clampWidth,
  getManualBrowser,
  getMediaAccent,
  getAgentMonitorScope,
  isAgentMonitored,
  isAgentMonitorOptimistic,
  isLeftPanelEnabled,
  isBookmarksEnabled,
  isBottomPanelEnabled,
  isTopPanelEnabled,
  isRunningCatEnabled,
  isBrowserMediaEnabled,
  isEnvPanelEnabled,
  isExplorerEnabled,
  isMediaArtistVisible,
  isMediaWaveEnabled,
  isMediaPanelEnabled,
  isNewTabSameDirEnabled,
  isPaneCountBadgeEnabled,
  isConfirmCloseEnabled,
  readUiConfig,
  MIN_WIDTH,
  MAX_WIDTH,
} from '../src/config';

describe('config', () => {
  it('enables leftPanel, its sub-panels, bottomPanel, and newTabSameDir by default', () => {
    applyConfig(null);
    expect(isLeftPanelEnabled()).toBe(true);
    expect(isEnvPanelEnabled()).toBe(true);
    expect(isPaneCountBadgeEnabled()).toBe(true);
    expect(isMediaPanelEnabled()).toBe(true);
    expect(isBottomPanelEnabled()).toBe(true);
    expect(isExplorerEnabled()).toBe(true);
    expect(isBookmarksEnabled()).toBe(true);
    expect(isNewTabSameDirEnabled()).toBe(true);
    expect(isConfirmCloseEnabled()).toBe(true);
  });

  it('powers envPanel down independently of the leftPanel master switch', () => {
    applyConfig({ hyperKit: { leftPanel: { enable: true, envPanel: false } } });
    expect(isLeftPanelEnabled()).toBe(true);
    expect(isEnvPanelEnabled()).toBe(false);
  });

  it('powers paneCountBadge down independently', () => {
    applyConfig({ hyperKit: { paneCountBadge: false } });
    expect(isLeftPanelEnabled()).toBe(true);
    expect(isPaneCountBadgeEnabled()).toBe(false);
  });

  it('powers the whole leftPanel down via the single master switch', () => {
    applyConfig({ hyperKit: { leftPanel: { enable: false } } });
    expect(isLeftPanelEnabled()).toBe(false);
  });

  it('merges partial mediaPanel overrides against defaults', () => {
    applyConfig({ hyperKit: { leftPanel: { mediaPanel: { accent: '#fff' } } } });
    expect(isMediaPanelEnabled()).toBe(true);
    expect(isBrowserMediaEnabled()).toBe(true);
    expect(isMediaArtistVisible()).toBe(true);
    expect(isMediaWaveEnabled()).toBe(true);
    expect(getMediaAccent()).toBe('#fff');
    expect(getManualBrowser()).toBeNull();
  });

  it('turns the media wave off via mediaPanel.wave', () => {
    applyConfig({ hyperKit: { leftPanel: { mediaPanel: { wave: false } } } });
    expect(isMediaWaveEnabled()).toBe(false);
    applyConfig(null);
    expect(isMediaWaveEnabled()).toBe(true);
  });

  it('reads the manualBrowser fallback override', () => {
    applyConfig({ hyperKit: { leftPanel: { mediaPanel: { manualBrowser: 'safari' } } } });
    expect(getManualBrowser()).toBe('safari');
  });

  it('disables the mediaPanel sub-feature independently of leftPanel', () => {
    applyConfig({ hyperKit: { leftPanel: { mediaPanel: { enabled: false } } } });
    expect(isLeftPanelEnabled()).toBe(true);
    expect(isMediaPanelEnabled()).toBe(false);
  });

  it('powers bottomPanel down independently', () => {
    applyConfig({ hyperKit: { bottomPanel: false } });
    expect(isBottomPanelEnabled()).toBe(false);
    expect(isLeftPanelEnabled()).toBe(true);
  });

  it('powers topPanel down independently', () => {
    applyConfig({ hyperKit: { topPanel: false } });
    expect(isTopPanelEnabled()).toBe(false);
    expect(isLeftPanelEnabled()).toBe(true);
    applyConfig(null);
  });

  it('reads the running cat topPanel object form', () => {
    applyConfig({ hyperKit: { topPanel: { enabled: true } } });
    expect(isTopPanelEnabled()).toBe(true);
    expect(isRunningCatEnabled()).toBe(true);
    applyConfig({ hyperKit: { topPanel: { enabled: false } } });
    expect(isTopPanelEnabled()).toBe(false);
    expect(isRunningCatEnabled()).toBe(false);
    applyConfig({ hyperKit: { topPanel: { enabled: true, runningCat: false } } });
    expect(isTopPanelEnabled()).toBe(true);
    expect(isRunningCatEnabled()).toBe(false);
    applyConfig(null);
  });

  it('powers explorer down independently', () => {
    applyConfig({ hyperKit: { explorer: false } });
    expect(isExplorerEnabled()).toBe(false);
    expect(isBookmarksEnabled()).toBe(true);
    applyConfig(null);
  });

  it('powers bookmarks down independently', () => {
    applyConfig({ hyperKit: { bookmarks: false } });
    expect(isBookmarksEnabled()).toBe(false);
    expect(isExplorerEnabled()).toBe(true);
    applyConfig(null);
  });

  it('powers newTabSameDir down independently', () => {
    applyConfig({ hyperKit: { newTabSameDir: false } });
    expect(isLeftPanelEnabled()).toBe(true);
    expect(isNewTabSameDirEnabled()).toBe(false);
  });

  it('powers confirmClose down independently', () => {
    applyConfig({ hyperKit: { confirmClose: false } });
    expect(isLeftPanelEnabled()).toBe(true);
    expect(isConfirmCloseEnabled()).toBe(false);
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

  it('defaults the agent monitor to self scope, optimistic replies, and the on-list agents', () => {
    applyConfig(null);
    expect(getAgentMonitorScope()).toBe('self');
    expect(isAgentMonitorOptimistic()).toBe(true);
    for (const agent of ['opencode', 'claude', 'codex', 'agent', 'agy']) {
      expect(isAgentMonitored(agent)).toBe(true);
    }
    for (const agent of [
      'gemini',
      'copilot',
      'aider',
      'amp',
      'goose',
      'devin',
      'qwen',
      'kiro',
      'kimi',
      'openhands',
      'zed',
      'windsurf',
      'trae',
    ]) {
      expect(isAgentMonitored(agent)).toBe(false);
    }
    expect(isAgentMonitored('ghost-agent')).toBe(false);
    expect(isAgentMonitored(null)).toBe(false);
  });

  it('merges agentMonitor scope, optimistic, and per-agent overrides', () => {
    applyConfig({
      hyperKit: {
        agentMonitor: { scope: 'hyper', optimistic: false, agents: { opencode: false } },
      },
    });
    expect(getAgentMonitorScope()).toBe('hyper');
    expect(isAgentMonitorOptimistic()).toBe(false);
    expect(isAgentMonitored('opencode')).toBe(false);
    expect(isAgentMonitored('claude')).toBe(true); // untouched defaults survive
    expect(isAgentMonitored('gemini')).toBe(false);
    applyConfig(null);
    expect(getAgentMonitorScope()).toBe('self');
    expect(isAgentMonitored('opencode')).toBe(true);
  });

  it('accepts only known scope values', () => {
    applyConfig({ hyperKit: { agentMonitor: { scope: 'bogus' as any } } });
    expect(getAgentMonitorScope()).toBe('self');
    applyConfig({ hyperKit: { agentMonitor: { scope: 'all' } } });
    expect(getAgentMonitorScope()).toBe('all');
  });

  it('normalizes cursor aliases to the agent key', () => {
    applyConfig(null);
    expect(isAgentMonitored('cursor')).toBe(true);
    expect(isAgentMonitored('cursor-agent')).toBe(true);
  });
});
