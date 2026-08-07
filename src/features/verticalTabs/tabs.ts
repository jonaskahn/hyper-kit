import React from 'react';
import ReactDOM from 'react-dom';

import { cwdMap, statusMap, type Status } from '../../platform/state/tab-session-store';
import { briefCwd } from '../../core/session';
import { homeDir } from '../../platform/home-dir';
import { setActiveTab } from '../../platform/state/active-tab';
import { updateEnvInfo } from './env-panel';
import { initTabDrag, disposeTabDrag } from './drag-drop-tabs';
import { onCwdChanged, onStatusChanged } from '../../platform/event-bus';
import { isDragDropTabsEnabled } from '../../config';
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

export function decorateTab(Tab: React.ComponentType<any>): React.ComponentType<any> {
  return class DecoratedTab extends React.PureComponent<any> {
    uid?: string;
    node: HTMLElement | null = null;
    mountedAt = 0;
    cwdRow?: HTMLDivElement;
    statusEl?: HTMLDivElement;
    observer?: MutationObserver;
    disposeCwdListener?: () => void;
    disposeStatusListener?: () => void;
    onClick?: EventListener;

    componentDidMount(): void {
      const node = ReactDOM.findDOMNode(this) as HTMLElement | null;
      if (!node || !node.style) {
        return;
      }
      this.node = node;
      this.uid = this.props._tabUid || this.props.uid;
      this.mountedAt = Date.now();
      this.applyIndicatorColor(node);
      if (this.uid && isDragDropTabsEnabled()) {
        initTabDrag(node, this.uid);
      }
      if (node.classList.contains(CLASSES.tabActive)) {
        setActiveTab(this.uid, this.mountedAt);
        updateEnvInfo();
      }
      this.attachCwdRow(node);
      this.attachStatusBadge(node);
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
      if (this.uid && cwdMap.get(this.uid)) {
        this.setCwd(cwdMap.get(this.uid)!);
      }
      this.disposeCwdListener = onCwdChanged((uid, cwd) => {
        if (uid === this.uid) {
          this.setCwd(cwd);
        }
      });
    }

    attachStatusBadge(node: HTMLElement): void {
      this.statusEl = document.createElement('div');
      this.statusEl.className = CLASSES.tabStatus;
      node.appendChild(this.statusEl);
      if (this.uid && statusMap.get(this.uid)) {
        this.setStatus(statusMap.get(this.uid)!);
      }
      this.disposeStatusListener = onStatusChanged((uid, status) => {
        if (uid !== this.uid) {
          return;
        }
        if (status === 'done' && node.classList.contains(CLASSES.tabActive)) {
          // finished while focused: consume immediately, never show a stale check
          statusMap.delete(this.uid);
          this.setStatus(null);
        } else {
          this.setStatus(status);
        }
      });
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
          updateEnvInfo();
          if (this.uid && statusMap.get(this.uid) === 'done') {
            statusMap.delete(this.uid);
            this.setStatus(null);
          }
        }
      });
      this.observer.observe(node, { attributes: true, attributeFilter: ['class'] });
    }

    setStatus(status: Status | null): void {
      if (!this.statusEl) {
        return;
      }
      this.statusEl.className =
        CLASSES.tabStatus + (status === 'running' ? ' spin' : status === 'done' ? ' done' : '');
    }

    setCwd(cwd: string): void {
      if (!this.cwdRow || !this.node) {
        return;
      }
      this.cwdRow.textContent = briefCwd(cwd, homeDir());
      this.node.setAttribute('data-kit-tab-pwd', cwd);
    }

    componentWillUnmount(): void {
      if (this.node) {
        disposeTabDrag(this.node);
      }
      if (this.observer) {
        this.observer.disconnect();
      }
      this.disposeCwdListener?.();
      this.disposeStatusListener?.();
      if (this.node) {
        if (this.onClick) {
          this.node.removeEventListener('click', this.onClick);
        }
        if (this.cwdRow) {
          this.cwdRow.remove();
        }
        if (this.statusEl) {
          this.statusEl.remove();
        }
      }
    }

    render(): React.ReactNode {
      return React.createElement(Tab, this.props);
    }
  };
}
