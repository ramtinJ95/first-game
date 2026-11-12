/** Removes a record from a collection of the state. The collections stay plain objects for JSON. */
export function removeRecord<K extends string>(records: Partial<Record<K, unknown>>, id: K): void {
  Reflect.deleteProperty(records, id);
}
