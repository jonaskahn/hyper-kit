import { describe, it, expect, vi, afterEach } from 'vitest';

import { decorateConfig, getTabProps, middleware, __debug } from '../src/index';
import {
  sessionStart,
  cwdMap,
  statusMap,
  setLastCwd,
} from '../src/platform/state/tab-session-store';
import { getStore, setStore } from '../src/platform/hyper-store';
import { applyConfig } from '../src/config';

afterEach(() => {
  setStore(null);
  cwdMap.clear();
  statusMap.clear();
  sessionStart.clear();
  setLastCwd('');
});

describe('plugin entry', () => {
  it('decorateConfig applies the theme', () => {
    const out = decorateConfig({ fontSize: 20, tabUi: { maxTools: 5 } });
    expect(out.fontSize).toBe(14);
    expect(out.backgroundColor).toBe('#141414');
    expect(out.fontFamily).toContain('JetBrainsMono');
  });

  it('middleware records SESSION_ADD and forwards actions', () => {
    const store = {
      getState: () => ({
        termGroups: { termGroups: {} },
        ui: { cwd: '/work' },
      }),
    };
    const next = vi.fn((a: any) => a);
    const mw = middleware(store as any)(next);

    mw({ type: 'SESSION_ADD', uid: 's1' });
    expect(sessionStart.get('s1')).toBeGreaterThan(0);
    expect(cwdMap.get('s1')).toBe('/work');
    expect(getStore()).toBe(store);

    mw(null);
    expect(next).toHaveBeenCalledWith(null);

    mw({ type: 'UNKNOWN_ACTION' });
    expect(next).toHaveBeenCalledWith({ type: 'UNKNOWN_ACTION' });
  });

  it('getTabProps attaches the tab uid', () => {
    expect(getTabProps(null, {}, {}).uid).toBeUndefined();
    expect(getTabProps({ uid: 'u1' }, {}, {})._tabUid).toBe('u1');
  });

  it('TERM_GROUP_ADD inherits the last tracked cwd', () => {
    setLastCwd('/work/project');
    applyConfig(null);
    const store = {
      getState: () => ({ termGroups: { termGroups: {} }, ui: { cwd: '/work/project' } }),
    };
    const next = vi.fn((a: any) => a);
    const mw = middleware(store as any)(next);

    mw({ type: 'TERM_GROUP_ADD', uid: 't1' });
    expect(next).toHaveBeenCalledWith({ type: 'TERM_GROUP_ADD', uid: 't1', cwd: '/work/project' });
  });

  it('TERM_GROUP_ADD passes through without a tracked cwd', () => {
    applyConfig(null);
    const store = { getState: () => ({ termGroups: { termGroups: {} } }) };
    const next = vi.fn((a: any) => a);
    const mw = middleware(store as any)(next);

    mw({ type: 'TERM_GROUP_ADD', uid: 't1' });
    expect(next).toHaveBeenCalledWith({ type: 'TERM_GROUP_ADD', uid: 't1' });
    expect(next.mock.calls[0][0].cwd).toBeUndefined();
  });

  it('TERM_GROUP_ADD keeps an explicit cwd', () => {
    setLastCwd('/work/project');
    applyConfig(null);
    const store = {
      getState: () => ({ termGroups: { termGroups: {} }, ui: { cwd: '/work/project' } }),
    };
    const next = vi.fn((a: any) => a);
    const mw = middleware(store as any)(next);

    mw({ type: 'TERM_GROUP_ADD', uid: 't1', cwd: '/explicit/path' });
    expect(next).toHaveBeenCalledWith({ type: 'TERM_GROUP_ADD', uid: 't1', cwd: '/explicit/path' });
  });

  it('TERM_GROUP_ADD leaves cwd untouched when newTabSameDir is disabled', () => {
    setLastCwd('/work/project');
    applyConfig({ hyperKit: { newTabSameDir: false } });
    const store = {
      getState: () => ({ termGroups: { termGroups: {} }, ui: { cwd: '/work/project' } }),
    };
    const next = vi.fn((a: any) => a);
    const mw = middleware(store as any)(next);

    mw({ type: 'TERM_GROUP_ADD', uid: 't1' });
    expect(next).toHaveBeenCalledWith({ type: 'TERM_GROUP_ADD', uid: 't1' });
    expect(next.mock.calls[0][0].cwd).toBeUndefined();
  });

  it('exposes the __debug hook', () => {
    expect(__debug.cwdMap).toBeDefined();
    expect(__debug.statusMap).toBeDefined();
  });
});
