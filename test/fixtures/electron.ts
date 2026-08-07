// Minimal stand-in for Electron's main-process API (Hyper provides the real
// one at runtime). ipcMain and dialog are shared mocks so tests can capture
// and assert on channel registration and native dialog calls.
import { vi } from 'vitest';

export const ipcMain = {
  on: vi.fn(),
  removeListener: vi.fn(),
};

export const dialog = {
  showMessageBox: vi.fn(),
};
