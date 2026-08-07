import { TOOL_CATALOG } from '../core/tool-catalog';
import type { EnvEntry } from '../core/env-entries';
import { hasNodeRuntime, readTextFileSync, withTempScriptFile } from './exec';
import { homeDir } from './home-dir';

const ENV_CACHE_TTL_MS = 60000;
const PROBE_TIMEOUT_MS = 15000;
const WIN_PROBE_TIMEOUT_MS = 2500;
const VERSION_PATTERN = /\d+\.\d+(?:\.\d+)?/;

/** zsh is the macOS default; on Linux prefer bash when zsh is absent, and
    sh as a last resort for minimal distros without bash (Alpine, ...). */
export function detectShellName(): string {
  const shell = (process.env.SHELL || '').toLowerCase();
  if (shell.endsWith('zsh')) {
    return 'zsh';
  }
  if (shell.endsWith('bash')) {
    return 'bash';
  }
  if (shell.endsWith('/sh') || shell.endsWith('ash')) {
    return 'sh';
  }
  // fish, tcsh, ... : fall back to the platform default
  return process.platform === 'darwin' ? 'zsh' : 'bash';
}

/* bash may be absent on minimal distros; sh runs the same POSIX probe script.
   The login+interactive shell (needed to load .zshrc/.bashrc PATH setup) is
   run under `script`, which provides a PTY: without a terminal, `-i` can
   block forever on rc files that prompt or expect a tty. stdin is /dev/null
   so any `read` in the rc returns EOF immediately. Where `script` is missing
   (minimal distros), fall back to a plain login shell. */
function shellCommand(name: string, scriptPath: string): string {
  return (
    'command -v script >/dev/null 2>&1 && ' +
    'script -q /dev/null ' +
    name +
    ' -lic "' +
    scriptPath +
    '" </dev/null || ' +
    name +
    ' -lc "' +
    scriptPath +
    '"'
  );
}

let envCache: EnvEntry[] | null = null;
let envCacheAt = 0;

export function detectEnv(): Promise<EnvEntry[]> {
  const now = Date.now();
  if (envCache && now - envCacheAt < ENV_CACHE_TTL_MS) {
    return Promise.resolve(envCache);
  }
  return new Promise((resolve) => {
    if (!hasNodeRuntime()) {
      resolve([]);
      return;
    }
    if (typeof process !== 'undefined' && process.platform === 'win32') {
      detectEnvWin(resolve);
      return;
    }
    // the renderer's PATH is minimal; run every probe inside the user's
    // login+interactive shell (sources .zprofile/.zshrc) via a temp script
    // file so nvm/homebrew/volta etc. are visible
    const cp: any = window.require('child_process');
    const shellName = detectShellName();
    const started = withTempScriptFile(
      'hyper-kit-inventory-',
      'env.sh',
      buildProbeScript(),
      (scriptPath, cleanup) => {
        const runProbe = (name: string): void => {
          cp.exec(
            shellCommand(name, scriptPath),
            { timeout: PROBE_TIMEOUT_MS },
            (err: any, stdout: string) => {
              // the detected shell (e.g. bash) is missing on minimal distros:
              // sh is POSIX-compatible with the same probe script
              if (err && err.code === 'ENOENT' && name !== 'sh') {
                runProbe('sh');
                return;
              }
              cleanup();
              const results = parseProbeOutput(stdout);
              const nvmVersion = readNvmVersion();
              if (nvmVersion && !results.some(([name]) => name === 'Nvm')) {
                results.push(['Nvm', nvmVersion]);
              }
              finishDetection(resolve, results);
            },
          );
        };
        runProbe(shellName);
      },
    );
    if (!started) {
      resolve([]);
    }
  });
}

/* one probe per tool with its own version flag; stderr is merged so tools
   that print their version to stderr (kotlinc, ...) still match */
function buildProbeScript(): string {
  return (
    TOOL_CATALOG.map((tool) => {
      const flag = tool.versionFlag || '--version';
      return (
        'v=\n' +
        'command -v "' +
        tool.command +
        '" >/dev/null 2>&1 && ' +
        'v=$("' +
        tool.command +
        '" ' +
        flag +
        ' 2>&1 | head -n 1);\n' +
        '[ -n "$v" ] && printf "%s\\t%s\\n" "' +
        tool.command +
        '" "$v";'
      );
    }).join('\n') + '\nexit 0\n'
  );
}

export function parseProbeOutput(stdout: string): EnvEntry[] {
  const results: EnvEntry[] = [];
  String(stdout || '')
    .split('\n')
    .forEach((line) => {
      /* the PTY (`script`) echoes its stdin-EOF as literal caret notation
         ("^D" + backspaces) and writes CRLF; strip both raw control bytes
         and caret-notation sequences so they never corrupt tool names
         (tab, the field separator, and newline must be kept) */
      const clean = line.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '').replace(/\^[A-Z@\[\]\\^_?]/g, '');
      const [command, first] = clean.split('\t');
      const version = (first || '').match(VERSION_PATTERN);
      if (command && version) {
        const tool = TOOL_CATALOG.find((entry) => entry.command === command);
        results.push([tool ? tool.name : command, version[0]]);
      }
    });
  return results;
}

/* nvm is a shell function; only detectable via its file */
function readNvmVersion(): string | null {
  if (!hasNodeRuntime()) {
    return null;
  }
  const nvmSh = window.require('path').join(homeDir(), '.nvm', 'nvm.sh');
  const m = String(readTextFileSync(nvmSh) ?? '').match(/NVM_VERSION="?(\d+\.\d+\.\d+)/);
  return m ? m[1] : null;
}

function finishDetection(resolve: (r: EnvEntry[]) => void, results: EnvEntry[]): void {
  results.sort((a, b) => a[0].localeCompare(b[0]));
  envCache = results;
  envCacheAt = Date.now();
  resolve(results);
}

function detectEnvWin(resolve: (r: EnvEntry[]) => void): void {
  const results: EnvEntry[] = [];
  let remaining = TOOL_CATALOG.length;
  const cp: any = window.require('child_process');
  for (const tool of TOOL_CATALOG) {
    const realCommand = tool.command === 'python3' ? 'python' : tool.command;
    cp.exec(
      realCommand + ' ' + (tool.versionFlag || '--version'),
      { timeout: WIN_PROBE_TIMEOUT_MS },
      (_err: any, stdout: string) => {
        const line = String(stdout || '')
          .split('\n')[0]
          .trim();
        const version = line.match(VERSION_PATTERN);
        if (version) {
          results.push([tool.name, version[0]]);
        }
        remaining -= 1;
        if (remaining === 0) {
          finishDetection(resolve, results);
        }
      },
    );
  }
}

export function resetEnvCache(): void {
  envCache = null;
  envCacheAt = 0;
}
