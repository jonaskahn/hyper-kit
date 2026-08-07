import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  execToString,
  hasNodeRuntime,
  readTextFileSync,
  runScriptFile,
  withTempScriptFile,
} from '../../src/platform/exec';

afterEach(() => {
  delete (window as any).require;
});

function stubRuntime(cp: any): void {
  (window as any).require = (mod: string) => {
    if (mod === 'child_process') {
      return cp;
    }
    if (mod === 'fs') {
      return fs;
    }
    if (mod === 'os') {
      return os;
    }
    if (mod === 'path') {
      return path;
    }
    return undefined;
  };
}

describe('hasNodeRuntime', () => {
  it('is false without window.require', () => {
    expect(hasNodeRuntime()).toBe(false);
  });

  it('is true when window.require exists', () => {
    (window as any).require = () => undefined;
    expect(hasNodeRuntime()).toBe(true);
  });
});

describe('execToString', () => {
  it('resolves null without a node runtime', async () => {
    expect(await execToString('echo hi', 1000)).toBeNull();
  });

  it('resolves stdout as-is, or trimmed on request', async () => {
    stubRuntime({ exec: (_cmd: string, _opts: any, cb: any) => cb(null, '  out\n', '') });
    expect(await execToString('cmd', 1000)).toBe('  out\n');
    expect(await execToString('cmd', 1000, { trim: true })).toBe('out');
  });

  it('reports the error message with stderr, truncated to 200 chars', async () => {
    stubRuntime({
      exec: (_cmd: string, _opts: any, cb: any) => cb(new Error('boom'), '', 'x'.repeat(300)),
    });
    const seen: string[] = [];
    const result = await execToString('cmd', 1000, { onError: (m) => seen.push(m) });
    expect(result).toBeNull();
    expect(seen).toEqual(['boom | ' + 'x'.repeat(200)]);
  });

  it('does not call onError on success', async () => {
    stubRuntime({ exec: (_cmd: string, _opts: any, cb: any) => cb(null, 'out', '') });
    const onError = (): void => {
      throw new Error('must not fire');
    };
    expect(await execToString('cmd', 1000, { onError })).toBe('out');
  });
});

describe('readTextFileSync', () => {
  it('returns the file contents', () => {
    stubRuntime({});
    const file = path.join(os.tmpdir(), 'hyper-kit-read-' + Date.now() + '.txt');
    fs.writeFileSync(file, 'hello');
    expect(readTextFileSync(file)).toBe('hello');
    fs.rmSync(file);
  });

  it('returns null for a missing file', () => {
    stubRuntime({});
    expect(readTextFileSync(path.join(os.tmpdir(), 'hyper-kit-missing-' + Date.now()))).toBeNull();
  });

  it('returns null without a node runtime', () => {
    expect(readTextFileSync('/does/not/matter')).toBeNull();
  });
});

describe('withTempScriptFile', () => {
  it('writes an owner-only script, hands it over, and cleans up', () => {
    stubRuntime({});
    let scriptPath = '';
    const started = withTempScriptFile('hyper-kit-test-', 'probe.sh', 'echo hi', (p, cleanup) => {
      scriptPath = p;
      expect(fs.existsSync(p)).toBe(true);
      expect(fs.statSync(p).mode & 0o777).toBe(0o700);
      expect(fs.readFileSync(p, 'utf8')).toBe('echo hi');
      cleanup();
      expect(fs.existsSync(p)).toBe(false);
    });
    expect(started).toBe(true);
    expect(path.dirname(scriptPath)).toContain('hyper-kit-test-');
  });

  it('never calls use and returns false without a node runtime', () => {
    let called = false;
    const started = withTempScriptFile('hyper-kit-test-', 'probe.sh', 'echo hi', () => {
      called = true;
    });
    expect(started).toBe(false);
    expect(called).toBe(false);
  });
});

describe('runScriptFile', () => {
  it('writes the script, runs it via commandLine, and resolves its output', async () => {
    stubRuntime({
      exec: (command: string, _opts: any, cb: any) => {
        const quoted = /"(.*)"/.exec(command);
        const content = quoted ? fs.readFileSync(quoted[1], 'utf8') : '';
        cb(null, content + '\n', '');
      },
    });
    const out = await runScriptFile(
      'hyper-kit-test-',
      'probe.sh',
      'echo ok',
      (p) => '"' + p + '"',
      5000,
    );
    expect(out).toBe('echo ok\n');
  });

  it('resolves null without a node runtime', async () => {
    expect(
      await runScriptFile('hyper-kit-test-', 'probe.sh', 'echo ok', (p) => p, 5000),
    ).toBeNull();
  });
});
