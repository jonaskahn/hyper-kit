/* Lazy access to Node core modules from Hyper's Electron renderer
   (window.require). Loaded on demand so the plugin degrades gracefully in
   test environments (jsdom) and any host without node integration; tests
   can stub modules via the injection hooks below. */

type Module = unknown;

const overrides = new Map<string, Module>();

export function getNodeModule(name: string): Module | null {
  if (overrides.has(name)) {
    return overrides.get(name) as Module;
  }
  try {
    const w = window as unknown as { require?: (n: string) => Module };
    if (w && typeof w.require === 'function') {
      return w.require(name);
    }
  } catch {
    // no node integration available
  }
  return null;
}

export function hasNodeRuntime(): boolean {
  return getNodeModule('http') !== null;
}

export function setNodeModuleForTest(name: string, module: Module): void {
  overrides.set(name, module);
}

export function clearNodeModulesForTest(): void {
  overrides.clear();
}
