import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { listRoots, listSubdirectories } from '../../src/platform/dir-lister';

afterEach(() => {
  delete (window as any).require;
  vi.restoreAllMocks();
});

function stubRuntime(cp?: any): void {
  (window as any).require = (mod: string) => {
    if (mod === 'fs') {
      return fs;
    }
    if (mod === 'os') {
      return os;
    }
    if (mod === 'path') {
      return path;
    }
    if (mod === 'child_process') {
      return cp;
    }
    return undefined;
  };
}

function stubPlatform(value: NodeJS.Platform): () => void {
  const original = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value, configurable: true });
  return () => {
    if (original) {
      Object.defineProperty(process, 'platform', original);
    }
  };
}

function stubEnv(name: string, value: string | undefined): () => void {
  const original = process.env[name];
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
  return () => {
    if (original === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = original;
    }
  };
}

describe('listSubdirectories', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hyper-kit-dirlist-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('returns [] without a node runtime', () => {
    expect(listSubdirectories(dir)).toEqual({ entries: [], error: null });
  });

  it('lists only real subdirectories, sorted case-insensitively', () => {
    stubRuntime();
    fs.mkdirSync(path.join(dir, 'banana'));
    fs.mkdirSync(path.join(dir, 'Apple'));
    fs.writeFileSync(path.join(dir, 'a-file.txt'), 'x');
    const result = listSubdirectories(dir);
    expect(result.error).toBeNull();
    expect(result.entries.map((e) => e.name)).toEqual(['Apple', 'banana']);
    expect(result.entries[0].path).toBe(path.join(dir, 'Apple'));
  });

  it('omits dot-prefixed entries by default', () => {
    stubRuntime();
    fs.mkdirSync(path.join(dir, 'visible'));
    fs.mkdirSync(path.join(dir, '.hidden'));
    fs.writeFileSync(path.join(dir, '.hidden-file'), 'x');
    const result = listSubdirectories(dir);
    expect(result.entries.map((e) => e.name)).toEqual(['visible']);
  });

  it('includes dot-prefixed entries when showHidden is true', () => {
    stubRuntime();
    fs.mkdirSync(path.join(dir, 'visible'));
    fs.mkdirSync(path.join(dir, '.hidden'));
    const result = listSubdirectories(dir, true);
    expect(result.entries.map((e) => e.name)).toEqual(['.hidden', 'visible']);
  });

  it.skipIf(process.platform === 'win32')('follows a symlink to a real directory', () => {
    stubRuntime();
    const target = path.join(dir, 'real');
    fs.mkdirSync(target);
    fs.symlinkSync(target, path.join(dir, 'link'));
    const result = listSubdirectories(dir);
    expect(result.entries.map((e) => e.name).sort()).toEqual(['link', 'real']);
  });

  it.skipIf(process.platform === 'win32')(
    'skips a broken symlink without failing the whole listing',
    () => {
      stubRuntime();
      fs.mkdirSync(path.join(dir, 'real'));
      fs.symlinkSync(path.join(dir, 'does-not-exist'), path.join(dir, 'broken'));
      const result = listSubdirectories(dir);
      expect(result.error).toBeNull();
      expect(result.entries.map((e) => e.name)).toEqual(['real']);
    },
  );

  it('classifies a missing directory as not-found', () => {
    stubRuntime();
    const result = listSubdirectories(path.join(dir, 'nope'));
    expect(result).toEqual({ entries: [], error: 'not-found' });
  });

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'classifies a permission-denied directory as denied',
    () => {
      stubRuntime();
      const locked = path.join(dir, 'locked');
      fs.mkdirSync(locked);
      fs.chmodSync(locked, 0);
      try {
        const result = listSubdirectories(locked);
        expect(result).toEqual({ entries: [], error: 'denied' });
      } finally {
        fs.chmodSync(locked, 0o700);
      }
    },
  );
});

describe('listRoots', () => {
  it.skipIf(process.platform === 'win32')('resolves to the filesystem root on posix', async () => {
    expect(await listRoots(true)).toEqual([{ name: '/', path: '/' }]);
  });

  it('parses PowerShell drive output on windows', async () => {
    const restorePlatform = stubPlatform('win32');
    stubRuntime({
      exec: (_cmd: string, _opts: any, cb: any) => cb(null, 'C:\\\r\nD:\\\r\n', ''),
    });
    try {
      expect(await listRoots(true)).toEqual([
        { name: 'C:\\', path: 'C:\\' },
        { name: 'D:\\', path: 'D:\\' },
      ]);
    } finally {
      restorePlatform();
    }
  });

  it('falls back to SystemDrive when PowerShell yields nothing', async () => {
    const restorePlatform = stubPlatform('win32');
    const restoreSystemDrive = stubEnv('SystemDrive', 'D:');
    stubRuntime({
      exec: (_cmd: string, _opts: any, cb: any) => cb(new Error('no powershell'), '', ''),
    });
    try {
      expect(await listRoots(true)).toEqual([{ name: 'D:\\', path: 'D:\\' }]);
    } finally {
      restoreSystemDrive();
      restorePlatform();
    }
  });

  it('keeps whole-disk behavior for listRoots(true) with a runtime', async () => {
    stubRuntime();
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    expect(await listRoots(true)).toEqual([{ name: '/', path: '/' }]);
  });
});

describe('listRoots curated roots', () => {
  it('darwin: Users and Volumes', async () => {
    const restorePlatform = stubPlatform('darwin');
    stubRuntime();
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    try {
      expect(await listRoots()).toEqual([
        { name: 'Users', path: '/Users' },
        { name: 'Volumes', path: '/Volumes' },
      ]);
    } finally {
      restorePlatform();
    }
  });

  it('darwin: drops roots that do not exist', async () => {
    const restorePlatform = stubPlatform('darwin');
    stubRuntime();
    vi.spyOn(fs, 'existsSync').mockImplementation((p: string) => p === '/Volumes');
    try {
      expect(await listRoots()).toEqual([{ name: 'Volumes', path: '/Volumes' }]);
    } finally {
      restorePlatform();
    }
  });

  it('linux: /home followed by the first of /media or /mnt that exists', async () => {
    const restorePlatform = stubPlatform('linux');
    stubRuntime();
    vi.spyOn(fs, 'existsSync').mockImplementation((p: string) => p === '/home' || p === '/mnt');
    try {
      expect(await listRoots()).toEqual([
        { name: 'home', path: '/home' },
        { name: 'mnt', path: '/mnt' },
      ]);
    } finally {
      restorePlatform();
    }
  });

  it('linux: prefers /media over /mnt when both exist', async () => {
    const restorePlatform = stubPlatform('linux');
    stubRuntime();
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    try {
      expect(await listRoots()).toEqual([
        { name: 'home', path: '/home' },
        { name: 'media', path: '/media' },
      ]);
    } finally {
      restorePlatform();
    }
  });

  it('linux: omits the mount slot when neither /media nor /mnt exists', async () => {
    const restorePlatform = stubPlatform('linux');
    stubRuntime();
    vi.spyOn(fs, 'existsSync').mockImplementation((p: string) => p === '/home');
    try {
      expect(await listRoots()).toEqual([{ name: 'home', path: '/home' }]);
    } finally {
      restorePlatform();
    }
  });

  it('win32: prepends the existing home folder to the drive list', async () => {
    const restorePlatform = stubPlatform('win32');
    const restoreHome = stubEnv('HOME', 'C:\\Users\\tester');
    stubRuntime({
      exec: (_cmd: string, _opts: any, cb: any) => cb(null, 'C:\\\r\nD:\\\r\n', ''),
    });
    vi.spyOn(fs, 'existsSync').mockImplementation((p: string) => p === 'C:\\Users\\tester');
    try {
      expect(await listRoots()).toEqual([
        { name: 'tester', path: 'C:\\Users\\tester' },
        { name: 'C:\\', path: 'C:\\' },
        { name: 'D:\\', path: 'D:\\' },
      ]);
    } finally {
      restoreHome();
      restorePlatform();
    }
  });

  it('win32: skips the home folder when it does not exist', async () => {
    const restorePlatform = stubPlatform('win32');
    const restoreHome = stubEnv('HOME', 'C:\\Users\\tester');
    stubRuntime({
      exec: (_cmd: string, _opts: any, cb: any) => cb(null, 'C:\\\r\n', ''),
    });
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    try {
      expect(await listRoots()).toEqual([{ name: 'C:\\', path: 'C:\\' }]);
    } finally {
      restoreHome();
      restorePlatform();
    }
  });

  it('falls back to the posix root without a node runtime', async () => {
    const restorePlatform = stubPlatform('darwin');
    try {
      expect(await listRoots()).toEqual([{ name: '/', path: '/' }]);
    } finally {
      restorePlatform();
    }
  });
});
