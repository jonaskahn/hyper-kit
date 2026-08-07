/* Node core-module access from Hyper's Electron renderer (window.require)
   for the probes that shell out to the OS. Every helper is best-effort:
   any failure resolves to null / returns false so callers degrade gracefully
   outside Electron (tests, exotic hosts). */

export function hasNodeRuntime(): boolean {
  return typeof window !== 'undefined' && !!window.require;
}

/* Reads a text file through the renderer's node runtime; null when the
   runtime is missing or the read fails (file absent, permissions, ...). */
export function readTextFileSync(path: string): string | null {
  if (!hasNodeRuntime()) {
    return null;
  }
  try {
    const fs: any = window.require('fs');
    return String(fs.readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

export interface ExecOptions {
  trim?: boolean;
  onError?: (message: string) => void;
}

export function execToString(
  command: string,
  timeoutMs: number,
  options?: ExecOptions,
): Promise<string | null> {
  return new Promise((resolve) => {
    if (!hasNodeRuntime()) {
      resolve(null);
      return;
    }
    const cp: any = window.require('child_process');
    cp.exec(command, { timeout: timeoutMs }, (err: any, stdout: string, stderr: string) => {
      if (err) {
        options?.onError?.(err && err.message + ' | ' + String(stderr || '').slice(0, 200));
        resolve(null);
        return;
      }
      const out = String(stdout || '');
      resolve(options?.trim ? out.trim() : out);
    });
  });
}

/* Writes `script` into a freshly-created, owner-only-permission temp dir (not
   a fixed, predictable path) so another local user can't pre-plant a symlink
   or read/tamper with it, then hands the path — plus a cleanup callback — to
   `use`. Returns false when the temp file couldn't be prepared (no runtime,
   fs error), in which case `use` is never called. */
export function withTempScriptFile(
  prefix: string,
  fileName: string,
  script: string,
  use: (scriptPath: string, cleanup: () => void) => void,
): boolean {
  if (!hasNodeRuntime()) {
    return false;
  }
  const os: any = window.require('os');
  const fs: any = window.require('fs');
  const path: any = window.require('path');
  let tmpDir: string;
  let scriptPath: string;
  try {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    scriptPath = path.join(tmpDir, fileName);
    fs.writeFileSync(scriptPath, script, { mode: 0o700 });
  } catch {
    return false;
  }
  use(scriptPath, () => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // cleanup is best-effort
    }
  });
  return true;
}

/* Runs a script file (osascript / powershell) via a fresh temp dir and
   resolves its stdout; mirrors withTempScriptFile's quoting-safety intent. */
export function runScriptFile(
  prefix: string,
  fileName: string,
  script: string,
  commandLine: (scriptPath: string) => string,
  timeoutMs: number,
  onError?: (message: string) => void,
): Promise<string | null> {
  return new Promise((resolve) => {
    const started = withTempScriptFile(prefix, fileName, script, (scriptPath, cleanup) => {
      void execToString(commandLine(scriptPath), timeoutMs, { onError }).then((result) => {
        cleanup();
        resolve(result);
      });
    });
    if (!started) {
      resolve(null);
    }
  });
}
