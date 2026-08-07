/* Hyper's term-group tree: each pane is a leaf group holding a sessionUid,
   parent groups link panes into a tab (root group = tab). */
export interface TermGroup {
  uid: string;
  sessionUid: string | null;
  parentUid: string | null;
  children: string[];
}

interface HyperState {
  termGroups: {
    termGroups: Record<string, TermGroup>;
    activeSessions: Record<string, string>; // root group uid -> focused session uid
    activeRootGroup: string | null;
  };
  ui?: {
    cwd?: string;
  };
}

export interface HyperStore {
  getState: () => HyperState;
  dispatch?: (action: unknown) => unknown;
}

export interface HyperAction {
  type: string;
  uid?: string;
  data?: string;
  title?: string;
  cwd?: string;
  splitDirection?: string;
  activeUid?: string;
}
