/* Shared shell for the Explorer/Bookmark popovers: a document.body-appended
   panel that always opens centered above the bottom panel's action icons
   (the panel's center column), closes on outside click or Escape, and tears
   down cleanly. Kept as one module so neither popover duplicates this
   positioning/lifecycle wiring (mirrors src/platform/agent-monitor/popup.ts's
   per-open listener lifecycle, not media-panel.ts's always-on picker
   listeners -- these popovers are created/destroyed with the feature's
   config toggle rather than being permanent singletons). */

import { ATTRIBUTES } from '../../platform/dom-selectors';

export interface AnchoredPopover {
  readonly bodyEl: HTMLElement;
  readonly headerEl: HTMLElement;
  toggle(anchor: HTMLElement): void;
  close(): void;
  destroy(): void;
}

const VIEWPORT_MARGIN_PX = 8;

const CLOSE_SVG =
  '<svg width="12" height="12" viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';

export function createAnchoredPopover(rootClass: string, title: string): AnchoredPopover {
  const root = document.createElement('div');
  root.className = rootClass;
  root.setAttribute('role', 'dialog');

  const header = document.createElement('div');
  header.className = rootClass + '-header';
  const titleEl = document.createElement('div');
  titleEl.className = rootClass + '-title';
  titleEl.textContent = title;
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = rootClass + '-close';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.innerHTML = CLOSE_SVG;
  const headerActions = document.createElement('div');
  headerActions.className = rootClass + '-header-actions';
  headerActions.append(closeBtn);
  header.append(titleEl, headerActions);

  const body = document.createElement('div');
  body.className = rootClass + '-body';

  root.append(header, body);

  let anchorEl: HTMLElement | null = null;
  let open = false;
  let destroyed = false;
  let outsideHandler: ((e: MouseEvent) => void) | null = null;
  let escHandler: ((e: KeyboardEvent) => void) | null = null;

  const removeListeners = (): void => {
    if (outsideHandler) {
      document.removeEventListener('mousedown', outsideHandler);
      outsideHandler = null;
    }
    if (escHandler) {
      document.removeEventListener('keydown', escHandler);
      escHandler = null;
    }
  };

  /* Centered on the bottom panel's center column (where the Explorer and
     Bookmark action buttons sit), flush above the panel's top edge -- the
     same spot whichever button opened it. Falls back to the viewport center
     if the panel isn't in the DOM yet. The popover must already be appended
     so its own width can be measured. */
  const position = (): void => {
    const panel = document.querySelector(`[${ATTRIBUTES.bottomPanel}]`);
    let centerX = window.innerWidth / 2;
    if (panel) {
      const rect = panel.getBoundingClientRect();
      centerX = rect.left + rect.width / 2;
    }
    const width = root.offsetWidth;
    const left = Math.min(
      Math.max(VIEWPORT_MARGIN_PX, centerX - width / 2),
      window.innerWidth - width - VIEWPORT_MARGIN_PX,
    );
    root.style.right = 'auto';
    root.style.left = left + 'px';
    if (panel) {
      const rect = panel.getBoundingClientRect();
      root.style.bottom = window.innerHeight - rect.top + 6 + 'px';
    } else {
      root.style.bottom = VIEWPORT_MARGIN_PX + 'px';
    }
  };

  const close = (): void => {
    if (!open) {
      return;
    }
    open = false;
    removeListeners();
    root.remove();
  };

  closeBtn.addEventListener('click', close);

  const controller: AnchoredPopover = {
    bodyEl: body,
    headerEl: header,
    toggle(anchor: HTMLElement): void {
      if (destroyed) {
        return;
      }
      if (open && anchorEl === anchor) {
        close();
        return;
      }
      close();
      anchorEl = anchor;
      document.body.appendChild(root);
      position();
      open = true;
      outsideHandler = (e: MouseEvent): void => {
        const target = e.target as Node;
        if (root.contains(target) || anchor.contains(target)) {
          return;
        }
        close();
      };
      escHandler = (e: KeyboardEvent): void => {
        if (e.key === 'Escape') {
          e.preventDefault();
          close();
        }
      };
      document.addEventListener('mousedown', outsideHandler);
      document.addEventListener('keydown', escHandler);
    },
    close,
    destroy(): void {
      destroyed = true;
      close();
      anchorEl = null;
    },
  };

  return controller;
}
