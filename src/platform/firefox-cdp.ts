/* Firefox on macOS has no AppleScript support and never registers a
   MediaRemote session, so the only way to see its tabs is the DevTools
   protocol: when Firefox runs with --remote-debugging-port it writes a
   devtoolsActivePort file into its profile directory and serves a CDP
   endpoint on localhost. Everything here is best-effort — any failure
   resolves to null/false so the media panel simply falls back to the other
   sources. Only meaningful on macOS (Linux/Windows Firefox already show up
   via MPRIS/SMTC). */

import type { MediaCommand } from './now-playing';
import { hasNodeRuntime, readTextFileSync } from './exec';

interface FirefoxPage {
  id: string;
  title: string;
  url: string;
  wsUrl: string;
}

interface FirefoxMediaInfo {
  title: string;
  playing: boolean;
  pageVolume: number | null;
}
const VIDEO_JS = "!!document.querySelector('video')";
const PAUSED_JS = "!!document.querySelector('video') && document.querySelector('video').paused";
const PAGE_VOL_JS =
  "Math.round((document.querySelector('video')?document.querySelector('video').volume*100:-1))";

/* snippets stay free of double quotes so they survive string escaping.
   Shared with now-playing.ts: Chromium runs the same video-control JS */
export const COMMAND_JS: Record<'playPause' | 'next' | 'prev', string> = {
  playPause: "var v=document.querySelector('video');if(v){if(v.paused){v.play()}else{v.pause()}}",
  next: "var s='[data-testid^=control-button-skip-forward], .ytp-next-button, [aria-label^=Next]';var b=document.querySelector(s);if(b){b.click()}",
  prev: "var s='[data-testid^=control-button-skip-back], .ytp-prev-button, [aria-label^=Previous]';var b=document.querySelector(s);if(b){b.click()}",
};

export function volumeJs(value: number): string {
  const ratio = (value / 100).toFixed(2);
  return "var v=document.querySelector('video');if(v){v.volume=" + ratio + '}';
}

/* devtoolsActivePort holds "<port>\n<profile-path>"; only the port matters */
export function parseDevtoolsPortFile(text: string): number | null {
  const port = parseInt(String(text || '').split('\n')[0], 10);
  return isNaN(port) ? null : port;
}

async function findDevtoolsPortFile(): Promise<string | null> {
  if (!hasNodeRuntime()) {
    return null;
  }
  try {
    const os: any = window.require('os');
    const fs: any = window.require('fs');
    const path: any = window.require('path');
    const profilesDir = path.join(
      os.homedir(),
      'Library',
      'Application Support',
      'Firefox',
      'Profiles',
    );
    const profiles: string[] = fs
      .readdirSync(profilesDir)
      .map((name: string) => path.join(profilesDir, name));
    for (const profile of profiles) {
      const file = path.join(profile, 'devtoolsActivePort');
      if (fs.existsSync(file)) {
        return file;
      }
    }
  } catch {
    // profiles dir may not exist when Firefox was never installed
  }
  return null;
}

async function findFirefoxDevtoolsPort(): Promise<number | null> {
  const file = await findDevtoolsPortFile();
  if (!file) {
    return null;
  }
  return parseDevtoolsPortFile(readTextFileSync(file) ?? '');
}

async function fetchJson(url: string, timeoutMs: number): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const response = await window.fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!response.ok) {
      return null;
    }
    return await response.text();
  } catch {
    return null;
  }
}

/* /json/list entries: every target with type "page" and a websocket URL is a
   tab we can drive */
export function parseFirefoxPages(json: string | null): FirefoxPage[] {
  let targets: unknown = null;
  try {
    targets = JSON.parse(String(json || '[]'));
  } catch {
    return [];
  }
  if (!Array.isArray(targets)) {
    return [];
  }
  const pages: FirefoxPage[] = [];
  for (const target of targets) {
    if (
      target &&
      typeof target === 'object' &&
      (target as any).type === 'page' &&
      typeof (target as any).id === 'string' &&
      typeof (target as any).webSocketDebuggerUrl === 'string'
    ) {
      pages.push({
        id: (target as any).id,
        title: String((target as any).title || ''),
        url: String((target as any).url || ''),
        wsUrl: (target as any).webSocketDebuggerUrl,
      });
    }
  }
  return pages;
}

async function listPages(port: number): Promise<FirefoxPage[]> {
  const text = await fetchJson('http://127.0.0.1:' + port + '/json/list', 2000);
  return parseFirefoxPages(text);
}

/* one Runtime.evaluate round-trip over the page's websocket; returns the
   stringified value or null on any failure/timeout */
function evaluate(wsUrl: string, expression: string, timeoutMs: number): Promise<string | null> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || typeof window.WebSocket === 'undefined') {
      resolve(null);
      return;
    }
    let ws: WebSocket | null = null;
    let settled = false;
    const finish = (value: string | null) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      try {
        ws?.close();
      } catch {
        // best effort
      }
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    try {
      ws = new window.WebSocket(wsUrl);
    } catch {
      finish(null);
      return;
    }
    ws.onopen = () => {
      ws?.send(
        JSON.stringify({
          id: 1,
          method: 'Runtime.evaluate',
          params: { expression, returnByValue: true },
        }),
      );
    };
    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(String(event.data));
        if (message.id === 1) {
          const value = message.result?.result?.value;
          finish(value === undefined || value === null ? null : String(value));
        }
      } catch {
        // keep waiting for a well-formed reply
      }
    };
    ws.onerror = () => finish(null);
    ws.onclose = () => finish(null);
  });
}

/* first tab that holds a video element — playing OR paused, so a paused
   video stays a source the user can resume */
async function findVideoPage(port: number): Promise<FirefoxPage | null> {
  const pages = await listPages(port);
  for (const page of pages) {
    const hasVideo = await evaluate(page.wsUrl, VIDEO_JS, 2000);
    if (hasVideo === 'true') {
      return page;
    }
  }
  return null;
}

/* finds the first tab with a video element and reports its title + volume */
export async function probeFirefoxMedia(): Promise<FirefoxMediaInfo | null> {
  const port = await findFirefoxDevtoolsPort();
  if (port === null) {
    return null;
  }
  const page = await findVideoPage(port);
  if (!page) {
    return null;
  }
  const paused = await evaluate(page.wsUrl, PAUSED_JS, 2000);
  const volumeRaw = await evaluate(page.wsUrl, PAGE_VOL_JS, 2000);
  const parsed = volumeRaw !== null ? parseInt(volumeRaw, 10) : NaN;
  return {
    title: page.title,
    playing: paused !== 'true',
    pageVolume: isNaN(parsed) ? null : parsed,
  };
}

/* transport command for the video tab; volUp/volDown carry the target
   page volume (0-100) in `volume` */
export async function sendFirefoxCommand(
  command: MediaCommand,
  volume: number | null = null,
): Promise<void> {
  const port = await findFirefoxDevtoolsPort();
  if (port === null) {
    return;
  }
  const page = await findVideoPage(port);
  if (!page) {
    return;
  }
  const js =
    command === 'volUp' || command === 'volDown'
      ? volume !== null
        ? volumeJs(volume)
        : null
      : COMMAND_JS[command] || null;
  if (js) {
    await evaluate(page.wsUrl, js, 3000);
  }
}
