import { describe, it, expect, afterEach } from 'vitest';

import { decorateTab } from '../../../src/features/left-panel/tabs';
import { setStore } from '../../../src/platform/hyper-store';
import { agentMap } from '../../../src/platform/state/tab-session-store';
import { splitGroups, tabStore, unsplitGroup } from '../../helpers/store';

function FakeTab(props: any) {
  return props;
}

/* A mounted-ish DecoratedTab with the tab uid resolved, ready to exercise
   its imperative DOM hooks (refreshPaneCount, refreshAgentsRow, ...) */
function makeTab(props: any = { _tabUid: 'g1' }): any {
  const inst = new (decorateTab(FakeTab) as any)(props);
  inst.uid = 'g1';
  return inst;
}

function makeTabWithRow(): any {
  const inst = makeTab();
  inst.cwdRow = document.createElement('div');
  return inst;
}

function storeWithChildren(children: string[]): any {
  return tabStore(splitGroups(children));
}

afterEach(() => {
  setStore(null);
  agentMap.clear();
});

describe('decorateTab', () => {
  it('wraps a tab component and forwards props through render', () => {
    const Decorated = decorateTab(FakeTab) as any;
    const inst = new Decorated({ a: 1 });
    const el = inst.render();
    expect(el.type).toBe(FakeTab);
    expect(el.props.a).toBe(1);
  });

  it('componentDidMount is a safe no-op when the DOM node is missing', () => {
    const Decorated = decorateTab(FakeTab) as any;
    const inst = new Decorated({});
    expect(() => inst.componentDidMount()).not.toThrow();
  });

  it('resolveCwdKey prefers the active session, falling back to the tab uid', () => {
    const inst = makeTab();
    inst.activeSession = 's3';
    expect(inst.resolveCwdKey()).toBe('s3');
    inst.activeSession = null;
    expect(inst.resolveCwdKey()).toBe('g1');
  });

  it('refreshPaneCount hides the badge at 0 and 1 panes', () => {
    const inst = makeTab();
    inst.panesEl = document.createElement('div');
    setStore(tabStore(unsplitGroup())); // g1 unsplit -> 1
    inst.refreshPaneCount();
    expect(inst.panesEl.classList.contains('visible')).toBe(false);
    setStore(tabStore({})); // unknown -> 0
    inst.refreshPaneCount();
    expect(inst.panesEl.classList.contains('visible')).toBe(false);
  });

  it('refreshPaneCount shows the pane count once split', () => {
    const inst = makeTab();
    inst.panesEl = document.createElement('div');
    setStore(storeWithChildren(['g2', 'g3']));
    inst.refreshPaneCount();
    expect(inst.panesEl.classList.contains('visible')).toBe(true);
    expect(inst.panesEl.textContent).toBe('2');
  });

  it('refreshPaneCount caps the count at 9+', () => {
    const inst = makeTab();
    inst.panesEl = document.createElement('div');
    const children = Array.from({ length: 12 }, (_, i) => 'g' + (i + 2));
    setStore(storeWithChildren(children));
    inst.refreshPaneCount();
    expect(inst.panesEl.textContent).toBe('9+');
  });

  it('refreshAgentsRow renders one bash icon per pane, centered', () => {
    const inst = makeTabWithRow();
    setStore(storeWithChildren(['g2', 'g3'])); // sessions s2, s3, no agents
    inst.refreshAgentsRow();
    const icons = inst.cwdRow.querySelectorAll('.kit-tab-agent');
    expect(icons.length).toBe(2);
    expect(inst.cwdRow.classList.contains('kit-tab-agents')).toBe(true);
  });

  it('refreshAgentsRow shows the agent glyph for a pane running an agent', () => {
    const inst = makeTabWithRow();
    setStore(storeWithChildren(['g2', 'g3']));
    agentMap.set('s2', 'claude');
    inst.refreshAgentsRow();
    const icons = inst.cwdRow.querySelectorAll('.kit-tab-agent');
    expect(icons.length).toBe(2);
    expect((icons[0] as HTMLElement).style.getPropertyValue('--kit-agent-uri')).toContain('url(');
    expect((icons[1] as HTMLElement).style.getPropertyValue('--kit-agent-uri')).toContain('url(');
  });

  it('refreshAgentsRow tints neutral glyphs with the mask class', () => {
    const inst = makeTabWithRow();
    setStore(storeWithChildren(['g2']));
    agentMap.set('s2', 'cursor');
    inst.refreshAgentsRow();
    const icon = inst.cwdRow.querySelector('.kit-tab-agent') as HTMLElement;
    expect(icon.classList.contains('kit-tab-agent-mask')).toBe(true);
    agentMap.set('s2', 'claude');
    inst.refreshAgentsRow();
    expect(
      (inst.cwdRow.querySelector('.kit-tab-agent') as HTMLElement).classList.contains(
        'kit-tab-agent-mask',
      ),
    ).toBe(false);
  });

  it('refreshAgentsRow skips rebuilding when the icon set did not change', () => {
    const inst = makeTabWithRow();
    setStore(storeWithChildren(['g2']));
    inst.refreshAgentsRow();
    const first = inst.cwdRow.querySelector('.kit-tab-agent');
    inst.refreshAgentsRow();
    expect(inst.cwdRow.querySelector('.kit-tab-agent')).toBe(first);
  });

  it('refreshAgentsRow falls back to the active session before the store knows the tab', () => {
    const inst = makeTabWithRow();
    inst.activeSession = 's9';
    inst.refreshAgentsRow();
    const icons = inst.cwdRow.querySelectorAll('.kit-tab-agent');
    expect(icons.length).toBe(1);
  });

  it('refreshAgentsRow tints the strip for the current color scheme', () => {
    const inst = makeTabWithRow();
    setStore(storeWithChildren(['g2']));
    inst.refreshAgentsRow();
    expect(inst.cwdRow.style.getPropertyValue('--kit-agent-tint')).toBe('#1f2328');
    window.matchMedia = (() => ({ matches: true })) as any;
    inst.refreshAgentsRow();
    expect(inst.cwdRow.style.getPropertyValue('--kit-agent-tint')).toBe('#e6e6e6');
    delete (window as any).matchMedia;
  });

  it('refreshAgentsRow caps icons to the row width with a +N indicator', () => {
    const inst = makeTabWithRow();
    Object.defineProperty(inst.cwdRow, 'clientWidth', { value: 60, configurable: true });
    const children = Array.from({ length: 6 }, (_, i) => 'g' + (i + 2));
    setStore(storeWithChildren(children)); // sessions s2..s7, no agents
    inst.refreshAgentsRow();
    expect(inst.cwdRow.querySelectorAll('.kit-tab-agent').length).toBe(2);
    const more = inst.cwdRow.querySelector('.kit-tab-agent-more');
    expect(more).not.toBeNull();
    expect(more!.textContent).toBe('+4');
  });

  it('refreshAgentsRow prioritizes agent icons over bash when capped', () => {
    const inst = makeTabWithRow();
    Object.defineProperty(inst.cwdRow, 'clientWidth', { value: 60, configurable: true });
    const children = Array.from({ length: 5 }, (_, i) => 'g' + (i + 2));
    setStore(storeWithChildren(children)); // sessions s2..s6
    agentMap.set('s5', 'claude');
    agentMap.set('s6', 'codex');
    inst.refreshAgentsRow();
    const icons = inst.cwdRow.querySelectorAll('.kit-tab-agent');
    expect(icons.length).toBe(2); // both agents, shells collapsed into +N
    expect(inst.cwdRow.querySelector('.kit-tab-agent-more')!.textContent).toBe('+3');
  });

  it('refreshAgentsRow drops the +N indicator once the row is wide enough', () => {
    const inst = makeTabWithRow();
    const children = Array.from({ length: 6 }, (_, i) => 'g' + (i + 2));
    setStore(storeWithChildren(children));
    Object.defineProperty(inst.cwdRow, 'clientWidth', { value: 60, configurable: true });
    inst.refreshAgentsRow();
    expect(inst.cwdRow.querySelector('.kit-tab-agent-more')).not.toBeNull();
    Object.defineProperty(inst.cwdRow, 'clientWidth', { value: 200, configurable: true });
    inst.refreshAgentsRow();
    expect(inst.cwdRow.querySelectorAll('.kit-tab-agent').length).toBe(6);
    expect(inst.cwdRow.querySelector('.kit-tab-agent-more')).toBeNull();
  });

  it('setCwd keeps the pwd attribute but never wipes the icon strip', () => {
    const inst = makeTabWithRow();
    inst.node = document.createElement('div');
    inst.node.appendChild(inst.cwdRow);
    setStore(storeWithChildren(['g2']));
    inst.refreshAgentsRow();
    inst.setCwd('/Users/test/proj');
    expect(inst.node.getAttribute('data-kit-tab-pwd')).toBe('/Users/test/proj');
    expect(inst.cwdRow.querySelectorAll('.kit-tab-agent').length).toBe(1);
  });
});
