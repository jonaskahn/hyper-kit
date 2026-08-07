import { REORDER_ACTION, computeInsertIndex, type TabRect } from '../../core/reorder';
import { getStore } from '../../platform/hyper-store';
import { SELECTORS, CLASSES } from '../../platform/dom-selectors';

const DRAG_THRESHOLD_PX = 4;
const SCROLL_EDGE_PX = 24;
const SCROLL_STEP_PX = 8;

interface DragState {
  uid: string;
  node: HTMLElement;
  list: HTMLElement;
  ghost: HTMLElement;
  indicator: HTMLElement;
  startX: number;
  startY: number;
  lastY: number;
  lastIndex: number;
  isArmed: boolean;
  scrollDir: -1 | 0 | 1;
  scrollRaf: number | null;
}

let drag: DragState | null = null;

const cleanupFns = new WeakMap<HTMLElement, () => void>();

function rectsOf(list: HTMLElement, exclude: HTMLElement): TabRect[] {
  const rects: TabRect[] = [];
  list.querySelectorAll(SELECTORS.tab).forEach((el) => {
    if (el === exclude) {
      return;
    }
    const rect = (el as HTMLElement).getBoundingClientRect();
    rects.push({ top: rect.top, bottom: rect.bottom });
  });
  return rects;
}

function buildGhost(node: HTMLElement): HTMLElement {
  const ghost = node.cloneNode(true) as HTMLElement;
  ghost.removeAttribute('id');
  ghost.classList.add(CLASSES.tabDragGhost);
  /* .tab_tab sets width via !important; only an !important inline style
     can override it once the ghost is detached and reparented to body */
  ghost.style.setProperty('width', node.offsetWidth + 'px', 'important');
  return ghost;
}

function tabElements(list: HTMLElement): HTMLElement[] {
  return Array.from(list.querySelectorAll(SELECTORS.tab)) as HTMLElement[];
}

/* Final position of the dragged tab within the FULL tab list. computeInsertIndex
   works against the list without the dragged tab, so a downward move lands one
   slot lower than the raw index: map it back with the dragged tab's original
   position. */
export function computeTargetIndex(
  pointerY: number,
  list: HTMLElement,
  draggedNode: HTMLElement,
): number {
  const tabs = tabElements(list);
  const dragIndex = tabs.indexOf(draggedNode);
  const index = computeInsertIndex(pointerY, rectsOf(list, draggedNode));
  return index > dragIndex ? index + 1 : index;
}

function positionIndicator(targetIndex: number): void {
  if (!drag) {
    return;
  }
  const listRect = drag.list.getBoundingClientRect();
  const tabs = tabElements(drag.list);
  let boundaryY: number;
  if (targetIndex >= tabs.length) {
    const last = tabs[tabs.length - 1];
    boundaryY = last ? last.getBoundingClientRect().bottom : listRect.top;
  } else {
    boundaryY = tabs[targetIndex].getBoundingClientRect().top;
  }
  drag.indicator.style.top = Math.max(0, boundaryY - listRect.top) + 'px';
  drag.lastIndex = targetIndex;
}

function updateDropSlot(): void {
  if (!drag) {
    return;
  }
  positionIndicator(computeTargetIndex(drag.lastY, drag.list, drag.node));
}

function scrollLoop(): void {
  if (!drag) {
    return;
  }
  drag.scrollRaf = null;
  if (drag.scrollDir !== 0) {
    drag.list.scrollTop += drag.scrollDir * SCROLL_STEP_PX;
    updateDropSlot();
    drag.scrollRaf = requestAnimationFrame(scrollLoop);
  }
}

function moveGhost(e: MouseEvent): void {
  if (!drag) {
    return;
  }
  drag.lastY = e.clientY;
  drag.ghost.style.left = e.clientX + 10 + 'px';
  drag.ghost.style.top = e.clientY + 10 + 'px';

  const listRect = drag.list.getBoundingClientRect();
  drag.scrollDir = 0;
  if (e.clientY < listRect.top + SCROLL_EDGE_PX) {
    drag.scrollDir = -1;
  } else if (e.clientY > listRect.bottom - SCROLL_EDGE_PX) {
    drag.scrollDir = 1;
  }

  if (drag.scrollDir !== 0 && drag.scrollRaf === null) {
    drag.scrollRaf = requestAnimationFrame(scrollLoop);
  }
  updateDropSlot();
}

function swallowClick(e: MouseEvent): void {
  e.preventDefault();
  e.stopPropagation();
}

/* a drag that ends with the pointer still over the source tab produces a
   click, which would switch to that tab; suppress exactly one such click */
function suppressClickAfterDrag(node: HTMLElement): void {
  node.addEventListener('click', swallowClick, { capture: true, once: true });
}

function collectTabUids(list: HTMLElement): string[] {
  const uids: string[] = [];
  list.querySelectorAll(SELECTORS.tab).forEach((el) => {
    const uid = (el as HTMLElement).dataset.uid;
    if (uid && uids.indexOf(uid) === -1) {
      uids.push(uid);
    }
  });
  return uids;
}

/* Build the new order: current DOM tab order, with the dragged tab lifted
   out and re-inserted at the drop slot. lastIndex is the target position in
   the FULL list; after removing the dragged tab every slot below it shifts
   up by one. */
function dispatchOrder(list: HTMLElement, draggedUid: string, lastIndex: number): void {
  const uids = collectTabUids(list);
  const dragIndex = uids.indexOf(draggedUid);
  if (dragIndex === -1) {
    return;
  }
  const order = uids.filter((uid) => uid !== draggedUid);
  if (order.length < 1) {
    return;
  }
  const pos = lastIndex > dragIndex ? lastIndex - 1 : lastIndex;
  order.splice(Math.min(pos, order.length), 0, draggedUid);
  const store = getStore();
  if (store && typeof store.dispatch === 'function') {
    store.dispatch({ type: REORDER_ACTION, order });
  }
}

function cleanupDrag(): void {
  if (!drag) {
    return;
  }
  window.removeEventListener('mousemove', onMove);
  window.removeEventListener('mouseup', onUp);
  window.removeEventListener('keydown', onKey);
  if (drag.scrollRaf !== null) {
    cancelAnimationFrame(drag.scrollRaf);
  }
  drag.node.classList.remove(CLASSES.dragging);
  drag.ghost.remove();
  drag.indicator.remove();
  drag = null;
}

function onMove(e: MouseEvent): void {
  if (!drag) {
    return;
  }
  if (!drag.isArmed) {
    const dist = Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY);
    if (dist < DRAG_THRESHOLD_PX) {
      return;
    }
    drag.isArmed = true;
    document.body.appendChild(drag.ghost);
    drag.node.classList.add(CLASSES.dragging);
    drag.list.appendChild(drag.indicator);
    positionIndicator(computeTargetIndex(e.clientY, drag.list, drag.node));
  }
  e.preventDefault();
  moveGhost(e);
}

function onUp(): void {
  const wasArmed = !!(drag && drag.isArmed);
  const node = drag ? drag.node : null;
  const list = drag ? drag.list : null;
  const uid = drag ? drag.uid : null;
  const index = drag ? drag.lastIndex : 0;
  cleanupDrag();
  if (wasArmed && list && uid) {
    dispatchOrder(list, uid, index);
  }
  if (wasArmed && node) {
    suppressClickAfterDrag(node);
  }
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault();
    cancelDrag();
  }
}

export function cancelDrag(): void {
  cleanupDrag();
}

export function initTabDrag(node: HTMLElement, uid: string): void {
  if (!node || cleanupFns.has(node)) {
    return;
  }
  node.dataset.uid = uid;

  const onDown = (e: MouseEvent) => {
    if (e.button !== 0 || !e.target) {
      return;
    }
    const target = e.target as HTMLElement;
    if (target.closest && target.closest(SELECTORS.tabIcon)) {
      return; // close button keeps its own behavior
    }
    if (drag && drag.node === node) {
      return;
    }
    const list = node.parentElement;
    if (!list || list.querySelectorAll(SELECTORS.tab).length < 2) {
      return;
    }

    drag = {
      uid,
      node,
      list,
      ghost: buildGhost(node),
      indicator: document.createElement('div'),
      startX: e.clientX,
      startY: e.clientY,
      lastY: e.clientY,
      lastIndex: 0,
      isArmed: false,
      scrollDir: 0,
      scrollRaf: null,
    };
    drag.indicator.className = CLASSES.tabDropIndicator;
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('keydown', onKey);
  };

  node.addEventListener('mousedown', onDown);

  cleanupFns.set(node, () => {
    node.removeEventListener('mousedown', onDown);
    if (drag && drag.node === node) {
      cleanupDrag();
    }
  });
}

export function disposeTabDrag(node: HTMLElement): void {
  const cleanup = cleanupFns.get(node);
  if (cleanup) {
    cleanupFns.delete(node);
    cleanup();
  }
}
