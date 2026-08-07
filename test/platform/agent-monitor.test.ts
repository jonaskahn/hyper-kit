import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { applyConfig } from '../../src/config';
import { setStore, type HyperStore } from '../../src/platform/hyper-store';
import { cwdMap, agentMap, statusMap, titleMap } from '../../src/platform/state/tab-session-store';
import {
  clearNodeModulesForTest,
  setNodeModuleForTest,
} from '../../src/platform/agent-monitor/node';
import { PendingStore, type PendingEntry } from '../../src/platform/agent-monitor/store';
import {
  extractServices,
  parseMdnsResponse,
  type MdnsRecord,
} from '../../src/platform/agent-monitor/mdns';
import {
  isHyperOwned,
  matchTabForDirectory,
  parseLsofPorts,
  scanListenerOwners,
  scanListenerPorts,
  tabsRunningAgent,
  agentOfTab,
} from '../../src/platform/agent-monitor/discovery';
import { createPopup } from '../../src/platform/agent-monitor/popup';
import * as client from '../../src/platform/agent-monitor/client';
import { agentMonitor, type MonitorPopupHandlers } from '../../src/platform/agent-monitor/monitor';
import { tabStore } from '../helpers/store';

/* ------------------------------------------------------------------ */

const HOST = '127.0.0.1';

function storeWith(termGroups: Record<string, unknown>, activeRootGroup: string | null): void {
  setStore(tabStore(termGroups, {}, activeRootGroup) as HyperStore);
}

function storeWithDispatch(
  termGroups: Record<string, unknown>,
  activeRootGroup: string | null,
): ReturnType<typeof vi.fn> {
  const dispatch = vi.fn();
  setStore({ ...tabStore(termGroups, {}, activeRootGroup), dispatch } as unknown as HyperStore);
  return dispatch;
}

function group(uid: string, sessionUid: string | null, parentUid: string | null): unknown {
  return { uid, sessionUid, parentUid, children: [] };
}

function permissionEntry(overrides: Partial<PendingEntry> = {}): PendingEntry {
  return {
    requestID: 'per_1',
    kind: 'permission',
    request: {
      id: 'per_1',
      sessionID: 'sess_1',
      permission: 'bash',
      patterns: ['npm run build'],
      metadata: {},
      always: false,
    },
    target: { host: HOST, port: 4096 },
    directory: '/repo',
    tabUid: 'g1',
    addedAt: Date.now(),
    ...overrides,
  } as PendingEntry;
}

function questionEntry(overrides: Partial<PendingEntry> = {}): PendingEntry {
  return {
    requestID: 'que_1',
    kind: 'question',
    request: {
      id: 'que_1',
      sessionID: 'sess_1',
      questions: [
        {
          question: 'Which approach?',
          header: 'Approach',
          options: [
            { label: 'A', description: 'first' },
            { label: 'B', description: 'second' },
          ],
        },
      ],
    },
    target: { host: HOST, port: 4096 },
    directory: '/repo',
    tabUid: 'g1',
    addedAt: Date.now(),
    ...overrides,
  } as PendingEntry;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

beforeEach(() => {
  applyConfig({
    hyperKit: { agentMonitor: { heartbeatSec: 0, ports: [4096], scope: 'all' } },
  });
  cwdMap.clear();
  agentMap.clear();
  statusMap.clear();
  titleMap.clear();
  setStore(null);
});

/* Each node-module test owns its override and clears it before returning
   (finally). NEVER clear shared override state from afterEach/beforeEach
   hooks: a hook can be scheduled to run while the next test's await is in
   flight (observed under load), wiping the override between
   setNodeModuleForTest() and the scan, which made the discovery tests
   flaky. */
afterEach(() => {
  agentMonitor.stop();
  vi.restoreAllMocks();
});

/* --- store ----------------------------------------------------------- */

describe('PendingStore', () => {
  it('dedupes by request id', () => {
    const store = new PendingStore();
    expect(store.add(permissionEntry())).toBe(true);
    expect(store.add(permissionEntry())).toBe(false);
    expect(store.size).toBe(1);
  });

  it('nextVisible skips the focused tab and falls back to the oldest entry', () => {
    const store = new PendingStore();
    store.add(permissionEntry({ requestID: 'per_1', tabUid: 'g1' }));
    store.add(permissionEntry({ requestID: 'per_2', tabUid: 'g2' }));
    expect(store.nextVisible('g1')).toMatchObject({ requestID: 'per_2' });
    expect(store.nextVisible('g2')).toMatchObject({ requestID: 'per_1' });
    expect(store.nextVisible('g3')).toMatchObject({ requestID: 'per_1' });
  });

  it('returns nothing when every request belongs to the focused tab', () => {
    const store = new PendingStore();
    store.add(permissionEntry({ requestID: 'per_1', tabUid: 'g1' }));
    expect(store.nextVisible('g1')).toBeNull();
  });

  it('shows tabless entries when nothing else can be shown, but never focused-tab ones', () => {
    const store = new PendingStore();
    store.add(permissionEntry({ requestID: 'per_1', tabUid: null }));
    // nothing else visible -> the tabless request surfaces (it would
    // otherwise block the agent invisibly)
    expect(store.nextVisible('g1')).toMatchObject({ requestID: 'per_1' });

    // a non-focused-tab entry takes priority over tabless ones
    store.add(permissionEntry({ requestID: 'per_2', tabUid: 'g2' }));
    expect(store.nextVisible('g1')).toMatchObject({ requestID: 'per_2' });

    // focused-tab requests are still suppressed (answer in the terminal)
    store.add(permissionEntry({ requestID: 'per_3', tabUid: 'g1' }));
    expect(store.nextVisible('g1')).toMatchObject({ requestID: 'per_2' });
    const store2 = new PendingStore();
    store2.add(permissionEntry({ requestID: 'per_4', tabUid: 'g1' }));
    expect(store2.nextVisible('g1')).toBeNull();
  });

  it('suppresses tabless entries while the focused tab runs an agent', () => {
    const store = new PendingStore();
    store.add(permissionEntry({ requestID: 'per_1', tabUid: null }));
    // the focused tab runs opencode: the tabless request is that tab's own
    // ask (attribution failed), answerable in the terminal -- no card
    expect(store.nextVisible('g1', true)).toBeNull();
    // a plain focused tab: the tabless request is from elsewhere, surface it
    expect(store.nextVisible('g1', false)).toMatchObject({ requestID: 'per_1' });
  });

  it('removeForTarget drops all entries for an instance', () => {
    const store = new PendingStore();
    store.add(permissionEntry({ requestID: 'per_1' }));
    store.add(permissionEntry({ requestID: 'per_2', target: { host: HOST, port: 5000 } }));
    const removed = store.removeForTarget({ host: HOST, port: 4096 });
    expect(removed.map((e) => e.requestID)).toEqual(['per_1']);
    expect(store.size).toBe(1);
  });

  it('setTabUid retargets a single entry without touching others on the same instance', () => {
    const store = new PendingStore();
    store.add(permissionEntry({ requestID: 'per_1', tabUid: null }));
    store.add(permissionEntry({ requestID: 'per_2', tabUid: 'g1' }));
    expect(store.setTabUid('per_1', 'g9')).toBe(true);
    expect(store.get('per_1')).toMatchObject({ tabUid: 'g9' });
    expect(store.get('per_2')).toMatchObject({ tabUid: 'g1' });
    expect(store.setTabUid('per_1', 'g9')).toBe(false);
    expect(store.setTabUid('missing', 'g9')).toBe(false);
  });
});

/* --- mdns -------------------------------------------------------------- */

function encodeName(name: string): Buffer {
  const parts = name.split('.');
  const buffers = parts.map((part) => {
    const label = Buffer.from(part, 'utf8');
    const out = Buffer.alloc(1 + label.length);
    out[0] = label.length;
    label.copy(out, 1);
    return out;
  });
  return Buffer.concat([...buffers, Buffer.from([0])]);
}

function mdnsPacket(records: MdnsRecord[]): Buffer {
  const header = Buffer.alloc(12);
  header.writeUInt16BE(0, 0);
  header.writeUInt16BE(0x8400, 2);
  header.writeUInt16BE(0, 4); // questions
  header.writeUInt16BE(records.length, 6);
  header.writeUInt16BE(0, 8);
  header.writeUInt16BE(0, 10);
  const body: Buffer[] = [];
  for (const record of records) {
    body.push(encodeName(record.name));
    const fixed = Buffer.alloc(10);
    fixed.writeUInt16BE(record.type, 0);
    fixed.writeUInt16BE(1, 2); // class IN
    fixed.writeUInt32BE(record.ttl, 4);
    fixed.writeUInt16BE(record.rdata.length, 8);
    body.push(fixed, record.rdata);
  }
  return Buffer.concat([header, ...body]);
}

describe('mdns', () => {
  it('extracts opencode services from PTR/SRV/A records', () => {
    const packet = mdnsPacket([
      {
        name: '_http._tcp.local',
        type: 12,
        ttl: 120,
        rdata: encodeName('opencode-4096._http._tcp.local'),
      },
      {
        name: '_http._tcp.local',
        type: 12,
        ttl: 120,
        rdata: encodeName('some-other._http._tcp.local'),
      },
      {
        name: 'opencode-4096._http._tcp.local',
        type: 33,
        ttl: 120,
        rdata: Buffer.concat([
          Buffer.from([0, 0, 0, 0]),
          Buffer.from([0x10, 0x00]),
          encodeName('opencode.local'),
        ]),
      },
    ]);
    const parsed = parseMdnsResponse(packet);
    const services = extractServices(parsed);
    expect(services).toEqual([{ name: 'opencode-4096', port: 4096, host: 'opencode.local' }]);
  });

  it('ignores packets without opencode PTR entries', () => {
    const packet = mdnsPacket([
      {
        name: '_http._tcp.local',
        type: 12,
        ttl: 120,
        rdata: encodeName('printer._http._tcp.local'),
      },
    ]);
    expect(extractServices(parseMdnsResponse(packet))).toEqual([]);
  });
});

/* --- discovery ----------------------------------------------------------- */

describe('discovery', () => {
  it('matchTabForDirectory finds the tab running opencode in the directory', () => {
    storeWith(
      {
        g1: group('g1', 's1', null),
        g2: group('g2', 's2', null),
      },
      'g2',
    );
    cwdMap.set('s1', '/repo');
    cwdMap.set('s2', '/other');
    agentMap.set('s1', 'opencode');
    statusMap.set('s1', 'running');
    expect(matchTabForDirectory('/repo')).toBe('g1');
    expect(matchTabForDirectory('/other')).toBe('g2');
    expect(matchTabForDirectory('/nowhere')).toBeNull();
  });

  it('prefers the opencode tab over a plain tab in the same directory', () => {
    storeWith(
      {
        g1: group('g1', 's1', null),
        g2: group('g2', 's2', null),
      },
      'g1',
    );
    cwdMap.set('s1', '/repo');
    cwdMap.set('s2', '/repo');
    agentMap.set('s2', 'opencode');
    statusMap.set('s2', 'running');
    expect(matchTabForDirectory('/repo')).toBe('g2');
  });

  it('tabsRunningAgent lists roots whose sessions run the agent', () => {
    storeWith(
      {
        g1: group('g1', 's1', null),
        g2: group('g2', 's2', null),
      },
      'g1',
    );
    agentMap.set('s1', 'opencode');
    statusMap.set('s1', 'running');
    agentMap.set('s2', 'opencode');
    statusMap.set('s2', 'done');
    expect(tabsRunningAgent('opencode')).toEqual(['g1']);
  });

  it('agentOfTab prefers opencode over other agents in the same tab', () => {
    storeWith({ g1: group('g1', 's1', null) }, 'g1');
    agentMap.set('s1', 'claude');
    expect(agentOfTab('g1')).toBe('claude');
    agentMap.set('s1', 'opencode');
    expect(agentOfTab('g1')).toBe('opencode');
  });

  it('agentOfTab still reports opencode when its badge was cleared but its title matches', () => {
    storeWith({ g1: group('g1', 's1', null) }, 'g1');
    // the opencode pane lost its badge (title/prompt chatter) while its TUI
    // still owns the screen: the last OSC 0 title names opencode
    agentMap.set('s1', 'claude');
    titleMap.set('s1', '⠂ opencode');
    expect(agentOfTab('g1')).toBe('opencode');
  });

  it('agentOfTab returns the first agent when no opencode evidence remains', () => {
    storeWith({ g1: group('g1', 's1', null) }, 'g1');
    agentMap.set('s1', 'claude');
    titleMap.set('s1', 'zsh');
    expect(agentOfTab('g1')).toBe('claude');
  });

  it('parseLsofPorts extracts opencode listener ports from lsof output', () => {
    const lsofOutput = [
      'COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME',
      'opencode 123 456 u IPv4 0x1 0t0 TCP 127.0.0.1:4096 (LISTEN)',
      'opencode 124 456 u IPv4 0x2 0t0 TCP 127.0.0.1:55555 (LISTEN)',
      'node 999 456 u IPv4 0x3 0t0 TCP 127.0.0.1:9229 (LISTEN)',
      '',
    ].join('\n');
    expect(parseLsofPorts(lsofOutput)).toEqual([4096, 55555]);
  });

  it('scanListenerPorts returns empty on child_process failure', async () => {
    setNodeModuleForTest('child_process', {
      exec: ((_cmd: string, _opts: unknown, callback: (error: Error, stdout: string) => void) => {
        callback(new Error('boom'), '');
      }) as unknown as typeof import('node:child_process').exec,
    });
    try {
      await expect(scanListenerPorts()).resolves.toEqual([]);
    } finally {
      clearNodeModulesForTest();
    }
  });

  it('scanListenerOwners maps opencode listener ports to their pids', async () => {
    const lsofOutput = [
      'COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME',
      'opencode 123 456 u IPv4 0x1 0t0 TCP 127.0.0.1:4096 (LISTEN)',
      'opencode 124 456 u IPv4 0x2 0t0 TCP 127.0.0.1:55555 (LISTEN)',
      '',
    ].join('\n');
    setNodeModuleForTest('child_process', {
      exec: ((
        _cmd: string,
        _opts: unknown,
        callback: (error: Error | null, stdout: string) => void,
      ) => {
        callback(null, lsofOutput);
      }) as unknown as typeof import('node:child_process').exec,
    });
    const original = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
    try {
      const owners = await scanListenerOwners();
      expect(owners.get(4096)).toBe(123);
      expect(owners.get(55555)).toBe(124);
    } finally {
      if (original) {
        Object.defineProperty(process, 'platform', original);
      }
      clearNodeModulesForTest();
    }
  });

  it('isHyperOwned follows the ancestor chain to a Hyper process', async () => {
    // opencode pid 900 -> zsh (901) -> Hyper (902)
    const exec = ((
      cmd: string,
      _opts: unknown,
      callback: (error: Error | null, stdout: string) => void,
    ) => {
      if (cmd.includes('comm=')) {
        const pid = Number.parseInt(cmd.match(/-p (\d+)/)?.[1] ?? '0', 10);
        callback(null, pid === 902 ? 'Hyper\n' : 'zsh\n');
        return;
      }
      const pid = Number.parseInt(cmd.match(/-p (\d+)/)?.[1] ?? '0', 10);
      callback(null, `${pid + 1}\n`);
    }) as unknown as typeof import('node:child_process').exec;
    setNodeModuleForTest('child_process', { exec });
    try {
      await expect(isHyperOwned(900)).resolves.toBe(true);
    } finally {
      clearNodeModulesForTest();
    }
  });

  it('isHyperOwned returns false for a process tree without Hyper', async () => {
    const exec = ((
      cmd: string,
      _opts: unknown,
      callback: (error: Error | null, stdout: string) => void,
    ) => {
      if (cmd.includes('comm=')) {
        callback(null, 'zsh\n');
        return;
      }
      callback(null, '1\n'); // parents resolve to init, never Hyper
    }) as unknown as typeof import('node:child_process').exec;
    setNodeModuleForTest('child_process', { exec });
    try {
      await expect(isHyperOwned(900)).resolves.toBe(false);
    } finally {
      clearNodeModulesForTest();
    }
  });

  it('isHyperOwned returns false when the ancestry cannot be resolved', async () => {
    setNodeModuleForTest('child_process', {
      exec: ((
        _cmd: string,
        _opts: unknown,
        callback: (error: Error | null, stdout: string) => void,
      ) => {
        callback(new Error('permission denied'), '');
      }) as unknown as typeof import('node:child_process').exec,
    });
    try {
      await expect(isHyperOwned(900)).resolves.toBe(false);
    } finally {
      clearNodeModulesForTest();
    }
  });
});

/* --- popup ---------------------------------------------------------------- */

describe('popup', () => {
  it('renders a permission card and sends the reply', () => {
    const onReply = vi.fn(async () => true);
    const onReject = vi.fn(async () => true);
    const popup = createPopup({
      onReply,
      onAnswer: vi.fn(async () => true),
      onReject,
      onDismiss: vi.fn(),
      onView: vi.fn(),
      onHintDismiss: vi.fn(),
    });
    popup.show(permissionEntry());
    const card = document.querySelector('.kit-amon-card');
    expect(card).not.toBeNull();
    expect(card!.textContent).toContain('npm run build');

    const allow = [...card!.querySelectorAll('button')].find(
      (b) => b.textContent === 'Allow once',
    )!;
    allow.click();
    expect(onReply).toHaveBeenCalledWith(expect.objectContaining({ requestID: 'per_1' }), 'once');
    expect(onReject).not.toHaveBeenCalled();
    popup.destroy();
  });

  it('disables the actions while a reply is in flight, and shows an error if it fails', async () => {
    let resolveReply: (ok: boolean) => void = () => undefined;
    const onReply = vi.fn(() => new Promise<boolean>((resolve) => (resolveReply = resolve)));
    const popup = createPopup({
      onReply,
      onAnswer: vi.fn(async () => true),
      onReject: vi.fn(async () => true),
      onDismiss: vi.fn(),
      onView: vi.fn(),
      onHintDismiss: vi.fn(),
    });
    popup.show(permissionEntry());
    const card = document.querySelector('.kit-amon-card')!;
    const allow = [...card.querySelectorAll('button')].find(
      (b) => b.textContent === 'Allow once',
    ) as HTMLButtonElement;
    const deny = [...card.querySelectorAll('button')].find(
      (b) => b.textContent === 'Deny',
    ) as HTMLButtonElement;
    allow.click();
    expect(allow.disabled).toBe(true);
    expect(deny.disabled).toBe(true);

    resolveReply(false);
    await Promise.resolve();
    await Promise.resolve();
    expect(allow.disabled).toBe(false);
    expect(card.querySelector('.kit-amon-status')!.textContent).toMatch(/try again/i);
    popup.destroy();
  });

  it('deny reveals the reason input and submits the message on Enter', () => {
    const onReply = vi.fn(async () => true);
    const popup = createPopup({
      onReply,
      onAnswer: vi.fn(async () => true),
      onReject: vi.fn(async () => true),
      onDismiss: vi.fn(),
      onView: vi.fn(),
      onHintDismiss: vi.fn(),
    });
    popup.show(permissionEntry());
    const card = document.querySelector('.kit-amon-card')!;
    const deny = [...card.querySelectorAll('button')].find((b) => b.textContent === 'Deny')!;
    deny.click();
    const input = card.querySelector('.kit-amon-input') as HTMLInputElement;
    expect(input).not.toBeNull();
    input.value = 'not now';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(onReply).toHaveBeenCalledWith(
      expect.objectContaining({ requestID: 'per_1' }),
      'reject',
      'not now',
    );
    popup.destroy();
  });

  it('escape dismisses without rejecting, and the request stays suppressed', () => {
    vi.useFakeTimers();
    try {
      const onReject = vi.fn(async () => true);
      const onReply = vi.fn(async () => true);
      const onDismiss = vi.fn();
      const popup = createPopup({
        onReply,
        onAnswer: vi.fn(async () => true),
        onReject,
        onDismiss,
        onView: vi.fn(),
        onHintDismiss: vi.fn(),
      });
      popup.show(permissionEntry());
      expect(document.querySelector('.kit-amon-card')).not.toBeNull();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      expect(onReject).not.toHaveBeenCalled();
      expect(onReply).not.toHaveBeenCalled();
      expect(onDismiss).toHaveBeenCalledWith(expect.objectContaining({ requestID: 'per_1' }));
      vi.advanceTimersByTime(300); // close animation completes, layer removed
      expect(document.querySelector('.kit-amon-card')).toBeNull();

      // still pending: a re-show inside the suppression window stays hidden
      popup.show(permissionEntry());
      expect(document.querySelector('.kit-amon-card')).toBeNull();

      // after the suppression window the "still waiting" reminder returns
      vi.advanceTimersByTime(121000);
      popup.show(permissionEntry());
      expect(document.querySelector('.kit-amon-card')).not.toBeNull();
      popup.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('collects question answers (single-select + custom input)', () => {
    const onAnswer = vi.fn(async () => true);
    const popup = createPopup({
      onReply: vi.fn(async () => true),
      onAnswer,
      onReject: vi.fn(async () => true),
      onDismiss: vi.fn(),
      onView: vi.fn(),
      onHintDismiss: vi.fn(),
    });
    popup.show(questionEntry());
    const card = document.querySelector('.kit-amon-card')!;
    const chips = [...card.querySelectorAll('.kit-amon-chip')];
    (chips[1] as HTMLButtonElement).click();
    const input = card.querySelector('.kit-amon-input') as HTMLInputElement;
    input.value = 'my plan';
    const submit = [...card.querySelectorAll('button')].find((b) => b.textContent === 'Submit')!;
    submit.click();
    expect(onAnswer).toHaveBeenCalledWith(expect.objectContaining({ requestID: 'que_1' }), [
      ['B', 'my plan'],
    ]);
    popup.destroy();
  });

  it('labels the card with the session title so answers never target the wrong session', () => {
    storeWith({ g1: group('g1', 's1', null) }, 'g2');
    titleMap.set('s1', 'hyper-kit · build');
    const popup = createPopup({
      onReply: vi.fn(async () => true),
      onAnswer: vi.fn(async () => true),
      onReject: vi.fn(async () => true),
      onDismiss: vi.fn(),
      onView: vi.fn(),
      onHintDismiss: vi.fn(),
    });
    popup.show(permissionEntry());
    const card = document.querySelector('.kit-amon-card')!;
    expect(card.textContent).toContain('repo · hyper-kit · build · :4096');
    popup.destroy();
  });

  it('footers the card with the asking agent and a View Tab pill above a dot divider', () => {
    storeWith({ g1: group('g1', 's1', null) }, 'g2');
    agentMap.set('s1', 'opencode');
    const onView = vi.fn();
    const popup = createPopup({
      onReply: vi.fn(async () => true),
      onAnswer: vi.fn(async () => true),
      onReject: vi.fn(async () => true),
      onDismiss: vi.fn(),
      onView,
      onHintDismiss: vi.fn(),
    });
    popup.show(permissionEntry());
    const card = document.querySelector('.kit-amon-card')!;
    expect(card.querySelector('.kit-amon-divider-dot')).not.toBeNull();
    expect(card.textContent).toContain('opencode');
    expect(card.textContent).toContain('View Tab');
    const view = [...card.querySelectorAll('button')].find((b) => b.textContent === 'View Tab')!;
    view.click();
    expect(onView).toHaveBeenCalledWith(expect.objectContaining({ requestID: 'per_1' }));
    popup.destroy();
  });

  it('falls back to opencode in the footer when no tab agent is recorded', () => {
    storeWith({ g1: group('g1', 's1', null) }, 'g2');
    // no agentMap entry for s1: the request still names its server's agent
    const popup = createPopup({
      onReply: vi.fn(async () => true),
      onAnswer: vi.fn(async () => true),
      onReject: vi.fn(async () => true),
      onDismiss: vi.fn(),
      onView: vi.fn(),
      onHintDismiss: vi.fn(),
    });
    popup.show(permissionEntry({ tabUid: null, directory: null }));
    const card = document.querySelector('.kit-amon-card')!;
    expect(card.textContent).toContain('opencode');
    popup.destroy();
  });

  it('shows the hint card when no request is active', () => {
    const onHintDismiss = vi.fn();
    const popup = createPopup({
      onReply: vi.fn(async () => true),
      onAnswer: vi.fn(async () => true),
      onReject: vi.fn(async () => true),
      onDismiss: vi.fn(),
      onView: vi.fn(),
      onHintDismiss,
    });
    popup.showHint('g1', '/repo');
    const card = document.querySelector('.kit-amon-card')!;
    expect(card.textContent).toContain('opencode');
    const gotIt = [...card.querySelectorAll('button')].find((b) => b.textContent === 'Got it')!;
    gotIt.click();
    expect(onHintDismiss).toHaveBeenCalledWith('g1');
    popup.destroy();
  });

  it('places the card at the configured edge', () => {
    applyConfig({ hyperKit: { agentMonitor: { position: 'bottom' } } });
    const popup = createPopup({
      onReply: vi.fn(async () => true),
      onAnswer: vi.fn(async () => true),
      onReject: vi.fn(async () => true),
      onDismiss: vi.fn(),
      onView: vi.fn(),
      onHintDismiss: vi.fn(),
    });
    popup.show(permissionEntry());
    const overlay = document.querySelector('.kit-amon')!;
    expect(overlay.classList.contains('kit-amon-bottom')).toBe(true);
    expect(overlay.classList.contains('kit-amon-top')).toBe(false);
    popup.destroy();

    applyConfig({ hyperKit: { agentMonitor: { position: 'top' } } });
    const popup2 = createPopup({
      onReply: vi.fn(async () => true),
      onAnswer: vi.fn(async () => true),
      onReject: vi.fn(async () => true),
      onDismiss: vi.fn(),
      onView: vi.fn(),
      onHintDismiss: vi.fn(),
    });
    popup2.show(permissionEntry());
    expect(document.querySelector('.kit-amon')!.classList.contains('kit-amon-top')).toBe(true);
    popup2.destroy();
  });

  it('defaults to the top edge when unconfigured', () => {
    applyConfig();
    const popup = createPopup({
      onReply: vi.fn(async () => true),
      onAnswer: vi.fn(async () => true),
      onReject: vi.fn(async () => true),
      onDismiss: vi.fn(),
      onView: vi.fn(),
      onHintDismiss: vi.fn(),
    });
    popup.show(permissionEntry());
    expect(document.querySelector('.kit-amon')!.classList.contains('kit-amon-top')).toBe(true);
    popup.destroy();
  });

  it('persist mode ignores backdrop clicks: the card only reacts to its buttons', () => {
    vi.useFakeTimers();
    try {
      applyConfig({ hyperKit: { agentMonitor: { persist: true } } });
      const onReject = vi.fn(async () => true);
      const onDismiss = vi.fn();
      const popup = createPopup({
        onReply: vi.fn(async () => true),
        onAnswer: vi.fn(async () => true),
        onReject,
        onDismiss,
        onView: vi.fn(),
        onHintDismiss: vi.fn(),
      });
      popup.show(permissionEntry());
      const backdrop = document.querySelector('.kit-amon-backdrop')!;
      expect(backdrop).not.toBeNull();
      // during the slide-in and after it: a click in the popup area (the
      // invisible catcher) must neither reject nor hide the sticky card
      backdrop.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      vi.advanceTimersByTime(400);
      backdrop.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      expect(onReject).not.toHaveBeenCalled();
      expect(onDismiss).not.toHaveBeenCalled();
      expect(document.querySelector('.kit-amon-card')).not.toBeNull();
      popup.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('without persist, a backdrop click after the slide-in dismisses (never rejects)', () => {
    vi.useFakeTimers();
    try {
      applyConfig({ hyperKit: { agentMonitor: { persist: false } } });
      const onReject = vi.fn(async () => true);
      const onDismiss = vi.fn();
      const popup = createPopup({
        onReply: vi.fn(async () => true),
        onAnswer: vi.fn(async () => true),
        onReject,
        onDismiss,
        onView: vi.fn(),
        onHintDismiss: vi.fn(),
      });
      popup.show(permissionEntry());
      const backdrop = document.querySelector('.kit-amon-backdrop')!;
      vi.advanceTimersByTime(400);
      backdrop.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      // the card closes, nothing is sent to the agent, and the dismissal is
      // reported so the monitor's queue can advance
      expect(onReject).not.toHaveBeenCalled();
      expect(onDismiss).toHaveBeenCalledWith(expect.objectContaining({ requestID: 'per_1' }));
      expect(document.querySelector('.kit-amon-card')).not.toBeNull(); // closing, not removed yet
      popup.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('clicking the card body (outside the buttons) does nothing', () => {
    vi.useFakeTimers();
    try {
      const onReject = vi.fn(async () => true);
      const onDismiss = vi.fn();
      const popup = createPopup({
        onReply: vi.fn(async () => true),
        onAnswer: vi.fn(async () => true),
        onReject,
        onDismiss,
        onView: vi.fn(),
        onHintDismiss: vi.fn(),
      });
      popup.show(permissionEntry());
      const card = document.querySelector('.kit-amon-card')!;
      const body = card.querySelector('.kit-amon-body')!;
      body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(onReject).not.toHaveBeenCalled();
      expect(onDismiss).not.toHaveBeenCalled();
      expect(document.querySelector('.kit-amon-card')).not.toBeNull();
      popup.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('snaps the card to its final position on first interaction', () => {
    const popup = createPopup({
      onReply: vi.fn(async () => true),
      onAnswer: vi.fn(async () => true),
      onReject: vi.fn(async () => true),
      onDismiss: vi.fn(),
      onView: vi.fn(),
      onHintDismiss: vi.fn(),
    });
    popup.show(permissionEntry());
    const card = document.querySelector('.kit-amon-card') as HTMLElement;
    // jsdom has no PointerEvent; MouseEvent carries the same type string
    card.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    expect(card.style.animation).toBe('none');
    popup.destroy();
  });

  it('re-enables the buttons and shows an error when the reply handler rejects', async () => {
    const popup = createPopup({
      onReply: vi.fn(() => Promise.reject(new Error('boom'))),
      onAnswer: vi.fn(async () => true),
      onReject: vi.fn(async () => true),
      onDismiss: vi.fn(),
      onView: vi.fn(),
      onHintDismiss: vi.fn(),
    });
    popup.show(permissionEntry());
    const card = document.querySelector('.kit-amon-card')!;
    const allow = [...card.querySelectorAll('button')].find(
      (b) => b.textContent === 'Allow once',
    ) as HTMLButtonElement;
    const deny = [...card.querySelectorAll('button')].find(
      (b) => b.textContent === 'Deny',
    ) as HTMLButtonElement;
    allow.click();
    await sleep(0);
    await sleep(0);
    expect(allow.disabled).toBe(false);
    expect(deny.disabled).toBe(false);
    expect(card.querySelector('.kit-amon-status')!.textContent).toMatch(/try again/i);
    popup.destroy();
  });

  it('slides the card out before removing the layer', () => {
    const popup = createPopup({
      onReply: vi.fn(async () => true),
      onAnswer: vi.fn(async () => true),
      onReject: vi.fn(async () => true),
      onDismiss: vi.fn(),
      onView: vi.fn(),
      onHintDismiss: vi.fn(),
    });
    popup.show(permissionEntry());
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    const overlay = document.querySelector('.kit-amon');
    expect(overlay!.classList.contains('kit-amon-closing')).toBe(true);
    expect(document.querySelector('.kit-amon-card')).not.toBeNull();
    popup.destroy();
    expect(document.querySelector('.kit-amon')).toBeNull();
    expect(document.querySelector('.kit-amon-card')).toBeNull();
  });
});

/* --- monitor (integration, mocked client) ---------------------------------- */

describe('AgentMonitor', () => {
  const sseState = vi.hoisted(() => ({ handlers: {} as Record<string, unknown> }));

  beforeEach(() => {
    vi.mock('../../src/platform/agent-monitor/client', () => ({
      probeHealth: vi.fn(async () => ({ healthy: true, version: '1.18.15' })),
      listSessions: vi.fn(async () => [{ id: 'sess_1', directory: '/repo', projectID: 'p1' }]),
      getSession: vi.fn(async () => null),
      listPermissions: vi.fn(async () => null),
      listQuestions: vi.fn(async () => null),
      subscribeEvents: vi.fn((_target: unknown, callbacks: Record<string, unknown>) => {
        sseState.handlers.onEvent = callbacks.onEvent;
        sseState.handlers.onClose = callbacks.onClose;
        return () => undefined;
      }),
      replyPermission: vi.fn(async () => true),
      replyQuestion: vi.fn(async () => true),
      rejectQuestion: vi.fn(async () => true),
    }));
  });

  it('attaches to a matching instance, pops up unfocused requests, hides on focus', async () => {
    applyConfig({
      hyperKit: { agentMonitor: { heartbeatSec: 0, ports: [4096], scope: 'all', persist: false } },
    });
    storeWith({ g1: group('g1', 's1', null) }, 'g2');
    cwdMap.set('s1', '/repo');
    agentMap.set('s1', 'opencode');
    statusMap.set('s1', 'running');

    const shown: Array<PendingEntry | null> = [];
    const handlers: MonitorPopupHandlers = {
      onShow: (entry) => shown.push(entry),
      onShowHint: vi.fn(),
    };
    agentMonitor.start(handlers);
    await sleep(500); // scan debounce + probe

    expect(client.probeHealth).toHaveBeenCalled();
    expect(client.listSessions).toHaveBeenCalled();
    expect(client.subscribeEvents).toHaveBeenCalledTimes(1);

    (sseState.handlers.onEvent as (event: unknown) => void)({
      directory: '/repo',
      payload: {
        type: 'permission.asked',
        properties: {
          id: 'per_1',
          sessionID: 'sess_1',
          permission: 'bash',
          patterns: ['ls'],
          metadata: {},
          always: false,
        },
      },
    });
    await sleep(10);
    expect(agentMonitor.pending.size).toBe(1);
    const entry = agentMonitor.pending.all[0];
    expect(entry).toMatchObject({ requestID: 'per_1', kind: 'permission', tabUid: 'g1' });
    expect(shown[shown.length - 1]).toMatchObject({ requestID: 'per_1' });

    // focusing the asking tab hides the popup but keeps the request pending
    storeWith({ g1: group('g1', 's1', null) }, 'g1');
    agentMonitor.onFocusChanged();
    expect(shown[shown.length - 1]).toBeNull();
    expect(agentMonitor.pending.size).toBe(1);

    // unfocusing brings it back
    storeWith({ g1: group('g1', 's1', null) }, 'g2');
    agentMonitor.onFocusChanged();
    expect(shown[shown.length - 1]).toMatchObject({ requestID: 'per_1' });

    // answering routes to the instance and clears the queue
    await agentMonitor.replyPermission(entry, 'once');
    expect(client.replyPermission).toHaveBeenCalledWith(
      expect.objectContaining({ host: HOST, port: 4096 }),
      'per_1',
      'once',
      undefined,
    );
    expect(agentMonitor.pending.size).toBe(0);
    expect(shown[shown.length - 1]).toBeNull();
  });

  it('replied events remove the request without a popup action', async () => {
    storeWith({ g1: group('g1', 's1', null) }, 'g2');
    cwdMap.set('s1', '/repo');
    agentMap.set('s1', 'opencode');
    statusMap.set('s1', 'running');
    const shown: Array<PendingEntry | null> = [];
    agentMonitor.start({ onShow: (entry) => shown.push(entry), onShowHint: vi.fn() });
    await sleep(500);

    (sseState.handlers.onEvent as (event: unknown) => void)({
      payload: {
        type: 'permission.asked',
        properties: {
          id: 'per_9',
          sessionID: 'sess_1',
          permission: 'edit',
          patterns: ['src/a.ts'],
          metadata: {},
          always: false,
        },
      },
    });
    await sleep(10);
    expect(agentMonitor.pending.size).toBe(1);
    (sseState.handlers.onEvent as (event: unknown) => void)({
      payload: {
        type: 'permission.replied',
        properties: { sessionID: 'sess_1', requestID: 'per_9' },
      },
    });
    await sleep(10);
    expect(agentMonitor.pending.size).toBe(0);
  });

  it('drops a pending request whose session no longer exists on the next scan', async () => {
    applyConfig({
      hyperKit: { agentMonitor: { heartbeatSec: 0, ports: [4096], scope: 'all', persist: false } },
    });
    storeWith({ g1: group('g1', 's1', null) }, 'g2');
    cwdMap.set('s1', '/repo');
    agentMap.set('s1', 'opencode');
    statusMap.set('s1', 'running');

    const shown: Array<PendingEntry | null> = [];
    agentMonitor.start({ onShow: (entry) => shown.push(entry), onShowHint: vi.fn() });
    await sleep(500);

    (sseState.handlers.onEvent as (event: unknown) => void)({
      directory: '/repo',
      payload: {
        type: 'permission.asked',
        properties: {
          id: 'per_1',
          sessionID: 'sess_1',
          permission: 'bash',
          patterns: ['ls'],
          metadata: {},
          always: false,
        },
      },
    });
    await sleep(10);
    expect(agentMonitor.pending.size).toBe(1);
    expect(shown[shown.length - 1]).toMatchObject({ requestID: 'per_1' });

    // the session is gone server-side (tab closed, agent exited): the next
    // scan must sweep the stale card instead of letting it linger forever
    (client.listSessions as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    agentMonitor.requestScan();
    await sleep(600);
    expect(agentMonitor.pending.size).toBe(0);
    expect(shown[shown.length - 1]).toBeNull();
    expect(client.replyPermission).not.toHaveBeenCalled();
  });

  it('keeps a pending request while its session still exists', async () => {
    applyConfig({
      hyperKit: { agentMonitor: { heartbeatSec: 0, ports: [4096], scope: 'all', persist: false } },
    });
    storeWith({ g1: group('g1', 's1', null) }, 'g2');
    cwdMap.set('s1', '/repo');
    agentMap.set('s1', 'opencode');
    statusMap.set('s1', 'running');

    const shown: Array<PendingEntry | null> = [];
    agentMonitor.start({ onShow: (entry) => shown.push(entry), onShowHint: vi.fn() });
    await sleep(500);

    (sseState.handlers.onEvent as (event: unknown) => void)({
      directory: '/repo',
      payload: {
        type: 'question.asked',
        properties: {
          id: 'que_1',
          sessionID: 'sess_1',
          questions: [{ question: 'Continue?', header: 'opencode asks', options: [] }],
        },
      },
    });
    await sleep(10);
    expect(agentMonitor.pending.size).toBe(1);

    // listSessions still lists sess_1: the sweep must leave the entry alone
    agentMonitor.requestScan();
    await sleep(600);
    expect(agentMonitor.pending.size).toBe(1);
    expect(shown[shown.length - 1]).toMatchObject({ requestID: 'que_1' });
  });

  it('a replayed request for a swept session is ignored (tombstoned)', async () => {
    applyConfig({
      hyperKit: { agentMonitor: { heartbeatSec: 0, ports: [4096], scope: 'all', persist: false } },
    });
    storeWith({ g1: group('g1', 's1', null) }, 'g2');
    cwdMap.set('s1', '/repo');
    agentMap.set('s1', 'opencode');
    statusMap.set('s1', 'running');

    agentMonitor.start({ onShow: vi.fn(), onShowHint: vi.fn() });
    await sleep(500);

    const ask = (): void => {
      (sseState.handlers.onEvent as (event: unknown) => void)({
        directory: '/repo',
        payload: {
          type: 'permission.asked',
          properties: {
            id: 'per_1',
            sessionID: 'sess_1',
            permission: 'bash',
            patterns: ['ls'],
            metadata: {},
            always: false,
          },
        },
      });
    };
    ask();
    await sleep(10);
    expect(agentMonitor.pending.size).toBe(1);

    (client.listSessions as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    agentMonitor.requestScan();
    await sleep(600);
    expect(agentMonitor.pending.size).toBe(0);

    // a late SSE / listPermissions replay for the same id (the server still
    // holds the request) must not bring the dead session's card back
    ask();
    await sleep(10);
    expect(agentMonitor.pending.size).toBe(0);
  });

  it('resolves each pending request to its own tab on a server hosting multiple sessions', async () => {
    // A single opencode server commonly hosts many unrelated project
    // sessions at once (verified against a real opencode 1.18.x instance);
    // it must never gate attachment on any one of them having a matching tab.
    storeWith({ g1: group('g1', 's1', null), g2: group('g2', 's2', null) }, 'g3');
    cwdMap.set('s1', '/repoA');
    cwdMap.set('s2', '/repoB');
    agentMap.set('s1', 'opencode');
    agentMap.set('s2', 'opencode');
    statusMap.set('s1', 'running');
    statusMap.set('s2', 'running');

    const sessionsByID: Record<string, { id: string; directory: string; projectID: string }> = {
      sess_a: { id: 'sess_a', directory: '/repoA', projectID: 'p1' },
      sess_b: { id: 'sess_b', directory: '/repoB', projectID: 'p2' },
    };
    (client.listSessions as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      Object.values(sessionsByID),
    );
    (client.getSession as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (_target: unknown, sessionID: string) => sessionsByID[sessionID] ?? null,
    );
    (client.listPermissions as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      {
        id: 'per_a',
        sessionID: 'sess_a',
        permission: 'bash',
        patterns: ['ls'],
        metadata: {},
        always: false,
      },
      {
        id: 'per_c',
        sessionID: 'sess_c',
        permission: 'bash',
        patterns: ['ls'],
        metadata: {},
        always: false,
      },
    ]);

    agentMonitor.start({ onShow: vi.fn(), onShowHint: vi.fn() });
    await sleep(500);

    // per_a's directory comes from the shared session cache -> its own tab, g1
    expect(agentMonitor.pending.get('per_a')).toMatchObject({ tabUid: 'g1', directory: '/repoA' });
    // per_c belongs to a session nobody knows about (e.g. already closed) --
    // it must still be queued, not silently dropped, just tabless.
    expect(agentMonitor.pending.get('per_c')).toMatchObject({ tabUid: null, directory: null });

    // a live SSE event for a *different* session on the *same* instance,
    // carrying its own directory on the envelope (the fast, no-round-trip path)
    (sseState.handlers.onEvent as (event: unknown) => void)({
      directory: '/repoB',
      payload: {
        type: 'permission.asked',
        properties: {
          id: 'per_b',
          sessionID: 'sess_b',
          permission: 'edit',
          patterns: ['src/a.ts'],
          metadata: {},
          always: false,
        },
      },
    });
    await sleep(10);
    expect(agentMonitor.pending.get('per_b')).toMatchObject({ tabUid: 'g2', directory: '/repoB' });
  });

  it('does not re-queue a request the server already confirmed answered', async () => {
    storeWith({ g1: group('g1', 's1', null) }, 'g2');
    cwdMap.set('s1', '/repo');
    agentMap.set('s1', 'opencode');
    statusMap.set('s1', 'running');

    const shown: Array<PendingEntry | null> = [];
    agentMonitor.start({ onShow: (entry) => shown.push(entry), onShowHint: vi.fn() });
    await sleep(500);

    (sseState.handlers.onEvent as (event: unknown) => void)({
      directory: '/repo',
      payload: {
        type: 'permission.asked',
        properties: {
          id: 'per_1',
          sessionID: 'sess_1',
          permission: 'bash',
          patterns: ['ls'],
          metadata: {},
          always: false,
        },
      },
    });
    await sleep(10);
    expect(agentMonitor.pending.size).toBe(1);

    await agentMonitor.replyPermission(agentMonitor.pending.all[0], 'once');
    expect(agentMonitor.pending.size).toBe(0);
    expect(shown[shown.length - 1]).toBeNull();

    // a late listPermissions replay / duplicate SSE for the same id (the
    // server already recorded the reply) must not resurrect a dead card
    (sseState.handlers.onEvent as (event: unknown) => void)({
      directory: '/repo',
      payload: {
        type: 'permission.asked',
        properties: {
          id: 'per_1',
          sessionID: 'sess_1',
          permission: 'bash',
          patterns: ['ls'],
          metadata: {},
          always: false,
        },
      },
    });
    await sleep(10);
    expect(agentMonitor.pending.size).toBe(0);
    expect(shown[shown.length - 1]).toBeNull();
  });

  it('does not pop a card for a tabless request while the focused tab runs opencode', async () => {
    // no cwdMap data (no OSC 7): attribution fails and the request is
    // tabless -- but the user is sitting in the asking tab, so the card
    // must stay hidden and the TUI prompt handles it
    applyConfig({
      hyperKit: { agentMonitor: { heartbeatSec: 0, ports: [4096], scope: 'all', persist: true } },
    });
    storeWith({ g1: group('g1', 's1', null) }, 'g1');
    agentMap.set('s1', 'opencode');
    statusMap.set('s1', 'running');

    const shown: Array<PendingEntry | null> = [];
    agentMonitor.start({ onShow: (entry) => shown.push(entry), onShowHint: vi.fn() });
    await sleep(500);

    (sseState.handlers.onEvent as (event: unknown) => void)({
      directory: '/repo',
      payload: {
        type: 'permission.asked',
        properties: {
          id: 'per_1',
          sessionID: 'sess_1',
          permission: 'bash',
          patterns: ['ls'],
          metadata: {},
          always: false,
        },
      },
    });
    await sleep(10);
    expect(agentMonitor.pending.size).toBe(1);
    expect(agentMonitor.pending.get('per_1')).toMatchObject({ tabUid: null });
    expect(shown[shown.length - 1]).toBeNull();
  });

  it('shows a tabless request when the focused tab is a plain tab', async () => {
    applyConfig({
      hyperKit: { agentMonitor: { heartbeatSec: 0, ports: [4096], scope: 'all', persist: true } },
    });
    storeWith({ g1: group('g1', 's1', null) }, 'g1');
    // s1 is a plain shell, not an agent: the tabless request is from
    // elsewhere (another window / unattributed tab) and deserves a card

    const shown: Array<PendingEntry | null> = [];
    agentMonitor.start({ onShow: (entry) => shown.push(entry), onShowHint: vi.fn() });
    await sleep(500);

    (sseState.handlers.onEvent as (event: unknown) => void)({
      directory: '/repo',
      payload: {
        type: 'permission.asked',
        properties: {
          id: 'per_1',
          sessionID: 'sess_1',
          permission: 'bash',
          patterns: ['ls'],
          metadata: {},
          always: false,
        },
      },
    });
    await sleep(10);
    expect(shown[shown.length - 1]).toMatchObject({ requestID: 'per_1' });
  });

  it("'always' drains the other pending asks of the same kind and session", async () => {
    storeWith({ g1: group('g1', 's1', null) }, 'g2');
    cwdMap.set('s1', '/repo');
    agentMap.set('s1', 'opencode');
    statusMap.set('s1', 'running');

    const shown: Array<PendingEntry | null> = [];
    agentMonitor.start({ onShow: (entry) => shown.push(entry), onShowHint: vi.fn() });
    await sleep(500);

    const ask = (id: string, sessionID: string, permission: string): void => {
      (sseState.handlers.onEvent as (event: unknown) => void)({
        directory: '/repo',
        payload: {
          type: 'permission.asked',
          properties: { id, sessionID, permission, patterns: ['ls'], metadata: {}, always: false },
        },
      });
    };
    ask('per_1', 'sess_1', 'bash');
    ask('per_2', 'sess_1', 'bash');
    ask('per_3', 'sess_1', 'edit'); // different kind: not covered by an 'always' bash
    ask('per_4', 'sess_2', 'bash'); // different session: not covered either
    await sleep(10);
    expect(agentMonitor.pending.size).toBe(4);

    await agentMonitor.replyPermission(agentMonitor.pending.get('per_1')!, 'always');

    expect(client.replyPermission).toHaveBeenCalledWith(
      expect.objectContaining({ host: HOST, port: 4096 }),
      'per_1',
      'always',
      undefined,
    );
    expect(client.replyPermission).toHaveBeenCalledWith(
      expect.objectContaining({ host: HOST, port: 4096 }),
      'per_2',
      'always',
    );
    expect(client.replyPermission).not.toHaveBeenCalledWith(
      expect.anything(),
      'per_3',
      expect.anything(),
    );
    expect(client.replyPermission).not.toHaveBeenCalledWith(
      expect.anything(),
      'per_4',
      expect.anything(),
    );
    expect(agentMonitor.pending.size).toBe(2);
    expect(agentMonitor.pending.get('per_1')).toBeNull();
    expect(agentMonitor.pending.get('per_2')).toBeNull();
    expect(agentMonitor.pending.get('per_3')).not.toBeNull();
    expect(agentMonitor.pending.get('per_4')).not.toBeNull();
  });

  it('persists the shown card until interaction: focus changes and new requests do not hide it', async () => {
    applyConfig({
      hyperKit: { agentMonitor: { heartbeatSec: 0, ports: [4096], scope: 'all', persist: true } },
    });
    storeWith({ g1: group('g1', 's1', null) }, 'g2');
    cwdMap.set('s1', '/repo');
    agentMap.set('s1', 'opencode');
    statusMap.set('s1', 'running');

    const shown: Array<PendingEntry | null> = [];
    agentMonitor.start({ onShow: (entry) => shown.push(entry), onShowHint: vi.fn() });
    await sleep(500);

    (sseState.handlers.onEvent as (event: unknown) => void)({
      directory: '/repo',
      payload: {
        type: 'permission.asked',
        properties: {
          id: 'per_1',
          sessionID: 'sess_1',
          permission: 'bash',
          patterns: ['ls'],
          metadata: {},
          always: false,
        },
      },
    });
    await sleep(10);
    expect(shown[shown.length - 1]).toMatchObject({ requestID: 'per_1' });

    // focusing the asking tab would hide the card without persist
    storeWith({ g1: group('g1', 's1', null) }, 'g1');
    agentMonitor.onFocusChanged();
    expect(shown[shown.length - 1]).toMatchObject({ requestID: 'per_1' });

    // a second request must not swap the card under the user
    (sseState.handlers.onEvent as (event: unknown) => void)({
      directory: '/repo',
      payload: {
        type: 'permission.asked',
        properties: {
          id: 'per_2',
          sessionID: 'sess_1',
          permission: 'bash',
          patterns: ['ls'],
          metadata: {},
          always: false,
        },
      },
    });
    await sleep(10);
    expect(shown[shown.length - 1]).toMatchObject({ requestID: 'per_1' });

    // back to a neutral tab: answering advances the queue to the next request
    storeWith({ g1: group('g1', 's1', null) }, 'g2');
    agentMonitor.onFocusChanged();
    expect(shown[shown.length - 1]).toMatchObject({ requestID: 'per_1' });
    await agentMonitor.replyPermission(agentMonitor.pending.get('per_1')!, 'once');
    expect(shown[shown.length - 1]).toMatchObject({ requestID: 'per_2' });
    await agentMonitor.replyPermission(agentMonitor.pending.get('per_2')!, 'once');
    expect(shown[shown.length - 1]).toBeNull();
  });

  it('dismissing advances the queue without answering', async () => {
    applyConfig({
      hyperKit: { agentMonitor: { heartbeatSec: 0, ports: [4096], scope: 'all', persist: true } },
    });
    storeWith({ g1: group('g1', 's1', null) }, 'g2');
    cwdMap.set('s1', '/repo');
    agentMap.set('s1', 'opencode');
    statusMap.set('s1', 'running');

    const shown: Array<PendingEntry | null> = [];
    agentMonitor.start({ onShow: (entry) => shown.push(entry), onShowHint: vi.fn() });
    await sleep(500);

    const ask = (id: string): void => {
      (sseState.handlers.onEvent as (event: unknown) => void)({
        directory: '/repo',
        payload: {
          type: 'permission.asked',
          properties: {
            id,
            sessionID: 'sess_1',
            permission: 'bash',
            patterns: ['ls'],
            metadata: {},
            always: false,
          },
        },
      });
    };
    ask('per_1');
    ask('per_2');
    await sleep(10);
    expect(shown[shown.length - 1]).toMatchObject({ requestID: 'per_1' });

    // dismiss: nothing is sent to the server, the queue advances to per_2
    const dismissed = agentMonitor.pending.get('per_1')!;
    agentMonitor.dismiss(dismissed);
    expect(client.replyPermission).not.toHaveBeenCalled();
    expect(shown[shown.length - 1]).toMatchObject({ requestID: 'per_2' });

    // a refresh must not resurrect the dismissed request in the queue
    agentMonitor.requestScan();
    await sleep(600);
    expect(shown[shown.length - 1]).toMatchObject({ requestID: 'per_2' });
  });

  it('viewTab targets the unique agent tab when attribution failed', async () => {
    const dispatch = storeWithDispatch(
      { g1: group('g1', 's1', null), g2: group('g2', 's2', null) },
      'g2',
    );
    agentMap.set('s1', 'opencode');
    statusMap.set('s1', 'running');

    // no cwd data anywhere (no OSC 7): the entry has no tab and no directory
    await agentMonitor.viewTab(permissionEntry({ tabUid: null, directory: null }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'SESSION_SET_ACTIVE', uid: 's1' });
  });

  it('viewTab prefers a non-active agent tab among several', async () => {
    const dispatch = storeWithDispatch(
      { g1: group('g1', 's1', null), g2: group('g2', 's2', null) },
      'g2',
    );
    agentMap.set('s1', 'opencode');
    statusMap.set('s1', 'running');
    agentMap.set('s2', 'opencode');
    statusMap.set('s2', 'running');

    // both tabs run opencode; the user is in g2, so the asking tab is g1
    await agentMonitor.viewTab(permissionEntry({ tabUid: null, directory: null }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'SESSION_SET_ACTIVE', uid: 's1' });
    expect(dispatch).not.toHaveBeenCalledWith({ type: 'SESSION_SET_ACTIVE', uid: 's2' });
  });

  it('viewTab re-matches the directory at click time instead of trusting a stale tabUid', async () => {
    const dispatch = storeWithDispatch(
      { g1: group('g1', 's1', null), g2: group('g2', 's2', null) },
      'g2',
    );
    cwdMap.set('s1', '/repo');
    agentMap.set('s1', 'opencode');
    statusMap.set('s1', 'running');

    // entry.tabUid points at the tab the user is already in (stale/wrong):
    // the fresh directory match must win and route to the asking tab
    await agentMonitor.viewTab(permissionEntry({ tabUid: 'g2', directory: '/repo' }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'SESSION_SET_ACTIVE', uid: 's1' });
  });

  it('viewTab does nothing without a resolvable tab', async () => {
    const dispatch = storeWithDispatch({ g1: group('g1', 's1', null) }, 'g1');

    await agentMonitor.viewTab(permissionEntry({ tabUid: null, directory: null }));
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('forgets an instance whose stream died and health probe fails', async () => {
    storeWith({ g1: group('g1', 's1', null) }, 'g2');
    cwdMap.set('s1', '/repo');
    agentMap.set('s1', 'opencode');
    statusMap.set('s1', 'running');

    const shown: Array<PendingEntry | null> = [];
    agentMonitor.start({ onShow: (entry) => shown.push(entry), onShowHint: vi.fn() });
    await sleep(500);
    expect(client.subscribeEvents).toHaveBeenCalledTimes(1);

    (sseState.handlers.onEvent as (event: unknown) => void)({
      directory: '/repo',
      payload: {
        type: 'permission.asked',
        properties: {
          id: 'per_1',
          sessionID: 'sess_1',
          permission: 'bash',
          patterns: ['ls'],
          metadata: {},
          always: false,
        },
      },
    });
    await sleep(10);
    expect(agentMonitor.pending.size).toBe(1);

    // stream dies and the server is gone: the retry probe must drop the
    // instance (and its pending requests) instead of retrying forever
    (client.probeHealth as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      healthy: false,
      version: '1.18.15',
    });
    (sseState.handlers.onClose as (error?: Error) => void)();
    await sleep(1200);
    expect(agentMonitor.pending.size).toBe(0);
    expect(shown[shown.length - 1]).toBeNull();
  });

  it('re-subscribes after a stream hiccup when the server is still healthy', async () => {
    storeWith({ g1: group('g1', 's1', null) }, 'g2');
    cwdMap.set('s1', '/repo');
    agentMap.set('s1', 'opencode');
    statusMap.set('s1', 'running');

    agentMonitor.start({ onShow: vi.fn(), onShowHint: vi.fn() });
    await sleep(500);
    expect(client.subscribeEvents).toHaveBeenCalledTimes(1);

    (sseState.handlers.onClose as (error?: Error) => void)();
    await sleep(1200);
    expect(client.subscribeEvents).toHaveBeenCalledTimes(2);
    expect(agentMonitor.pending.size).toBe(0);
  });

  it("scope 'self' admits only requests that can belong to this window's tabs", async () => {
    applyConfig({
      hyperKit: { agentMonitor: { heartbeatSec: 0, ports: [4096], scope: 'self' } },
    });
    storeWith({ g1: group('g1', 's1', null) }, 'g2');
    cwdMap.set('s1', '/repo');
    agentMap.set('s1', 'opencode');
    statusMap.set('s1', 'running');

    // scope='self' now gates attachment the same way 'hyper' does: the
    // instance must resolve to a pid running inside this Hyper window.
    const lsofOutput = [
      'COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME',
      'opencode 777 456 u IPv4 0x1 0t0 TCP 127.0.0.1:4096 (LISTEN)',
      '',
    ].join('\n');
    setNodeModuleForTest('child_process', {
      exec: ((
        cmd: string,
        _opts: unknown,
        callback: (error: Error | null, stdout: string) => void,
      ) => {
        if (cmd.startsWith('lsof')) {
          callback(null, lsofOutput);
          return;
        }
        if (cmd.startsWith('ps -o comm=')) {
          callback(null, 'Hyper\n');
          return;
        }
        callback(null, '1\n');
      }) as unknown as typeof import('node:child_process').exec,
    });

    try {
      const shown: Array<PendingEntry | null> = [];
      agentMonitor.start({ onShow: (entry) => shown.push(entry), onShowHint: vi.fn() });
      await sleep(500);

      const ask = (id: string, sessionID: string, directory?: string): void => {
        const event: Record<string, unknown> = {
          payload: {
            type: 'permission.asked',
            properties: {
              id,
              sessionID,
              permission: 'bash',
              patterns: ['ls'],
              metadata: {},
              always: false,
            },
          },
        };
        if (directory) {
          event.directory = directory;
        }
        (sseState.handlers.onEvent as (event: unknown) => void)(event);
      };

      // in-window session: admitted, attributed to the tab
      ask('per_1', 'sess_1', '/repo');
      await sleep(10);
      expect(agentMonitor.pending.get('per_1')).toMatchObject({ tabUid: 'g1', agent: 'opencode' });

      // unknown session with no directory anywhere: foreign, dropped outright
      ask('per_2', 'sess_foreign');
      await sleep(10);
      expect(agentMonitor.pending.get('per_2')).toBeNull();

      // directory that matches no tab: foreign, swept on the next reconcile.
      // It must never reach the popup in the meantime (that's the request
      // "leaking" from another terminal) even though it briefly sits in the
      // pending queue awaiting reconcile's resolve-or-sweep pass.
      ask('per_3', 'sess_1', '/somewhere-else');
      await sleep(10);
      expect(agentMonitor.pending.get('per_3')).toMatchObject({ tabUid: null });
      expect(shown.some((entry) => entry?.requestID === 'per_3')).toBe(false);
      agentMonitor.requestScan();
      await sleep(300);
      expect(agentMonitor.pending.get('per_3')).toBeNull();
      expect(agentMonitor.pending.get('per_1')).not.toBeNull();
      expect(shown.some((entry) => entry?.requestID === 'per_3')).toBe(false);
    } finally {
      clearNodeModulesForTest();
    }
  });

  it("scope 'self' skips instances not started inside Hyper", async () => {
    applyConfig({
      hyperKit: { agentMonitor: { heartbeatSec: 0, ports: [4096], scope: 'self' } },
    });
    storeWith({ g1: group('g1', 's1', null) }, 'g2');
    cwdMap.set('s1', '/repo');
    agentMap.set('s1', 'opencode');
    statusMap.set('s1', 'running');

    // the listener table shows the port owned by a plain-terminal process
    // (Terminal.app, iTerm, VS Code, ...) -- not a Hyper descendant.
    const lsofOutput = [
      'COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME',
      'opencode 777 456 u IPv4 0x1 0t0 TCP 127.0.0.1:4096 (LISTEN)',
      '',
    ].join('\n');
    setNodeModuleForTest('child_process', {
      exec: ((
        cmd: string,
        _opts: unknown,
        callback: (error: Error | null, stdout: string) => void,
      ) => {
        if (cmd.startsWith('lsof')) {
          callback(null, lsofOutput);
          return;
        }
        if (cmd.startsWith('ps -o comm=')) {
          callback(null, 'zsh\n'); // never Hyper
          return;
        }
        callback(null, '1\n');
      }) as unknown as typeof import('node:child_process').exec,
    });

    agentMonitor.start({ onShow: vi.fn(), onShowHint: vi.fn() });
    try {
      await sleep(500);
      expect(client.probeHealth).not.toHaveBeenCalled();
      expect(client.subscribeEvents).not.toHaveBeenCalled();
    } finally {
      clearNodeModulesForTest();
    }
  });

  it('drops requests attributed to a tab whose agent is not monitored', async () => {
    applyConfig({
      hyperKit: {
        agentMonitor: { heartbeatSec: 0, ports: [4096], scope: 'all', agents: { claude: false } },
      },
    });
    storeWith({ g1: group('g1', 's1', null) }, 'g2');
    cwdMap.set('s1', '/repo');
    agentMap.set('s1', 'claude'); // the asking tab runs claude
    statusMap.set('s1', 'running');

    agentMonitor.start({ onShow: vi.fn(), onShowHint: vi.fn() });
    await sleep(500);

    const ask = (id: string): void => {
      (sseState.handlers.onEvent as (event: unknown) => void)({
        directory: '/repo',
        payload: {
          type: 'permission.asked',
          properties: {
            id,
            sessionID: 'sess_1',
            permission: 'bash',
            patterns: ['ls'],
            metadata: {},
            always: false,
          },
        },
      });
    };

    // claude monitor off: the request never surfaces
    ask('per_1');
    await sleep(10);
    expect(agentMonitor.pending.size).toBe(0);

    // flipping the agent on admits the next request, labeled with the agent
    applyConfig({
      hyperKit: {
        agentMonitor: { heartbeatSec: 0, ports: [4096], scope: 'all', agents: { claude: true } },
      },
    });
    ask('per_2');
    await sleep(10);
    expect(agentMonitor.pending.get('per_2')).toMatchObject({ agent: 'claude' });
  });

  it('labels an opencode question from a multi-agent tab as opencode even when its badge was cleared', async () => {
    applyConfig({ hyperKit: { agentMonitor: { heartbeatSec: 0, ports: [4096], scope: 'all' } } });
    // tab g1: claude + agy + opencode panes, all in /repo; the opencode
    // pane lost its badge to title chatter, but its TUI title still names
    // opencode. g2 is the freshly opened tab in the same directory.
    storeWith(
      {
        g1: { uid: 'g1', sessionUid: null, parentUid: null, children: ['g1a', 'g1b', 'g1c'] },
        g1a: group('g1a', 's1', 'g1'),
        g1b: group('g1b', 's2', 'g1'),
        g1c: group('g1c', 's3', 'g1'),
        g2: group('g2', 's4', null),
      },
      'g2',
    );
    cwdMap.set('s1', '/repo');
    cwdMap.set('s2', '/repo');
    cwdMap.set('s3', '/repo');
    cwdMap.set('s4', '/repo');
    agentMap.set('s1', 'claude');
    agentMap.set('s2', 'agy');
    titleMap.set('s3', '⠂ opencode'); // badge cleared, title survives
    statusMap.set('g1a', 'running');
    statusMap.set('g1b', 'running');
    statusMap.set('g1c', 'running');
    statusMap.set('g2', 'done');

    agentMonitor.start({ onShow: vi.fn(), onShowHint: vi.fn() });
    await sleep(500);

    (sseState.handlers.onEvent as (event: unknown) => void)({
      directory: '/repo',
      payload: {
        type: 'question.asked',
        properties: {
          id: 'que_1',
          sessionID: 'sess_1',
          questions: [{ question: 'Which approach?', header: 'Approach' }],
        },
      },
    });
    await sleep(10);
    expect(agentMonitor.pending.get('que_1')).toMatchObject({ tabUid: 'g1', agent: 'opencode' });
  });

  it('gates unattributed requests on the opencode flag', async () => {
    applyConfig({
      hyperKit: {
        agentMonitor: { heartbeatSec: 0, ports: [4096], scope: 'all', agents: { opencode: false } },
      },
    });
    storeWith({ g1: group('g1', 's1', null) }, 'g2'); // plain tab, no cwd
    agentMonitor.start({ onShow: vi.fn(), onShowHint: vi.fn() });
    await sleep(500);

    (sseState.handlers.onEvent as (event: unknown) => void)({
      directory: '/repo',
      payload: {
        type: 'permission.asked',
        properties: {
          id: 'per_1',
          sessionID: 'sess_1',
          permission: 'bash',
          patterns: ['ls'],
          metadata: {},
          always: false,
        },
      },
    });
    await sleep(10);
    expect(agentMonitor.pending.size).toBe(0);
  });

  it('sweeps queued requests whose agent gets turned off (config reload)', async () => {
    applyConfig({ hyperKit: { agentMonitor: { heartbeatSec: 0, ports: [4096], scope: 'all' } } });
    storeWith({ g1: group('g1', 's1', null) }, 'g2');
    cwdMap.set('s1', '/repo');
    agentMap.set('s1', 'opencode');
    statusMap.set('s1', 'running');

    agentMonitor.start({ onShow: vi.fn(), onShowHint: vi.fn() });
    await sleep(500);

    (sseState.handlers.onEvent as (event: unknown) => void)({
      directory: '/repo',
      payload: {
        type: 'permission.asked',
        properties: {
          id: 'per_1',
          sessionID: 'sess_1',
          permission: 'bash',
          patterns: ['ls'],
          metadata: {},
          always: false,
        },
      },
    });
    await sleep(10);
    expect(agentMonitor.pending.size).toBe(1);

    applyConfig({
      hyperKit: {
        agentMonitor: { heartbeatSec: 0, ports: [4096], scope: 'all', agents: { opencode: false } },
      },
    });
    agentMonitor.requestScan();
    await sleep(300);
    expect(agentMonitor.pending.size).toBe(0);
  });

  it('treats an unreachable reply as answered when optimistic', async () => {
    applyConfig({ hyperKit: { agentMonitor: { heartbeatSec: 0, ports: [4096], scope: 'all' } } });
    storeWith({ g1: group('g1', 's1', null) }, 'g2');
    cwdMap.set('s1', '/repo');
    agentMap.set('s1', 'opencode');
    statusMap.set('s1', 'running');

    agentMonitor.start({ onShow: vi.fn(), onShowHint: vi.fn() });
    await sleep(500);

    const ask = (id: string): void => {
      (sseState.handlers.onEvent as (event: unknown) => void)({
        directory: '/repo',
        payload: {
          type: 'permission.asked',
          properties: {
            id,
            sessionID: 'sess_1',
            permission: 'bash',
            patterns: ['ls'],
            metadata: {},
            always: false,
          },
        },
      });
    };

    // server unreachable (request already answered elsewhere): any button
    // counts as accepted and the card closes
    (client.replyPermission as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    ask('per_1');
    await sleep(10);
    await expect(
      agentMonitor.replyPermission(agentMonitor.pending.get('per_1')!, 'once'),
    ).resolves.toBe(true);
    expect(agentMonitor.pending.size).toBe(0);

    // strict mode keeps the request and reports the failure
    applyConfig({
      hyperKit: {
        agentMonitor: { heartbeatSec: 0, ports: [4096], scope: 'all', optimistic: false },
      },
    });
    ask('per_2');
    await sleep(10);
    await expect(
      agentMonitor.replyPermission(agentMonitor.pending.get('per_2')!, 'once'),
    ).resolves.toBe(false);
    expect(agentMonitor.pending.size).toBe(1);
  });

  it("scope 'hyper' skips instances not started inside Hyper", async () => {
    applyConfig({
      hyperKit: { agentMonitor: { heartbeatSec: 0, ports: [4096], scope: 'hyper' } },
    });
    storeWith({ g1: group('g1', 's1', null) }, 'g2');
    cwdMap.set('s1', '/repo');
    agentMap.set('s1', 'opencode');
    statusMap.set('s1', 'running');

    // the listener table shows the port owned by a plain-terminal process
    const lsofOutput = [
      'COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME',
      'opencode 777 456 u IPv4 0x1 0t0 TCP 127.0.0.1:4096 (LISTEN)',
      '',
    ].join('\n');
    setNodeModuleForTest('child_process', {
      exec: ((
        cmd: string,
        _opts: unknown,
        callback: (error: Error | null, stdout: string) => void,
      ) => {
        if (cmd.startsWith('lsof')) {
          callback(null, lsofOutput);
          return;
        }
        if (cmd.startsWith('ps -o comm=')) {
          callback(null, 'zsh\n'); // never Hyper
          return;
        }
        callback(null, '1\n');
      }) as unknown as typeof import('node:child_process').exec,
    });

    agentMonitor.start({ onShow: vi.fn(), onShowHint: vi.fn() });
    try {
      await sleep(500);
      expect(client.probeHealth).not.toHaveBeenCalled();
      expect(client.subscribeEvents).not.toHaveBeenCalled();
    } finally {
      clearNodeModulesForTest();
    }
  });
});
