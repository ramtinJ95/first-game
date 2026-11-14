/** Stable, disjoint partitions; filenames remain the source of scenario discovery. */
export function shardScenarios<T>(
  scenarios: T[],
  shard: string | undefined,
  seconds: (scenario: T) => number = () => 1,
): T[] {
  if (shard === undefined) return scenarios;
  const match = /^(\d+)\/(\d+)$/.exec(shard);
  const index = Number(match?.[1]);
  const count = Number(match?.[2]);
  if (!Number.isSafeInteger(index) || !Number.isSafeInteger(count) || index < 1 || index > count) {
    throw new Error(
      `invalid capture shard ${shard}; expected index/count with 1 <= index <= count`,
    );
  }
  // Place the longest scenarios first on the least-loaded runner. A filename still
  // discovers a new scenario; its caller supplies a visible default before it is timed.
  const weighted = scenarios.map((scenario, original) => ({
    original,
    seconds: seconds(scenario),
  }));
  if (weighted.some((item) => !Number.isFinite(item.seconds) || item.seconds <= 0)) {
    throw new Error('capture scheduling durations must be positive and finite');
  }
  weighted.sort((a, b) => b.seconds - a.seconds || a.original - b.original);
  const first = { index: 0, seconds: 0 };
  const buckets = [
    first,
    ...Array.from({ length: count - 1 }, (_, i) => ({ index: i + 1, seconds: 0 })),
  ];
  const selected = new Set<number>();
  for (const item of weighted) {
    let lightest = first;
    for (const bucket of buckets) if (bucket.seconds < lightest.seconds) lightest = bucket;
    lightest.seconds += item.seconds;
    if (lightest.index === index - 1) selected.add(item.original);
  }
  return scenarios.filter((_, i) => selected.has(i));
}
