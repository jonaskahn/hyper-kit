import { getAgentIconUrls } from '../config';
import { AGENT_ICON_ASSETS } from './agent-icons.generated';

/* Agent glyphs, all embedded locally (generated from assets/icons/ by
   scripts/generate-agent-icons.mjs — no runtime network). Each asset is
   either a colored background image or a single-color glyph that the tab
   chrome renders as a CSS mask tinted with light-dark(), so it reads well in
   both light and dark mode. `hyperKit.agentIconUrls` in ~/.hyper.js can
   override or add entries (e.g. new icons from dashboardicons.com). */

interface AgentIcon {
  uri: string;
  mask: boolean;
}

export function iconFor(agentCommand: string | null | undefined): AgentIcon {
  if (!agentCommand) {
    return bashIcon();
  }
  const override = getAgentIconUrls()[agentCommand];
  if (override) {
    return { uri: override, mask: false };
  }
  const asset = AGENT_ICON_ASSETS[agentCommand];
  if (asset) {
    return { uri: asset.uri, mask: asset.mask };
  }
  return FALLBACK_AGENT_ICON;
}

/* The default for panes without an agent: the shell glyph. */
export function bashIcon(): AgentIcon {
  return AGENT_ICON_ASSETS['shell-light'] ?? FALLBACK_AGENT_ICON;
}

/* Mask glyphs are tinted with a solid color chosen per scheme. The color is
   computed in JS (not CSS light-dark()) so old Chromium builds — Hyper's
   Electron — never drop the declaration and leave the icon invisible. */
function isDarkScheme(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  );
}

export function maskTint(): string {
  return isDarkScheme() ? '#e6e6e6' : '#1f2328';
}

/* --- bordered tile accents --------------------------------------------------
   Every agent icon renders inside a small square tile whose border takes the
   agent's brand color (mid-tones so they read on both light and dark). The
   neutral-brand agents (cursor, goose, windsurf, shell, opencode) have no
   usable brand hue — their accent is the scheme-aware tint, same value that
   tints their mask glyph, so border and glyph stay coherent in both modes. */

const AGENT_ACCENTS: Record<string, string> = {
  agy: '#ffd400',
  aider: '#e07b39',
  amp: '#f34e3f',
  claude: '#d97757',
  codex: '#00b8b8',
  copilot: '#7e57ff',
  devin: '#3969ca',
  gemini: '#8a63d2',
  kimi: '#1783ff',
  kiro: '#9046ff',
  openhands: '#e6b800',
  qwen: '#7044f6',
  trae: '#00c77d',
  zed: '#4173e7',
};

export function agentAccent(command: string | null | undefined): string {
  if (!command) {
    return maskTint();
  }
  return AGENT_ACCENTS[command] ?? maskTint();
}

/* Subtle tile backdrop (behind the glyph, inside the border). Like the tint,
   computed in JS per scheme so old Chromium never drops the declaration. */
export function tileBackground(): string {
  return isDarkScheme() ? 'rgba(255, 255, 255, 0.08)' : 'rgba(31, 35, 40, 0.05)';
}

/* Re-render (or just re-tint) when the OS scheme flips. */
export function onSchemeChanged(handler: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => undefined;
  }
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const listener = (): void => handler();
  mq.addEventListener('change', listener);
  return () => mq.removeEventListener('change', listener);
}

/* --- strip layout ---------------------------------------------------------
   A tab may hold many panes, but the icon strip must never overflow the tab:
   icons are capped to what fits the available width and the remainder is
   collapsed into a "+N" indicator. */

const AGENT_ICON_SIZE_PX = 18;
const AGENT_ICON_GAP_PX = 5;
const AGENT_MORE_MIN_PX = 18;

interface AgentStripPlan {
  icons: number;
  more: number;
}

export function planAgentStrip(width: number, paneCount: number): AgentStripPlan {
  if (paneCount <= 0) {
    return { icons: 0, more: 0 };
  }
  if (width <= 0) {
    return { icons: paneCount, more: 0 }; // not laid out yet — render everything
  }
  const step = AGENT_ICON_SIZE_PX + AGENT_ICON_GAP_PX;
  if (paneCount * step - AGENT_ICON_GAP_PX <= width) {
    return { icons: paneCount, more: 0 };
  }
  const icons = Math.max(1, Math.floor((width - AGENT_MORE_MIN_PX + AGENT_ICON_GAP_PX) / step));
  return { icons, more: Math.max(0, paneCount - icons) };
}

function svgUri(svg: string): string {
  // parens are legal inside data URIs only when percent-encoded — unquoted
  // url() CSS values (and jsdom) treat a raw '(' as a terminator, so encode
  // them explicitly: e.g. transform="rotate(60 12 12)"
  const encoded = encodeURIComponent(svg).replace(/\(/g, '%28').replace(/\)/g, '%29');
  return 'data:image/svg+xml;utf8,' + encoded;
}

/* Neon sparkle in the kit accent: fallback for unknown agent commands */
const FALLBACK_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
  <path fill="#2ee6a8" d="M12 2.5 L14.3 9.7 L21.5 12 L14.3 14.3 L12 21.5 L9.7 14.3 L2.5 12 L9.7 9.7 Z"/>
</svg>`;

export const FALLBACK_AGENT_ICON: AgentIcon = {
  uri: svgUri(FALLBACK_SVG),
  mask: false,
};
