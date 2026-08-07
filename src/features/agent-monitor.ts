/* Agent monitor feature: wires the monitor orchestrator to the popup UI and
   to Hyper's window events (tab activity, focus changes, agent detection).
   Started lazily on the first store action so config is applied and the
   store exists. */

import { isAgentMonitorEnabled } from '../config';
import { onAgentsChanged } from '../platform/event-bus';
import {
  agentMonitor,
  agentMonitorOnFocusChanged,
  agentMonitorRequestScan,
  startAgentMonitor,
} from '../platform/agent-monitor/monitor';
import { createPopup, type PopupHandlers } from '../platform/agent-monitor/popup';

let started = false;
let popup: ReturnType<typeof createPopup> | null = null;

const popupHandlers: PopupHandlers = {
  onReply: (entry, reply, message) => agentMonitor.replyPermission(entry, reply, message),
  onAnswer: (entry, answers) => agentMonitor.answerQuestion(entry, answers),
  onReject: (entry) => agentMonitor.reject(entry),
  onDismiss: (entry) => agentMonitor.dismiss(entry),
  onView: (entry) => {
    agentMonitor.viewTab(entry);
  },
  onHintDismiss: (tabUid) => {
    agentMonitor.dismissHint(tabUid);
  },
};

export function ensureAgentMonitor(): void {
  if (started) {
    return;
  }
  started = true;
  if (!isAgentMonitorEnabled()) {
    return;
  }
  popup = createPopup(popupHandlers);
  startAgentMonitor({
    onShow: (entry) => popup?.show(entry),
    onShowHint: (tabUid, directory) => popup?.showHint(tabUid, directory),
  });
  onAgentsChanged(() => agentMonitorRequestScan());
}

export function agentMonitorFocusChanged(): void {
  agentMonitorOnFocusChanged();
}

/* A tab was added or closed (either can change which sessions exist): the
   next scan re-fetches the instances' session lists, which is also what
   sweeps dead sessions' stale requests off the queue. */
export function agentMonitorScan(): void {
  agentMonitorRequestScan();
}

export const __agentMonitorDebug = {
  agentMonitor,
};
