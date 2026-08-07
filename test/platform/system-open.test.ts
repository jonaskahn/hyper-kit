import { describe, it, expect, afterEach, vi } from 'vitest';

import { openInFileManager, openNewHyperWindow } from '../../src/platform/system-open';

afterEach(() => {
  delete (window as any).require;
  vi.restoreAllMocks();
});

function stubPlatform(value: NodeJS.Platform): () => void {
  const original = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value, configurable: true });
  return () => {
    if (original) {
      Object.defineProperty(process, 'platform', original);
    }
  };
}

function stubChildProcess(): ReturnType<typeof vi.fn> {
  const execFile = vi.fn();
  (window as any).require = (mod: string) => (mod === 'child_process' ? { execFile } : undefined);
  return execFile;
}

describe('openInFileManager', () => {
  it('opens Finder on darwin', () => {
    const restorePlatform = stubPlatform('darwin');
    const execFile = stubChildProcess();
    try {
      openInFileManager('/tmp/a');
      expect(execFile).toHaveBeenCalledWith('open', ['/tmp/a'], expect.any(Function));
    } finally {
      restorePlatform();
    }
  });

  it('opens Explorer on win32', () => {
    const restorePlatform = stubPlatform('win32');
    const execFile = stubChildProcess();
    try {
      openInFileManager('C:\\tmp\\a');
      expect(execFile).toHaveBeenCalledWith('explorer', ['C:\\tmp\\a'], expect.any(Function));
    } finally {
      restorePlatform();
    }
  });

  it('does nothing on linux', () => {
    const restorePlatform = stubPlatform('linux');
    const execFile = stubChildProcess();
    try {
      openInFileManager('/tmp/a');
      expect(execFile).not.toHaveBeenCalled();
    } finally {
      restorePlatform();
    }
  });

  it('does nothing without a node runtime', () => {
    const restorePlatform = stubPlatform('darwin');
    try {
      expect(() => openInFileManager('/tmp/a')).not.toThrow();
    } finally {
      restorePlatform();
    }
  });
});

describe('openNewHyperWindow', () => {
  it('spawns the hyper CLI with the path', () => {
    const execFile = stubChildProcess();
    openNewHyperWindow('/tmp/a');
    expect(execFile).toHaveBeenCalledWith('hyper', ['/tmp/a'], expect.any(Function));
  });

  it('does nothing without a node runtime', () => {
    expect(() => openNewHyperWindow('/tmp/a')).not.toThrow();
  });
});
