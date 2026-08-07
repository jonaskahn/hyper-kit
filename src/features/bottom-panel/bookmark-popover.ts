/* Saved-folder grid popover. Bookmarks are only ever added from the
   Explorer tree's pin button; this popover just opens or removes them, so
   it re-reads storage fresh on every open rather than caching stale state
   across opens. */

import { CLASSES } from '../../platform/dom-selectors';
import { emitRpc, getFocusedSessionUid } from '../../platform/hyper-store';
import { homeDir } from '../../platform/home-dir';
import { briefCwd } from '../../core/session';
import { loadBookmarks, removeBookmark } from '../../platform/bookmark-storage';
import { openInFileManager } from '../../platform/system-open';
import { createAnchoredPopover } from './anchored-popover';

export interface BookmarkPopoverController {
  toggle(anchor: HTMLElement): void;
  close(): void;
  destroy(): void;
}

const FOLDER_SVG =
  '<svg width="16" height="16" viewBox="0 0 16 16"><path d="M1 3.5A1.5 1.5 0 0 1 2.5 2h3.379a1.5 1.5 0 0 1 1.06.44L8.06 3.56a1.5 1.5 0 0 0 1.06.44H13.5A1.5 1.5 0 0 1 15 5.5v7A1.5 1.5 0 0 1 13.5 14h-11A1.5 1.5 0 0 1 1 12.5v-9z" fill="currentColor"/></svg>';
const TERMINAL_SVG =
  '<svg width="13" height="13" viewBox="0 0 16 16"><path d="M1.5 3.5A1.5 1.5 0 0 1 3 2h10a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 13 14H3a1.5 1.5 0 0 1-1.5-1.5v-9z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M4.5 5.5L7 8l-2.5 2.5M8.5 10.5h3" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const SPLIT_TERMINAL_SVG =
  '<svg width="13" height="13" viewBox="0 0 16 16"><path d="M1.5 3.5A1.5 1.5 0 0 1 3 2h10a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 13 14H3a1.5 1.5 0 0 1-1.5-1.5v-9z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M8 2v12" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M3.5 8l1.5 1.5L3.5 11M10.5 8l1.5 1.5-1.5 1.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const FILES_SVG =
  '<svg width="13" height="13" viewBox="0 0 16 16"><path d="M1 3.5A1.5 1.5 0 0 1 2.5 2h3.379a1.5 1.5 0 0 1 1.06.44L8.06 3.56a1.5 1.5 0 0 0 1.06.44H13.5A1.5 1.5 0 0 1 15 5.5v7A1.5 1.5 0 0 1 13.5 14h-11A1.5 1.5 0 0 1 1 12.5v-9z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M8 10.5V6.5M6 8l2-2 2 2" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function baseName(path: string): string {
  const parts = path.replace(/[\\/]+$/, '').split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

/* Mirrors Cmd+D (pane:splitRight): asks the main process, over Hyper's own
   rpc bridge, to spawn a real pty split into the focused tab at `path` --
   see hyper-store.ts's emitRpc for why this (and not a dispatched action)
   is the correct mechanism. Hyper's reducer keys off `splitDirection` alone
   to decide "split" vs "new tab" (lib/reducers/term-groups.ts), and
   `activeUid` names which existing pane's group to split into. */
function openInThisTab(path: string): void {
  const activeUid = getFocusedSessionUid();
  if (!activeUid) {
    return;
  }
  emitRpc('new', { cwd: path, splitDirection: 'VERTICAL', activeUid });
}

/* Mirrors Cmd+T (tab:new): same rpc bridge, no splitDirection, which is what
   makes Hyper's reducer create a brand-new root tab instead of splitting. */
function openInNewTab(path: string): void {
  emitRpc('new', { cwd: path });
}

export function createBookmarkPopover(): BookmarkPopoverController {
  const popover = createAnchoredPopover(CLASSES.bookmarkPopover, 'Bookmarks');

  function createTile(path: string): HTMLElement {
    const tile = document.createElement('div');
    tile.className = CLASSES.bookmarkTile;
    tile.setAttribute('role', 'listitem');
    tile.dataset.path = path;

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = CLASSES.bookmarkTileRemove;
    remove.dataset.role = 'remove';
    remove.setAttribute('aria-label', 'Remove bookmark');
    remove.title = 'Remove bookmark';
    remove.textContent = '×';

    const main = document.createElement('button');
    main.type = 'button';
    main.className = CLASSES.bookmarkTileMain;
    main.dataset.role = 'open';
    main.title = `Open a new tab in ${path}`;
    const icon = document.createElement('span');
    icon.className = CLASSES.bookmarkTileIcon;
    icon.innerHTML = FOLDER_SVG;
    const name = document.createElement('span');
    name.className = CLASSES.bookmarkTileName;
    name.textContent = baseName(path);
    const pathEl = document.createElement('span');
    pathEl.className = CLASSES.bookmarkTilePath;
    const pathInner = document.createElement('span');
    pathInner.className = CLASSES.bookmarkTilePathInner;
    const brief = briefCwd(path, homeDir());
    pathInner.textContent = brief;
    pathEl.append(pathInner);
    main.append(icon, name, pathEl);

    /* hovering the tile scrolls the path right-to-left so the full path
       shows instead of the ellipsis; the rest state stays abbreviated. Only
       the inner span moves -- animating the clipping element itself would
       drag its clip box out of the tile. */
    const reduceMotion =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    tile.addEventListener('mouseenter', () => {
      if (reduceMotion || pathInner.textContent === path) {
        return;
      }
      pathInner.textContent = path;
      const overflow = pathInner.scrollWidth - pathEl.clientWidth;
      if (overflow <= 0) {
        return;
      }
      pathInner.animate(
        [{ transform: 'translateX(0)' }, { transform: `translateX(${-overflow}px)` }],
        { duration: Math.min(15000, 3000 + overflow * 20), fill: 'forwards', easing: 'linear' },
      );
    });
    tile.addEventListener('mouseleave', () => {
      pathInner.getAnimations?.().forEach((a) => a.cancel());
      pathInner.textContent = brief;
    });

    const actions = document.createElement('div');
    actions.className = CLASSES.bookmarkTileActions;

    const split = document.createElement('button');
    split.type = 'button';
    split.className = CLASSES.bookmarkTileAction;
    split.dataset.role = 'split';
    split.setAttribute('aria-label', 'Open in this tab');
    split.title = 'Open in this tab';
    split.innerHTML = SPLIT_TERMINAL_SVG;

    const newTab = document.createElement('button');
    newTab.type = 'button';
    newTab.className = CLASSES.bookmarkTileAction;
    newTab.dataset.role = 'terminal';
    newTab.setAttribute('aria-label', 'Open in a new tab');
    newTab.title = 'Open in a new tab';
    newTab.innerHTML = TERMINAL_SVG;

    const files = document.createElement('button');
    files.type = 'button';
    files.className = CLASSES.bookmarkTileAction;
    files.dataset.role = 'files';
    files.setAttribute('aria-label', 'Reveal in file manager');
    files.title = 'Reveal in file manager';
    files.innerHTML = FILES_SVG;

    actions.append(split, newTab, files);

    tile.append(remove, main, actions);
    return tile;
  }

  function emptyState(): HTMLElement {
    const el = document.createElement('div');
    el.className = CLASSES.bookmarkEmpty;
    el.textContent = 'No bookmarks yet — pin a folder from the Explorer tree.';
    return el;
  }

  function render(): void {
    popover.bodyEl.innerHTML = '';
    const paths = loadBookmarks();
    if (paths.length === 0) {
      popover.bodyEl.appendChild(emptyState());
      return;
    }
    const grid = document.createElement('div');
    grid.className = CLASSES.bookmarkGrid;
    grid.setAttribute('role', 'list');
    for (const path of paths) {
      grid.appendChild(createTile(path));
    }
    popover.bodyEl.appendChild(grid);
  }

  popover.bodyEl.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const btn = target.closest<HTMLButtonElement>('button[data-role]');
    if (!btn) {
      return;
    }
    const tile = btn.closest<HTMLElement>(`.${CLASSES.bookmarkTile}`);
    const path = tile?.dataset.path;
    if (!tile || !path) {
      return;
    }
    if (btn.dataset.role === 'open' || btn.dataset.role === 'terminal') {
      openInNewTab(path);
      popover.close();
    } else if (btn.dataset.role === 'split') {
      openInThisTab(path);
      popover.close();
    } else if (btn.dataset.role === 'files') {
      openInFileManager(path);
    } else if (btn.dataset.role === 'remove') {
      removeBookmark(path);
      render();
    }
  });

  return {
    toggle(anchor: HTMLElement): void {
      render();
      popover.toggle(anchor);
    },
    close: popover.close,
    destroy: popover.destroy,
  };
}
