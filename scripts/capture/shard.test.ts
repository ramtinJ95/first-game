import { describe, expect, it } from 'vitest';
import { shardScenarios } from './shard.ts';

describe('capture shards', () => {
  it('covers every scenario exactly once, including uneven partitions', () => {
    const scenarios = Array.from({ length: 35 }, (_, i) => `scenario-${i}`);
    const shards = Array.from({ length: 6 }, (_, i) => shardScenarios(scenarios, `${i + 1}/6`));
    expect(shards.map((s) => s.length)).toEqual([6, 6, 6, 6, 6, 5]);
    expect(shards.flat().sort()).toEqual([...scenarios].sort());
    expect(new Set(shards.flat()).size).toBe(scenarios.length);
  });

  it('leaves unsharded calls unchanged and permits empty shards', () => {
    expect(shardScenarios(['map', 'news'], undefined)).toEqual(['map', 'news']);
    expect(shardScenarios(['map'], '2/6')).toEqual([]);
  });

  it('balances heavy scenarios instead of grouping them on one runner', () => {
    const scenarios = [100, 100, 50, 50, 10, 10];
    const shards = [1, 2, 3].map((index) =>
      shardScenarios(scenarios, `${index}/3`, (seconds) => seconds),
    );
    expect(shards.map((items) => items.reduce((sum, seconds) => sum + seconds, 0))).toEqual([
      110, 110, 100,
    ]);
    expect(shards.flat().sort((a, b) => a - b)).toEqual([...scenarios].sort((a, b) => a - b));
  });

  it.each([0, -1, NaN, Infinity])('rejects invalid scheduling duration %s', (seconds) => {
    expect(() => shardScenarios(['map'], '1/6', () => seconds)).toThrow('positive and finite');
  });

  it.each(['0/6', '7/6', '1/0', '-1/6', '1.5/6', '1', '1/Infinity'])('rejects %s', (shard) => {
    expect(() => shardScenarios([], shard)).toThrow('invalid capture shard');
  });
});
