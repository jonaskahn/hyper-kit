import { describe, it, expect, vi, afterEach } from 'vitest';

import { detectShellName } from '../../src/platform/tool-probe';

afterEach(() => {
  vi.unstubAllEnvs();
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
