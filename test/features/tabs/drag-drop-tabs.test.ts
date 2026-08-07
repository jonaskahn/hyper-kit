import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  computeTargetIndex,
  initTabDrag,
  disposeTabDrag,
  cancelDrag,
} from '../../../src/features/tabs/drag-drop-tabs';
import { REORDER_ACTION } from '../../../src/core/reorder';
import { setStore } from '../../../src/platform/hyper-store';

const TAB_H = 60;

function mockRect(el: HTMLElement, top: number) {
  el.getBoundingClientRect = () =>
    ({ top, bottom: top + TAB_H, left: 0, right: 200, height: TAB_H, width: 200 }) as DOMRect;
}

function mouse(target: EventTarget, type: string, opts: { clientX: number; clientY: number }) {
  target.dispatchEvent(
    new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...opts }),
  );
}

let list: HTMLElement;
let tabs: HTMLElement[];
let dispatchSpy: ReturnType<typeof vi.fn>;
let store: { getState: () => unknown; dispatch: ReturnType<typeof vi.fn> };

function setupDom(uids: string[]) {
  list = document.createElement('ul');
  list.className = 'tabs_list';
  tabs = uids.map((uid, i) => {
    const t = document.createElement('li');
    t.className = 'tab_tab';
    mockRect(t, i * TAB_H);
    list.appendChild(t);
    return t;
  });
  mockRect(list, 0);
  document.body.appendChild(list);
}

beforeEach(() => {
  document.body.innerHTML = '';
  dispatchSpy = vi.fn();
  store = { getState: () => ({}), dispatch: dispatchSpy };
  setStore(store);
});

afterEach(() => {
  cancelDrag();
  setStore(null);
});

describe('computeTargetIndex', () => {
  it('maps a downward move one slot further than the raw insert index', () => {
    setupDom(['a', 'b', 'c']);
    // dragging 'a' below everything: raw index (w/o 'a') = 2 -> target 3
    expect(computeTargetIndex(200, list, tabs[0])).toBe(3);
    // dragging 'a' between b and c: raw index 1 -> target 2
    expect(computeTargetIndex(130, list, tabs[0])).toBe(2);
    // dragging 'c' to the top: raw index 0 -> target 0
    expect(computeTargetIndex(10, list, tabs[2])).toBe(0);
    // dragging 'b' stays put: raw index 1 -> target 1
    expect(computeTargetIndex(90, list, tabs[1])).toBe(1);
  });

  it('returns 0 for a single tab at any pointer position', () => {
    setupDom(['a']);
    expect(computeTargetIndex(10, list, tabs[0])).toBe(0);
    expect(computeTargetIndex(999, list, tabs[0])).toBe(0);
  });

  it('treats the exact midpoint as the slot below it', () => {
    setupDom(['a', 'b', 'c']);
    // dragging 'b' with the pointer exactly on a's bottom edge (mid of the
    // remaining list) keeps it in place
    expect(computeTargetIndex(60, list, tabs[1])).toBe(1);
  });
});

describe('tab drag controller', () => {
  it('is a plain click when the pointer never moves past the threshold', () => {
    setupDom(['a', 'b', 'c']);
    initTabDrag(tabs[0], 'a');
    mouse(tabs[0], 'mousedown', { clientX: 10, clientY: 10 });
    mouse(window, 'mouseup', { clientX: 12, clientY: 12 });
    expect(dispatchSpy).not.toHaveBeenCalled();
    expect(document.querySelector('.kit-tab-drag-ghost')).toBeNull();
    expect(document.querySelector('.kit-tab-drop-indicator')).toBeNull();
  });

  it('dispatches the new order on drop (top to bottom)', () => {
    setupDom(['a', 'b', 'c']);
    tabs.forEach((t, i) => initTabDrag(t, ['a', 'b', 'c'][i]));

    mouse(tabs[0], 'mousedown', { clientX: 10, clientY: 10 });
    mouse(window, 'mousemove', { clientX: 30, clientY: 150 });
    expect(document.querySelector('.kit-tab-drag-ghost')).not.toBeNull();
    expect(document.querySelector('.kit-tab-drop-indicator')).not.toBeNull();
    // pointer below all tabs: indicator sits at the very bottom edge (c's bottom)
    const indicator = document.querySelector('.kit-tab-drop-indicator') as HTMLElement;
    expect(indicator.style.top).toBe('180px');

    mouse(window, 'mouseup', { clientX: 30, clientY: 150 });
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    expect(dispatchSpy).toHaveBeenCalledWith({ type: REORDER_ACTION, order: ['b', 'c', 'a'] });
  });

  it('dispatches the new order on drop (bottom to top)', () => {
    setupDom(['a', 'b', 'c']);
    tabs.forEach((t, i) => initTabDrag(t, ['a', 'b', 'c'][i]));

    mouse(tabs[2], 'mousedown', { clientX: 10, clientY: 150 });
    mouse(window, 'mousemove', { clientX: 30, clientY: 10 });
    const indicator = document.querySelector('.kit-tab-drop-indicator') as HTMLElement;
    expect(indicator.style.top).toBe('0px');

    mouse(window, 'mouseup', { clientX: 30, clientY: 10 });
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    expect(dispatchSpy).toHaveBeenCalledWith({ type: REORDER_ACTION, order: ['c', 'a', 'b'] });
  });

  it('does not dispatch when the order is unchanged', () => {
    setupDom(['a', 'b']);
    tabs.forEach((t, i) => initTabDrag(t, ['a', 'b'][i]));
    mouse(tabs[0], 'mousedown', { clientX: 10, clientY: 10 });
    mouse(window, 'mousemove', { clientX: 30, clientY: 20 });
    mouse(window, 'mouseup', { clientX: 30, clientY: 20 });
    expect(dispatchSpy).toHaveBeenCalledWith({ type: REORDER_ACTION, order: ['a', 'b'] });
  });

  it('Escape cancels the drag without dispatching', () => {
    setupDom(['a', 'b', 'c']);
    tabs.forEach((t, i) => initTabDrag(t, ['a', 'b', 'c'][i]));
    mouse(tabs[0], 'mousedown', { clientX: 10, clientY: 10 });
    mouse(window, 'mousemove', { clientX: 40, clientY: 40 });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    mouse(window, 'mouseup', { clientX: 40, clientY: 40 });
    expect(dispatchSpy).not.toHaveBeenCalled();
    expect(document.querySelector('.kit-tab-drag-ghost')).toBeNull();
    expect(document.querySelector('.kit-tab-drop-indicator')).toBeNull();
  });

  it('never starts a drag on the close button', () => {
    setupDom(['a', 'b']);
    tabs.forEach((t, i) => initTabDrag(t, ['a', 'b'][i]));
    const close = document.createElement('div');
    close.className = 'tab_icon';
    tabs[0].appendChild(close);
    mouse(close, 'mousedown', { clientX: 10, clientY: 10 });
    mouse(window, 'mousemove', { clientX: 60, clientY: 60 });
    mouse(window, 'mouseup', { clientX: 60, clientY: 60 });
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it('never starts a drag with only one tab', () => {
    setupDom(['a']);
    initTabDrag(tabs[0], 'a');
    mouse(tabs[0], 'mousedown', { clientX: 10, clientY: 10 });
    mouse(window, 'mousemove', { clientX: 60, clientY: 60 });
    mouse(window, 'mouseup', { clientX: 60, clientY: 60 });
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it('disposeTabDrag removes listeners and cleans up an in-flight drag', () => {
    setupDom(['a', 'b']);
    tabs.forEach((t, i) => initTabDrag(t, ['a', 'b'][i]));
    mouse(tabs[0], 'mousedown', { clientX: 10, clientY: 10 });
    mouse(window, 'mousemove', { clientX: 40, clientY: 40 });
    disposeTabDrag(tabs[0]);
    expect(document.querySelector('.kit-tab-drag-ghost')).toBeNull();
    expect(document.querySelector('.kit-tab-drop-indicator')).toBeNull();
    mouse(window, 'mouseup', { clientX: 40, clientY: 40 });
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it('Escape before the drag arms cancels without side effects', () => {
    setupDom(['a', 'b']);
    tabs.forEach((t, i) => initTabDrag(t, ['a', 'b'][i]));
    mouse(tabs[0], 'mousedown', { clientX: 10, clientY: 10 });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    mouse(window, 'mouseup', { clientX: 12, clientY: 12 });
    expect(dispatchSpy).not.toHaveBeenCalled();
    expect(document.querySelector('.kit-tab-drag-ghost')).toBeNull();
    expect(document.querySelector('.kit-tab-drop-indicator')).toBeNull();
  });

  it('never starts a drag on a non-left mouse button', () => {
    setupDom(['a', 'b']);
    tabs.forEach((t, i) => initTabDrag(t, ['a', 'b'][i]));
    tabs[0].dispatchEvent(
      new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
        button: 2,
        clientX: 10,
        clientY: 10,
      }),
    );
    mouse(window, 'mousemove', { clientX: 60, clientY: 60 });
    mouse(window, 'mouseup', { clientX: 60, clientY: 60 });
    expect(dispatchSpy).not.toHaveBeenCalled();
    expect(document.querySelector('.kit-tab-drag-ghost')).toBeNull();
  });

  it('reorders two tabs', () => {
    setupDom(['a', 'b']);
    tabs.forEach((t, i) => initTabDrag(t, ['a', 'b'][i]));
    mouse(tabs[0], 'mousedown', { clientX: 10, clientY: 10 });
    mouse(window, 'mousemove', { clientX: 30, clientY: 90 });
    mouse(window, 'mouseup', { clientX: 30, clientY: 90 });
    expect(dispatchSpy).toHaveBeenCalledWith({ type: REORDER_ACTION, order: ['b', 'a'] });
  });

  it('initTabDrag is idempotent per node and disposeTabDrag is a safe no-op on unknown nodes', () => {
    setupDom(['a', 'b']);
    tabs.forEach((t, i) => initTabDrag(t, ['a', 'b'][i]));
    initTabDrag(tabs[0], 'a'); // second init on the same node must be a no-op
    mouse(tabs[0], 'mousedown', { clientX: 10, clientY: 10 });
    mouse(window, 'mousemove', { clientX: 40, clientY: 40 });
    mouse(window, 'mouseup', { clientX: 40, clientY: 40 });
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    expect(() => disposeTabDrag(tabs[0])).not.toThrow();
    expect(() => disposeTabDrag(tabs[1])).not.toThrow();
  });
});

describe('drag visuals', () => {
  it('ghost follows the cursor offset by 10px', () => {
    setupDom(['a', 'b']);
    tabs.forEach((t, i) => initTabDrag(t, ['a', 'b'][i]));
    mouse(tabs[0], 'mousedown', { clientX: 10, clientY: 10 });
    mouse(window, 'mousemove', { clientX: 100, clientY: 200 });
    const ghost = document.querySelector('.kit-tab-drag-ghost') as HTMLElement;
    expect(ghost).not.toBeNull();
    expect(ghost.style.left).toBe('110px');
    expect(ghost.style.top).toBe('210px');
    mouse(window, 'mouseup', { clientX: 100, clientY: 200 });
  });

  it('drop indicator sits on the next tab boundary when hovering between tabs', () => {
    setupDom(['a', 'b', 'c']);
    tabs.forEach((t, i) => initTabDrag(t, ['a', 'b', 'c'][i]));
    mouse(tabs[0], 'mousedown', { clientX: 10, clientY: 10 });
    mouse(window, 'mousemove', { clientX: 30, clientY: 130 });
    const indicator = document.querySelector('.kit-tab-drop-indicator') as HTMLElement;
    expect(indicator.style.top).toBe('120px'); // c's top edge
    mouse(window, 'mouseup', { clientX: 30, clientY: 130 });
  });

  it('marks the dragged tab while armed and clears it on drop', () => {
    setupDom(['a', 'b']);
    tabs.forEach((t, i) => initTabDrag(t, ['a', 'b'][i]));
    mouse(tabs[0], 'mousedown', { clientX: 10, clientY: 10 });
    mouse(window, 'mousemove', { clientX: 40, clientY: 40 });
    expect(tabs[0].classList.contains('kit-tab-dragging')).toBe(true);
    mouse(window, 'mouseup', { clientX: 40, clientY: 40 });
    expect(tabs[0].classList.contains('kit-tab-dragging')).toBe(false);
  });
});

describe('edge auto-scroll', () => {
  function mockScrollableList(height = 600, scrollTop = 40) {
    list.getBoundingClientRect = () =>
      ({ top: 0, bottom: height, left: 0, right: 200, height, width: 200 }) as DOMRect;
    let top = scrollTop;
    Object.defineProperty(list, 'scrollTop', {
      get: () => top,
      set: (v: number) => {
        top = Math.max(0, v);
      },
      configurable: true,
    });
  }

  const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

  it('scrolls toward the top edge while the pointer hugs it, then stops in the middle', async () => {
    setupDom(['a', 'b', 'c', 'd']);
    tabs.forEach((t, i) => initTabDrag(t, ['a', 'b', 'c', 'd'][i]));
    mockScrollableList();

    mouse(tabs[0], 'mousedown', { clientX: 10, clientY: 10 });
    mouse(window, 'mousemove', { clientX: 30, clientY: 10 });
    await nextFrame();
    expect(list.scrollTop).toBeLessThan(40);

    mouse(window, 'mousemove', { clientX: 30, clientY: 300 });
    const stoppedAt = list.scrollTop;
    await nextFrame();
    await nextFrame();
    expect(list.scrollTop).toBe(stoppedAt);
    mouse(window, 'mouseup', { clientX: 30, clientY: 300 });
  });

  it('scrolls toward the bottom edge while the pointer hugs it', async () => {
    setupDom(['a', 'b', 'c', 'd']);
    tabs.forEach((t, i) => initTabDrag(t, ['a', 'b', 'c', 'd'][i]));
    mockScrollableList();

    mouse(tabs[0], 'mousedown', { clientX: 10, clientY: 10 });
    mouse(window, 'mousemove', { clientX: 30, clientY: 590 });
    await nextFrame();
    expect(list.scrollTop).toBeGreaterThan(40);
    mouse(window, 'mouseup', { clientX: 30, clientY: 590 });
  });
});
