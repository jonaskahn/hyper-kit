/* Friendly labels, risk tiers, and icons for opencode's permission kinds
   (confirmed against a live opencode 1.18.15 instance's OpenAPI schema --
   PermissionConfig enumerates read/edit/glob/grep/list/bash/task/
   external_directory/todowrite/webfetch/websearch/lsp/doom_loop/skill, plus
   arbitrary custom/MCP tool names). Kinds are grouped by the kind of access
   they represent so an unrecognized custom tool still gets a sane default
   instead of a blank/generic card. */

export type RiskTier = 'low' | 'medium' | 'high';
type IconName = 'eye' | 'pencil' | 'terminal' | 'folder' | 'globe' | 'bolt' | 'question';

interface KindMeta {
  icon: IconName;
  risk: RiskTier;
  title: string;
}

const KIND_META: Record<string, KindMeta> = {
  read: { icon: 'eye', risk: 'low', title: 'Read a file?' },
  glob: { icon: 'eye', risk: 'low', title: 'Search for files?' },
  grep: { icon: 'eye', risk: 'low', title: 'Search file contents?' },
  list: { icon: 'eye', risk: 'low', title: 'List a directory?' },
  lsp: { icon: 'eye', risk: 'low', title: 'Use the language server?' },
  todowrite: { icon: 'pencil', risk: 'low', title: 'Update the task list?' },
  edit: { icon: 'pencil', risk: 'medium', title: 'Edit a file?' },
  skill: { icon: 'bolt', risk: 'medium', title: 'Use a skill?' },
  task: { icon: 'terminal', risk: 'medium', title: 'Run a subtask?' },
  websearch: { icon: 'globe', risk: 'low', title: 'Search the web?' },
  webfetch: { icon: 'globe', risk: 'medium', title: 'Fetch a URL?' },
  bash: { icon: 'terminal', risk: 'high', title: 'Run a command?' },
  doom_loop: { icon: 'terminal', risk: 'high', title: 'Keep retrying?' },
  external_directory: {
    icon: 'folder',
    risk: 'high',
    title: 'Access a folder outside the project?',
  },
};

const FALLBACK_META: KindMeta = { icon: 'bolt', risk: 'medium', title: '' };

/* `permission` is a free-form string -- built-in tools use the fixed set
   above, but MCP servers can register their own permission names, so an
   unknown value must still render something reasonable rather than fail. */
export function getKindMeta(permission: string): KindMeta {
  const known = KIND_META[permission];
  if (known) {
    return known;
  }
  return { ...FALLBACK_META, title: `Allow ${permission}?` };
}

const ICONS: Record<IconName, string> = {
  eye: '<path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8Z"/><circle cx="8" cy="8" r="2"/>',
  pencil: '<path d="M10.5 2.5l3 3-8 8-3.5 1 1-3.5z"/><path d="M9 4l3 3"/>',
  terminal:
    '<rect x="1.5" y="3" width="13" height="10" rx="1.5"/><path d="M4.5 6.5 7 8.5 4.5 10.5"/><path d="M8.5 10.5h3"/>',
  folder:
    '<path d="M2 4.5a1 1 0 0 1 1-1h3l1.5 1.5H13a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1Z"/>',
  globe:
    '<circle cx="8" cy="8" r="6"/><path d="M2 8h12M8 2c2 2.2 2 9.8 0 12M8 2c-2 2.2-2 9.8 0 12"/>',
  bolt: '<path d="M8.5 1.5 3.5 9h3.2L6 14.5 12.5 6.5H9.2Z"/>',
  question: '<path d="M2 3.5h12v7H6.5L3.5 13V10.5H2Z"/>',
};

export function iconMarkup(name: IconName): string {
  return `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;
}

/* Metadata keys worth surfacing with a friendly label instead of a raw JSON
   dump (observed on a live instance: external_directory sends {filepath,
   parentDir}; other kinds are expected to follow the same "a few named
   strings" shape). Anything else still reaches the UI via the collapsed
   raw-details fallback, so nothing is silently hidden. */
const META_LABELS: Record<string, string> = {
  filepath: 'File',
  parentDir: 'Outside project',
  url: 'URL',
  command: 'Command',
  description: 'Description',
  reason: 'Reason',
  query: 'Query',
};

interface MetaField {
  label: string;
  value: string;
}

/* Splits metadata into friendly named fields (shown inline) and whatever's
   left over (shown only behind the raw-details toggle). */
export function describeMetadata(metadata: Record<string, unknown>): {
  fields: MetaField[];
  rest: Record<string, unknown>;
} {
  const fields: MetaField[] = [];
  const rest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    const label = META_LABELS[key];
    if (label && typeof value === 'string' && value) {
      fields.push({ label, value });
    } else {
      rest[key] = value;
    }
  }
  return { fields, rest };
}
