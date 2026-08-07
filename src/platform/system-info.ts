/* One host capability: probing network + battery state via child_process
   (or sysfs), the same boundary tool-probe.ts owns for toolchain detection.
   Every probe is best-effort: any failure resolves to null so the bottom
   panel can render a placeholder instead of crashing. Parsers are exported
   so the shell-output contracts stay unit-testable. */

import { execToString, hasNodeRuntime, readTextFileSync } from './exec';

export interface NetCounters {
  rx: number;
  tx: number;
}

interface SpeedSample {
  down: number;
  up: number;
}

export interface BatteryInfo {
  level: number;
  charging: boolean;
}

interface RamInfo {
  used: number;
  total: number;
}

export interface CpuTimes {
  total: number;
  idle: number;
}

function trimmedExec(command: string, timeoutMs: number): Promise<string | null> {
  return execToString(command, timeoutMs, { trim: true });
}

function defaultInterface(): Promise<string | null> {
  if (process.platform === 'win32') {
    return Promise.resolve(null);
  }
  const command =
    process.platform === 'darwin'
      ? "route -n get default | awk '/interface:/{print $2}'"
      : "ip -o route show default | awk '/default/{print $5; exit}'";
  return trimmedExec(command, 2000);
}

function procDefaultInterface(): string | null {
  const content = String(readTextFileSync('/proc/net/route') ?? '');
  for (const line of content.split('\n').slice(1)) {
    const fields = line.trim().split(/\s+/);
    if (fields[0] && fields[1] === '00000000') {
      return fields[0];
    }
  }
  return null;
}

/* --- network name ------------------------------------------------------ */

export function parseIpconfigSsid(output: string | null): string | null {
  const match = String(output || '').match(/<key>SSID<\/key>\s*<string>(.*?)<\/string>/);
  return match ? match[1] : null;
}

export function parseAirportNetwork(output: string | null): string | null {
  const match = String(output || '').match(/Current Wi-Fi Network: (.+)/);
  return match ? match[1] : null;
}

export function parseNmcliSsid(output: string | null): string | null {
  const match = String(output || '').match(/^yes:(.+)$/m);
  return match ? match[1] : null;
}

export function parseNetshSsid(output: string | null): string | null {
  const match = String(output || '').match(/^\s*SSID\s*:\s*(.+)$/m);
  return match ? match[1] : null;
}

export async function detectNetworkName(): Promise<string | null> {
  if (process.platform === 'darwin') {
    const iface = await defaultInterface();
    if (!iface) {
      return null;
    }
    const summary = parseIpconfigSsid(await trimmedExec('ipconfig getsummary ' + iface, 2000));
    if (summary) {
      return summary;
    }
    return parseAirportNetwork(await trimmedExec('networksetup -getairportnetwork ' + iface, 2000));
  }
  if (process.platform === 'linux') {
    const nmcli = parseNmcliSsid(await trimmedExec('nmcli -t -f ACTIVE,SSID dev wifi', 3000));
    if (nmcli) {
      return nmcli;
    }
    return trimmedExec('iwgetid -r', 2000);
  }
  if (process.platform === 'win32') {
    return parseNetshSsid(await trimmedExec('netsh wlan show interfaces', 3000));
  }
  return null;
}

/* --- network throughput (cumulative byte counters, sampled twice) ------- */

export function parseNetstatCounters(output: string | null, iface: string): NetCounters | null {
  let rx = 0;
  let tx = 0;
  String(output || '')
    .split('\n')
    .forEach((line) => {
      const fields = line.trim().split(/\s+/);
      if (fields[0] === iface && fields[2] && fields[2].indexOf('<Link') === 0) {
        rx = Math.max(rx, parseInt(fields[6], 10) || 0);
        tx = Math.max(tx, parseInt(fields[9], 10) || 0);
      }
    });
  return rx + tx > 0 ? { rx, tx } : null;
}

export function parseProcNetDev(output: string | null, iface: string): NetCounters | null {
  const line = String(output || '')
    .split('\n')
    .find((entry) => entry.trim().indexOf(iface + ':') === 0);
  if (!line) {
    return null;
  }
  const fields = line.split(':')[1].trim().split(/\s+/);
  const rx = parseInt(fields[0], 10);
  const tx = parseInt(fields[8], 10);
  return isNaN(rx) || isNaN(tx) ? null : { rx, tx };
}

export function parseAdapterStats(output: string | null): NetCounters | null {
  const values = String(output || '')
    .split('\n')
    .map((line) => parseInt(line.trim(), 10));
  if (values.length < 2 || isNaN(values[0]) || isNaN(values[1])) {
    return null;
  }
  return { rx: values[0], tx: values[1] };
}

async function readNetCounters(): Promise<NetCounters | null> {
  if (process.platform === 'darwin') {
    const iface = await defaultInterface();
    if (!iface) {
      return null;
    }
    return parseNetstatCounters(await trimmedExec('netstat -ib -I ' + iface, 2000), iface);
  }
  if (process.platform === 'linux') {
    const iface = procDefaultInterface() || (await defaultInterface());
    if (!iface) {
      return null;
    }
    return parseProcNetDev(await trimmedExec('cat /proc/net/dev', 2000), iface);
  }
  if (process.platform === 'win32') {
    const command =
      'powershell -NoProfile -Command ' +
      '"$s = Get-NetAdapterStatistics; ' +
      '(($s | Measure-Object -Property ReceivedBytes -Sum).Sum); ' +
      '(($s | Measure-Object -Property SentBytes -Sum).Sum)"';
    return parseAdapterStats(await trimmedExec(command, 5000));
  }
  return null;
}

export class SpeedMeter {
  private previous: NetCounters | null = null;
  private previousAt = 0;

  constructor(private readCounters: () => Promise<NetCounters | null> = readNetCounters) {}

  async sample(): Promise<SpeedSample | null> {
    const now = Date.now();
    const current = await this.readCounters();
    if (!current || !this.previous) {
      this.previous = current;
      this.previousAt = now;
      return null;
    }
    // two probes can land on the same tick; a 0-length window makes the
    // rate NaN, so clamp it to a token millisecond
    const elapsed = Math.max((now - this.previousAt) / 1000, 1e-3);
    const sample = {
      down: Math.max(0, (current.rx - this.previous.rx) / elapsed),
      up: Math.max(0, (current.tx - this.previous.tx) / elapsed),
    };
    this.previous = current;
    this.previousAt = now;
    return sample;
  }
}

/* --- battery ------------------------------------------------------------ */

export function parsePmsetBattery(output: string | null): BatteryInfo | null {
  const match = String(output || '').match(
    /(\d+)%;\s*(charged|charging|discharging|finishing charge)/,
  );
  if (!match) {
    return null;
  }
  return { level: parseInt(match[1], 10), charging: match[2] !== 'discharging' };
}

export function parseWmicBattery(output: string | null): BatteryInfo | null {
  const levelMatch = String(output || '').match(/EstimatedChargeRemaining=(\d+)/);
  const statusMatch = String(output || '').match(/ChargeStatus=(\d+)/);
  const level = levelMatch ? parseInt(levelMatch[1], 10) : NaN;
  if (isNaN(level)) {
    return null;
  }
  const status = statusMatch ? parseInt(statusMatch[1], 10) : NaN;
  return { level, charging: status === 2 };
}

function readLinuxBattery(): BatteryInfo | null {
  try {
    const fs: any = window.require('fs');
    const path: any = window.require('path');
    const supplyDir = '/sys/class/power_supply';
    const batteryName = fs.readdirSync(supplyDir).find((name: string) => name.indexOf('BAT') === 0);
    if (!batteryName) {
      return null;
    }
    const batteryDir = path.join(supplyDir, batteryName);
    const level = parseInt(String(readTextFileSync(path.join(batteryDir, 'capacity'))), 10);
    const status = String(readTextFileSync(path.join(batteryDir, 'status')) || '').trim();
    return { level, charging: status === 'Charging' || status === 'Full' };
  } catch {
    // no battery sysfs entry (desktop, VM, ...); the panel falls back to '—'
    return null;
  }
}

export async function detectBattery(): Promise<BatteryInfo | null> {
  if (process.platform === 'darwin') {
    return parsePmsetBattery(await trimmedExec('pmset -g batt', 2000));
  }
  if (process.platform === 'linux') {
    return readLinuxBattery();
  }
  if (process.platform === 'win32') {
    return parseWmicBattery(
      await trimmedExec(
        'wmic path Win32_Battery get EstimatedChargeRemaining,ChargeStatus /value',
        3000,
      ),
    );
  }
  return null;
}

/* --- CPU + RAM (Node os module, no shell needed) ------------------------ */

export function readRam(): RamInfo | null {
  try {
    if (!hasNodeRuntime()) {
      return null;
    }
    const os: any = window.require('os');
    const total = os.totalmem();
    return { used: total - os.freemem(), total };
  } catch {
    // os module is unavailable outside Electron; the panel falls back to '—'
    return null;
  }
}

function readCpuTimes(): CpuTimes | null {
  try {
    if (!hasNodeRuntime()) {
      return null;
    }
    const os: any = window.require('os');
    let total = 0;
    let idle = 0;
    for (const core of os.cpus()) {
      const times = core.times;
      total += times.user + times.nice + times.sys + times.idle + times.irq;
      idle += times.idle;
    }
    return { total, idle };
  } catch {
    // os.cpus() may be unavailable in a sandboxed renderer; the panel falls back to '—'
    return null;
  }
}

export class CpuMeter {
  private previous: CpuTimes | null = null;

  constructor(private readTimes: () => CpuTimes | null = readCpuTimes) {}

  sample(): number | null {
    const current = this.readTimes();
    if (!current || !this.previous) {
      this.previous = current;
      return null;
    }
    const totalDelta = Math.max(current.total - this.previous.total, 0);
    const idleDelta = Math.max(current.idle - this.previous.idle, 0);
    this.previous = current;
    if (totalDelta <= 0) {
      return 0;
    }
    return Math.min(100, Math.max(0, 100 - (100 * idleDelta) / totalDelta));
  }
}
