const MAX_CWD_DISPLAY_LENGTH = 26;
const TAIL_SEGMENT_COUNT = 3;
const OSC7_PATTERN = /\x1b\]7;file:\/\/([^\x07\x1b]*?)(?:\x07|\x1b\\)/g;
const WINDOWS_DRIVE_PATTERN = /^[a-zA-Z]:[\\/]/;
const MSYS_DRIVE_PATTERN = /^\/[a-zA-Z]\//;

/* Canonicalize a path for display/matching across platforms:
   - backslashes -> forward slashes (cmd/PowerShell)
   - MSYS `/c/Users/...` -> `C:/Users/...` (Git Bash)
   - Windows drive letters uppercased (`c:/users/...` -> `C:/users/...`) */
export function normalizePath(path: string): string {
  const slashed = path.replace(/\\/g, '/');
  const msys = slashed.match(MSYS_DRIVE_PATTERN);
  if (msys) {
    return msys[0][1].toUpperCase() + ':' + slashed.slice(2);
  }
  if (WINDOWS_DRIVE_PATTERN.test(slashed)) {
    return slashed[0].toUpperCase() + ':' + slashed.slice(2);
  }
  return slashed;
}

export function briefCwd(path: string | null | undefined, home: string): string {
  if (!path) {
    return '';
  }
  const display = normalizePath(path);
  const homePath = normalizePath(home);
  // Windows home dirs are case-insensitive; POSIX stays exact so `~`
  // collapse can never misfire on a case-only sibling directory
  const underHome = homePath
    ? WINDOWS_DRIVE_PATTERN.test(homePath)
      ? display.toLowerCase().indexOf(homePath.toLowerCase()) === 0
      : display.indexOf(homePath) === 0
    : false;
  const shortened = underHome ? '~' + display.slice(homePath.length) : display;
  if (shortened.length <= MAX_CWD_DISPLAY_LENGTH) {
    return shortened;
  }
  const parts = shortened.split('/').filter(Boolean);
  const tail = parts.slice(-TAIL_SEGMENT_COUNT).join('/');
  return shortened[0] === '~' ? '~/' + tail : '…/' + tail;
}

export function parseOsc7(data: string): string | null {
  let match: RegExpExecArray | null;
  let cwd: string | null = null;
  while ((match = OSC7_PATTERN.exec(data))) {
    const raw = match[1];
    // `file://host/path` and `file:///path` carry the host before the path;
    // `file://C:/...` has no host, so the drive prefix is already the path
    const slashIndex = raw.indexOf('/');
    const path = /^[a-zA-Z]:/.test(raw) ? raw : slashIndex >= 0 ? raw.slice(slashIndex) : raw;
    try {
      cwd = decodeURIComponent(path);
    } catch {
      // malformed percent-encoding in the payload; the raw path is still useful
      cwd = path;
    }
  }
  return cwd ? normalizePath(cwd) : cwd;
}
