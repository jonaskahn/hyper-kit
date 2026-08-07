import { STORAGE_KEY } from '../config';

export function loadSavedWidth(): number | null {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) {
      return null;
    }
    const px = parseInt(saved, 10);
    return Number.isFinite(px) ? px : null;
  } catch {
    // localStorage may be unavailable (private mode, disabled storage); a null fallback is safe
    return null;
  }
}

export function saveWidth(px: number): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(px));
  } catch {
    // best effort: losing a saved width is harmless
  }
}
