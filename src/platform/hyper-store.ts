import { HyperStore, TermGroup } from '../types';

let appStore: HyperStore | null = null;

export function setStore(store: HyperStore | null): void {
  appStore = store;
}

export function getStore(): HyperStore | null {
  return appStore;
}

export function getTermGroups(): Record<string, TermGroup> {
  if (!appStore) {
    return {};
  }
  try {
    return appStore.getState().termGroups.termGroups;
  } catch {
    // the store may not be ready during startup; an empty result is a harmless fallback
    return {};
  }
}
