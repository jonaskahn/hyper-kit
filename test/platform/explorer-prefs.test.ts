import { describe, it, expect, beforeEach } from 'vitest';

import { EXPLORER_FULL_TREE_STORAGE_KEY, EXPLORER_SHOW_HIDDEN_STORAGE_KEY } from '../../src/config';
import {
  getFullTree,
  getShowHidden,
  setFullTree,
  setShowHidden,
} from '../../src/platform/explorer-prefs';

beforeEach(() => {
  localStorage.clear();
});

describe('explorer-prefs', () => {
  it('defaults both flags to false', () => {
    expect(getShowHidden()).toBe(false);
    expect(getFullTree()).toBe(false);
  });

  it('persists the show-hidden flag', () => {
    setShowHidden(true);
    expect(getShowHidden()).toBe(true);
    expect(localStorage.getItem(EXPLORER_SHOW_HIDDEN_STORAGE_KEY)).toBe('true');
    setShowHidden(false);
    expect(getShowHidden()).toBe(false);
    expect(localStorage.getItem(EXPLORER_SHOW_HIDDEN_STORAGE_KEY)).toBe('false');
  });

  it('persists the full-tree flag', () => {
    setFullTree(true);
    expect(getFullTree()).toBe(true);
    expect(localStorage.getItem(EXPLORER_FULL_TREE_STORAGE_KEY)).toBe('true');
    setFullTree(false);
    expect(getFullTree()).toBe(false);
  });

  it('keeps the two flags independent', () => {
    setShowHidden(true);
    expect(getFullTree()).toBe(false);
    setFullTree(true);
    expect(getShowHidden()).toBe(true);
  });

  it('falls back to false on corrupted values', () => {
    localStorage.setItem(EXPLORER_SHOW_HIDDEN_STORAGE_KEY, '{not json');
    localStorage.setItem(EXPLORER_FULL_TREE_STORAGE_KEY, 'yes');
    expect(getShowHidden()).toBe(false);
    expect(getFullTree()).toBe(false);
  });
});
