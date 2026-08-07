/* Discovery of running opencode servers and their relation to Hyper tabs.
   The opencode TUI only exposes an HTTP API when started with --port /
   --hostname / --mdns (or server.mdns in its config); such instances bind
   127.0.0.1 on an arbitrary port (4096 first, then random), so candidates
   are gathered by scanning the OS listener table for opencode processes,
   then verified with GET /global/health. */

import { getNodeModule } from './node';
import { listPaneSessions, getTermGroups } from '../hyper-store';
import { cwdMap, agentMap, statusMap, titleMap } from '../state/tab-session-store';
import { matchAgentTitle } from '../../core/agent-detect';

function execList(cmd: string): Promise<string> {
  const cp = getNodeModule('child_process') as typeof import('node:child_process') | null;
  if (!cp) {
    return Promise.resolve('');
  }
  return new Promise((resolve) => {
    try {
      cp.exec(cmd, { timeout: 5000 }, (error, stdout) => {
        if (error) {
          resolve('');
          return;
        }
        resolve(String(stdout ?? ''));
      });
    } catch {
      resolve('');
    }
  });
}

/* Ports of every opencode process listening per `lsof -nP -iTCP` output
   (darwin), with the owning pid (needed to scope instances to Hyper). */
export function parseLsofOwners(output: string): { command: string; pid: number; port: number }[] {
  const owners: { command: string; pid: number; port: number }[] = [];
  for (const line of output.split('\n').slice(1)) {
    const match = line.match(
      /^(\S+)\s+(\S+)\s+\S+\s+\S+\s+\S+\s+\S+\s+\S+\s+TCP\s+(\S+):(\d+)\s+\(LISTEN\)/,
    );
    if (!match || !/opencode/i.test(match[1])) {
      continue;
    }
    const pid = Number.parseInt(match[2], 10);
    const port = Number.parseInt(match[4], 10);
    if (pid > 0) {
      owners.push({ command: match[1], pid, port });
    }
  }
  return owners;
}

export function parseLsofPorts(output: string): number[] {
  return parseLsofOwners(output).map((owner) => owner.port);
}

/* local opencode listener ports -> owning pid, per platform. The pid lets
   scope='hyper' decide whether an instance was started inside Hyper. */
export async function scanListenerOwners(): Promise<Map<number, number>> {
  const platform = typeof process !== 'undefined' ? process.platform : 'darwin';
  const owners = new Map<number, number>();
  try {
    if (platform === 'darwin') {
      const output = await execList('lsof -nP -iTCP -sTCP:LISTEN');
      for (const owner of parseLsofOwners(output)) {
        owners.set(owner.port, owner.pid);
      }
    } else if (platform === 'linux') {
      const output = await execList('ss -tlnp 2>/dev/null');
      for (const line of output.split('\n')) {
        if (!/opencode/i.test(line)) {
          continue;
        }
        const match = line.match(/LISTEN\s+\S+\s+\S+\s+\S+:(\d+)\s+.*pid=(\d+)/);
        if (match) {
          owners.set(Number.parseInt(match[1], 10), Number.parseInt(match[2], 10));
        }
      }
    } else if (platform === 'win32') {
      const [netstat, tasklist] = await Promise.all([
        execList('netstat -ano -p tcp'),
        execList('tasklist /fi "IMAGENAME eq opencode.exe" /fo csv /nh'),
      ]);
      const pids = new Set<string>();
      for (const line of tasklist.split('\n')) {
        const match = line.match(/^"opencode\.exe","(\d+)/i);
        if (match) {
          pids.add(match[1]);
        }
      }
      for (const line of netstat.split('\n')) {
        const match = line.match(/TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/);
        if (match && pids.has(match[2])) {
          owners.set(Number.parseInt(match[1], 10), Number.parseInt(match[2], 10));
        }
      }
    }
  } catch {
    // scan failures are non-fatal; configured ports are still probed
  }
  return owners;
}

export async function scanListenerPorts(): Promise<number[]> {
  return [...(await scanListenerOwners()).keys()];
}

/* --- Hyper ownership ------------------------------------------------------
   scope='hyper' admits only opencode instances whose process tree runs
   inside a Hyper window (opencode -> shell -> Hyper/Electron). Best-effort:
   anything that can't be resolved (missing tools, permission) is treated as
   not owned, so foreign instances are never shown. */

const HYPER_PROCESS_RE = /hyper|electron/i;
const MAX_ANCESTOR_HOPS = 8;

async function processName(pid: number): Promise<string> {
  const platform = typeof process !== 'undefined' ? process.platform : 'darwin';
  const cmd =
    platform === 'win32'
      ? `wmic process where processid=${pid} get name /value`
      : `ps -o comm= -p ${pid}`;
  return (await execList(cmd)).trim();
}

async function parentPid(pid: number): Promise<number | null> {
  const platform = typeof process !== 'undefined' ? process.platform : 'darwin';
  const cmd =
    platform === 'win32'
      ? `wmic process where processid=${pid} get parentprocessid /value`
      : `ps -o ppid= -p ${pid}`;
  const match = (await execList(cmd)).match(/(\d+)/);
  if (!match) {
    return null;
  }
  const parent = Number.parseInt(match[1], 10);
  return parent > 0 ? parent : null;
}

export async function isHyperOwned(pid: number): Promise<boolean> {
  let current = pid;
  for (let hop = 0; hop < MAX_ANCESTOR_HOPS; hop += 1) {
    if (HYPER_PROCESS_RE.test(await processName(current))) {
      return true;
    }
    const parent = await parentPid(current);
    if (!parent) {
      return false;
    }
    current = parent;
  }
  return false;
}

/* --- tab matching -------------------------------------------------------- */

/* Resolve symlinks so opencode's directory (usually realpath'd) compares
   fairly against the shell's $PWD / OSC 7 cwd. Falls back to the raw value. */
export function normalizePath(value: string): string {
  const fs = getNodeModule('fs') as typeof import('node:fs') | null;
  if (!fs) {
    return value;
  }
  try {
    return fs.realpathSync.native(value) || value;
  } catch {
    try {
      return fs.realpathSync(value) || value;
    } catch {
      return value;
    }
  }
}

/* Root (tab) group uid whose panes run in `directory`, or null. When several
   tabs share the directory, prefer the one actually running opencode. */
export function matchTabForDirectory(directory: string): string | null {
  const groups = getTermGroups();
  const normalized = normalizePath(directory);
  const candidates: { root: string; agent: boolean; running: boolean }[] = [];
  for (const uid in groups) {
    const group = groups[uid];
    if (!group || group.parentUid) {
      continue;
    }
    const sessions = listPaneSessions(uid);
    const inDir = sessions.filter((s) => normalizePath(cwdMap.get(s) ?? '') === normalized);
    if (inDir.length === 0) {
      continue;
    }
    const agent = inDir.some((s) => agentMap.get(s) === 'opencode');
    const running = inDir.some((s) => statusMap.get(s) === 'running');
    candidates.push({ root: uid, agent, running });
  }
  if (candidates.length === 0) {
    return null;
  }
  return (candidates.find((c) => c.agent) ?? candidates.find((c) => c.running) ?? candidates[0])
    .root;
}

/* Tab root uids currently running an agent. */
export function tabsRunningAgent(agent = 'opencode'): string[] {
  const groups = getTermGroups();
  const roots: string[] = [];
  for (const uid in groups) {
    const group = groups[uid];
    if (!group || group.parentUid) {
      continue;
    }
    if (
      listPaneSessions(uid).some((s) => agentMap.get(s) === agent && statusMap.get(s) === 'running')
    ) {
      roots.push(uid);
    }
  }
  return roots;
}

export function cwdOfTab(tabUid: string): string | null {
  const sessions = listPaneSessions(tabUid);
  for (const s of sessions) {
    const cwd = cwdMap.get(s);
    if (cwd) {
      return cwd;
    }
  }
  return null;
}

/* The coding agent running in the tab (agentMap value of one of its panes).
   Requests always come from an opencode server, so its pane wins when it is
   present; any other agent is a fallback label for the card footer. The
   opencode badge can briefly be cleared by title/prompt chatter, so a pane
   whose last OSC 0 title still names opencode counts as opencode evidence
   too -- titleMap outlives badge clears. */
export function agentOfTab(tabUid: string): string | null {
  const sessions = listPaneSessions(tabUid);
  const opencode = sessions.find(
    (s) => agentMap.get(s) === 'opencode' || matchAgentTitle(titleMap.get(s) ?? '') === 'opencode',
  );
  if (opencode) {
    return 'opencode';
  }
  for (const s of sessions) {
    const agent = agentMap.get(s);
    if (agent) {
      return agent;
    }
  }
  return null;
}

/* Human-readable label for a tab: the last OSC 0 window title any of its
   panes reported (opencode titles its window, so this names the session the
   card belongs to). Falls back to the tab's directory, then null. */
export function tabLabelOf(tabUid: string): string | null {
  const sessions = listPaneSessions(tabUid);
  for (const s of sessions) {
    const title = titleMap.get(s);
    if (title) {
      return title;
    }
  }
  return cwdOfTab(tabUid);
}
