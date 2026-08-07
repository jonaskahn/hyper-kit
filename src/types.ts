export interface TermGroup {
  sessionUid: string;
}

export interface HyperState {
  termGroups: {
    termGroups: Record<string, TermGroup>;
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
  cwd?: string;
}
