/* Shared rendering for the per-pane agent icon strip, used by both the kit
   tab chrome (features/left-panel/tabs.ts) and the single-tab pill
   (features/left-panel/tabbar.ts). One icon per terminal pane: agent glyphs
   for panes running an agent, the bash chevron for everything else. Never
   overflows its row: only as many icons fit the width are rendered, the rest
   collapse into a "+N" indicator (agents first, shells last).

   `agents` is one entry per pane (the agent command, or null for a shell).
   Returns the new signature so callers can skip redundant re-renders, or
   null when the rendered set is unchanged (content only changes when the
   set actually changed — the callers' observers must not loop on their own
   mutations). */

import {
  iconFor,
  maskTint,
  agentAccent,
  tileBackground,
  planAgentStrip,
} from '../core/agent-icons';
import { CLASSES } from './dom-selectors';

export function renderAgentStrip(
  row: HTMLElement,
  agents: readonly (string | null)[],
  width: number,
  previousSig: string | null,
): string | null {
  const plan = planAgentStrip(width, agents.length);
  const shown = [
    ...agents.filter((command): command is string => command !== null),
    ...agents.filter((command) => command === null),
  ].slice(0, plan.icons);
  const sig =
    maskTint() +
    '|' +
    shown.map((command) => command ?? '~').join(',') +
    (plan.more > 0 ? '+' + plan.more : '');
  if (sig === previousSig) {
    return null;
  }
  row.style.setProperty('--kit-agent-tint', maskTint());
  row.style.setProperty('--kit-agent-tile', tileBackground());
  row.textContent = '';
  row.classList.add(CLASSES.tabAgents);
  for (const command of shown) {
    const span = document.createElement('span');
    span.className = CLASSES.tabAgentIcon;
    const { uri, mask } = iconFor(command);
    span.style.setProperty('--kit-agent-uri', `url(${uri})`);
    span.style.setProperty('--kit-agent-accent', agentAccent(command));
    if (mask) {
      span.classList.add(CLASSES.tabAgentMask);
    }
    row.appendChild(span);
  }
  if (plan.more > 0) {
    const more = document.createElement('span');
    more.className = CLASSES.tabAgentMore;
    more.textContent = '+' + plan.more;
    row.appendChild(more);
  }
  return sig;
}
