import React from 'react';

import {
  FONT_FAMILY,
  applyConfig,
  readUiConfig,
  isLeftPanelEnabled,
  isNewTabSameDirEnabled,
  isPaneCountBadgeEnabled,
  isConfirmCloseEnabled,
} from './config';
import { setStore, getFocusedSessionUid } from './platform/hyper-store';
import * as sessionTracking from './features/left-panel/session-tracking';
import {
  cwdMap,
  statusMap,
  sessionStart,
  agentMap,
  agentSource,
  getLastCwd,
} from './platform/state/tab-session-store';
import { attachControls } from './features/left-panel/tabbar';
import { reloadBottomPanel } from './features/bottom-panel';
import { reloadTopPanel } from './features/top-panel';
import { reloadEnvPanel } from './features/left-panel/env-panel';
import { reloadMediaPanel } from './features/left-panel/media-panel';
import { HyperStore, HyperAction } from './types';
import {
  decorateTab as decorateVerticalTab,
  decorateTabWithPanesBadge,
} from './features/left-panel/tabs';
import {
  interceptGroupExit,
  syncWindowCloseGuardState,
  type CloseAction,
} from './features/close-confirm';
import {
  ensureAgentMonitor,
  agentMonitorFocusChanged,
  agentMonitorScan,
  __agentMonitorDebug,
} from './features/agent-monitor';

export { reduceTermGroups } from './core/reorder';

export function decorateTab(Tab: React.ComponentType<any>): React.ComponentType<any> {
  if (isLeftPanelEnabled()) {
    return decorateVerticalTab(Tab);
  }
  // badge is independent of the vertical chrome: it also works on Hyper's
  // normal tab bar (with its own minimal stylesheet)
  return isPaneCountBadgeEnabled() ? decorateTabWithPanesBadge(Tab) : Tab;
}

export function decorateConfig(config: Record<string, any>): Record<string, any> {
  applyConfig(config);
  if (!isLeftPanelEnabled()) {
    return config;
  }
  return Object.assign({}, config, {
    fontSize: 14,
    fontFamily: FONT_FAMILY,
    padding: '0',
    backgroundColor: '#141414',
    borderColor: '#262626',
  });
}

function reloadPanels(): void {
  readUiConfig();
  reloadBottomPanel();
  reloadTopPanel();
  reloadEnvPanel();
  reloadMediaPanel();
}

function trackSessionAction(action: HyperAction, store: HyperStore): void {
  if (action.type === 'CONFIG_RELOAD') {
    reloadPanels();
    return;
  }
  if (action.type === 'SESSION_USER_DATA') {
    // Hyper's SESSION_USER_DATA carries no uid of its own: the session that
    // is typing is only reachable through the store's active-tab bookkeeping
    const uid = action.uid || getFocusedSessionUid();
    if (uid && action.data) {
      sessionTracking.onSessionUserData(uid, action.data);
    }
    return;
  }
  const uid = action.uid;
  if (!uid) {
    return;
  }
  switch (action.type) {
    case 'SESSION_ADD':
      sessionTracking.onSessionAdd(uid, store.getState().ui?.cwd);
      if (action.splitDirection && action.activeUid) {
        sessionTracking.onSessionSplit(uid, action.activeUid);
      }
      agentMonitorScan();
      break;
    case 'SESSION_SET_XTERM_TITLE':
      // Hyper parses OSC 0 window titles itself (xterm onTitleChange) and
      // dispatches them here with the session uid — the primary agent signal
      sessionTracking.onSessionXtermTitle(uid, action.title || '');
      break;
    case 'SESSION_RESIZE':
      sessionTracking.onSessionResize(uid);
      break;
    case 'TERM_GROUP_EXIT':
      sessionTracking.onTermGroupExit(uid);
      // a closed tab usually kills its opencode session server-side; scan
      // now so the dead session's stale card is swept right away
      agentMonitorScan();
      break;
    case 'SESSION_SET_ACTIVE':
      sessionTracking.onSessionSetActive(uid);
      agentMonitorFocusChanged();
      break;
    case 'SESSION_PTY_DATA':
      if (action.data) {
        sessionTracking.onSessionPtyData(uid, action.data);
      }
      break;
  }
}

/* a new tab opens in the active tab's directory: Hyper sets `cwd` itself only
   when the user picked one explicitly, so an absent cwd is ours to fill in.
   Only in vertical mode — normal tabs keep Hyper's stock behavior */
function withInheritedCwd(action: HyperAction): HyperAction {
  const inherits =
    action.type === 'TERM_GROUP_ADD' &&
    isLeftPanelEnabled() &&
    isNewTabSameDirEnabled() &&
    action.cwd === undefined;
  const lastCwd = getLastCwd();
  if (!inherits || !lastCwd) {
    return action;
  }
  return Object.assign({}, action, { cwd: lastCwd });
}

export const middleware =
  (store: HyperStore) =>
  (next: (action: HyperAction | null) => unknown) =>
  (action: HyperAction | null): unknown => {
    setStore(store);
    ensureAgentMonitor();
    if (!action) {
      return next(action);
    }
    // guard Hyper's OS window close (traffic light, Cmd+W, Cmd+Q) with the
    // same confirmation; the main process intercepts the window's close
    // event and shows a native dialog — this renderer only reports the
    // guard state (confirmClose setting + running-tab count) for that
    // decision (see onWindow)
    syncWindowCloseGuardState();
    // closing a tab that is running a command asks for confirmation first;
    // runs in every mode, so it also guards Hyper's normal tab bar. The
    // confirmed re-dispatch carries _kitConfirmed and passes through.
    if (
      isConfirmCloseEnabled() &&
      action.type === 'TERM_GROUP_EXIT' &&
      interceptGroupExit(action as CloseAction)
    ) {
      return undefined;
    }
    // session tracking also powers the pane-count badge on normal tabs, so
    // run it whenever either the vertical chrome or the badge is enabled
    if (!isLeftPanelEnabled() && !isPaneCountBadgeEnabled()) {
      return next(action);
    }
    trackSessionAction(action, store);
    return next(withInheritedCwd(action));
  };

export function getTabProps(item: any, _parentProps: any, props: any): any {
  const uid = item && item.uid;
  return uid ? Object.assign({}, props, { _tabUid: uid }) : props;
}

export function decorateHeader(Header: React.ComponentType<any>): React.ComponentType<any> {
  if (!isLeftPanelEnabled()) {
    return Header;
  }
  return class TabBarHeader extends React.PureComponent<any> {
    dispose?: () => void;

    componentDidMount(): void {
      this.dispose = attachControls();
    }

    componentWillUnmount(): void {
      if (this.dispose) {
        this.dispose();
      }
    }

    render(): React.ReactNode {
      return React.createElement(Header, this.props);
    }
  };
}

/* keep live state inspectable from the devtools console */
export const __debug = {
  cwdMap,
  statusMap,
  sessionStart,
  agentMap,
  agentSource,
  getLastCwd,
  agentMonitor: __agentMonitorDebug.agentMonitor,
};

/* Main-process hook: Hyper calls onWindow(win) for every window. This is
   where the OS window close (traffic light, Cmd+W, Cmd+Q) gets guarded.
   The confirmation itself is a native dialog shown from the main process —
   a renderer HTML dialog or a beforeunload guard is unreliable here (a
   cancelled close can leave the transparent window ignoring input until a
   second manual close). Flow:

   - the renderer keeps this side informed via 'hyper-kit-close-guard-state'
     {enabled, running} — the confirmClose setting plus how many tabs are
     running a command (see syncWindowCloseGuardState).
   - win 'close' → if a confirmation is needed, prevent it and show a native
     dialog; 'Quit Anyway' closes for real. A win.close() from the main
     process is always honoured, so the first confirm works. While the
     native modal is up the window is disabled (expected), and dismissing it
     restores the window cleanly.
   - until the first state message arrives (or if the renderer died) the
     close is never trapped. */
export function onWindow(win: {
  webContents?: unknown;
  close: () => void;
  on: (e: string, f: (...args: never[]) => void) => void;
  removeListener: (e: string, f: (...args: never[]) => void) => void;
}): void {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const electron = require('electron') as {
    ipcMain: {
      on: (channel: string, listener: (event: { sender: unknown }) => void) => void;
      removeListener: (channel: string, listener: (event: { sender: unknown }) => void) => void;
    };
    dialog: {
      showMessageBox: (
        window: unknown,
        options: {
          type: string;
          buttons: string[];
          defaultId: number;
          cancelId: number;
          message: string;
          detail: string;
        },
      ) => Promise<{ response: number }>;
    };
  };
  const stateChannel = 'hyper-kit-close-guard-state';
  let confirmed = false;
  let armed = false;
  let enabled = true;
  let running = 0;

  const fromThisWindow = (event: { sender: unknown }): boolean => {
    // match by webContents id: more robust across Electron versions than
    // relying on object identity between event.sender and win.webContents
    const sender = event.sender as { id?: number } | null | undefined;
    const contents = win.webContents as { id?: number } | null | undefined;
    return Boolean(sender && contents && sender.id === contents.id);
  };

  const onGuardState = (event: { sender: unknown }, state?: unknown): void => {
    if (!fromThisWindow(event)) {
      return;
    }
    const s = (state ?? {}) as { enabled?: unknown; running?: unknown };
    armed = true;
    enabled = s.enabled !== false;
    running = typeof s.running === 'number' ? s.running : 0;
  };

  const onClose = (e: { preventDefault: () => void }): void => {
    if (confirmed) {
      confirmed = false;
      return;
    }
    if (!armed || !enabled || running === 0) {
      return; // no confirmation needed: never trap the window
    }
    e.preventDefault();
    void electron.dialog
      .showMessageBox(win, {
        type: 'warning',
        buttons: ['Cancel', 'Quit Anyway'],
        defaultId: 0,
        cancelId: 0,
        message: 'Processes still running',
        detail: 'One or more tabs are still running a command. Quitting Hyper will stop them.',
      })
      .then(({ response }) => {
        if (response === 1) {
          confirmed = true;
          win.close();
        }
      });
  };

  win.on('close', onClose);
  electron.ipcMain.on(stateChannel, onGuardState);
  const cleanup = (): void => {
    win.removeListener('close', onClose);
    electron.ipcMain.removeListener(stateChannel, onGuardState);
  };
  win.on('closed', cleanup);
  // never trap a window whose renderer has died (crash, force-reload)
  (win.webContents as { on?: (e: string, f: () => void) => void } | undefined)?.on?.(
    'render-process-gone',
    () => {
      armed = false;
    },
  );
}
