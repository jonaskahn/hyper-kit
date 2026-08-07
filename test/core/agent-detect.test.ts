import { describe, it, expect } from 'vitest';

import { parseAgentCommand, matchAgentTitle, AGENT_COMMANDS } from '../../src/core/agent-detect';

describe('parseAgentCommand', () => {
  it('recognizes a bare agent command', () => {
    expect(parseAgentCommand('claude')).toBe('claude');
    expect(parseAgentCommand('codex')).toBe('codex');
    expect(parseAgentCommand('opencode')).toBe('opencode');
    expect(parseAgentCommand('gemini')).toBe('gemini');
    expect(parseAgentCommand('aider')).toBe('aider');
  });

  it('recognizes agents invoked with arguments', () => {
    expect(parseAgentCommand('claude -p "explain this file"')).toBe('claude');
    expect(parseAgentCommand('codex exec')).toBe('codex');
    expect(parseAgentCommand('opencode --dangerously-skip-permissions')).toBe('opencode');
  });

  it('recognizes antigravity by its agy binary and the long form', () => {
    expect(parseAgentCommand('agy')).toBe('agy');
    expect(parseAgentCommand('agy --model gemini-3')).toBe('agy');
    expect(parseAgentCommand('antigravity')).toBe('agy');
    expect(matchAgentTitle('agy')).toBe('agy');
    expect(matchAgentTitle('antigravity')).toBe('agy');
  });

  it('recognizes qwen by its current binary and the historical qwen-code', () => {
    expect(parseAgentCommand('qwen')).toBe('qwen');
    expect(parseAgentCommand('qwen -m qwen3-code')).toBe('qwen');
    expect(parseAgentCommand('qwen-code')).toBe('qwen');
    expect(matchAgentTitle('qwen')).toBe('qwen');
  });

  it('recognizes the cursor two-word invocation, its dashed alias, and the agent shim', () => {
    expect(parseAgentCommand('cursor agent')).toBe('cursor');
    expect(parseAgentCommand('cursor-agent')).toBe('cursor');
    expect(parseAgentCommand('cursor')).toBe('cursor');
    expect(parseAgentCommand('agent')).toBe('cursor');
    expect(parseAgentCommand('agent --dangerously-skip-permissions')).toBe('cursor');
  });

  it('strips shell wrappers before matching', () => {
    expect(parseAgentCommand('sudo claude')).toBe('claude');
    expect(parseAgentCommand('npx opencode')).toBe('opencode');
    expect(parseAgentCommand('nohup claude &')).toBe('claude');
    expect(parseAgentCommand('env TERM=xterm codex')).toBe('codex');
    expect(parseAgentCommand('npm exec claude')).toBe('claude');
    expect(parseAgentCommand('pnpm dlx opencode')).toBe('opencode');
  });

  it('rejects ordinary commands and false-positive names', () => {
    expect(parseAgentCommand('git status')).toBeNull();
    expect(parseAgentCommand('grep claude file.txt')).toBeNull();
    expect(parseAgentCommand('vim claude.md')).toBeNull();
    expect(parseAgentCommand('docker agent')).toBeNull();
    expect(parseAgentCommand('')).toBeNull();
    expect(parseAgentCommand('   ')).toBeNull();
  });

  it('never matches editor launchers — only CLI coding agents', () => {
    expect(parseAgentCommand('zed')).toBeNull();
    expect(parseAgentCommand('windsurf')).toBeNull();
    expect(parseAgentCommand('trae')).toBeNull();
    expect(matchAgentTitle('zed')).toBeNull();
    expect(matchAgentTitle('windsurf')).toBeNull();
    expect(matchAgentTitle('trae')).toBeNull();
  });
});

describe('matchAgentTitle', () => {
  it('matches titles that start with an agent command', () => {
    expect(matchAgentTitle('claude')).toBe('claude');
    expect(matchAgentTitle('claude -p "x"')).toBe('claude');
    expect(matchAgentTitle('Claude Code')).toBe('claude');
    expect(matchAgentTitle('codex exec --full-auto')).toBe('codex');
    expect(matchAgentTitle('cursor agent')).toBe('cursor');
    expect(matchAgentTitle('agent')).toBe('cursor');
    expect(matchAgentTitle('cursor-agent')).toBe('cursor');
  });

  it('strips spinner/decoration prefixes agent TUIs prepend on every redraw', () => {
    expect(matchAgentTitle('⠂ Claude Code')).toBe('claude');
    expect(matchAgentTitle('⠐ Claude Code')).toBe('claude');
    expect(matchAgentTitle('✳ Claude Code')).toBe('claude');
    expect(matchAgentTitle('◉ codex')).toBe('codex');
    expect(matchAgentTitle('\x1b[38;5;120m✳ Claude Code')).toBe('claude');
  });

  it('rejects titles that merely contain an agent name', () => {
    expect(matchAgentTitle('grep claude file.txt')).toBeNull();
    expect(matchAgentTitle('~/codex-project')).toBeNull();
    expect(matchAgentTitle('claude-projects')).toBeNull();
    expect(matchAgentTitle('vim')).toBeNull();
  });

  it('rejects empty and decoration-only titles', () => {
    expect(matchAgentTitle('')).toBeNull();
    expect(matchAgentTitle('  ')).toBeNull();
    expect(matchAgentTitle('⠂')).toBeNull();
  });

  it('every catalog agent command matches its own title', () => {
    for (const command of AGENT_COMMANDS) {
      expect(matchAgentTitle(command)).toBe(command);
    }
  });
});
