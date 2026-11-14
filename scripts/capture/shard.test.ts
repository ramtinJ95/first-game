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

  it.each(['0/6', '7/6', '1/0', '-1/6', '1.5/6', '1', '1/Infinity'])('rejects %s', (shard) => {
    expect(() => shardScenarios([], shard)).toThrow('invalid capture shard');
  });
});
