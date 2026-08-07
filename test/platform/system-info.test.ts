import { describe, it, expect, vi, afterEach } from 'vitest';

import {
  parsePmsetBattery,
  parseWmicBattery,
  parseNetstatCounters,
  parseProcNetDev,
  parseAdapterStats,
  parseIpconfigSsid,
  parseAirportNetwork,
  parseNmcliSsid,
  parseNetshSsid,
  SpeedMeter,
  CpuMeter,
  readRam,
  type NetCounters,
  type CpuTimes,
} from '../../src/platform/system-info';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('parsePmsetBattery', () => {
  it('reads level and charging from pmset output', () => {
    expect(parsePmsetBattery('100%; charged; 0:00 remaining present: true')).toEqual({
      level: 100,
      charging: true,
    });
  });

  it('marks discharging as not charging', () => {
    expect(parsePmsetBattery('87%; discharging; 4:14 remaining present: true')).toEqual({
      level: 87,
      charging: false,
    });
  });

  it('returns null when pmset has no battery line', () => {
    expect(parsePmsetBattery('No batteries attached.')).toBeNull();
  });
});

describe('parseWmicBattery', () => {
  it('reads level and charge status from wmic /value output', () => {
    const out = 'ChargeStatus=2\nEstimatedChargeRemaining=87\n';
    expect(parseWmicBattery(out)).toEqual({ level: 87, charging: true });
  });

  it('treats a discharging status as not charging', () => {
    const out = 'ChargeStatus=1\nEstimatedChargeRemaining=40\n';
    expect(parseWmicBattery(out)).toEqual({ level: 40, charging: false });
  });

  it('returns null without a level', () => {
    expect(parseWmicBattery('No Instance(s) Available.')).toBeNull();
  });
});

describe('parseNetstatCounters', () => {
  const output = [
    'Name  Mtu   Network       Address            Ipkts Ierrs     Ibytes    Opkts Oerrs     Obytes  Coll',
    'en0   1500  <Link#6>      a0:bc:c1:d2:e3:f4   100    0     512000      200    0    1024000     0',
    'en0   1500  192.168.1.5   192.168.1.5         100    0     512000      200    0    1024000     0',
  ].join('\n');

  it('takes the link-level byte counters for the default interface', () => {
    expect(parseNetstatCounters(output, 'en0')).toEqual({ rx: 512000, tx: 1024000 });
  });

  it('returns null when the interface is absent', () => {
    expect(parseNetstatCounters(output, 'en1')).toBeNull();
  });
});

describe('parseProcNetDev', () => {
  const output = [
    'Inter-|   Receive                                                |  Transmit',
    ' face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed',
    '    en0: 512000     100    0    0    0     0          0         0   1024000      50    0    0    0     0       0          0',
  ].join('\n');

  it('reads rx and tx bytes for the interface', () => {
    expect(parseProcNetDev(output, 'en0')).toEqual({ rx: 512000, tx: 1024000 });
  });

  it('returns null when the interface is absent', () => {
    expect(parseProcNetDev(output, 'eth1')).toBeNull();
  });
});

describe('parseAdapterStats', () => {
  it('reads the two summed counter lines', () => {
    expect(parseAdapterStats('512000\n1024000\n')).toEqual({ rx: 512000, tx: 1024000 });
  });

  it('returns null on non-numeric output', () => {
    expect(parseAdapterStats('No adapters found.')).toBeNull();
  });
});

describe('network name parsers', () => {
  it('extracts the SSID from ipconfig getsummary plist output', () => {
    const out =
      '<?xml version="1.0"?><plist><dict><key>SSID</key><string>HomeNet-5G</string></dict></plist>';
    expect(parseIpconfigSsid(out)).toBe('HomeNet-5G');
  });

  it('extracts the SSID from networksetup output', () => {
    expect(parseAirportNetwork('Current Wi-Fi Network: HomeNet-5G')).toBe('HomeNet-5G');
  });

  it('returns null when not associated with a network', () => {
    expect(parseAirportNetwork('You are not associated with an AirPort network.')).toBeNull();
  });

  it('extracts the active SSID from nmcli tab-separated output', () => {
    const out = ['yes:HomeNet-5G', 'no:NeighborNet'].join('\n');
    expect(parseNmcliSsid(out)).toBe('HomeNet-5G');
  });

  it('extracts the SSID from netsh wlan output', () => {
    const out = ['SSID                   : HomeNet-5G', 'Signal                 : 92%'].join('\n');
    expect(parseNetshSsid(out)).toBe('HomeNet-5G');
  });
});

describe('SpeedMeter', () => {
  const counters = (rx: number, tx: number): NetCounters => ({ rx, tx });

  it('returns null until a second sample exists', async () => {
    const meter = new SpeedMeter(async () => counters(0, 0));
    expect(await meter.sample()).toBeNull();
    expect(await meter.sample()).toEqual({ down: 0, up: 0 });
  });

  it('computes bytes per second from the counter delta', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    let current = counters(0, 0);
    const meter = new SpeedMeter(async () => current);
    await meter.sample();
    vi.setSystemTime(2000);
    current = counters(2000, 1000);
    expect(await meter.sample()).toEqual({ down: 1000, up: 500 });
    vi.useRealTimers();
  });

  it('never reports a negative rate after a counter reset', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    let current = counters(1000, 500);
    const meter = new SpeedMeter(async () => current);
    await meter.sample();
    vi.setSystemTime(1000);
    current = counters(100, 50);
    expect(await meter.sample()).toEqual({ down: 0, up: 0 });
    vi.useRealTimers();
  });
});

describe('CpuMeter', () => {
  const times = (total: number, idle: number): CpuTimes => ({ total, idle });

  it('returns null until a second sample exists', () => {
    const meter = new CpuMeter(() => times(100, 80));
    expect(meter.sample()).toBeNull();
    expect(meter.sample()).not.toBeNull();
  });

  it('computes usage from the idle share of the total delta', () => {
    let current = times(100, 80);
    const meter = new CpuMeter(() => current);
    meter.sample();
    current = times(200, 100);
    expect(meter.sample()).toBeCloseTo(80);
  });

  it('never reports a negative usage after a counter reset', () => {
    let current = times(1000, 800);
    const meter = new CpuMeter(() => current);
    meter.sample();
    current = times(100, 100);
    expect(meter.sample()).toBe(0);
  });

  it('clamps to 100 percent', () => {
    let current = times(100, 100);
    const meter = new CpuMeter(() => current);
    meter.sample();
    current = times(200, 100);
    expect(meter.sample()).toBe(100);
  });
});

describe('readRam', () => {
  it('computes used from total minus free', () => {
    (window as any).require = (mod: string) =>
      mod === 'os' ? { totalmem: () => 16 * 1024 ** 3, freemem: () => 4 * 1024 ** 3 } : undefined;
    expect(readRam()).toEqual({ used: 12 * 1024 ** 3, total: 16 * 1024 ** 3 });
  });

  it('returns null without window.require', () => {
    (window as any).require = undefined;
    expect(readRam()).toBeNull();
  });
});
