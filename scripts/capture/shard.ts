/** Stable, disjoint partitions; filenames remain the source of scenario discovery. */
export function shardScenarios<T>(scenarios: T[], shard: string | undefined): T[] {
  if (shard === undefined) return scenarios;
  const match = /^(\d+)\/(\d+)$/.exec(shard);
  const index = Number(match?.[1]);
  const count = Number(match?.[2]);
  if (!Number.isSafeInteger(index) || !Number.isSafeInteger(count) || index < 1 || index > count) {
    throw new Error(
      `invalid capture shard ${shard}; expected index/count with 1 <= index <= count`,
    );
  }
  return scenarios.filter((_, i) => i % count === index - 1);
}
