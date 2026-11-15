import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import seconds from './scenario-seconds.json' with { type: 'json' };
import { SHARD_BUDGET_SECONDS, shardScenarios } from './shard.ts';

const recorded: Readonly<Record<string, number>> = seconds;
const scenarios = readdirSync(join(import.meta.dirname, 'scenarios'))
  .filter((file) => file.endsWith('.ts'))
  .map((file) => file.replace(/\.ts$/, ''))
  .sort();
const workflow = readFileSync(join(import.meta.dirname, '../../.github/workflows/ci.yml'), 'utf8');
const capture = workflow.slice(workflow.indexOf('\n  capture-shards:'));
const shardCount = /shard: \[([\d, ]+)\]/.exec(capture)?.[1]?.split(',').length ?? 0;

describe('the CI capture plan', () => {
  it('has a measured time for every scenario, so none is planned blind', () => {
    expect(scenarios.filter((name) => recorded[name] === undefined)).toEqual([]);
  });

  it('keeps every shard within its budget at the shard count the workflow runs', () => {
    expect(shardCount).toBeGreaterThan(0);
    const planned = Array.from({ length: shardCount }, (_, i) =>
      shardScenarios(scenarios, `${i + 1}/${shardCount}`, (name) => recorded[name] ?? 60),
    ).map((names) => names.reduce((sum, name) => sum + (recorded[name] ?? 60), 0));
    expect(Math.max(...planned)).toBeLessThanOrEqual(SHARD_BUDGET_SECONDS);
  });
});
