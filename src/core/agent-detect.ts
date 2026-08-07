import { TOOL_CATALOG } from './tool-catalog';

/* Canonical CLI coding-agent commands — exactly the catalog's `cliAgent`
   tools (Claude Code, Codex, ...), minus 'agent' (Cursor's launcher shim,
   matched through aliases below). Editor launchers (zed, windsurf, trae)
   are inventory-only and never match. Plus the aliases users actually
   invoke: `cursor agent` (two-word), `cursor-agent`, the standalone `agent`
   shim Cursor installs, antigravity's real binary `agy`, and the historical
   `qwen-code` name. */
const CLI_AGENTS = TOOL_CATALOG.filter((tool) => tool.cliAgent === true);

export const AGENT_COMMANDS: string[] = CLI_AGENTS.map((tool) => tool.command).filter(
  (command) => command !== 'agent',
);

const AGENT_ALIASES = new Map<string, string>([
  ...CLI_AGENTS.filter((tool) => tool.command !== 'agent').map(
    (tool) => [tool.command, tool.command] as const,
  ),
  // Cursor ships an `agent` launcher shim (cursor-agent); `agent` alone is
  // its CLI. Keep it an alias so other tools named `agent` stay unmatched.
  ['agent', 'cursor'],
  ['cursor-agent', 'cursor'],
  ['cursor', 'cursor'],
  // antigravity's binary is `agy`; accept the long form too
  ['antigravity', 'agy'],
  // qwen-code is the historical name; the current binary is `qwen`
  ['qwen-code', 'qwen'],
]);

/* Words the shell consumes before the real program (prefix wrappers around
   `sudo claude`, `npx claude`, `env TERM=x claude`, ...). Stripped before
   matching. */
const SHELL_WRAPPERS = new Set([
  'sudo',
  'doas',
  'nohup',
  'exec',
  'env',
  'time',
  'nice',
  'noglob',
  'command',
  'builtin',
  'setsid',
  'npx',
  'bunx',
  'dlx',
]);

/* `claude -p "..."`, `codex exec`, `cursor agent`, `opencode --dangerously-skip-permissions`
   -> canonical command. Returns null when the line doesn't start with an agent. */
export function parseAgentCommand(line: string): string | null {
  const tokens = line
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0);
  if (tokens.length === 0) {
    return null;
  }
  let head = tokens[0];
  let index = 0;
  let advanced = true;
  while (advanced) {
    advanced = false;
    if (SHELL_WRAPPERS.has(head)) {
      index += 1;
      head = tokens[index] || '';
      advanced = true;
    } else if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(head)) {
      // env-var assignments (env TERM=xterm codex, or bare VAR=1 claude)
      index += 1;
      head = tokens[index] || '';
      advanced = true;
    } else if (
      (head === 'npm' || head === 'pnpm' || head === 'yarn') &&
      (tokens[index + 1] === 'exec' || tokens[index + 1] === 'dlx')
    ) {
      index += 2;
      head = tokens[index] || '';
      advanced = true;
    }
  }
  if (head === 'cursor' && tokens[index + 1] === 'agent') {
    return 'cursor';
  }
  return AGENT_ALIASES.get(head) ?? null;
}

/* OSC 0 window titles: shells emit them on preexec (the running command) and
   precmd (back at the prompt). Agent TUIs prepend a live spinner and emit a
   fresh title on every redraw — Claude Code sends "⠂ Claude Code",
   "⠐ Claude Code", "✳ Claude Code" — so leading decoration (spinners,
   glyphs, ANSI codes) is stripped before matching. Prefix-anchored (not
   substring) so `grep claude file` never matches. */
export function matchAgentTitle(title: string): string | null {
  const cleaned = title
    .trim()
    .replace(/\x1b\[[0-9;]*m/g, '')
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .toLowerCase();
  if (!cleaned) {
    return null;
  }
  for (const [alias, command] of AGENT_ALIASES) {
    if (cleaned === alias || cleaned.startsWith(alias + ' ')) {
      return command;
    }
  }
  return null;
}
