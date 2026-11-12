/**
 * Brings a cache of drawn things in step with the records of one state: it makes a
 * drawing for each new record, updates the drawing of each kept record, and removes
 * the drawing of each record the state no longer has.
 */
export function reconcile<K, R, D>(
  cache: Map<K, D>,
  records: Iterable<R>,
  keyOf: (record: R) => K,
  handlers: { create(record: R): D; update(drawn: D, record: R): void; remove(drawn: D): void },
): void {
  const present = new Set<K>();
  for (const record of records) {
    const key = keyOf(record);
    present.add(key);
    const drawn = cache.get(key);
    if (drawn === undefined) cache.set(key, handlers.create(record));
    else handlers.update(drawn, record);
  }
  for (const [key, drawn] of cache) {
    if (present.has(key)) continue;
    handlers.remove(drawn);
    cache.delete(key);
  }
}
