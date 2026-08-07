/* Edge-docked drawer cards for opencode permission requests and questions
   (and the one-time hint card for serverless opencode launches). The card
   is flush with the window's top or bottom edge and slides in/out like a
   classic macOS drawer; an invisible click-catcher replaces the old dim
   backdrop. Dismissing (Escape) only closes the card -- the request stays
   pending, so the agent is never rejected by accident; the explicit Deny
   button (with optional reason) is the only way to reject. With persist
   enabled the card is sticky: only its buttons (or Escape) interact with
   it. Cards are risk-coded (icon + accent color) from the permission kind,
   and metadata is parsed into named fields instead of a raw JSON dump where
   the live opencode API exposes named strings (see kind-meta.ts). */

import { CLASSES } from '../dom-selectors';
import { injectAgentMonitorStyle } from '../style-injector';
import { getAgentMonitorPosition, isAgentMonitorPersistEnabled } from '../../config';
import { tabLabelOf, agentOfTab } from './discovery';
import { iconFor, maskTint, agentAccent, tileBackground } from '../../core/agent-icons';
import { describeMetadata, getKindMeta, iconMarkup, type RiskTier } from './kind-meta';
import type { PermissionPendingEntry, PendingEntry, QuestionPendingEntry } from './store';
import type { PermissionReply, QuestionInfo } from './types';

export interface PopupHandlers {
  /* Resolve to whether the server actually recorded the reply -- a false
     result keeps the card open with an inline error instead of vanishing
     as if it had worked. */
  onReply(entry: PendingEntry, reply: PermissionReply, message?: string): Promise<boolean>;
  onAnswer(entry: PendingEntry, answers: string[][]): Promise<boolean>;
  onReject(entry: PendingEntry): Promise<boolean>;
  onView(entry: PendingEntry): void;
  /* The card was dismissed without answering (Escape / click-outside);
     the request stays pending, the monitor advances its queue. */
  onDismiss(entry: PendingEntry): void;
  onHintDismiss(tabUid: string): void;
}

interface PopupController {
  /* Show the entry's card (or hide everything when null). Requests stay
     pending when hidden — the popup may reappear on focus changes. */
  show(entry: PendingEntry | null): void;
  showHint(tabUid: string, directory: string | null): void;
  destroy(): void;
}

type Current =
  | { kind: 'request'; entry: PendingEntry }
  | { kind: 'hint'; tabUid: string; directory: string | null }
  | null;

const RISK_CLASS: Record<RiskTier, string> = {
  low: CLASSES.agentMonitorRiskLow,
  medium: CLASSES.agentMonitorRiskMedium,
  high: CLASSES.agentMonitorRiskHigh,
};

const MAX_VISIBLE_PATTERNS = 6;
const SEND_ERROR = "Couldn't reach opencode — try again.";
/* Backdrop clicks are ignored while the card is still sliding in, so a fast
   click that lands on the invisible catcher (card not yet at its final
   position) can't silently dismiss the card. */
const ENTRANCE_GUARD_MS = 350;
/* If a reply neither resolves nor fails within this window (the HTTP client
   times out at 4s), the card is released again instead of staying disabled
   forever. */
const REPLY_WATCHDOG_MS = 4500;
/* A dismissed request stays out of sight for this long even though it is
   still pending (refreshPopup would otherwise re-show it on the next scan).
   After the window, the card returns as a "still waiting" reminder. */
const DISMISS_SUPPRESS_MS = 120000;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

function dirLabel(directory: string | null): string {
  if (!directory) {
    return 'unknown directory';
  }
  const parts = directory.replace(/[\\/]+$/, '').split(/[\\/]/);
  return parts[parts.length - 1] || directory;
}

/* "project · opencode session title · :port" — names the session the card
   belongs to so an answer can't silently target a different one. */
function requestOrigin(entry: PendingEntry): string {
  const parts: string[] = [dirLabel(entry.directory)];
  if (entry.tabUid) {
    const label = tabLabelOf(entry.tabUid);
    if (label && !parts.includes(label)) {
      parts.push(label);
    }
  }
  parts.push(`:${entry.target.port}`);
  return parts.join(' · ');
}

export function createPopup(handlers: PopupHandlers): PopupController {
  let current: Current = null;
  let overlay: HTMLDivElement | null = null;
  let keyHandler: ((e: KeyboardEvent) => void) | null = null;
  let closeTimer: ReturnType<typeof setTimeout> | null = null;
  let destroyed = false;
  /* requestID -> suppressed until (ms epoch): dismissed requests stay hidden
     for a while even though they are still pending. */
  const suppressed = new Map<string, number>();

  const cancelClose = (): void => {
    if (closeTimer) {
      clearTimeout(closeTimer);
      closeTimer = null;
    }
  };

  const teardown = (): void => {
    cancelClose();
    if (keyHandler) {
      document.removeEventListener('keydown', keyHandler);
      keyHandler = null;
    }
    if (overlay) {
      overlay.remove();
      overlay = null;
    }
  };

  /* Slide the card back into the edge, then remove the layer once the exit
     animation finishes (with a timer fallback — animationend may never fire,
     e.g. in tests or when the animation is disabled). */
  const closeAnimated = (): void => {
    if (!overlay) {
      return;
    }
    const layer = overlay;
    if (layer.classList.contains(CLASSES.agentMonitorClosing)) {
      return;
    }
    layer.classList.add(CLASSES.agentMonitorClosing);
    const card = layer.querySelector(`.${CLASSES.agentMonitorCard}`);
    let done = false;
    const finish = (): void => {
      if (done) {
        return;
      }
      done = true;
      if (overlay === layer) {
        teardown();
      }
    };
    card?.addEventListener('animationend', finish, { once: true });
    closeTimer = setTimeout(finish, 250);
  };

  /* Non-destructive: closes the card without answering the request, so the
     agent keeps waiting (and the card can return) instead of being rejected
     by an accidental Escape or backdrop click. Only the hint carries no
     pending request, so its dismissal is recorded for good. */
  const dismissActive = (): void => {
    if (current?.kind === 'request') {
      handlers.onDismiss(current.entry);
      const until = Date.now() + DISMISS_SUPPRESS_MS;
      if (suppressed.size >= 32) {
        // keep the map from growing unboundedly: drop expired entries
        for (const [id, t] of suppressed) {
          if (t <= Date.now()) {
            suppressed.delete(id);
          }
        }
      }
      suppressed.set(current.entry.requestID, until);
    } else if (current?.kind === 'hint') {
      handlers.onHintDismiss(current.tabUid);
    }
    current = null;
    closeAnimated();
  };

  const makeOverlay = (card: HTMLElement): void => {
    teardown();
    const layer = document.createElement('div');
    layer.className = CLASSES.agentMonitor;
    const position = getAgentMonitorPosition();
    if (position === 'top') {
      layer.classList.add('kit-amon-top');
    } else if (position === 'bottom') {
      layer.classList.add('kit-amon-bottom');
    }
    layer.setAttribute('role', 'presentation');
    const mountedAt = Date.now();
    const backdrop = document.createElement('div');
    backdrop.className = CLASSES.agentMonitorBackdrop;
    backdrop.addEventListener('mousedown', (e) => {
      if (e.target !== backdrop) {
        return;
      }
      if (Date.now() - mountedAt < ENTRANCE_GUARD_MS) {
        return;
      }
      /* Persist mode keeps the card sticky: only the card's buttons (or
         Escape) interact with it, so a stray click anywhere in the popup
         area -- on the invisible catcher included -- can't hide it. */
      if (isAgentMonitorPersistEnabled()) {
        return;
      }
      dismissActive();
    });
    layer.appendChild(backdrop);
    /* First interaction snaps the card to its final position so a click that
       starts while the drawer is still sliding in registers on the card (and
       can't fall through to the backdrop). */
    card.addEventListener(
      'pointerdown',
      () => {
        if (!layer.classList.contains(CLASSES.agentMonitorClosing)) {
          card.style.animation = 'none';
        }
      },
      { once: true },
    );
    layer.appendChild(card);
    document.body.appendChild(layer);
    overlay = layer;
    keyHandler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        dismissActive();
      }
    };
    document.addEventListener('keydown', keyHandler);
  };

  const header = (icon: string, title: string, sub: string): HTMLElement => {
    const wrap = el('div', CLASSES.agentMonitorHeader);
    const iconEl = el('div', CLASSES.agentMonitorIcon);
    iconEl.innerHTML = icon;
    wrap.appendChild(iconEl);
    const col = el('div', CLASSES.agentMonitorTitleCol);
    col.appendChild(el('div', CLASSES.agentMonitorTitle, title));
    col.appendChild(el('div', CLASSES.agentMonitorSub, sub));
    wrap.appendChild(col);
    return wrap;
  };

  /* Disables every action button (including View tab) while a reply is in
     flight, and shows an inline error -- without removing the card -- when
     the server didn't confirm it, so the request stays answerable instead
     of silently disappearing. A rejected handler or a hung request can
     never leave the card disabled forever: both re-enable the buttons,
     show the error, and return focus to the primary action. */
  const attachSender = (
    actions: HTMLElement,
    viewButton: HTMLButtonElement | null,
  ): { status: HTMLElement; send: (run: () => Promise<boolean>) => void } => {
    const status = el('div', CLASSES.agentMonitorStatus);
    const setBusy = (busy: boolean): void => {
      for (const button of actions.querySelectorAll<HTMLButtonElement>('button')) {
        button.disabled = busy;
      }
      if (viewButton) {
        viewButton.disabled = busy;
      }
    };
    const fail = (): void => {
      setBusy(false);
      status.textContent = SEND_ERROR;
      status.classList.add(CLASSES.agentMonitorStatusError);
      actions.querySelector<HTMLButtonElement>(`.${CLASSES.agentMonitorPrimary}`)?.focus();
    };
    const send = (run: () => Promise<boolean>): void => {
      setBusy(true);
      status.textContent = '';
      status.classList.remove(CLASSES.agentMonitorStatusError);
      let watchdog: ReturnType<typeof setTimeout> | undefined;
      watchdog = setTimeout(() => {
        watchdog = undefined;
        fail();
      }, REPLY_WATCHDOG_MS);
      run().then(
        (ok) => {
          if (watchdog) {
            clearTimeout(watchdog);
            watchdog = undefined;
          }
          if (!ok) {
            fail();
          }
        },
        () => {
          if (watchdog) {
            clearTimeout(watchdog);
            watchdog = undefined;
          }
          fail();
        },
      );
    };
    return { status, send };
  };

  const viewTabButton = (entry: PendingEntry): HTMLButtonElement => {
    const view = el('button', CLASSES.agentMonitorView, 'View Tab');
    view.type = 'button';
    view.addEventListener('click', () => handlers.onView(entry));
    return view;
  };

  /* Card footer: a dot divider above a row that names the coding agent the
     request came from (left) and offers the View Tab action (right). The
     dot keys off the card's risk accent so the footer reads as part of the
     same severity-coded card. */
  const renderFooter = (entry: PendingEntry, view: HTMLButtonElement): HTMLElement => {
    const footer = el('div', CLASSES.agentMonitorFooter);
    const divider = el('div', CLASSES.agentMonitorDivider);
    divider.appendChild(el('span', CLASSES.agentMonitorDividerDot));
    footer.appendChild(divider);
    const row = el('div', CLASSES.agentMonitorFooterRow);
    const agentName = entry.agent ?? (entry.tabUid ? agentOfTab(entry.tabUid) : null) ?? 'opencode';
    const agent = el('div', CLASSES.agentMonitorAgent);
    const icon = el('span', CLASSES.agentMonitorAgentIcon);
    const { uri, mask } = iconFor(agentName);
    icon.style.setProperty('--kit-agent-uri', `url(${uri})`);
    icon.style.setProperty('--kit-agent-tint', maskTint());
    icon.style.setProperty('--kit-agent-tile', tileBackground());
    icon.style.setProperty('--kit-agent-accent', agentAccent(agentName));
    if (mask) {
      icon.classList.add(CLASSES.agentMonitorAgentMask);
    }
    agent.appendChild(icon);
    agent.appendChild(el('span', CLASSES.agentMonitorAgentName, agentName));
    row.appendChild(agent);
    row.appendChild(view);
    footer.appendChild(row);
    return footer;
  };

  const renderPatterns = (patterns: string[]): HTMLElement[] => {
    const visible = patterns.slice(0, MAX_VISIBLE_PATTERNS);
    const nodes = visible.map((pattern) => el('div', CLASSES.agentMonitorPattern, pattern));
    const extra = patterns.length - visible.length;
    if (extra > 0) {
      nodes.push(el('div', CLASSES.agentMonitorPatternMore, `+${extra} more`));
    }
    return nodes;
  };

  /* Named metadata fields render inline; anything left over is still fully
     available behind a "Show details" toggle instead of being dropped. */
  const renderMetadata = (body: HTMLElement, metadata: Record<string, unknown>): void => {
    if (!metadata || Object.keys(metadata).length === 0) {
      return;
    }
    const { fields, rest } = describeMetadata(metadata);
    for (const field of fields) {
      const row = el('div', CLASSES.agentMonitorMetaRow);
      row.appendChild(el('span', CLASSES.agentMonitorMetaLabel, field.label));
      row.appendChild(el('span', CLASSES.agentMonitorMetaValue, field.value));
      body.appendChild(row);
    }
    if (Object.keys(rest).length === 0) {
      return;
    }
    let json: string;
    try {
      json = JSON.stringify(rest, null, 2);
    } catch {
      return;
    }
    const toggle = el('button', CLASSES.agentMonitorDetailsToggle, 'Show details');
    toggle.type = 'button';
    const pre = el('div', CLASSES.agentMonitorMeta, json);
    pre.style.display = 'none';
    toggle.addEventListener('click', () => {
      const showing = pre.style.display !== 'none';
      pre.style.display = showing ? 'none' : '';
      toggle.textContent = showing ? 'Show details' : 'Hide details';
    });
    body.appendChild(toggle);
    body.appendChild(pre);
  };

  const renderPermission = (entry: PermissionPendingEntry): HTMLElement => {
    const request = entry.request;
    const meta = getKindMeta(request.permission);
    const card = el('div', CLASSES.agentMonitorCard);
    card.classList.add(RISK_CLASS[meta.risk]);
    card.setAttribute('role', 'alertdialog');
    card.setAttribute('aria-modal', 'true');
    card.appendChild(header(iconMarkup(meta.icon), meta.title, `${requestOrigin(entry)}`));
    const body = el('div', CLASSES.agentMonitorBody);
    if (request.patterns.length > 0) {
      body.append(...renderPatterns(request.patterns));
    } else {
      body.appendChild(el('div', '', 'opencode wants to proceed.'));
    }
    renderMetadata(body, request.metadata);
    card.appendChild(body);

    let messageInput: HTMLInputElement | null = null;
    const actions = el('div', CLASSES.agentMonitorActions);
    const view = viewTabButton(entry);
    const { status, send } = attachSender(actions, view);

    const allowOnce = el('button', CLASSES.agentMonitorPrimary, 'Allow once');
    allowOnce.type = 'button';
    allowOnce.addEventListener('click', () => send(() => handlers.onReply(entry, 'once')));
    const always = el('button', CLASSES.agentMonitorSecondary, 'Always allow');
    always.type = 'button';
    always.addEventListener('click', () => send(() => handlers.onReply(entry, 'always')));
    const deny = el('button', CLASSES.agentMonitorDanger, 'Deny');
    deny.type = 'button';
    deny.addEventListener('click', () => {
      if (!messageInput) {
        messageInput = document.createElement('input');
        messageInput.className = CLASSES.agentMonitorInput;
        messageInput.type = 'text';
        messageInput.placeholder = 'Reason (optional)';
        messageInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            send(() => handlers.onReply(entry, 'reject', messageInput?.value.trim() || undefined));
          }
        });
        body.appendChild(messageInput);
        messageInput.focus();
        return;
      }
      send(() => handlers.onReply(entry, 'reject', messageInput?.value.trim() || undefined));
    });
    actions.append(allowOnce, always, deny);
    card.appendChild(actions);
    card.appendChild(status);
    card.appendChild(renderFooter(entry, view));

    setTimeout(() => allowOnce.focus(), 0);
    return card;
  };

  const renderQuestionCard = (entry: QuestionPendingEntry): HTMLElement => {
    const request = entry.request;
    const card = el('div', CLASSES.agentMonitorCard);
    card.classList.add(RISK_CLASS.low);
    card.setAttribute('role', 'alertdialog');
    card.setAttribute('aria-modal', 'true');
    const single = request.questions.length === 1;
    card.appendChild(
      header(
        iconMarkup('question'),
        single ? request.questions[0].header || 'opencode asks' : 'opencode asks',
        requestOrigin(entry),
      ),
    );

    const selected = request.questions.map(() => new Set<string>());
    const customInputs: (HTMLInputElement | null)[] = request.questions.map(() => null);

    const body = el('div', CLASSES.agentMonitorBody);
    request.questions.forEach((question: QuestionInfo, index: number) => {
      const wrap = el('div', CLASSES.agentMonitorQuestion);
      wrap.appendChild(el('div', CLASSES.agentMonitorTitle, question.question));
      if (question.options && question.options.length > 0) {
        const chips = el('div', CLASSES.agentMonitorChips);
        for (const option of question.options) {
          const chip = el('button', CLASSES.agentMonitorChip, option.label);
          chip.type = 'button';
          chip.title = option.description || '';
          chip.addEventListener('click', () => {
            if (question.multiple) {
              if (selected[index].has(option.label)) {
                selected[index].delete(option.label);
                chip.classList.remove(CLASSES.agentMonitorChipOn);
              } else {
                selected[index].add(option.label);
                chip.classList.add(CLASSES.agentMonitorChipOn);
              }
            } else {
              selected[index].clear();
              selected[index].add(option.label);
              for (const other of chips.querySelectorAll<HTMLElement>(
                `.${CLASSES.agentMonitorChip}`,
              )) {
                other.classList.remove(CLASSES.agentMonitorChipOn);
              }
              chip.classList.add(CLASSES.agentMonitorChipOn);
            }
          });
          chips.appendChild(chip);
        }
        wrap.appendChild(chips);
      }
      const custom = question.custom !== false;
      if (custom) {
        const input = document.createElement('input');
        input.className = CLASSES.agentMonitorInput;
        input.type = 'text';
        input.placeholder = 'Type your own answer…';
        customInputs[index] = input;
        wrap.appendChild(input);
      }
      body.appendChild(wrap);
    });
    card.appendChild(body);

    const collect = (): string[][] =>
      request.questions.map((_question: QuestionInfo, index: number) => {
        const values = [...selected[index]];
        const custom = customInputs[index]?.value.trim();
        if (custom) {
          values.push(custom);
        }
        return values;
      });

    const actions = el('div', CLASSES.agentMonitorActions);
    const view = viewTabButton(entry);
    const { status, send } = attachSender(actions, view);

    const submit = el('button', CLASSES.agentMonitorPrimary, 'Submit');
    submit.type = 'button';
    submit.addEventListener('click', () => send(() => handlers.onAnswer(entry, collect())));
    const reject = el('button', CLASSES.agentMonitorSecondary, 'Reject');
    reject.type = 'button';
    reject.addEventListener('click', () => send(() => handlers.onReject(entry)));
    actions.append(submit, reject);
    card.appendChild(actions);
    card.appendChild(status);
    card.appendChild(renderFooter(entry, view));

    setTimeout(() => submit.focus(), 0);
    return card;
  };

  const renderHint = (directory: string | null): HTMLElement => {
    const card = el('div', CLASSES.agentMonitorCard);
    card.classList.add(RISK_CLASS.medium);
    card.setAttribute('role', 'alertdialog');
    card.setAttribute('aria-modal', 'true');
    card.appendChild(
      header(iconMarkup('bolt'), 'opencode needs a server to be monitored', dirLabel(directory)),
    );
    const body = el('div', CLASSES.agentMonitorBody);
    body.appendChild(
      el(
        'div',
        '',
        'The opencode running in this tab was started without its API server, so permission popups cannot reach it. Relaunch it with:',
      ),
    );
    body.appendChild(el('div', CLASSES.agentMonitorMeta, 'opencode --port 0'));
    body.appendChild(
      el(
        'div',
        '',
        'Or restart your shell (source ~/.zshrc) — hyper-kit installs a transparent `opencode` function that appends the flag automatically.',
      ),
    );
    card.appendChild(body);
    const actions = el('div', CLASSES.agentMonitorActions);
    const gotIt = el('button', CLASSES.agentMonitorPrimary, 'Got it');
    gotIt.type = 'button';
    gotIt.addEventListener('click', () => dismissActive());
    actions.appendChild(gotIt);
    card.appendChild(actions);
    setTimeout(() => gotIt.focus(), 0);
    return card;
  };

  const controller: PopupController = {
    show(entry: PendingEntry | null): void {
      if (destroyed) {
        return;
      }
      if (!entry) {
        if (current) {
          current = null;
          closeAnimated();
        }
        return;
      }
      if (current?.kind === 'request' && current.entry.requestID === entry.requestID) {
        return;
      }
      // the user dismissed this request; keep it hidden until the
      // suppression window passes (it is still pending server-side)
      const suppressedUntil = suppressed.get(entry.requestID);
      if (suppressedUntil && Date.now() < suppressedUntil) {
        return;
      }
      current = { kind: 'request', entry };
      const card =
        entry.kind === 'permission' ? renderPermission(entry) : renderQuestionCard(entry);
      makeOverlay(card);
    },

    showHint(tabUid: string, directory: string | null): void {
      if (destroyed || current) {
        return; // requests take priority over the hint
      }
      current = { kind: 'hint', tabUid, directory };
      makeOverlay(renderHint(directory));
    },

    destroy(): void {
      destroyed = true;
      current = null;
      teardown();
    },
  };

  injectAgentMonitorStyle();
  return controller;
}
