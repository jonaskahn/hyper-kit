import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';

import {
  clearNodeModulesForTest,
  setNodeModuleForTest,
} from '../../src/platform/agent-monitor/node';
import * as client from '../../src/platform/agent-monitor/client';

const HOST = '127.0.0.1';

function fakeHttp(
  handler: (options: Record<string, unknown>) => { status: number; body?: string },
): typeof import('node:http') {
  return {
    request: ((options: Record<string, unknown>, callback: (res: unknown) => void) => {
      const req = new EventEmitter() as EventEmitter & {
        write: () => void;
        end: () => void;
        destroy: () => void;
      };
      req.write = vi.fn();
      req.end = vi.fn();
      req.destroy = vi.fn();
      process.nextTick(() => {
        const { status, body } = handler(options);
        const res = new EventEmitter() as EventEmitter & {
          statusCode: number;
          setEncoding: () => void;
        };
        res.statusCode = status;
        res.setEncoding = vi.fn();
        callback(res);
        if (body !== undefined) {
          process.nextTick(() => res.emit('data', Buffer.from(body)));
        }
        process.nextTick(() => res.emit('end'));
      });
      return req;
    }) as unknown as typeof import('node:http').request,
  } as unknown as typeof import('node:http');
}

/* Each test owns its node-module override and clears it before returning
   (finally). NEVER clear shared override state from afterEach/beforeEach
   hooks: a hook can be scheduled to run while the next test's await is in
   flight (observed under load), wiping the override mid-test. */
afterEach(() => {
  vi.restoreAllMocks();
});

describe('client', () => {
  it('probeHealth parses the health payload', async () => {
    setNodeModuleForTest(
      'http',
      fakeHttp(() => ({
        status: 200,
        body: JSON.stringify({ healthy: true, version: '1.18.15' }),
      })),
    );
    try {
      await expect(client.probeHealth({ host: HOST, port: 4096 })).resolves.toEqual({
        healthy: true,
        version: '1.18.15',
      });
    } finally {
      clearNodeModulesForTest();
    }
  });

  it('probeHealth returns null for non-opencode services', async () => {
    setNodeModuleForTest(
      'http',
      fakeHttp(() => ({ status: 404, body: '<html>Cannot GET</html>' })),
    );
    try {
      await expect(client.probeHealth({ host: HOST, port: 4096 })).resolves.toBeNull();
    } finally {
      clearNodeModulesForTest();
    }
  });

  it('listSessions parses the session list', async () => {
    setNodeModuleForTest(
      'http',
      fakeHttp((options) => {
        expect(options.path).toBe('/session');
        return {
          status: 200,
          body: JSON.stringify([
            { id: 'sess_1', directory: '/repoA', projectID: 'p1' },
            { id: 'sess_2', directory: '/repoB', projectID: 'p2' },
          ]),
        };
      }),
    );
    try {
      await expect(client.listSessions({ host: HOST, port: 4096 })).resolves.toEqual([
        { id: 'sess_1', directory: '/repoA', projectID: 'p1' },
        { id: 'sess_2', directory: '/repoB', projectID: 'p2' },
      ]);
    } finally {
      clearNodeModulesForTest();
    }
  });

  it('listSessions returns null on a non-2xx response', async () => {
    setNodeModuleForTest(
      'http',
      fakeHttp(() => ({ status: 500 })),
    );
    try {
      await expect(client.listSessions({ host: HOST, port: 4096 })).resolves.toBeNull();
    } finally {
      clearNodeModulesForTest();
    }
  });

  it('getSession fetches a single session by id', async () => {
    setNodeModuleForTest(
      'http',
      fakeHttp((options) => {
        expect(options.path).toBe('/session/sess_1');
        return {
          status: 200,
          body: JSON.stringify({ id: 'sess_1', directory: '/repoA', projectID: 'p1' }),
        };
      }),
    );
    try {
      await expect(client.getSession({ host: HOST, port: 4096 }, 'sess_1')).resolves.toEqual({
        id: 'sess_1',
        directory: '/repoA',
        projectID: 'p1',
      });
    } finally {
      clearNodeModulesForTest();
    }
  });

  it('getSession returns null for an unknown session', async () => {
    setNodeModuleForTest(
      'http',
      fakeHttp(() => ({ status: 404 })),
    );
    try {
      await expect(
        client.getSession({ host: HOST, port: 4096 }, 'sess_missing'),
      ).resolves.toBeNull();
    } finally {
      clearNodeModulesForTest();
    }
  });

  it('requestJson resolves null on network errors', async () => {
    const mod = {
      request: (() => {
        const req = new EventEmitter() as EventEmitter & {
          write: () => void;
          end: () => void;
          destroy: () => void;
        };
        req.write = vi.fn();
        req.end = vi.fn();
        req.destroy = vi.fn();
        process.nextTick(() => req.emit('error', new Error('ECONNREFUSED')));
        return req;
      }) as unknown as typeof import('node:http').request,
    } as unknown as typeof import('node:http');
    setNodeModuleForTest('http', mod);
    try {
      await expect(client.probeHealth({ host: HOST, port: 4096 })).resolves.toBeNull();
    } finally {
      clearNodeModulesForTest();
    }
  });

  it('replyPermission posts the payload to the right path', async () => {
    let captured = '';
    const mod = {
      request: ((_options: Record<string, unknown>, callback: (res: unknown) => void) => {
        const req = new EventEmitter() as EventEmitter & {
          write: (chunk: string) => void;
          end: () => void;
          destroy: () => void;
        };
        req.write = vi.fn((chunk: string) => {
          captured += chunk;
        });
        req.end = vi.fn();
        req.destroy = vi.fn();
        process.nextTick(() => {
          const res = new EventEmitter() as EventEmitter & {
            statusCode: number;
            setEncoding: () => void;
          };
          res.statusCode = 200;
          res.setEncoding = vi.fn();
          callback(res);
          process.nextTick(() => res.emit('data', Buffer.from('true')));
          process.nextTick(() => res.emit('end'));
        });
        return req;
      }) as unknown as typeof import('node:http').request,
    } as unknown as typeof import('node:http');
    setNodeModuleForTest('http', mod);
    try {
      await expect(
        client.replyPermission({ host: HOST, port: 4096 }, 'per_1', 'always', 'good idea'),
      ).resolves.toBe(true);
      expect(JSON.parse(captured)).toEqual({ reply: 'always', message: 'good idea' });
    } finally {
      clearNodeModulesForTest();
    }
  });

  it('replyQuestion posts answers as labels per question', async () => {
    let captured = '';
    const mod = {
      request: ((_options: Record<string, unknown>, callback: (res: unknown) => void) => {
        const req = new EventEmitter() as EventEmitter & {
          write: (chunk: string) => void;
          end: () => void;
          destroy: () => void;
        };
        req.write = vi.fn((chunk: string) => {
          captured += chunk;
        });
        req.end = vi.fn();
        req.destroy = vi.fn();
        process.nextTick(() => {
          const res = new EventEmitter() as EventEmitter & {
            statusCode: number;
            setEncoding: () => void;
          };
          res.statusCode = 200;
          res.setEncoding = vi.fn();
          callback(res);
          process.nextTick(() => res.emit('data', Buffer.from('true')));
          process.nextTick(() => res.emit('end'));
        });
        return req;
      }) as unknown as typeof import('node:http').request,
    } as unknown as typeof import('node:http');
    setNodeModuleForTest('http', mod);
    try {
      await expect(
        client.replyQuestion({ host: HOST, port: 4096 }, 'que_1', [['A', 'custom']]),
      ).resolves.toBe(true);
      expect(JSON.parse(captured)).toEqual({ answers: [['A', 'custom']] });
    } finally {
      clearNodeModulesForTest();
    }
  });

  it('subscribeEvents parses chunked SSE and fires onClose at stream end', async () => {
    let responder: ((chunk: string) => void) | null = null;
    const req = new EventEmitter() as EventEmitter & { destroy: () => void };
    req.destroy = vi.fn();
    const mod = {
      request: ((_options: unknown, callback: (res: unknown) => void) => {
        const res = new EventEmitter() as EventEmitter & {
          statusCode: number;
          setEncoding: () => void;
        };
        res.statusCode = 200;
        res.setEncoding = vi.fn();
        callback(res);
        responder = (chunk: string) => res.emit('data', chunk);
        res.on('end', () => undefined);
        process.nextTick(() => res.emit('end'));
        return req;
      }) as unknown as typeof import('node:http').request,
    } as unknown as typeof import('node:http');
    setNodeModuleForTest('http', mod);
    try {
      const events: unknown[] = [];
      const closed: string[] = [];
      client.subscribeEvents(
        { host: HOST, port: 4096 },
        {
          onEvent: (event) => events.push(event),
          onClose: (error) => closed.push(error?.message ?? 'closed'),
        },
      );
      responder!(
        `data: ${JSON.stringify({ directory: '/repo', payload: { type: 'permission.asked', properties: { id: 'per_1' } } })}\n\n`,
      );
      responder!(
        `data: ${JSON.stringify({ payload: { type: 'question.asked', properties: { id: 'que_1' } } })}\n\n`,
      );
      responder!('data: not-json\n\n');
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(events).toHaveLength(2);
      expect(events[0]).toMatchObject({ directory: '/repo' });
      expect(closed.length).toBeGreaterThan(0);
    } finally {
      clearNodeModulesForTest();
    }
  });
});
