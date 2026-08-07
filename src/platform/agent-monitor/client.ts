/* HTTP client for opencode's instance API, spoken over Node's http module so
   requests bypass Chromium CORS entirely (the monitor runs in Hyper's
   renderer, but the opencode server is not a CORS-enabled endpoint).
   All helpers are null-tolerant: anything unreachable/4xx returns null. */

import { getNodeModule } from './node';
import type http from 'node:http';
import type {
  HealthInfo,
  InstanceTarget,
  PermissionReply,
  PermissionRequest,
  QuestionRequest,
  SessionInfo,
  SseEnvelope,
} from './types';

type HttpModule = typeof http;

function httpModule(): HttpModule | null {
  return getNodeModule('http') as HttpModule | null;
}

function authHeaders(target: InstanceTarget): Record<string, string> | undefined {
  if (!target.password) {
    return undefined;
  }
  const encoded = Buffer.from(`opencode:${target.password}`).toString('base64');
  return { Authorization: `Basic ${encoded}` };
}

function requestJson<T>(
  target: InstanceTarget,
  method: string,
  path: string,
  body?: unknown,
  timeoutMs = 4000,
): Promise<T | null> {
  const mod = httpModule();
  if (!mod) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const headers: Record<string, string> = Object.assign({}, authHeaders(target), {
      Accept: 'application/json',
    });
    if (payload !== undefined) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = String(Buffer.byteLength(payload));
    }
    const req = mod.request(
      { host: target.host, port: target.port, method, path, headers, timeout: timeoutMs },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
            resolve(null);
            return;
          }
          const text = Buffer.concat(chunks).toString('utf8');
          try {
            resolve(text ? (JSON.parse(text) as T) : null);
          } catch {
            resolve(null);
          }
        });
      },
    );
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(null));
    if (payload !== undefined) {
      req.write(payload);
    }
    req.end();
  });
}

export function probeHealth(target: InstanceTarget): Promise<HealthInfo | null> {
  return requestJson<HealthInfo>(target, 'GET', '/global/health', undefined, 2000);
}

/* All sessions an instance is currently serving. A single opencode server
   commonly hosts many unrelated project directories at once, so this is a
   list, not a single directory. */
export function listSessions(target: InstanceTarget): Promise<SessionInfo[] | null> {
  return requestJson<SessionInfo[]>(target, 'GET', '/session', undefined, 4000);
}

/* Lazy lookup for a session not yet in the last listSessions() snapshot
   (e.g. one created between polls). */
export function getSession(target: InstanceTarget, sessionID: string): Promise<SessionInfo | null> {
  return requestJson<SessionInfo>(
    target,
    'GET',
    `/session/${encodeURIComponent(sessionID)}`,
    undefined,
    3000,
  );
}

export function listPermissions(target: InstanceTarget): Promise<PermissionRequest[] | null> {
  return requestJson<PermissionRequest[]>(target, 'GET', '/permission', undefined, 3000);
}

export function listQuestions(target: InstanceTarget): Promise<QuestionRequest[] | null> {
  return requestJson<QuestionRequest[]>(target, 'GET', '/question', undefined, 3000);
}

export function replyPermission(
  target: InstanceTarget,
  requestID: string,
  reply: PermissionReply,
  message?: string,
): Promise<boolean> {
  return requestJson<boolean>(
    target,
    'POST',
    `/permission/${encodeURIComponent(requestID)}/reply`,
    message ? { reply, message } : { reply },
  ).then((result) => result === true);
}

export function replyQuestion(
  target: InstanceTarget,
  requestID: string,
  answers: string[][],
): Promise<boolean> {
  return requestJson<boolean>(target, 'POST', `/question/${encodeURIComponent(requestID)}/reply`, {
    answers,
  }).then((result) => result === true);
}

export function rejectQuestion(target: InstanceTarget, requestID: string): Promise<boolean> {
  return requestJson<boolean>(
    target,
    'POST',
    `/question/${encodeURIComponent(requestID)}/reject`,
  ).then((result) => result === true);
}

/* --- server-sent events -------------------------------------------------- */

interface SseCallbacks {
  onEvent: (event: SseEnvelope) => void;
  onClose: (error?: Error) => void;
}

export function subscribeEvents(target: InstanceTarget, callbacks: SseCallbacks): () => void {
  const mod = httpModule();
  let stopped = false;
  if (!mod) {
    callbacks.onClose(new Error('no node http module'));
    return () => undefined;
  }
  const req = mod.request(
    {
      host: target.host,
      port: target.port,
      method: 'GET',
      path: '/global/event',
      headers: Object.assign({ Accept: 'text/event-stream' }, authHeaders(target)),
      timeout: 30000,
    },
    (res) => {
      if (!res.statusCode || res.statusCode !== 200) {
        res.resume();
        callbacks.onClose(new Error(`sse status ${String(res.statusCode)}`));
        return;
      }
      let buffer = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        buffer += chunk;
        let newline = buffer.indexOf('\n');
        while (newline >= 0) {
          const line = buffer.slice(0, newline).replace(/\r$/, '');
          buffer = buffer.slice(newline + 1);
          handleLine(line);
          newline = buffer.indexOf('\n');
        }
      });
      res.on('end', () => {
        if (buffer) {
          handleLine(buffer);
          buffer = '';
        }
        if (!stopped) {
          callbacks.onClose(new Error('sse stream ended'));
        }
      });
      res.on('error', (err) => {
        if (!stopped) {
          callbacks.onClose(err);
        }
      });

      let dataLines: string[] = [];
      const handleLine = (line: string): void => {
        if (line === '') {
          if (dataLines.length > 0) {
            const text = dataLines.join('\n');
            dataLines = [];
            try {
              const event = JSON.parse(text) as SseEnvelope;
              if (event && event.payload && typeof event.payload.type === 'string') {
                callbacks.onEvent(event);
              }
            } catch {
              // malformed SSE line; skip
            }
          }
          return;
        }
        if (line.startsWith('data:')) {
          dataLines.push(line.slice(5).replace(/^ /, ''));
        }
      };
    },
  );
  req.on('timeout', () => req.destroy());
  req.on('error', (err) => {
    if (!stopped) {
      callbacks.onClose(err);
    }
  });
  return () => {
    stopped = true;
    req.destroy();
  };
}
