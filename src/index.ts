import React from 'react';

import { FONT_FAMILY, applyConfig, readUiConfig, isVerticalTabEnabled } from './config';
import { setStore } from './platform/hyper-store';
import * as sessionTracking from './features/verticalTabs/session-tracking';
import { cwdMap, statusMap, sessionStart, getLastCwd } from './platform/state/tab-session-store';
import { attachControls } from './features/verticalTabs/tabbar';
import { reloadEnvPanel } from './features/verticalTabs/env-panel';
import { HyperStore, HyperAction } from './types';
import { decorateTab as decorateVerticalTab } from './features/verticalTabs/tabs';

export { reduceTermGroups } from './core/reorder';

export const decorateTab = (Tab: React.ComponentType<any>): React.ComponentType<any> =>
  isVerticalTabEnabled() ? decorateVerticalTab(Tab) : Tab;

export const decorateConfig = (config: Record<string, any>) => {
  applyConfig(config);
  if (!isVerticalTabEnabled()) {
    return config;
  }
  return Object.assign({}, config, {
    fontSize: 14,
    fontFamily: FONT_FAMILY,
    padding: '0',
    backgroundColor: '#141414',
    borderColor: '#262626',
  });
};

/* ------------------------------------------------------------------ */
/* middleware: cwd + command-status tracking                            */
/* ------------------------------------------------------------------ */
export const middleware =
  (store: HyperStore) =>
  (next: (action: HyperAction | null) => unknown) =>
  (action: HyperAction | null): unknown => {
    setStore(store);
    if (!action || !isVerticalTabEnabled()) {
      return next(action);
    }
    if (action.type === 'SESSION_ADD' && action.uid) {
      sessionTracking.onSessionAdd(action.uid, store.getState().ui?.cwd);
    } else if (action.type === 'SESSION_USER_DATA' && action.uid) {
      sessionTracking.onSessionUserData(action.uid, action.data || '');
    } else if (
      (action.type === 'SESSION_RESIZE' || action.type === 'SESSION_SET_ACTIVE') &&
      action.uid
    ) {
      sessionTracking.onSessionResize(action.uid);
    } else if (action.type === 'SESSION_PTY_DATA' && action.uid && action.data) {
      sessionTracking.onSessionPtyData(action.uid, action.data);
    } else if (action.type === 'CONFIG_RELOAD') {
      readUiConfig();
      reloadEnvPanel();
    }
    return next(action);
  };

export const getTabProps = (item: any, parentProps: any, props: any) => {
  const uid = item && item.uid;
  return uid ? Object.assign({}, props, { _tabUid: uid }) : props;
};

export const decorateHeader = (Header: React.ComponentType<any>): React.ComponentType<any> => {
  if (!isVerticalTabEnabled()) {
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
};

/* middleware: keep live state inspectable from the devtools console */
export const __debug = {
  cwdMap,
  statusMap,
  sessionStart,
  getLastCwd,
};
