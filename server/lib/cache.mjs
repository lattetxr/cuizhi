const store = new Map();

export const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

export function cacheGet(key) {
  const entry = store.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    store.delete(key);
    return null;
  }
  return entry.value;
}

export function cacheSet(key, value, ttlMs = DEFAULT_TTL_MS) {
  store.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
  });
  return value;
}

export function clearCache() {
  store.clear();
}

export function cacheStats() {
  const now = Date.now();
  let live = 0;
  for (const entry of store.values()) {
    if (entry.expiresAt > now) live += 1;
  }
  return { total: store.size, live };
}
