/* One host capability: reading and setting the OS-wide output volume, per
   platform. Every call is best-effort (any failure resolves to a null
   volume / a silent no-op write) so the media panel's slider degrades
   gracefully. Parsers and script builders are exported so the shell-output
   contracts stay unit-testable. No per-app volume access anywhere: the
   slider is deliberately system-level on macOS (osascript), Windows
   (winmm) and Linux (pactl with an amixer fallback). */

import { execToString, hasNodeRuntime, runScriptFile } from './exec';

/* --- macOS: osascript on the default output device ---------------------- */

export function macVolumeReadCommand(): string {
  return "osascript -e 'output volume of (get volume settings)'";
}

export function macVolumeSetCommand(value: number): string {
  return "osascript -e 'set volume output volume " + value + "'";
}

/* --- Windows: winmm master volume via PowerShell ------------------------- */

const WINMM_SCRIPT = [
  "$ErrorActionPreference = 'SilentlyContinue'",
  "Add-Type -TypeDefinition @'",
  'using System;',
  'using System.Runtime.InteropServices;',
  'public static class KitVol {',
  '  [DllImport("winmm.dll")] public static extern int waveOutGetVolume(IntPtr hwo, out uint dwVolume);',
  '  [DllImport("winmm.dll")] public static extern int waveOutSetVolume(IntPtr hwo, uint dwVolume);',
  '  public static int Read() {',
  '    uint v;',
  '    if (waveOutGetVolume(IntPtr.Zero, out v) != 0) { return -1; }',
  '    return (int)Math.Round((((v & 0xFFFF) + ((v >> 16) & 0xFFFF)) / 2.0) * 100.0 / 65535.0);',
  '  }',
  '  public static int Write(int pct) {',
  '    double c = Math.Max(0, Math.Min(100, pct)) * 655.35;',
  '    uint v = (uint)Math.Round(c);',
  '    return waveOutSetVolume(IntPtr.Zero, v | (v << 16));',
  '  }',
  '}',
  "'@",
].join('\n');

export function winmmVolumeReadScript(): string {
  return WINMM_SCRIPT + '\nWrite-Output ("VOL:" + [KitVol]::Read())';
}

export function winmmVolumeSetScript(value: number): string {
  return WINMM_SCRIPT + '\n[KitVol]::Write(' + Math.round(value) + ')';
}

export function parseWinmmVolume(output: string | null): number | null {
  const m = /^VOL:(-?\d+)$/m.exec(String(output || ''));
  if (!m) {
    return null;
  }
  const n = parseInt(m[1], 10);
  return n < 0 ? null : n;
}

/* --- Linux: pactl (PulseAudio/PipeWire) with amixer fallback -------------- */

export function parsePactlVolume(output: string | null): number | null {
  const m = /(\d{1,3})%/.exec(String(output || ''));
  return m ? parseInt(m[1], 10) : null;
}

export function parseAmixerVolume(output: string | null): number | null {
  const m = /\[(\d{1,3})%\]/.exec(String(output || ''));
  return m ? parseInt(m[1], 10) : null;
}

/* remembers which tool actually worked so the writer uses the same one
   instead of double-applying pactl + amixer */
let linuxVolumeTool: 'pactl' | 'amixer' | null = null;

export function getLinuxVolumeTool(): 'pactl' | 'amixer' | null {
  return linuxVolumeTool;
}

/* --- public API ----------------------------------------------------------- */

export async function fetchSystemVolume(): Promise<{ volume: number | null }> {
  if (!hasNodeRuntime() || typeof process === 'undefined') {
    return { volume: null };
  }
  if (process.platform === 'darwin') {
    const out = await execToString(macVolumeReadCommand(), 3000);
    const volume = parseInt(String(out || '').trim(), 10);
    return { volume: isNaN(volume) ? null : volume };
  }
  if (process.platform === 'win32') {
    const out = await runScriptFile(
      'hyper-kit-volume-',
      'volume.ps1',
      winmmVolumeReadScript(),
      (scriptPath) => 'powershell -NoProfile -ExecutionPolicy Bypass -File "' + scriptPath + '"',
      8000,
    );
    return { volume: parseWinmmVolume(out) };
  }
  if (process.platform === 'linux') {
    const pactlOut = await execToString('pactl get-sink-volume @DEFAULT_SINK@', 3000);
    const pactlVolume = parsePactlVolume(pactlOut);
    if (pactlOut !== null && pactlVolume !== null) {
      linuxVolumeTool = 'pactl';
      return { volume: pactlVolume };
    }
    const amixerOut = await execToString('amixer sget Master', 3000);
    const amixerVolume = parseAmixerVolume(amixerOut);
    if (amixerOut !== null && amixerVolume !== null) {
      linuxVolumeTool = 'amixer';
    }
    return { volume: amixerVolume };
  }
  return { volume: null };
}

export async function setSystemVolume(value: number): Promise<void> {
  const target = Math.max(0, Math.min(100, Math.round(value)));
  if (!hasNodeRuntime() || typeof process === 'undefined') {
    return;
  }
  if (process.platform === 'darwin') {
    await execToString(macVolumeSetCommand(target), 3000);
    return;
  }
  if (process.platform === 'win32') {
    await runScriptFile(
      'hyper-kit-volume-',
      'volume.ps1',
      winmmVolumeSetScript(target),
      (scriptPath) => 'powershell -NoProfile -ExecutionPolicy Bypass -File "' + scriptPath + '"',
      8000,
    );
    return;
  }
  if (process.platform === 'linux') {
    const tool = linuxVolumeTool || 'pactl';
    if (tool === 'pactl') {
      await execToString('pactl set-sink-volume @DEFAULT_SINK@ ' + target + '%', 3000);
    } else {
      await execToString('amixer set Master ' + target + '%', 3000);
    }
  }
}
