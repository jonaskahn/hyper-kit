import { categorySettings } from '../config';
import { CATEGORY_ORDER, TOOL_CATALOG, type ToolCategory } from './tool-catalog';

export type EnvEntry = [string, string];

export interface CategorySection {
  category: ToolCategory;
  entries: EnvEntry[];
  remainder: number;
}

/* config order wins; anything not listed (or no config) falls back to the
   category's default catalog order, then alphabetically; each section is
   capped at the configured limit */
export function orderDetectedByCategory(detected: EnvEntry[]): CategorySection[] {
  const byName = new Map(detected.map(([name, version]) => [name, version]));
  const sections: CategorySection[] = [];
  for (const category of CATEGORY_ORDER) {
    const tools = TOOL_CATALOG.filter((tool) => tool.category === category);
    const found = tools.filter((tool) => byName.has(tool.name));
    if (!found.length) {
      continue;
    }
    const { limit, order } = categorySettings(category);
    const priorityOrder = order && order.length ? order : tools.map((tool) => tool.name);
    const ordered = priorityOrder
      .filter((name) => byName.has(name))
      .concat(
        found
          .filter((tool) => priorityOrder.indexOf(tool.name) < 0)
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((tool) => tool.name),
      );
    const shown = ordered.slice(0, limit);
    sections.push({
      category,
      entries: shown.map((name) => [name, byName.get(name)!]),
      remainder: ordered.length - shown.length,
    });
  }
  return sections;
}
