import { describe, it, expect, afterEach, vi } from 'vitest';

import {
  iconFor,
  bashIcon,
  maskTint,
  agentAccent,
  tileBackground,
  onSchemeChanged,
  planAgentStrip,
  FALLBACK_AGENT_ICON,
} from '../../src/core/agent-icons';
import { applyConfig } from '../../src/config';

afterEach(() => {
  applyConfig(null);
  vi.restoreAllMocks();
});

describe('iconFor', () => {
  it('resolves every catalog agent to an embedded asset', () => {
    for (const command of [
      'claude',
      'codex',
      'opencode',
      'cursor',
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
      'agy',
      'trae',
    ]) {
      expect(iconFor(command).uri).toContain('data:image/svg+xml');
    }
  });

  it('keeps brand colors as background images', () => {
    expect(iconFor('claude').mask).toBe(false);
    expect(iconFor('codex').mask).toBe(false);
    expect(iconFor('aider').mask).toBe(false);
  });

  it('renders neutral glyphs as masks so they adapt to light and dark', () => {
    expect(iconFor('cursor').mask).toBe(true);
    expect(iconFor('windsurf').mask).toBe(true);
    expect(iconFor('goose').mask).toBe(true);
    expect(iconFor('opencode').mask).toBe(true);
  });

  it('falls back to the neon sparkle for unknown commands', () => {
    expect(iconFor('ghost-agent')).toBe(FALLBACK_AGENT_ICON);
    expect(iconFor('ghost-agent').mask).toBe(false);
  });

  it('returns the shell glyph for non-agent panes', () => {
    const bash = bashIcon();
    expect(bash.uri).toContain('data:image/svg+xml');
    expect(bash.mask).toBe(true);
    expect(iconFor(null)).toBe(bash);
    expect(iconFor(undefined)).toBe(bash);
  });

  it('lets user config override built-in icons and add new ones', () => {
    applyConfig({
      hyperKit: {
        agentIconUrls: {
          claude: 'https://example.com/my-claude.svg',
          aider: 'https://example.com/aider.svg',
        },
      },
    });
    expect(iconFor('claude')).toEqual({
      uri: 'https://example.com/my-claude.svg',
      mask: false,
    });
    expect(iconFor('aider')).toEqual({
      uri: 'https://example.com/aider.svg',
      mask: false,
    });
  });

  it('picks the mask tint from the OS color scheme, defaulting to dark-on-light', () => {
    expect(maskTint()).toBe('#1f2328'); // jsdom has no matchMedia
    window.matchMedia = (() => ({ matches: true })) as any;
    expect(maskTint()).toBe('#e6e6e6');
    window.matchMedia = (() => ({ matches: false })) as any;
    expect(maskTint()).toBe('#1f2328');
    delete (window as any).matchMedia;
  });

  it('gives every catalog agent a brand accent for its border', () => {
    for (const command of [
      'claude',
      'codex',
      'opencode',
      'cursor',
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
      'agy',
      'trae',
      'shell-light',
    ]) {
      expect(agentAccent(command).length).toBeGreaterThan(0);
    }
  });

  it('uses brand hues for colored logos and the scheme tint for neutral ones', () => {
    window.matchMedia = (() => ({ matches: false })) as any;
    expect(agentAccent('claude')).toBe('#d97757');
    expect(agentAccent('codex')).toBe('#00b8b8');
    // neutral-brand agents (mask glyphs) take the scheme-aware tint
    expect(agentAccent('cursor')).toBe('#1f2328');
    expect(agentAccent('windsurf')).toBe('#1f2328');
    expect(agentAccent('opencode')).toBe('#1f2328');
    window.matchMedia = (() => ({ matches: true })) as any;
    expect(agentAccent('cursor')).toBe('#e6e6e6');
    expect(agentAccent(null)).toBe('#e6e6e6');
    expect(agentAccent('ghost-agent')).toBe('#e6e6e6');
    delete (window as any).matchMedia;
  });

  it('picks the tile backdrop from the OS color scheme', () => {
    expect(tileBackground()).toBe('rgba(31, 35, 40, 0.05)'); // light by default
    window.matchMedia = (() => ({ matches: true })) as any;
    expect(tileBackground()).toBe('rgba(255, 255, 255, 0.08)');
    delete (window as any).matchMedia;
  });

  it('onSchemeChanged is a safe no-op without matchMedia', () => {
    const dispose = onSchemeChanged(() => undefined);
    expect(dispose).toBeInstanceOf(Function);
    dispose();
  });
});

describe('planAgentStrip', () => {
  it('renders every pane when they all fit', () => {
    // 3 panes: 3 * 23 - 5 = 64px
    expect(planAgentStrip(200, 3)).toEqual({ icons: 3, more: 0 });
    expect(planAgentStrip(64, 3)).toEqual({ icons: 3, more: 0 });
  });

  it('caps icons to the width and reports the surplus', () => {
    // 2 icons (36px) + 1 gap (5px) + indicator (18px) = 59 <= 79
    expect(planAgentStrip(79, 6)).toEqual({ icons: 2, more: 4 });
    expect(planAgentStrip(60, 6)).toEqual({ icons: 2, more: 4 });
  });

  it('keeps at least one icon even in a tiny row', () => {
    expect(planAgentStrip(10, 5)).toEqual({ icons: 1, more: 4 });
  });

  it('renders everything when the row is not laid out yet', () => {
    expect(planAgentStrip(0, 5)).toEqual({ icons: 5, more: 0 });
    expect(planAgentStrip(-1, 2)).toEqual({ icons: 2, more: 0 });
  });

  it('handles zero panes', () => {
    expect(planAgentStrip(200, 0)).toEqual({ icons: 0, more: 0 });
  });
});
