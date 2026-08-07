import { describe, it, expect, beforeEach } from 'vitest';

import { applyConfig } from '../../src/config';
import { orderDetectedByCategory } from '../../src/core/env-entries';

beforeEach(() => {
  applyConfig(null);
});

describe('orderDetectedByCategory', () => {
  it('groups detected tools by category in catalog order', () => {
    const sections = orderDetectedByCategory([
      ['Git', '2.40.0'],
      ['Node', '20.1.0'],
      ['Claude', '1.2.3'],
    ]);
    expect(sections.map((s) => s.category)).toEqual(['Agents', 'Language', 'Tool']);
    expect(sections[0].entries).toEqual([['Claude', '1.2.3']]);
    expect(sections[1].entries).toEqual([['Node', '20.1.0']]);
    expect(sections[2].entries).toEqual([['Git', '2.40.0']]);
  });

  it('skips categories with no detected entries', () => {
    const sections = orderDetectedByCategory([['Node', '20.1.0']]);
    expect(sections.map((s) => s.category)).toEqual(['Language']);
  });

  it('orders entries by the catalog default priority', () => {
    const sections = orderDetectedByCategory([
      ['Zig', '0.13.0'],
      ['Node', '20.1.0'],
      ['Rust', '1.76.0'],
    ]);
    const languages = sections.find((s) => s.category === 'Language')!;
    expect(languages.entries.map(([name]) => name)).toEqual(['Node', 'Rust', 'Zig']);
  });

  it('caps entries per category and reports the remainder', () => {
    applyConfig({ tabUi: { maxLanguages: 2 } });
    const sections = orderDetectedByCategory([
      ['Node', '20.1.0'],
      ['Python', '3.12.0'],
      ['Go', '1.22.0'],
      ['Rust', '1.76.0'],
    ]);
    const languages = sections.find((s) => s.category === 'Language')!;
    expect(languages.entries.map(([name]) => name)).toEqual(['Node', 'Python']);
    expect(languages.remainder).toBe(2);
  });

  it('applies a configured priority order', () => {
    applyConfig({ tabUi: { languageOrder: ['Rust', 'Go', 'Python', 'Node'] } });
    const sections = orderDetectedByCategory([
      ['Node', '20.1.0'],
      ['Python', '3.12.0'],
      ['Go', '1.22.0'],
      ['Rust', '1.76.0'],
    ]);
    const languages = sections.find((s) => s.category === 'Language')!;
    expect(languages.entries.map(([name]) => name)).toEqual(['Rust', 'Go', 'Python', 'Node']);
  });

  it('falls back to alphabetical order for tools outside a partial priority list', () => {
    applyConfig({ tabUi: { languageOrder: ['Go'] } });
    const sections = orderDetectedByCategory([
      ['Zig', '0.13.0'],
      ['Go', '1.22.0'],
      ['Rust', '1.76.0'],
    ]);
    const languages = sections.find((s) => s.category === 'Language')!;
    expect(languages.entries.map(([name]) => name)).toEqual(['Go', 'Rust', 'Zig']);
  });
});
