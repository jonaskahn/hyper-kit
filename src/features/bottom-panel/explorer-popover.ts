/* Whole-disk directory tree popover. Three sibling buttons per row --
   chevron and folder name (both expand/collapse only), pin (toggles a
   bookmark). A new tab opens with a double-click on the folder name, so a
   single click target never does two things at once. */

import { CLASSES } from '../../platform/dom-selectors';
import { emitRpc, getFocusedSessionUid } from '../../platform/hyper-store';
import {
  listRoots,
  listSubdirectories,
  type DirEntry,
  type DirListResult,
} from '../../platform/dir-lister';
import { toggleBookmark, isBookmarked } from '../../platform/bookmark-storage';
import { openInFileManager } from '../../platform/system-open';
import {
  getFullTree,
  getShowHidden,
  setFullTree,
  setShowHidden,
} from '../../platform/explorer-prefs';
import { createAnchoredPopover } from './anchored-popover';

export interface ExplorerPopoverController {
  toggle(anchor: HTMLElement): void;
  close(): void;
  destroy(): void;
}

const CHEVRON_SVG =
  '<svg width="8" height="6" viewBox="0 0 8 6"><path d="M0 6l4-6 4 6z" fill="currentColor"/></svg>';
const FOLDER_SVG =
  '<svg width="14" height="14" viewBox="0 0 16 16"><path d="M1 3.5A1.5 1.5 0 0 1 2.5 2h3.379a1.5 1.5 0 0 1 1.06.44L8.06 3.56a1.5 1.5 0 0 0 1.06.44H13.5A1.5 1.5 0 0 1 15 5.5v7A1.5 1.5 0 0 1 13.5 14h-11A1.5 1.5 0 0 1 1 12.5v-9z" fill="currentColor"/></svg>';
const STAR_OUTLINE_SVG =
  '<svg width="14" height="14" viewBox="0 0 16 16"><path d="M8 1.5l2.02 4.34 4.73.5-3.5 3.24.94 4.7L8 12.1l-4.19 2.18.94-4.7-3.5-3.24 4.73-.5L8 1.5z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>';
const STAR_FILLED_SVG =
  '<svg width="14" height="14" viewBox="0 0 16 16"><path d="M8 1.5l2.02 4.34 4.73.5-3.5 3.24.94 4.7L8 12.1l-4.19 2.18.94-4.7-3.5-3.24 4.73-.5L8 1.5z" fill="currentColor"/></svg>';
const FULL_TREE_SVG =
  '<svg width="13" height="13" viewBox="0 0 16 16"><path d="M2 3.5c0-.28.22-.5.5-.5h11c.28 0 .5.22.5.5v3c0 .28-.22.5-.5.5h-11c-.28 0-.5-.22-.5-.5v-3z" fill="currentColor"/><path d="M2 9.5c0-.28.22-.5.5-.5h11c.28 0 .5.22.5.5v3c0 .28-.22.5-.5.5h-11c-.28 0-.5-.22-.5-.5v-3z" fill="currentColor"/><circle cx="11" cy="5" r="1" fill="currentColor"/><circle cx="11" cy="11" r="1" fill="currentColor"/></svg>';
const SHOW_HIDDEN_SVG =
  '<svg width="13" height="13" viewBox="0 0 16 16"><path d="M1.5 8C3.6 4.9 5.6 3.5 8 3.5s4.4 1.4 6.5 4.5c-2.1 3.1-4.1 4.5-6.5 4.5S3.6 11.1 1.5 8z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><circle cx="8" cy="8" r="1.8" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>';
const TERMINAL_SVG =
  '<svg width="13" height="13" viewBox="0 0 16 16"><path d="M1.5 3.5A1.5 1.5 0 0 1 3 2h10a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 13 14H3a1.5 1.5 0 0 1-1.5-1.5v-9z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M4.5 5.5L7 8l-2.5 2.5M8.5 10.5h3" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const FILES_SVG =
  '<svg width="13" height="13" viewBox="0 0 16 16"><path d="M1 3.5A1.5 1.5 0 0 1 2.5 2h3.379a1.5 1.5 0 0 1 1.06.44L8.06 3.56a1.5 1.5 0 0 0 1.06.44H13.5A1.5 1.5 0 0 1 15 5.5v7A1.5 1.5 0 0 1 13.5 14h-11A1.5 1.5 0 0 1 1 12.5v-9z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M8 10.5V6.5M6 8l2-2 2 2" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const SPLIT_TERMINAL_SVG =
  '<svg width="13" height="13" viewBox="0 0 16 16"><path d="M1.5 3.5A1.5 1.5 0 0 1 3 2h10a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 13 14H3a1.5 1.5 0 0 1-1.5-1.5v-9z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M8 2v12" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M3.5 8l1.5 1.5L3.5 11M10.5 8l1.5 1.5-1.5 1.5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function textNode(className: string, text: string): HTMLElement {
  const el = document.createElement('div');
  el.className = className;
  el.textContent = text;
  return el;
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

export function createExplorerPopover(): ExplorerPopoverController {
  const popover = createAnchoredPopover(CLASSES.explorerPopover, 'Explorer');
  const childCache = new Map<string, DirListResult>();
  let rootsLoaded = false;
  let showHidden = getShowHidden();
  let fullTree = getFullTree();

  popover.bodyEl.setAttribute('role', 'tree');

  function createRow(entry: DirEntry): HTMLElement {
    const row = document.createElement('div');
    row.className = CLASSES.explorerRow;
    row.setAttribute('role', 'treeitem');
    row.setAttribute('aria-expanded', 'false');
    row.dataset.path = entry.path;

    const chevron = document.createElement('button');
    chevron.type = 'button';
    chevron.className = CLASSES.explorerChevron;
    chevron.dataset.role = 'chevron';
    chevron.setAttribute('aria-label', 'Expand');
    chevron.innerHTML = CHEVRON_SVG;

    const main = document.createElement('button');
    main.type = 'button';
    main.className = CLASSES.explorerRowMain;
    main.dataset.role = 'open';
    main.title = 'Click to expand, double-click to open';
    const icon = document.createElement('span');
    icon.className = CLASSES.explorerIcon;
    icon.innerHTML = FOLDER_SVG;
    const name = document.createElement('span');
    name.className = CLASSES.explorerName;
    name.textContent = entry.name;
    main.append(icon, name);

    const pin = document.createElement('button');
    pin.type = 'button';
    pin.className = CLASSES.explorerPin;
    pin.dataset.role = 'pin';
    pin.setAttribute('aria-label', 'Bookmark this folder');
    const pinned = isBookmarked(entry.path);
    pin.setAttribute('aria-pressed', String(pinned));
    pin.classList.toggle(CLASSES.explorerPinActive, pinned);
    pin.innerHTML = pinned ? STAR_FILLED_SVG : STAR_OUTLINE_SVG;

    const terminal = document.createElement('button');
    terminal.type = 'button';
    terminal.className = CLASSES.explorerTerminal;
    terminal.dataset.role = 'terminal';
    terminal.setAttribute('aria-label', 'Open in a new tab');
    terminal.title = 'Open in a new tab';
    terminal.innerHTML = TERMINAL_SVG;

    const split = document.createElement('button');
    split.type = 'button';
    split.className = CLASSES.explorerSplit;
    split.dataset.role = 'split';
    split.setAttribute('aria-label', 'Open in this tab');
    split.title = 'Open in this tab';
    split.innerHTML = SPLIT_TERMINAL_SVG;

    row.append(chevron, main, split, terminal);

    if (process.platform !== 'linux') {
      const files = document.createElement('button');
      files.type = 'button';
      files.className = CLASSES.explorerFiles;
      files.dataset.role = 'files';
      files.setAttribute('aria-label', 'Reveal in file manager');
      files.title = 'Reveal in file manager';
      files.innerHTML = FILES_SVG;
      row.append(files);
    }

    row.append(pin);

    const children = document.createElement('div');
    children.className = CLASSES.explorerChildren;
    children.hidden = true;

    const wrap = document.createElement('div');
    wrap.append(row, children);
    return wrap;
  }

  function renderChildren(container: HTMLElement, dirPath: string): void {
    let result = childCache.get(dirPath);
    if (!result) {
      result = listSubdirectories(dirPath, showHidden);
      childCache.set(dirPath, result);
    }
    container.innerHTML = '';
    if (result.error === 'denied') {
      container.appendChild(textNode(CLASSES.explorerError, 'Permission denied'));
      return;
    }
    if (result.error === 'not-found') {
      container.appendChild(textNode(CLASSES.explorerError, 'Not found'));
      return;
    }
    if (result.entries.length === 0) {
      container.appendChild(textNode(CLASSES.explorerEmpty, 'No subfolders'));
      return;
    }
    for (const entry of result.entries) {
      container.appendChild(createRow(entry));
    }
  }

  function toggleExpand(
    wrap: HTMLElement,
    row: HTMLElement,
    chevron: HTMLElement,
    path: string,
  ): void {
    const children = wrap.querySelector<HTMLElement>(`.${CLASSES.explorerChildren}`);
    if (!children) {
      return;
    }
    const willOpen = children.hidden;
    children.hidden = !willOpen;
    chevron.classList.toggle(CLASSES.explorerChevronOpen, willOpen);
    chevron.setAttribute('aria-label', willOpen ? 'Collapse' : 'Expand');
    row.setAttribute('aria-expanded', String(willOpen));
    if (willOpen && children.dataset.loaded !== 'true') {
      children.dataset.loaded = 'true';
      renderChildren(children, path);
    }
  }

  popover.bodyEl.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const btn = target.closest<HTMLButtonElement>('button[data-role]');
    if (!btn) {
      return;
    }
    const row = btn.closest<HTMLElement>(`.${CLASSES.explorerRow}`);
    const wrap = row?.parentElement ?? null;
    if (!row || !wrap) {
      return;
    }
    const path = row.dataset.path;
    if (!path) {
      return;
    }
    const role = btn.dataset.role;
    if (role === 'chevron' || role === 'open') {
      toggleExpand(wrap, row, btn, path);
    } else if (role === 'split') {
      openInThisTab(path);
      popover.close();
    } else if (role === 'terminal') {
      openInNewTab(path);
      popover.close();
    } else if (role === 'files') {
      openInFileManager(path);
    } else if (role === 'pin') {
      const pinned = toggleBookmark(path).includes(path);
      btn.setAttribute('aria-pressed', String(pinned));
      btn.classList.toggle(CLASSES.explorerPinActive, pinned);
      btn.innerHTML = pinned ? STAR_FILLED_SVG : STAR_OUTLINE_SVG;
    }
  });

  popover.bodyEl.addEventListener('dblclick', (e) => {
    const target = e.target as HTMLElement;
    const btn = target.closest<HTMLButtonElement>('button[data-role]');
    if (!btn || btn.dataset.role !== 'open') {
      return;
    }
    const row = btn.closest<HTMLElement>(`.${CLASSES.explorerRow}`);
    const path = row?.dataset.path;
    if (!path) {
      return;
    }
    openInNewTab(path);
    popover.close();
  });

  function renderToggle(btn: HTMLButtonElement, on: boolean): void {
    btn.setAttribute('aria-pressed', String(on));
    btn.classList.toggle(CLASSES.explorerToggleOn, on);
  }

  const fullTreeBtn = document.createElement('button');
  fullTreeBtn.type = 'button';
  fullTreeBtn.className = CLASSES.explorerToggleFullTree;
  fullTreeBtn.setAttribute('aria-label', 'Show whole disk tree');
  fullTreeBtn.title = 'Show whole disk tree';
  fullTreeBtn.innerHTML = FULL_TREE_SVG;
  renderToggle(fullTreeBtn, fullTree);
  fullTreeBtn.addEventListener('click', () => {
    fullTree = !fullTree;
    setFullTree(fullTree);
    renderToggle(fullTreeBtn, fullTree);
    childCache.clear();
    rootsLoaded = false;
    popover.bodyEl.innerHTML = '';
    ensureRoots();
  });

  const hiddenBtn = document.createElement('button');
  hiddenBtn.type = 'button';
  hiddenBtn.className = CLASSES.explorerToggleHidden;
  hiddenBtn.setAttribute('aria-label', 'Show hidden files');
  hiddenBtn.title = 'Show hidden files';
  hiddenBtn.innerHTML = SHOW_HIDDEN_SVG;
  renderToggle(hiddenBtn, showHidden);
  hiddenBtn.addEventListener('click', () => {
    showHidden = !showHidden;
    setShowHidden(showHidden);
    renderToggle(hiddenBtn, showHidden);
    childCache.clear();
    reRenderExpanded();
  });

  const headerActions = popover.headerEl.querySelector<HTMLElement>(
    `.${CLASSES.explorerHeaderActions}`,
  );
  headerActions?.prepend(fullTreeBtn, hiddenBtn);

  /* Re-fetch and re-render every currently-expanded branch in place (roots
     never need it -- they're never dot-prefixed, so the hidden filter can't
     change them). */
  function reRenderExpanded(): void {
    const expanded = popover.bodyEl.querySelectorAll<HTMLElement>(
      `.${CLASSES.explorerRow}[aria-expanded="true"]`,
    );
    for (const row of expanded) {
      const wrap = row.parentElement;
      const children = wrap?.querySelector<HTMLElement>(`.${CLASSES.explorerChildren}`);
      const path = row.dataset.path;
      if (children && path) {
        renderChildren(children, path);
      }
    }
  }

  function ensureRoots(): void {
    if (rootsLoaded) {
      return;
    }
    rootsLoaded = true;
    popover.bodyEl.appendChild(textNode(CLASSES.explorerLoading, 'Loading…'));
    void listRoots(fullTree).then((roots) => {
      popover.bodyEl.innerHTML = '';
      if (roots.length === 0) {
        popover.bodyEl.appendChild(textNode(CLASSES.explorerEmpty, 'No drives found'));
        return;
      }
      for (const root of roots) {
        popover.bodyEl.appendChild(createRow(root));
      }
    });
  }

  return {
    toggle(anchor: HTMLElement): void {
      popover.toggle(anchor);
      ensureRoots();
    },
    close: popover.close,
    destroy: popover.destroy,
  };
}
