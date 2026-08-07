import { describe, it, expect } from 'vitest';

import {
  parsePactlVolume,
  parseAmixerVolume,
  parseWinmmVolume,
  macVolumeReadCommand,
  macVolumeSetCommand,
  winmmVolumeReadScript,
  winmmVolumeSetScript,
  fetchSystemVolume,
  setSystemVolume,
  getLinuxVolumeTool,
} from '../../src/platform/system-volume';

describe('parsePactlVolume', () => {
  it('extracts the percent from a sink volume line', () => {
    expect(
      parsePactlVolume('Volume: front-left: 32768 /  50% / -18.06 dB,  front-right: 32768 /  50%'),
    ).toBe(50);
  });

  it('returns null for n/a or empty output', () => {
    expect(parsePactlVolume('Volume: n/a (sink)')).toBeNull();
    expect(parsePactlVolume(null)).toBeNull();
    expect(parsePactlVolume('')).toBeNull();
  });
});

describe('parseAmixerVolume', () => {
  it('extracts the percent from a Master control line', () => {
    expect(parseAmixerVolume('  Front Left: Playback 32768 [45%] [on]')).toBe(45);
  });

  it('returns null when no percent is present', () => {
    expect(parseAmixerVolume('amixer: Mixer attach default error')).toBeNull();
    expect(parseAmixerVolume(null)).toBeNull();
  });
});

describe('parseWinmmVolume', () => {
  it('parses the VOL prefix line', () => {
    expect(parseWinmmVolume('VOL:57\n')).toBe(57);
    expect(parseWinmmVolume('VOL:0')).toBe(0);
  });

  it('returns null for failures or missing output', () => {
    expect(parseWinmmVolume('VOL:-1')).toBeNull();
    expect(parseWinmmVolume(null)).toBeNull();
    expect(parseWinmmVolume('')).toBeNull();
  });
});

describe('mac volume commands', () => {
  it('builds the read and write osascript commands', () => {
    expect(macVolumeReadCommand()).toBe("osascript -e 'output volume of (get volume settings)'");
    expect(macVolumeSetCommand(45)).toBe("osascript -e 'set volume output volume 45'");
  });
});

describe('winmm volume scripts', () => {
  it('wraps winmm read and set in the shared PowerShell prefix', () => {
    const read = winmmVolumeReadScript();
    const set = winmmVolumeSetScript(45);
    expect(read).toContain('waveOutGetVolume');
    expect(read).toContain('Write-Output ("VOL:" + [KitVol]::Read())');
    expect(set).toContain('waveOutSetVolume');
    expect(set).toContain('[KitVol]::Write(45)');
    expect(set).not.toContain('Write-Output');
  });
});

describe('fetchSystemVolume / setSystemVolume', () => {
  it('resolve without throwing outside Electron', async () => {
    await expect(fetchSystemVolume()).resolves.toEqual({ volume: null });
    await expect(setSystemVolume(45)).resolves.toBeUndefined();
    expect(getLinuxVolumeTool()).toBeNull();
  });
});
