import { rootGroupUidOfGroup, getStore, getTermGroups } from '../platform/hyper-store';
import { statusMap } from '../platform/state/tab-session-store';
import { CLASSES } from '../platform/dom-selectors';
import { injectCloseConfirmStyle } from '../platform/style-injector';
import { isConfirmCloseEnabled } from '../config';
import type { HyperAction } from '../types';

/* Internal marker: set by the confirm dialog's "Close Tab" button so the
   re-dispatched TERM_GROUP_EXIT passes through the interception instead of
   re-prompting. Stripped before the action is forwarded. */
export type CloseAction = HyperAction & { _kitConfirmed?: boolean };

const COPY = {
  title: 'Command still running',
  body: 'A process is still running in this tab. Closing it will stop the process.',
  cancel: 'Cancel',
  confirm: 'Close Tab',
};

interface ConfirmDialogOptions {
  onConfirm?: () => void;
  title?: string;
  body?: string;
  confirmLabel?: string;
}

let activeDialog: HTMLDivElement | null = null;
let activeKeyHandler: ((e: KeyboardEvent) => void) | null = null;
let lastSentGuardState: string | null = null;

/* IPC channel shared with the main process (see onWindow in index.ts). The
   main process intercepts the BrowserWindow's close event (traffic light,
   Cmd+W, Cmd+Q) and shows a native confirmation dialog; this renderer just
   keeps it informed of whether a confirmation is needed: the channel carries
   the confirmClose setting plus how many tabs are running a command. */
const GUARD_STATE_CHANNEL = 'hyper-kit-close-guard-state';

interface GuardState {
  enabled: boolean;
  running: number;
}

interface ElectronIpc {
  send: (channel: string, payload?: unknown) => void;
}

/* The renderer's ipcRenderer: window.require works in Hyper's renderer
   (nodeIntegration), bare require as a fallback for hosts that only expose
   the module-scope one. Returns null outside Electron (tests, exotic hosts). */
function getIpcRenderer(): ElectronIpc | null {
  try {
    const nodeRequire = (window as { require?: unknown }).require ?? require;
    const electron = (nodeRequire as (mod: string) => unknown)('electron') as {
      ipcRenderer?: ElectronIpc;
    };
    return electron?.ipcRenderer ?? null;
  } catch {
    return null;
  }
}

/* How many tabs in the window are currently running a command? Root groups
   are the tabs; statusMap is keyed by root group uid. */
function runningTabCount(): number {
  const groups = getTermGroups();
  let count = 0;
  for (const key in groups) {
    if (!groups[key]?.parentUid && statusMap.get(key) === 'running') {
      count++;
    }
  }
  return count;
}

/* Resolve the tab (root group) the closed group belongs to and check whether
   it is currently running a command. Unknown/unresolvable groups pass
   through without a dialog. */
function isTabBusy(groupUid: string): boolean {
  const root = rootGroupUidOfGroup(groupUid);
  return root ? statusMap.get(root) === 'running' : false;
}

/* Called from the middleware on TERM_GROUP_EXIT. Returns true when the close
   was intercepted (dialog shown, action must be swallowed). Confirmed
   re-dispatches carry _kitConfirmed and always pass through. */
export function interceptGroupExit(action: CloseAction): boolean {
  if (action._kitConfirmed) {
    delete action._kitConfirmed;
    return false;
  }
  const uid = action.uid;
  if (!uid || !isTabBusy(uid)) {
    return false;
  }
  showConfirmDialog(action);
  return true;
}

export function showConfirmDialog(action: CloseAction, options?: ConfirmDialogOptions): void {
  if (activeDialog) {
    return; // one confirmation at a time; the pending close stays swallowed
  }
  const copy = {
    title: options?.title ?? COPY.title,
    body: options?.body ?? COPY.body,
    confirm: options?.confirmLabel ?? COPY.confirm,
  };
  injectCloseConfirmStyle();
  const overlay = document.createElement('div');
  overlay.className = CLASSES.closeConfirm;
  overlay.setAttribute('role', 'presentation');

  const card = document.createElement('div');
  card.className = CLASSES.closeConfirmCard;
  card.setAttribute('role', 'alertdialog');
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-labelledby', 'kit-close-confirm-title');

  const title = document.createElement('div');
  title.id = 'kit-close-confirm-title';
  title.className = CLASSES.closeConfirmTitle;
  title.textContent = copy.title;

  const body = document.createElement('div');
  body.className = CLASSES.closeConfirmBody;
  body.textContent = copy.body;

  const actions = document.createElement('div');
  actions.className = CLASSES.closeConfirmActions;

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = CLASSES.closeConfirmCancel;
  cancel.textContent = COPY.cancel;

  const confirm = document.createElement('button');
  confirm.type = 'button';
  confirm.className = CLASSES.closeConfirmDanger;
  confirm.textContent = copy.confirm;

  actions.append(cancel, confirm);
  card.append(title, body, actions);
  overlay.appendChild(card);

  const close = (): void => {
    if (activeKeyHandler) {
      document.removeEventListener('keydown', activeKeyHandler);
      activeKeyHandler = null;
    }
    overlay.remove();
    if (activeDialog === overlay) {
      activeDialog = null;
    }
  };

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  };

  cancel.addEventListener('click', close);
  confirm.addEventListener('click', () => {
    close();
    if (options?.onConfirm) {
      options.onConfirm();
      return;
    }
    const store = getStore();
    if (store && typeof store.dispatch === 'function') {
      store.dispatch({ ...action, _kitConfirmed: true });
    }
  });
  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay) {
      close();
    }
  });
  document.addEventListener('keydown', onKey);
  activeKeyHandler = onKey;

  document.body.appendChild(overlay);
  activeDialog = overlay;
  cancel.focus();
}

/* Test hook: dismiss an open dialog without confirming or dispatching. */
export function removeCloseConfirmDialog(): void {
  if (activeKeyHandler) {
    document.removeEventListener('keydown', activeKeyHandler);
    activeKeyHandler = null;
  }
  activeDialog?.remove();
  activeDialog = null;
}

/* Keep the main process informed of the guard state. The middleware calls
   this on every action; the IPC fires only when the state actually changed
   (config toggle or a tab's running status flipping), so it stays silent
   during normal typing. The main process uses the last reported state to
   decide whether the window close needs a native confirmation dialog. */
export function syncWindowCloseGuardState(): void {
  const ipc = getIpcRenderer();
  if (!ipc || typeof ipc.send !== 'function') {
    return; // not running inside Electron: nothing to sync
  }
  const state: GuardState = {
    enabled: isConfirmCloseEnabled(),
    running: runningTabCount(),
  };
  const key = `${state.enabled}:${state.running}`;
  if (key === lastSentGuardState) {
    return;
  }
  lastSentGuardState = key;
  ipc.send(GUARD_STATE_CHANNEL, state);
}

/* Test hook: drop the cached state so the next sync re-sends. */
export function resetWindowCloseGuard(): void {
  lastSentGuardState = null;
}
