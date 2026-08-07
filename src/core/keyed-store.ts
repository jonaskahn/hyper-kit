export interface KeyedStore<V> {
  get(key: string): V | undefined;
  set(key: string, value: V): void;
  has(key: string): boolean;
  delete(key: string): void;
  clear(): void;
  prune(liveKeys: Set<string>): void;
}

export function createKeyedStore<V>(): KeyedStore<V> {
  const map = new Map<string, V>();
  return {
    get(key) {
      return map.get(key);
    },
    set(key, value) {
      map.set(key, value);
    },
    has(key) {
      return map.has(key);
    },
    delete(key) {
      map.delete(key);
    },
    clear() {
      map.clear();
    },
    prune(liveKeys) {
      for (const key of Array.from(map.keys())) {
        if (!liveKeys.has(key)) {
          map.delete(key);
        }
      }
    },
  };
}
