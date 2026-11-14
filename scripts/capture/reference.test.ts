import { describe, expect, it } from 'vitest';
import { chooseReferenceRun, type Artifact, type WorkflowRun } from './reference.ts';

const run = (id: number, sha: string, status = 'completed'): WorkflowRun => ({
  id,
  head_sha: sha,
  html_url: `https://ci.example/runs/${id}`,
  status,
});
const shards = (expired = false): Artifact[] => [
  { name: 'captures-1', expired },
  { name: 'captures-2', expired },
  { name: 'capture-recordings-1', expired: true },
];

describe('chooseReferenceRun', () => {
  const choose = (runs: WorkflowRun[], artifacts: Record<number, Artifact[]>) =>
    chooseReferenceRun(runs, 'base', (candidate) => artifacts[candidate.id] ?? []);

  it("prefers the base commit's run over newer ones", () => {
    const chosen = choose([run(3, 'newer'), run(2, 'base')], { 2: shards(), 3: shards() });
    expect(chosen).toEqual({ run: run(2, 'base'), exact: true });
  });

  it('falls back to the newest run with screenshots when the base has none', () => {
    const chosen = choose([run(4, 'base', 'in_progress'), run(3, 'newer'), run(2, 'older')], {
      3: [
        { name: 'captures-1', expired: false },
        { name: 'captures-2', expired: true },
      ],
      2: shards(),
    });
    expect(chosen).toEqual({ run: run(2, 'older'), exact: false });
  });

  it('finds nothing when no run kept its screenshots', () => {
    expect(choose([run(2, 'base'), run(1, 'older')], { 2: shards(true), 1: [] })).toBeNull();
  });
});
