import { EXPLORER_FULL_TREE_STORAGE_KEY, EXPLORER_SHOW_HIDDEN_STORAGE_KEY } from '../config';

/* Per-user Explorer popover view preferences (show-hidden-files, whole-disk
   tree), persisted in localStorage following the bookmark-storage.ts
   pattern: any storage error or corrupted value degrades to the default
   (false) rather than throwing. */

function loadFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === 'true';
  } catch {
    // unavailable storage; the default view is a safe fallback
    return false;
  }
}

function saveFlag(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // best effort: losing a view preference is harmless
  }
}

export function getShowHidden(): boolean {
  return loadFlag(EXPLORER_SHOW_HIDDEN_STORAGE_KEY);
}

export function setShowHidden(value: boolean): void {
  saveFlag(EXPLORER_SHOW_HIDDEN_STORAGE_KEY, value);
}

export function getFullTree(): boolean {
  return loadFlag(EXPLORER_FULL_TREE_STORAGE_KEY);
}

export function setFullTree(value: boolean): void {
  saveFlag(EXPLORER_FULL_TREE_STORAGE_KEY, value);
}
