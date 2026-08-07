/* Directory-tree browsing for the Explorer popover. Every helper is
   best-effort like the rest of exec.ts: a directory that can't be read
   degrades to an empty list with an error tag instead of throwing, so one
   bad node never blanks the rest of the tree. */

import { execToString, hasNodeRuntime } from './exec';
import { homeDir } from './home-dir';

export interface DirEntry {
  name: string;
  path: string;
}

export type DirListError = 'denied' | 'not-found' | null;

export interface DirListResult {
  entries: DirEntry[];
  error: DirListError;
}

function sortEntries(entries: DirEntry[]): DirEntry[] {
  return entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

function classifyError(err: unknown): DirListError {
  const code = (err as { code?: string } | null)?.code;
  if (code === 'ENOENT' || code === 'ENOTDIR') {
    return 'not-found';
  }
  return 'denied';
}

function baseName(path: string): string {
  const parts = path.replace(/[\\/]+$/, '').split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

/* Lists only the real subdirectories of `dirPath` (no files). Symlinks are
   resolved one at a time -- a broken or looping symlink is skipped rather
   than failing the whole listing. `showHidden` admits dot-prefixed entries
   (the cross-platform dotfile convention only -- this is a deliberate scope
   limit, not real Windows FILE_ATTRIBUTE_HIDDEN detection). */
export function listSubdirectories(dirPath: string, showHidden = false): DirListResult {
  if (!hasNodeRuntime()) {
    return { entries: [], error: null };
  }
  const fs: any = window.require('fs');
  const path: any = window.require('path');
  let dirents: any[];
  try {
    dirents = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch (err) {
    return { entries: [], error: classifyError(err) };
  }
  const entries: DirEntry[] = [];
  for (const dirent of dirents) {
    if (!showHidden && dirent.name.startsWith('.')) {
      continue;
    }
    const entryPath = path.join(dirPath, dirent.name);
    let isDir = dirent.isDirectory();
    if (!isDir && dirent.isSymbolicLink()) {
      try {
        isDir = fs.statSync(entryPath).isDirectory();
      } catch {
        continue; // broken/looping symlink; skip without failing the listing
      }
    }
    if (isDir) {
      entries.push({ name: dirent.name, path: entryPath });
    }
  }
  return { entries: sortEntries(entries), error: null };
}

function parseWindowsDrives(output: string): DirEntry[] {
  const drives: DirEntry[] = [];
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (/^[A-Za-z]:\\?$/.test(trimmed)) {
      const root = trimmed.endsWith('\\') ? trimmed : trimmed + '\\';
      drives.push({ name: root, path: root });
    }
  }
  return drives;
}

function windowsFallbackDrive(): DirEntry[] {
  const root = (process.env.SystemDrive || 'C:') + '\\';
  return [{ name: root, path: root }];
}

/* Root nodes of the whole-disk tree: '/' on macOS/Linux (mount points like
   /Volumes just show up as ordinary children once it's expanded), or every
   fixed drive letter on Windows. */
async function wholeDiskRoots(): Promise<DirEntry[]> {
  if (process.platform !== 'win32') {
    return [{ name: '/', path: '/' }];
  }
  const output = await execToString(
    'powershell -NoProfile -Command "Get-PSDrive -PSProvider FileSystem | Select-Object -ExpandProperty Root"',
    4000,
  );
  const drives = output ? parseWindowsDrives(output) : [];
  return drives.length > 0 ? drives : windowsFallbackDrive();
}

/* Curated start points for the default Explorer tree: the folders people
   actually jump to (home area, mounted drives) instead of the raw
   filesystem root with its OS-internal clutter. Existence is checked so a
   machine without a mount point just omits that slot. Without a node
   runtime, existence can't be checked, so fall back to today's unconditional
   posix root. */
async function curatedRoots(): Promise<DirEntry[]> {
  if (!hasNodeRuntime()) {
    return [{ name: '/', path: '/' }];
  }
  const fs: any = window.require('fs');
  if (process.platform === 'darwin') {
    const roots: DirEntry[] = [];
    if (fs.existsSync('/Users')) {
      roots.push({ name: 'Users', path: '/Users' });
    }
    if (fs.existsSync('/Volumes')) {
      roots.push({ name: 'Volumes', path: '/Volumes' });
    }
    return roots;
  }
  if (process.platform === 'linux') {
    const roots: DirEntry[] = [];
    if (fs.existsSync('/home')) {
      roots.push({ name: 'home', path: '/home' });
    }
    if (fs.existsSync('/media')) {
      roots.push({ name: 'media', path: '/media' });
    } else if (fs.existsSync('/mnt')) {
      roots.push({ name: 'mnt', path: '/mnt' });
    }
    return roots;
  }
  if (process.platform === 'win32') {
    const roots: DirEntry[] = [];
    const home = homeDir();
    if (home && fs.existsSync(home)) {
      roots.push({ name: baseName(home), path: home });
    }
    const output = await execToString(
      'powershell -NoProfile -Command "Get-PSDrive -PSProvider FileSystem | Select-Object -ExpandProperty Root"',
      4000,
    );
    const drives = output ? parseWindowsDrives(output) : [];
    return roots.concat(drives.length > 0 ? drives : windowsFallbackDrive());
  }
  return [];
}

/* `fullTree` selects the raw whole-disk roots; the default is the curated
   OS-appropriate set (macOS: Users+Volumes; Linux: home+media/mnt; Windows:
   home folder prepended to the drive letters). */
export function listRoots(fullTree = false): Promise<DirEntry[]> {
  return fullTree ? wholeDiskRoots() : curatedRoots();
}
