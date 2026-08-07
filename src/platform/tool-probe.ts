import { TOOL_CATALOG } from '../core/tool-catalog';
import type { EnvEntry } from '../core/env-entries';

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

/* bash may be absent on minimal distros; sh runs the same POSIX probe script */
function shellCommand(name: string, scriptPath: string): string {
  return name + ' -lic "' + scriptPath + '"';
}

let envCache: EnvEntry[] | null = null;
let envCacheAt = 0;

export function detectEnv(): Promise<EnvEntry[]> {
  const now = Date.now();
  if (envCache && now - envCacheAt < ENV_CACHE_TTL_MS) {
    return Promise.resolve(envCache);
  }
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || !window.require) {
      resolve([]);
      return;
    }
    const isWin = typeof process !== 'undefined' && process.platform === 'win32';
    if (isWin) {
      detectEnvWin(resolve);
      return;
    }
    // the renderer's PATH is minimal; run every probe inside the user's
    // login+interactive shell (sources .zprofile/.zshrc) via a temp script
    // file so nvm/homebrew/volta etc. are visible
    const cp: any = window.require('child_process');
    const os: any = window.require('os');
    const fs: any = window.require('fs');
    const path: any = window.require('path');
    // use a freshly-created, owner-only-permission temp dir (not a fixed,
    // predictable path) so another local user can't pre-plant a symlink or
    // read/tamper with the probe script; removed again once we're done
    let tmpDir: string;
    let scriptPath: string;
    try {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hyper-kit-inventory-'));
      scriptPath = path.join(tmpDir, 'env.sh');
      fs.writeFileSync(scriptPath, buildProbeScript(), { mode: 0o700 });
    } catch {
      resolve([]);
      return;
    }
    const cleanup = () => {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // best effort
      }
    };
    const shellName = detectShellName();
    const runProbe = (name: string) => {
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

function parseProbeOutput(stdout: string): EnvEntry[] {
  const results: EnvEntry[] = [];
  String(stdout || '')
    .split('\n')
    .forEach((line) => {
      const [command, first] = line.split('\t');
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
  try {
    const os: any = window.require('os');
    const fs: any = window.require('fs');
    const path: any = window.require('path');
    const nvmSh = path.join(os.homedir(), '.nvm', 'nvm.sh');
    if (!fs.existsSync(nvmSh)) {
      return null;
    }
    const content = fs.readFileSync(nvmSh, 'utf8');
    const m = content.match(/NVM_VERSION="?(\d+\.\d+\.\d+)/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
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
      (err: any, stdout: string) => {
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
