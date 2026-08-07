/* Tab reordering: Hyper derives tab order from the insertion order of root
   term-group keys in `state.termGroups.termGroups` (lib/selectors.ts
   getRootGroups). Hyper has no native reorder action, so this plugin ships
   a `reduceTermGroups` reducer decoration that handles a custom action and
   rebuilds the key order. Hyper's plugin loader runs every plugin's
   reduceTermGroups after its own term-groups reducer on each action. */

export const REORDER_ACTION = 'KIT_TAB_REORDER';

export interface ReorderAction {
  type: typeof REORDER_ACTION;
  order: string[];
}

function isReorderAction(action: unknown): action is ReorderAction {
  if (!action || typeof action !== 'object') {
    return false;
  }
  const candidate = action as { type?: unknown; order?: unknown };
  return candidate.type === REORDER_ACTION && Array.isArray(candidate.order);
}

function sameOrder(a: string[], b: string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return a.every((uid, i) => uid === b[i]);
}

export function reduceTermGroups(state: any, action: unknown): any {
  if (!isReorderAction(action)) {
    return state;
  }

  const current = state.termGroups;
  // a tab is a root group (no parent); split panes hang below their parent
  const roots = Object.keys(current).filter((uid) => !current[uid].parentUid);

  const wanted: string[] = [];
  for (const uid of action.order) {
    if (roots.indexOf(uid) !== -1 && wanted.indexOf(uid) === -1) {
      wanted.push(uid);
    }
  }

  // incomplete order (missing a root) is a broken payload: ignore it
  if (wanted.length !== roots.length) {
    return state;
  }

  if (sameOrder(wanted, roots)) {
    return state;
  }

  const next: Record<string, unknown> = {};
  wanted.forEach((uid) => {
    next[uid] = current[uid];
  });
  Object.keys(current).forEach((uid) => {
    if (!(uid in next)) {
      next[uid] = current[uid];
    }
  });

  // termGroups is a top-level key of the seamless-immutable state, so a
  // plain replacement of that key deep-converts on set()
  return state.set('termGroups', next);
}

export interface TabRect {
  top: number;
  bottom: number;
}

/* Each tab's vertical midpoint is the drop boundary. */
export function computeInsertIndex(pointerY: number, rects: TabRect[]): number {
  for (let i = 0; i < rects.length; i++) {
    const mid = (rects[i].top + rects[i].bottom) / 2;
    if (pointerY < mid) {
      return i;
    }
  }
  return rects.length;
}
