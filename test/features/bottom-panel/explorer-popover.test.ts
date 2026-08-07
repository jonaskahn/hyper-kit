import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../../src/platform/dir-lister', () => ({
  listRoots: vi.fn(),
  listSubdirectories: vi.fn(),
}));

vi.mock('../../../src/platform/system-open', () => ({
  openInFileManager: vi.fn(),
}));

import { listRoots, listSubdirectories } from '../../../src/platform/dir-lister';
import { openInFileManager } from '../../../src/platform/system-open';
import { createExplorerPopover } from '../../../src/features/bottom-panel/explorer-popover';
import { setStore } from '../../../src/platform/hyper-store';
import { loadBookmarks } from '../../../src/platform/bookmark-storage';
import { setFullTree, setShowHidden } from '../../../src/platform/explorer-prefs';
import { tabStore, unsplitGroup } from '../../helpers/store';

let anchor: HTMLButtonElement;
let rpcEmit: ReturnType<typeof vi.fn>;

beforeEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
  anchor = document.createElement('button');
  document.body.appendChild(anchor);
  vi.mocked(listRoots).mockResolvedValue([{ name: '/', path: '/' }]);
  vi.mocked(listSubdirectories).mockReturnValue({ entries: [], error: null });
  rpcEmit = vi.fn();
  (window as any).rpc = { emit: rpcEmit };
});

afterEach(() => {
  setStore(null);
  document.body.innerHTML = '';
  vi.clearAllMocks();
  delete (window as any).rpc;
});

describe('explorer popover', () => {
  it('renders the root row without dispatching', async () => {
    const dispatch = vi.fn();
    setStore({ ...tabStore(unsplitGroup()), dispatch });
    createExplorerPopover().toggle(anchor);
    await vi.waitFor(() => expect(document.querySelector('[data-path="/"]')).not.toBeNull());
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('chevron click expands a row, lazy-loads children, and never dispatches', async () => {
    vi.mocked(listSubdirectories).mockReturnValue({
      entries: [{ name: 'home', path: '/home' }],
      error: null,
    });
    const dispatch = vi.fn();
    setStore({ ...tabStore(unsplitGroup()), dispatch });
    createExplorerPopover().toggle(anchor);
    await vi.waitFor(() => expect(document.querySelector('[data-path="/"]')).not.toBeNull());
    document.querySelector<HTMLButtonElement>('[data-path="/"] [data-role="chevron"]')!.click();
    expect(document.querySelector('[data-path="/home"]')).not.toBeNull();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('caches children so re-collapsing/re-expanding does not re-fetch', async () => {
    vi.mocked(listSubdirectories).mockReturnValue({
      entries: [{ name: 'home', path: '/home' }],
      error: null,
    });
    createExplorerPopover().toggle(anchor);
    await vi.waitFor(() => expect(document.querySelector('[data-path="/"]')).not.toBeNull());
    const chevron = document.querySelector<HTMLButtonElement>(
      '[data-path="/"] [data-role="chevron"]',
    )!;
    chevron.click(); // expand (fetches)
    chevron.click(); // collapse
    chevron.click(); // expand again
    expect(vi.mocked(listSubdirectories)).toHaveBeenCalledTimes(1);
  });

  it('clicking the folder name expands and collapses the row', async () => {
    vi.mocked(listSubdirectories).mockReturnValue({
      entries: [{ name: 'home', path: '/home' }],
      error: null,
    });
    createExplorerPopover().toggle(anchor);
    await vi.waitFor(() => expect(document.querySelector('[data-path="/"]')).not.toBeNull());
    const name = document.querySelector<HTMLButtonElement>('[data-path="/"] [data-role="open"]')!;
    name.click();
    expect(vi.mocked(listSubdirectories)).toHaveBeenLastCalledWith('/', false);
    expect(document.querySelector('[data-path="/home"]')).not.toBeNull();
    expect(
      document.querySelector<HTMLElement>('[data-path="/"]')!.getAttribute('aria-expanded'),
    ).toBe('true');
    name.click();
    expect(
      document.querySelector<HTMLElement>('[data-path="/"]')!.getAttribute('aria-expanded'),
    ).toBe('false');
    expect(vi.mocked(listSubdirectories)).toHaveBeenCalledTimes(1);
  });

  it('double-clicking the folder name opens a new tab via the rpc bridge and closes', async () => {
    createExplorerPopover().toggle(anchor);
    await vi.waitFor(() => expect(document.querySelector('[data-path="/"]')).not.toBeNull());
    document
      .querySelector<HTMLButtonElement>('[data-path="/"] [data-role="open"]')!
      .dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(rpcEmit).toHaveBeenCalledWith('new', { cwd: '/' });
    expect(document.querySelector('.kit-explorer')).toBeNull();
  });

  it('double-click on the chevron or pin does not dispatch or close', async () => {
    const dispatch = vi.fn();
    setStore({ ...tabStore(unsplitGroup()), dispatch });
    createExplorerPopover().toggle(anchor);
    await vi.waitFor(() => expect(document.querySelector('[data-path="/"]')).not.toBeNull());
    const chevron = document.querySelector<HTMLButtonElement>(
      '[data-path="/"] [data-role="chevron"]',
    )!;
    chevron.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    const pin = document.querySelector<HTMLButtonElement>('[data-path="/"] [data-role="pin"]')!;
    pin.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(dispatch).not.toHaveBeenCalled();
    expect(document.querySelector('.kit-explorer')).not.toBeNull();
  });

  it('terminal icon opens a new tab via the rpc bridge and closes', async () => {
    createExplorerPopover().toggle(anchor);
    await vi.waitFor(() => expect(document.querySelector('[data-path="/"]')).not.toBeNull());
    document.querySelector<HTMLButtonElement>('[data-path="/"] [data-role="terminal"]')!.click();
    expect(rpcEmit).toHaveBeenCalledWith('new', { cwd: '/' });
    expect(document.querySelector('.kit-explorer')).toBeNull();
  });

  it('split icon splits the focused tab via the rpc bridge and closes', async () => {
    setStore({ ...tabStore(unsplitGroup('s1'), { g1: 's1' }) });
    createExplorerPopover().toggle(anchor);
    await vi.waitFor(() => expect(document.querySelector('[data-path="/"]')).not.toBeNull());
    document.querySelector<HTMLButtonElement>('[data-path="/"] [data-role="split"]')!.click();
    expect(rpcEmit).toHaveBeenCalledWith('new', {
      cwd: '/',
      splitDirection: 'VERTICAL',
      activeUid: 's1',
    });
    expect(document.querySelector('.kit-explorer')).toBeNull();
  });

  it('split icon no-ops without a focused session', async () => {
    createExplorerPopover().toggle(anchor);
    await vi.waitFor(() => expect(document.querySelector('[data-path="/"]')).not.toBeNull());
    document.querySelector<HTMLButtonElement>('[data-path="/"] [data-role="split"]')!.click();
    expect(rpcEmit).not.toHaveBeenCalled();
    expect(document.querySelector('.kit-explorer')).toBeNull();
  });

  it('files icon reveals in the file manager and keeps the popover open', async () => {
    const original = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
    try {
      createExplorerPopover().toggle(anchor);
      await vi.waitFor(() => expect(document.querySelector('[data-path="/"]')).not.toBeNull());
      document.querySelector<HTMLButtonElement>('[data-path="/"] [data-role="files"]')!.click();
      expect(openInFileManager).toHaveBeenCalledWith('/');
      expect(document.querySelector('.kit-explorer')).not.toBeNull();
    } finally {
      if (original) {
        Object.defineProperty(process, 'platform', original);
      }
    }
  });

  it('omits the files icon on linux', async () => {
    const original = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    try {
      createExplorerPopover().toggle(anchor);
      await vi.waitFor(() => expect(document.querySelector('[data-path="/"]')).not.toBeNull());
      expect(document.querySelector('[data-path="/"] [data-role="files"]')).toBeNull();
      expect(document.querySelector('[data-path="/"] [data-role="terminal"]')).not.toBeNull();
    } finally {
      if (original) {
        Object.defineProperty(process, 'platform', original);
      }
    }
  });

  it('pin toggles a bookmark without dispatching or closing the popover', async () => {
    const dispatch = vi.fn();
    setStore({ ...tabStore(unsplitGroup()), dispatch });
    createExplorerPopover().toggle(anchor);
    await vi.waitFor(() => expect(document.querySelector('[data-path="/"]')).not.toBeNull());
    const pin = document.querySelector<HTMLButtonElement>('[data-path="/"] [data-role="pin"]')!;
    pin.click();
    expect(loadBookmarks()).toEqual(['/']);
    expect(pin.getAttribute('aria-pressed')).toBe('true');
    expect(dispatch).not.toHaveBeenCalled();
    expect(document.querySelector('.kit-explorer')).not.toBeNull();
    pin.click();
    expect(loadBookmarks()).toEqual([]);
    expect(pin.getAttribute('aria-pressed')).toBe('false');
  });

  it('a permission-denied child renders an error row without breaking its siblings', async () => {
    vi.mocked(listRoots).mockResolvedValue([
      { name: 'a', path: '/a' },
      { name: 'b', path: '/b' },
    ]);
    vi.mocked(listSubdirectories).mockImplementation((dirPath: string) =>
      dirPath === '/a' ? { entries: [], error: 'denied' } : { entries: [], error: null },
    );
    createExplorerPopover().toggle(anchor);
    await vi.waitFor(() => expect(document.querySelector('[data-path="/a"]')).not.toBeNull());
    document.querySelector<HTMLButtonElement>('[data-path="/a"] [data-role="chevron"]')!.click();
    expect(document.querySelector('[data-path="/a"]')!.nextElementSibling!.textContent).toBe(
      'Permission denied',
    );
    expect(document.querySelector('[data-path="/b"]')).not.toBeNull();
  });

  it('renders header toggles reflecting the default (off) prefs', () => {
    createExplorerPopover().toggle(anchor);
    const fullTreeBtn = document.querySelector<HTMLButtonElement>('.kit-explorer-toggle-fulltree')!;
    const hiddenBtn = document.querySelector<HTMLButtonElement>('.kit-explorer-toggle-hidden')!;
    expect(fullTreeBtn).not.toBeNull();
    expect(hiddenBtn).not.toBeNull();
    expect(fullTreeBtn.getAttribute('aria-pressed')).toBe('false');
    expect(hiddenBtn.getAttribute('aria-pressed')).toBe('false');
    expect(fullTreeBtn.closest('.kit-explorer-header-actions')).not.toBeNull();
  });

  it('hidden-files toggle re-renders expanded rows with showHidden=true', async () => {
    vi.mocked(listSubdirectories).mockReturnValue({
      entries: [{ name: 'home', path: '/home' }],
      error: null,
    });
    createExplorerPopover().toggle(anchor);
    await vi.waitFor(() => expect(document.querySelector('[data-path="/"]')).not.toBeNull());
    document.querySelector<HTMLButtonElement>('[data-path="/"] [data-role="chevron"]')!.click();
    expect(document.querySelector('[data-path="/home"]')).not.toBeNull();
    expect(vi.mocked(listSubdirectories)).toHaveBeenLastCalledWith('/', false);

    vi.mocked(listSubdirectories).mockReturnValue({
      entries: [
        { name: '.hidden', path: '/.hidden' },
        { name: 'home', path: '/home' },
      ],
      error: null,
    });
    document.querySelector<HTMLButtonElement>('.kit-explorer-toggle-hidden')!.click();
    expect(vi.mocked(listSubdirectories)).toHaveBeenLastCalledWith('/', true);
    expect(document.querySelector('[data-path="/.hidden"]')).not.toBeNull();
    expect(document.querySelector('[data-path="/home"]')).not.toBeNull();
    expect(
      document
        .querySelector<HTMLButtonElement>('.kit-explorer-toggle-hidden')!
        .getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('full-tree toggle reloads roots with fullTree=true and clears stale rows', async () => {
    vi.mocked(listRoots).mockResolvedValue([{ name: 'home', path: '/home' }]);
    createExplorerPopover().toggle(anchor);
    await vi.waitFor(() => expect(document.querySelector('[data-path="/home"]')).not.toBeNull());
    expect(vi.mocked(listRoots)).toHaveBeenLastCalledWith(false);

    vi.mocked(listRoots).mockResolvedValue([
      { name: '/', path: '/' },
      { name: 'Volumes', path: '/Volumes' },
    ]);
    document.querySelector<HTMLButtonElement>('.kit-explorer-toggle-fulltree')!.click();
    expect(vi.mocked(listRoots)).toHaveBeenLastCalledWith(true);
    await vi.waitFor(() => expect(document.querySelector('[data-path="/"]')).not.toBeNull());
    expect(document.querySelector('[data-path="/home"]')).toBeNull();
    expect(document.querySelector('[data-path="/Volumes"]')).not.toBeNull();
    expect(
      document
        .querySelector<HTMLButtonElement>('.kit-explorer-toggle-fulltree')!
        .getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('a fresh popover reflects prefs persisted before construction', async () => {
    setShowHidden(true);
    setFullTree(true);
    vi.mocked(listSubdirectories).mockReturnValue({
      entries: [{ name: '.hidden', path: '/.hidden' }],
      error: null,
    });
    createExplorerPopover().toggle(anchor);
    expect(
      document
        .querySelector<HTMLButtonElement>('.kit-explorer-toggle-fulltree')!
        .getAttribute('aria-pressed'),
    ).toBe('true');
    expect(
      document
        .querySelector<HTMLButtonElement>('.kit-explorer-toggle-hidden')!
        .getAttribute('aria-pressed'),
    ).toBe('true');
    expect(vi.mocked(listRoots)).toHaveBeenLastCalledWith(true);
    await vi.waitFor(() => expect(document.querySelector('[data-path="/"]')).not.toBeNull());
    document.querySelector<HTMLButtonElement>('[data-path="/"] [data-role="chevron"]')!.click();
    expect(vi.mocked(listSubdirectories)).toHaveBeenLastCalledWith('/', true);
  });
});
