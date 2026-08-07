/* One host capability: reading macOS's system-wide Now Playing session and
   sending transport commands via the private MediaRemote framework — the
   same source that powers Control Center's media widget and the media keys.
   Works for any app that registers a media session (Chrome, Safari,
   Firefox, VLC, ...) without touching the page: no AppleScript, no
   JavaScript injection, no "Allow JavaScript from Apple Events" toggle, and
   accurate paused state (a paused tab still shows as a source).

   The Swift helper is compiled once on first use into a cached temp binary
   and reused across polls; a missing toolchain degrades to null so callers
   fall back to the Spotify/Music AppleScript path. */

import type { MediaCommand } from './now-playing';
import { execToString, hasNodeRuntime } from './exec';

export interface RemoteSourceLine {
  app: string;
  title: string;
  artist: string;
  playing: boolean;
  artUrl: string | null;
}

/* swiftc needs -F to import the private framework; the probe emits one
   tab-separated line so the parser stays a single pure function */
export const MEDIA_REMOTE_SWIFT = [
  'import Foundation',
  'import MediaRemote',
  '',
  'let args = CommandLine.arguments',
  '',
  'func drain(_ sem: DispatchSemaphore, _ deadline: Date) -> Bool {',
  '    while sem.wait(timeout: .now()) != .success {',
  '        if Date() >= deadline { return false }',
  '        RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.05))',
  '    }',
  '    return true',
  '}',
  '',
  'if args.count > 2 && args[1] == "command" {',
  '    var cmd: MRMediaRemoteCommand',
  '    switch args[2] {',
  '    case "playPause": cmd = .playPause',
  '    case "next": cmd = .nextTrack',
  '    case "prev": cmd = .previousTrack',
  '    default: exit(0)',
  '    }',
  '    MRMediaRemoteSendCommand(cmd, nil)',
  '    exit(0)',
  '}',
  '',
  'var info: [String: Any]? = nil',
  'var isPlaying = false',
  'var appName: String? = nil',
  'let deadline = Date().addingTimeInterval(2)',
  '',
  'let sem1 = DispatchSemaphore(value: 0)',
  'MRMediaRemoteGetNowPlayingInfo(DispatchQueue.main) { result in',
  '    info = result',
  '    sem1.signal()',
  '}',
  'if !drain(sem1, deadline) { exit(0) }',
  '',
  'let sem2 = DispatchSemaphore(value: 0)',
  'MRMediaRemoteGetNowPlayingApplicationIsPlaying(DispatchQueue.main) { playing in',
  '    isPlaying = playing',
  '    sem2.signal()',
  '}',
  '_ = drain(sem2, deadline)',
  '',
  'let sem3 = DispatchSemaphore(value: 0)',
  'MRMediaRemoteGetNowPlayingApplicationDisplayName(DispatchQueue.main) { name in',
  '    appName = name',
  '    sem3.signal()',
  '}',
  '_ = drain(sem3, deadline)',
  '',
  'guard let dict = info,',
  '      let title = (dict[kMRMediaRemoteNowPlayingInfoTitle as String] as? String),',
  '      !title.isEmpty else { exit(0) }',
  '',
  'let artist = (dict[kMRMediaRemoteNowPlayingInfoArtist as String] as? String) ?? ""',
  'let rate = (dict[kMRMediaRemoteNowPlayingInfoPlaybackRate as String] as? NSNumber)?.doubleValue ?? 0',
  'let playing = isPlaying || rate > 0',
  'var artUrl = ""',
  'if let data = dict[kMRMediaRemoteNowPlayingInfoArtworkData as String] as? Data, data.count > 0 {',
  '    let path = "/tmp/hyper-kit-cover-remote.jpg"',
  '    try? data.write(to: URL(fileURLWithPath: path))',
  '    artUrl = "file://" + path',
  '}',
  'print((appName ?? "Unknown") + "\\t" + title + "\\t" + artist + "\\t" + (playing ? "true" : "false") + "\\t" + artUrl)',
].join('\n');

let helperPromise: Promise<string | null> | null = null;

/* compiles the Swift helper once and caches the binary in a stable temp dir
   so every poll after the first is a fast direct exec */
function ensureHelper(): Promise<string | null> {
  if (!helperPromise) {
    helperPromise = compileHelper();
  }
  return helperPromise;
}

async function compileHelper(): Promise<string | null> {
  if (!hasNodeRuntime() || typeof process === 'undefined' || process.platform !== 'darwin') {
    return null;
  }
  try {
    const os: any = window.require('os');
    const fs: any = window.require('fs');
    const path: any = window.require('path');
    const dir = path.join(os.tmpdir(), 'hyper-kit-media-remote');
    fs.mkdirSync(dir, { recursive: true });
    const bin = path.join(dir, 'media-remote.bin');
    if (fs.existsSync(bin)) {
      return bin;
    }
    const src = path.join(dir, 'media-remote.swift');
    fs.writeFileSync(src, MEDIA_REMOTE_SWIFT, { mode: 0o600 });
    await execToString(
      'swiftc -O -F /System/Library/PrivateFrameworks -framework MediaRemote -o "' +
        bin +
        '" "' +
        src +
        '"',
      60000,
    );
    if (fs.existsSync(bin)) {
      return bin;
    }
    return null;
  } catch {
    return null;
  }
}

export function parseRemoteLine(output: string | null): RemoteSourceLine | null {
  const line = String(output || '')
    .split('\n')[0]
    .replace(/\r$/, '');
  const fields = line.split('\t');
  if (fields.length < 5 || !fields[0] || !fields[1]) {
    return null;
  }
  return {
    app: fields[0],
    title: fields[1],
    artist: fields[2] || '',
    playing: fields[3] === 'true',
    artUrl: fields[4] || null,
  };
}

export async function probeMediaRemote(): Promise<RemoteSourceLine | null> {
  const bin = await ensureHelper();
  if (!bin) {
    return null;
  }
  const out = await execToString('"' + bin + '" probe', 4000);
  return parseRemoteLine(out);
}

export async function sendMediaRemoteCommand(command: MediaCommand): Promise<void> {
  const bin = await ensureHelper();
  if (!bin) {
    return;
  }
  const action = command === 'next' ? 'next' : command === 'prev' ? 'prev' : 'playPause';
  await execToString('"' + bin + '" command ' + action, 3000);
}
