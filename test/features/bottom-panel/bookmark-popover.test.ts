import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../../src/platform/system-open', () => ({
  openInFileManager: vi.fn(),
}));

import { createBookmarkPopover } from '../../../src/features/bottom-panel/bookmark-popover';
import { setStore } from '../../../src/platform/hyper-store';
import { addBookmark, loadBookmarks } from '../../../src/platform/bookmark-storage';
import { homeDir } from '../../../src/platform/home-dir';
import { openInFileManager } from '../../../src/platform/system-open';
import { tabStore, unsplitGroup } from '../../helpers/store';

let anchor: HTMLButtonElement;
let rpcEmit: ReturnType<typeof vi.fn>;

beforeEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
  anchor = document.createElement('button');
  document.body.appendChild(anchor);
  rpcEmit = vi.fn();
  (window as any).rpc = { emit: rpcEmit };
});

afterEach(() => {
  setStore(null);
  document.body.innerHTML = '';
  localStorage.clear();
  delete (window as any).rpc;
});

describe('bookmark popover', () => {
  it('shows an empty state pointing back at the Explorer pin control', () => {
    createBookmarkPopover().toggle(anchor);
    expect(document.querySelector('.kit-bookmark-empty')?.textContent).toContain('Explorer');
  });

  it('renders a tile per saved bookmark, freshly read on every open', () => {
    addBookmark('/tmp/a');
    createBookmarkPopover().toggle(anchor);
    expect(document.querySelectorAll('.kit-bookmark-tile').length).toBe(1);
    expect(document.querySelector('[data-path="/tmp/a"]')).not.toBeNull();
  });

  it('clicking a tile opens a new tab via the rpc bridge and closes', () => {
    addBookmark('/tmp/a');
    createBookmarkPopover().toggle(anchor);
    document.querySelector<HTMLButtonElement>('[data-path="/tmp/a"] [data-role="open"]')!.click();
    expect(rpcEmit).toHaveBeenCalledWith('new', { cwd: '/tmp/a' });
    expect(document.querySelector('.kit-bookmark')).toBeNull();
  });

  it('removing the last tile shows the empty state without dispatching or closing', () => {
    addBookmark('/tmp/a');
    const dispatch = vi.fn();
    setStore({ ...tabStore(unsplitGroup()), dispatch });
    createBookmarkPopover().toggle(anchor);
    document.querySelector<HTMLButtonElement>('[data-path="/tmp/a"] [data-role="remove"]')!.click();
    expect(loadBookmarks()).toEqual([]);
    expect(document.querySelector('.kit-bookmark-empty')).not.toBeNull();
    expect(dispatch).not.toHaveBeenCalled();
    expect(document.querySelector('.kit-bookmark')).not.toBeNull();
  });

  it('removing one of several tiles leaves the others intact', () => {
    addBookmark('/tmp/a');
    addBookmark('/tmp/b');
    createBookmarkPopover().toggle(anchor);
    document.querySelector<HTMLButtonElement>('[data-path="/tmp/a"] [data-role="remove"]')!.click();
    expect(loadBookmarks()).toEqual(['/tmp/b']);
    expect(document.querySelector('[data-path="/tmp/a"]')).toBeNull();
    expect(document.querySelector('[data-path="/tmp/b"]')).not.toBeNull();
  });

  it('renders hover actions on a tile', () => {
    addBookmark('/tmp/a');
    createBookmarkPopover().toggle(anchor);
    const tile = document.querySelector('[data-path="/tmp/a"]')!;
    expect(tile.querySelector('[data-role="split"]')).not.toBeNull();
    expect(tile.querySelector('[data-role="terminal"]')).not.toBeNull();
    expect(tile.querySelector('[data-role="files"]')).not.toBeNull();
  });

  it('hovering a tile swaps the path to the full path and restores it on leave', () => {
    const full = homeDir() + '/deep/nested/project';
    addBookmark(full);
    createBookmarkPopover().toggle(anchor);
    const tile = document.querySelector('[data-path="' + full + '"]')!;
    const pathEl = tile.querySelector('.kit-bookmark-tile-path')!;
    expect(pathEl.textContent).toBe('~/deep/nested/project');
    tile.dispatchEvent(new MouseEvent('mouseenter'));
    expect(pathEl.textContent).toBe(full);
    tile.dispatchEvent(new MouseEvent('mouseleave'));
    expect(pathEl.textContent).toBe('~/deep/nested/project');
  });

  it('hover new-tab action opens a new tab via the rpc bridge and closes', () => {
    addBookmark('/tmp/a');
    createBookmarkPopover().toggle(anchor);
    document
      .querySelector<HTMLButtonElement>('[data-path="/tmp/a"] [data-role="terminal"]')!
      .click();
    expect(rpcEmit).toHaveBeenCalledWith('new', { cwd: '/tmp/a' });
    expect(document.querySelector('.kit-bookmark')).toBeNull();
  });

  it('hover same-tab action splits the focused tab via the rpc bridge and closes', () => {
    addBookmark('/tmp/a');
    setStore({ ...tabStore(unsplitGroup('s1'), { g1: 's1' }) });
    createBookmarkPopover().toggle(anchor);
    document.querySelector<HTMLButtonElement>('[data-path="/tmp/a"] [data-role="split"]')!.click();
    expect(rpcEmit).toHaveBeenCalledWith('new', {
      cwd: '/tmp/a',
      splitDirection: 'VERTICAL',
      activeUid: 's1',
    });
    expect(document.querySelector('.kit-bookmark')).toBeNull();
  });

  it('hover same-tab action no-ops without a focused session', () => {
    addBookmark('/tmp/a');
    createBookmarkPopover().toggle(anchor);
    document.querySelector<HTMLButtonElement>('[data-path="/tmp/a"] [data-role="split"]')!.click();
    expect(rpcEmit).not.toHaveBeenCalled();
    expect(document.querySelector('.kit-bookmark')).toBeNull();
  });

  it('hover files action reveals in the file manager and keeps the popover open', () => {
    addBookmark('/tmp/a');
    const dispatch = vi.fn();
    setStore({ ...tabStore(unsplitGroup()), dispatch });
    createBookmarkPopover().toggle(anchor);
    document.querySelector<HTMLButtonElement>('[data-path="/tmp/a"] [data-role="files"]')!.click();
    expect(openInFileManager).toHaveBeenCalledWith('/tmp/a');
    expect(dispatch).not.toHaveBeenCalled();
    expect(document.querySelector('.kit-bookmark')).not.toBeNull();
  });

  it('Escape closes the popover without dispatching', () => {
    addBookmark('/tmp/a');
    const dispatch = vi.fn();
    setStore({ ...tabStore(unsplitGroup()), dispatch });
    createBookmarkPopover().toggle(anchor);
    expect(document.querySelector('.kit-bookmark')).not.toBeNull();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.querySelector('.kit-bookmark')).toBeNull();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('an outside click closes the popover', () => {
    addBookmark('/tmp/a');
    createBookmarkPopover().toggle(anchor);
    expect(document.querySelector('.kit-bookmark')).not.toBeNull();
    const outside = document.createElement('div');
    document.body.appendChild(outside);
    outside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(document.querySelector('.kit-bookmark')).toBeNull();
  });
});
