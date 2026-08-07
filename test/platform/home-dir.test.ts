import { describe, it, expect, vi, afterEach } from 'vitest';

import { homeDir } from '../../src/platform/home-dir';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('homeDir', () => {
  it('prefers HOME', () => {
    vi.stubEnv('HOME', '/home/jonas');
    vi.stubEnv('USERPROFILE', 'C:\\Users\\jonas');
    expect(homeDir()).toBe('/home/jonas');
  });

  it('falls back to USERPROFILE on Windows', () => {
    vi.stubEnv('HOME', '');
    vi.stubEnv('USERPROFILE', 'C:\\Users\\jonas');
    expect(homeDir()).toBe('C:\\Users\\jonas');
  });

  it('returns an empty string when no home is available', () => {
    vi.stubEnv('HOME', '');
    vi.stubEnv('USERPROFILE', '');
    expect(homeDir()).toBe('');
  });
});
