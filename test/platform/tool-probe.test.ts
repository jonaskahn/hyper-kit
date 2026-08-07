import { describe, it, expect, vi, afterEach } from 'vitest';

import { detectShellName, parseProbeOutput } from '../../src/platform/tool-probe';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('parseProbeOutput', () => {
  it('parses tab-separated command/version lines', () => {
    const rows = parseProbeOutput('node\tv24.18.0\ngit\tgit version 2.50.1\n');
    expect(rows).toEqual([
      ['Node', '24.18.0'],
      ['Git', '2.50.1'],
    ]);
  });

  it('strips PTY artifacts (EOF echo, backspaces, CRLF) from lines', () => {
    const rows = parseProbeOutput(
      '\u0004\u0008\u0008claude\t2.1.220 (Claude Code)\r\n^D\u0008\u0008codex\t0.147.0\r\n',
    );
    expect(rows).toEqual([
      ['Claude', '2.1.220'],
      ['Codex', '0.147.0'],
    ]);
  });

  it('drops lines without a version match', () => {
    const rows = parseProbeOutput('noise line\nnode\tv24.18.0\n');
    expect(rows).toEqual([['Node', '24.18.0']]);
  });
});

describe('detectShellName', () => {
  it('prefers zsh from $SHELL', () => {
    vi.stubEnv('SHELL', '/bin/zsh');
    expect(detectShellName()).toBe('zsh');
  });

  it('prefers bash from $SHELL', () => {
    vi.stubEnv('SHELL', '/usr/bin/bash');
    expect(detectShellName()).toBe('bash');
  });

  it('maps plain sh to sh', () => {
    vi.stubEnv('SHELL', '/bin/sh');
    expect(detectShellName()).toBe('sh');
  });

  it('maps ash to sh for minimal distros', () => {
    vi.stubEnv('SHELL', '/bin/ash');
    expect(detectShellName()).toBe('sh');
  });

  it('falls back to the platform default for unknown shells', () => {
    vi.stubEnv('SHELL', '/usr/bin/fish');
    const platform = process.platform;
    if (platform === 'darwin') {
      expect(detectShellName()).toBe('zsh');
    } else {
      expect(detectShellName()).toBe('bash');
    }
  });

  it('defaults to bash on linux even when SHELL is unset', () => {
    vi.stubEnv('SHELL', '');
    if (process.platform === 'linux') {
      expect(detectShellName()).toBe('bash');
    } else {
      expect(detectShellName()).toBe('zsh');
    }
  });
});
