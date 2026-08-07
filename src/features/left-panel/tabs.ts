import React from 'react';
import ReactDOM from 'react-dom';

import { isPaneCountBadgeEnabled, isAgentIconsEnabled } from '../../config';
import { cwdMap, agentMap } from '../../platform/state/tab-session-store';
import { briefCwd } from '../../core/session';
import { onSchemeChanged } from '../../core/agent-icons';
import { renderAgentStrip } from '../../platform/agent-strip';
import { homeDir } from '../../platform/home-dir';
import { setActiveTab } from '../../platform/state/active-tab';
import { updateBottomInfo } from '../bottom-panel';
import { initTabDrag, disposeTabDrag } from './drag-drop-tabs';
import { getActiveSessionUid, countPanesInTab, listPaneSessions } from '../../platform/hyper-store';
import {
  onCwdChanged,
  onActiveSessionChanged,
  onPanesChanged,
  onAgentsChanged,
} from '../../platform/event-bus';
import { injectPanesBadgeStyle } from '../../platform/style-injector';
import { CLASSES } from '../../platform/dom-selectors';

interface IndicatorColor {
  r: number;
  g: number;
  b: number;
}

const INDICATOR_COLORS: IndicatorColor[] = [
  { r: 0, g: 255, b: 65 },
  { r: 0, g: 229, b: 255 },
  { r: 255, g: 110, b: 199 },
  { r: 255, g: 214, b: 10 },
  { r: 77, g: 159, b: 255 },
  { r: 255, g: 122, b: 60 },
  { r: 181, g: 123, b: 255 },
  { r: 166, g: 255, b: 0 },
  { r: 46, g: 230, b: 168 },
  { r: 255, g: 85, b: 85 },
];

function pickIndicatorColor(): IndicatorColor {
  return INDICATOR_COLORS[Math.floor(Math.random() * INDICATOR_COLORS.length)];
}

/* shared by the kit tab chrome, its single-tab pill, and the normal-tab
   wrapper: small neon circle bottom-right, hidden at 1 pane, capped at 9+.
   The unchanged-label guard keeps the pill's own DOM observer from looping
   on the textContent write */
export function applyPaneBadge(el: HTMLElement, count: number): void {
  const label = count > 9 ? '9+' : String(count);
  if (el.textContent !== label) {
    el.textContent = label;
  }
  el.classList.toggle('visible', count > 1);
}

export function decorateTab(Tab: React.ComponentType<any>): React.ComponentType<any> {
  return class DecoratedTab extends React.PureComponent<any> {
    uid?: string;
    node: HTMLElement | null = null;
    mountedAt = 0;
    cwdRow?: HTMLDivElement;
    panesEl?: HTMLDivElement;
    observer?: MutationObserver;
    activeSession?: string | null;
    agentsSig = '';
    disposeCwdListener?: () => void;
    disposeActiveListener?: () => void;
    disposePanesListener?: () => void;
    disposeAgentsListener?: () => void;
    disposeSchemeListener?: () => void;
    resizeObserver?: ResizeObserver;
    onClick?: EventListener;

    componentDidMount(): void {
      const node = ReactDOM.findDOMNode(this) as HTMLElement | null;
      if (!node || !node.style) {
        return;
      }
      this.node = node;
      this.uid = this.props._tabUid || this.props.uid;
      this.activeSession = getActiveSessionUid(this.uid);
      this.mountedAt = Date.now();
      this.applyIndicatorColor(node);
      if (this.uid) {
        initTabDrag(node, this.uid);
      }
      if (node.classList.contains(CLASSES.tabActive)) {
        setActiveTab(this.uid, this.mountedAt);
        updateBottomInfo();
      }
      this.attachCwdRow(node);
      this.attachPanesBadge(node);
      this.trackActiveState(node);
    }

    applyIndicatorColor(node: HTMLElement): void {
      const color = pickIndicatorColor();
      node.style.setProperty('--tab-indicator', `rgba(${color.r}, ${color.g}, ${color.b}, 0.85)`);
    }

    attachCwdRow(node: HTMLElement): void {
      this.cwdRow = document.createElement('div');
      this.cwdRow.className = CLASSES.tabCwd;
      node.appendChild(this.cwdRow);
      const key = this.resolveCwdKey();
      if (key && cwdMap.get(key)) {
        this.setCwd(cwdMap.get(key)!);
      }
      this.disposeCwdListener = onCwdChanged((uid, cwd) => {
        if (uid === this.resolveCwdKey()) {
          this.setCwd(cwd);
        }
      });
      this.disposeActiveListener = onActiveSessionChanged((rootUid, sessionUid) => {
        if (rootUid !== this.uid) {
          return;
        }
        this.activeSession = sessionUid;
        const key = this.resolveCwdKey();
        this.setCwd(key ? cwdMap.get(key) || '' : '');
        this.refreshAgentsRow();
      });
      this.disposeAgentsListener = onAgentsChanged((rootUid) => {
        if (rootUid === this.uid) {
          this.refreshAgentsRow();
        }
      });
      // the mask tint depends on the OS color scheme; re-tint on flip
      this.disposeSchemeListener = onSchemeChanged(() => this.refreshAgentsRow());
      // tab width changes (resize handle) re-plan how many icons fit
      if (typeof ResizeObserver !== 'undefined') {
        this.resizeObserver = new ResizeObserver(() => this.refreshAgentsRow());
        this.resizeObserver.observe(this.cwdRow);
      }
      // splits change the pane set, which changes both the pane-count badge
      // and the per-pane agent icons; the emit fires before Hyper's reducer
      // applies the change, so re-read on the next tick
      this.disposePanesListener = onPanesChanged((rootUid) => {
        if (rootUid !== this.uid) {
          return;
        }
        queueMicrotask(() => {
          this.refreshPaneCount();
          this.refreshAgentsRow();
        });
      });
      if (isAgentIconsEnabled()) {
        this.refreshAgentsRow();
      }
    }

    /* cwdMap is keyed by session uid (stable across splits); fall back to the
       tab uid when no active session is known yet (e.g. pre-store startup). */
    resolveCwdKey(): string | null {
      if (!this.uid) {
        return null;
      }
      return this.activeSession ?? this.uid;
    }

    trackActiveState(node: HTMLElement): void {
      this.onClick = () => {
        if (!node.classList.contains(CLASSES.tabActive) && this.props.onSelect) {
          this.props.onSelect();
        }
      };
      node.addEventListener('click', this.onClick);

      this.observer = new MutationObserver(() => {
        if (node.classList.contains(CLASSES.tabActive)) {
          node.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          setActiveTab(this.uid, this.mountedAt);
          updateBottomInfo();
        }
      });
      this.observer.observe(node, { attributes: true, attributeFilter: ['class'] });
    }

    /* pane-count badge: small circle, bottom-right, hidden while the tab has
       a single terminal, capped at "9+". The pane-change subscription that
       keeps it fresh lives in attachCwdRow (shared with the agent icons). */
    attachPanesBadge(node: HTMLElement): void {
      if (!isPaneCountBadgeEnabled()) {
        return;
      }
      this.panesEl = document.createElement('div');
      this.panesEl.className = CLASSES.tabPanes;
      node.appendChild(this.panesEl);
      this.refreshPaneCount();
    }

    refreshPaneCount(): void {
      if (this.panesEl && this.uid) {
        applyPaneBadge(this.panesEl, countPanesInTab(this.uid));
      }
    }

    setCwd(cwd: string): void {
      if (!this.cwdRow || !this.node) {
        return;
      }
      this.node.setAttribute('data-kit-tab-pwd', cwd);
      if (!isAgentIconsEnabled()) {
        this.cwdRow.textContent = briefCwd(cwd, homeDir());
      }
    }

    /* one icon per terminal pane, centered, replacing the cwd text: agent
       glyphs for panes running an agent, the bash chevron for everything
       else. Rebuilds only when the rendered set actually changed. */
    refreshAgentsRow(): void {
      if (!this.cwdRow || !isAgentIconsEnabled()) {
        return;
      }
      let sessions: string[] = [];
      if (this.uid) {
        sessions = listPaneSessions(this.uid);
        if (sessions.length === 0) {
          sessions = this.activeSession ? [this.activeSession] : [this.uid];
        }
      }
      const sig = renderAgentStrip(
        this.cwdRow,
        sessions.map((session) => agentMap.get(session) ?? null),
        this.cwdRow.clientWidth,
        this.agentsSig,
      );
      if (sig !== null) {
        this.agentsSig = sig;
      }
    }

    componentWillUnmount(): void {
      if (this.node) {
        disposeTabDrag(this.node);
      }
      if (this.observer) {
        this.observer.disconnect();
      }
      this.resizeObserver?.disconnect();
      this.disposeCwdListener?.();
      this.disposeActiveListener?.();
      this.disposePanesListener?.();
      this.disposeAgentsListener?.();
      this.disposeSchemeListener?.();
      if (this.node) {
        if (this.onClick) {
          this.node.removeEventListener('click', this.onClick);
        }
        if (this.cwdRow) {
          this.cwdRow.remove();
        }
        if (this.panesEl) {
          this.panesEl.remove();
        }
      }
    }

    render(): React.ReactNode {
      return React.createElement(Tab, this.props);
    }
  };
}

/* Minimal badge-only wrapper for Hyper's normal (non-vertical) tab bar: no
   kit chrome, just the pane-count circle. Used when the left panel is off
   but the badge setting is on. */
export function decorateTabWithPanesBadge(Tab: React.ComponentType<any>): React.ComponentType<any> {
  return class PanesBadgeTab extends React.PureComponent<any> {
    uid?: string;
    panesEl?: HTMLDivElement;
    disposePanesListener?: () => void;

    componentDidMount(): void {
      const node = ReactDOM.findDOMNode(this) as HTMLElement | null;
      if (!node || !node.style) {
        return;
      }
      this.uid = this.props._tabUid || this.props.uid;
      injectPanesBadgeStyle();
      const el = document.createElement('div');
      el.className = CLASSES.tabPanes;
      node.appendChild(el);
      this.panesEl = el;
      applyPaneBadge(el, this.uid ? countPanesInTab(this.uid) : 0);
      this.disposePanesListener = onPanesChanged((rootUid) => {
        if (rootUid !== this.uid) {
          return;
        }
        // the emit fires before Hyper's reducer applies the change; re-count
        // on the next tick so the store reflects the new tree
        queueMicrotask(() => {
          if (this.panesEl) {
            applyPaneBadge(this.panesEl, this.uid ? countPanesInTab(this.uid) : 0);
          }
        });
      });
    }

    componentWillUnmount(): void {
      this.disposePanesListener?.();
      this.panesEl?.remove();
      this.panesEl = undefined;
    }

    render(): React.ReactNode {
      return React.createElement(Tab, this.props);
    }
  };
}
