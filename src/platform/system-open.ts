/* Best-effort OS-level folder openers for the Explorer/bookmark popovers:
   reveal a folder in the system file manager, or spawn a brand-new Hyper
   window rooted at it. Every helper degrades silently (no node runtime, bad
   binary, platform gaps) so a failed open never disturbs the popover. */

import { hasNodeRuntime } from './exec';

function runBestEffort(command: string, args: string[]): void {
  if (!hasNodeRuntime()) {
    return;
  }
  try {
    const cp: any = window.require('child_process');
    // noop callback so execFile errors land there instead of an uncaught
    // 'error' event in the Electron renderer
    cp.execFile(command, args, () => {});
  } catch {
    // best effort: a missing binary or platform gap is not an error state
  }
}

/* Reveals `path` in the OS file manager: Finder on macOS, Explorer on
   Windows. Deliberately no Linux branch -- the caller hides the affordance
   there instead. execFile's args array avoids shell-quoting issues. */
export function openInFileManager(path: string): void {
  if (process.platform === 'darwin') {
    runBestEffort('open', [path]);
  } else if (process.platform === 'win32') {
    runBestEffort('explorer', [path]);
  }
}

/* Opens a brand-new Hyper window rooted at `path` via the `hyper` CLI
   (already on PATH for most installs). */
export function openNewHyperWindow(path: string): void {
  runBestEffort('hyper', [path]);
}
