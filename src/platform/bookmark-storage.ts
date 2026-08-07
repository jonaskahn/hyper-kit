import { BOOKMARKS_STORAGE_KEY } from '../config';

/* Raw, native-separator paths only -- never the display-normalized form from
   core/session.ts (normalizePath/briefCwd), since these are re-dispatched as
   a pty cwd, not just shown on screen. */
export function loadBookmarks(): string[] {
  try {
    const saved = localStorage.getItem(BOOKMARKS_STORAGE_KEY);
    if (!saved) {
      return [];
    }
    const parsed = JSON.parse(saved);
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === 'string') : [];
  } catch {
    // corrupted JSON or unavailable storage; an empty list is a safe fallback
    return [];
  }
}

export function loadBookmarkSet(): Set<string> {
  return new Set(loadBookmarks());
}

export function isBookmarked(path: string): boolean {
  return loadBookmarkSet().has(path);
}

function saveBookmarks(paths: string[]): string[] {
  try {
    localStorage.setItem(BOOKMARKS_STORAGE_KEY, JSON.stringify(paths));
  } catch {
    // best effort: losing a saved bookmark list is harmless
  }
  return paths;
}

export function addBookmark(path: string): string[] {
  const current = loadBookmarks();
  if (current.includes(path)) {
    return current;
  }
  return saveBookmarks([...current, path]);
}

export function removeBookmark(path: string): string[] {
  return saveBookmarks(loadBookmarks().filter((p) => p !== path));
}

export function toggleBookmark(path: string): string[] {
  return loadBookmarks().includes(path) ? removeBookmark(path) : addBookmark(path);
}
