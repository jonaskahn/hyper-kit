import { describe, it, expect, beforeEach } from 'vitest';

import { BOOKMARKS_STORAGE_KEY } from '../../src/config';
import {
  addBookmark,
  isBookmarked,
  loadBookmarks,
  loadBookmarkSet,
  removeBookmark,
  toggleBookmark,
} from '../../src/platform/bookmark-storage';

beforeEach(() => {
  localStorage.clear();
});

describe('bookmark-storage', () => {
  it('starts empty', () => {
    expect(loadBookmarks()).toEqual([]);
    expect(loadBookmarkSet()).toEqual(new Set());
    expect(isBookmarked('/tmp')).toBe(false);
  });

  it('adds and persists a bookmark', () => {
    addBookmark('/tmp/a');
    expect(loadBookmarks()).toEqual(['/tmp/a']);
    expect(isBookmarked('/tmp/a')).toBe(true);
  });

  it('dedups on double-add', () => {
    addBookmark('/tmp/a');
    addBookmark('/tmp/a');
    expect(loadBookmarks()).toEqual(['/tmp/a']);
  });

  it('removes a bookmark', () => {
    addBookmark('/tmp/a');
    addBookmark('/tmp/b');
    removeBookmark('/tmp/a');
    expect(loadBookmarks()).toEqual(['/tmp/b']);
  });

  it('toggles a bookmark on and off', () => {
    expect(toggleBookmark('/tmp/a')).toEqual(['/tmp/a']);
    expect(isBookmarked('/tmp/a')).toBe(true);
    expect(toggleBookmark('/tmp/a')).toEqual([]);
    expect(isBookmarked('/tmp/a')).toBe(false);
  });

  it('degrades to an empty list on corrupted storage', () => {
    localStorage.setItem(BOOKMARKS_STORAGE_KEY, '{not json');
    expect(loadBookmarks()).toEqual([]);
  });

  it('drops non-string entries from a hand-edited array', () => {
    localStorage.setItem(BOOKMARKS_STORAGE_KEY, JSON.stringify(['/tmp/a', 42, null, '/tmp/b']));
    expect(loadBookmarks()).toEqual(['/tmp/a', '/tmp/b']);
  });

  it('treats a non-array value as empty', () => {
    localStorage.setItem(BOOKMARKS_STORAGE_KEY, JSON.stringify({ not: 'an array' }));
    expect(loadBookmarks()).toEqual([]);
  });
});
