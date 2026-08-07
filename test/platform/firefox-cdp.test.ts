import { describe, it, expect } from 'vitest';

import { parseDevtoolsPortFile, parseFirefoxPages } from '../../src/platform/firefox-cdp';

describe('parseDevtoolsPortFile', () => {
  it('reads the port from the first line', () => {
    expect(
      parseDevtoolsPortFile('9222\n/Users/me/Library/Application Support/Firefox/Profiles/x'),
    ).toBe(9222);
  });

  it('returns null for empty or unparseable content', () => {
    expect(parseDevtoolsPortFile('')).toBeNull();
    expect(parseDevtoolsPortFile('abc\n')).toBeNull();
    expect(parseDevtoolsPortFile(null)).toBeNull();
  });
});

describe('parseFirefoxPages', () => {
  const LIST_JSON = JSON.stringify([
    {
      id: 'page-1',
      type: 'page',
      title: 'YouTube',
      url: 'https://www.youtube.com/watch?v=1',
      webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/page-1',
    },
    {
      id: 'worker-1',
      type: 'service_worker',
      title: 'Service Worker',
      url: 'https://example.com/sw.js',
      webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/worker-1',
    },
    { id: 'broken', type: 'page', title: 'No socket', url: 'about:blank' },
  ]);

  it('keeps only page targets that have a websocket url', () => {
    expect(parseFirefoxPages(LIST_JSON)).toEqual([
      {
        id: 'page-1',
        title: 'YouTube',
        url: 'https://www.youtube.com/watch?v=1',
        wsUrl: 'ws://127.0.0.1:9222/devtools/page/page-1',
      },
    ]);
  });

  it('returns an empty list for null, invalid or non-array output', () => {
    expect(parseFirefoxPages(null)).toEqual([]);
    expect(parseFirefoxPages('not json')).toEqual([]);
    expect(parseFirefoxPages('{"targets":[]}')).toEqual([]);
    expect(parseFirefoxPages('[]')).toEqual([]);
  });
});
