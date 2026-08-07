import { describe, it, expect } from 'vitest';

import { createKeyedStore } from '../../src/core/keyed-store';

describe('createKeyedStore', () => {
  it('stores and retrieves values by key', () => {
    const store = createKeyedStore<string>();
    store.set('a', 'one');
    expect(store.get('a')).toBe('one');
    expect(store.get('missing')).toBeUndefined();
  });

  it('has() reflects whether a key is set', () => {
    const store = createKeyedStore<number>();
    expect(store.has('a')).toBe(false);
    store.set('a', 1);
    expect(store.has('a')).toBe(true);
  });

  it('delete() removes a key', () => {
    const store = createKeyedStore<number>();
    store.set('a', 1);
    store.delete('a');
    expect(store.has('a')).toBe(false);
  });

  it('clear() removes every key', () => {
    const store = createKeyedStore<number>();
    store.set('a', 1);
    store.set('b', 2);
    store.clear();
    expect(store.has('a')).toBe(false);
    expect(store.has('b')).toBe(false);
  });

  it('prune() deletes keys missing from the live set and keeps the rest', () => {
    const store = createKeyedStore<number>();
    store.set('a', 1);
    store.set('b', 2);
    store.set('c', 3);
    store.prune(new Set(['a', 'c']));
    expect(store.has('a')).toBe(true);
    expect(store.has('b')).toBe(false);
    expect(store.has('c')).toBe(true);
  });

  it('gives each store its own independent map', () => {
    const a = createKeyedStore<number>();
    const b = createKeyedStore<number>();
    a.set('x', 1);
    expect(b.has('x')).toBe(false);
  });
});
