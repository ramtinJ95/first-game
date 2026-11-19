import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

const SCRIPT = resolve(import.meta.dirname, '../.github/within-budget.sh');

/** Runs the command under a budget whose deadline is `left` seconds from now. */
function within(left: number, ...command: string[]) {
  const result = spawnSync('bash', [SCRIPT, ...command], {
    encoding: 'utf8',
    env: {
      ...process.env,
      BUDGET_NAME: 'the benches',
      BUDGET_SECONDS: '60',
      BUDGET_DEADLINE: String(Math.floor(Date.now() / 1000) + left),
    },
  });
  return { code: result.status, said: result.stderr, out: result.stdout };
}

it('runs a command that ends within the budget, and passes on its exit and output', () => {
  expect(within(30, 'echo', 'done')).toEqual({ code: 0, said: '', out: 'done\n' });
  expect(within(30, 'false').code).toBe(1);
});

it('stops a command that runs out of the budget, and names the budget', () => {
  const run = within(1, 'sleep', '10');
  expect(run.code).toBe(124);
  expect(run.said).toContain(
    '::error title=the benches::The 60 s budget for the benches ran out during: sleep 10',
  );
});

it('starts no command once the budget is spent, and names the budget', () => {
  const run = within(-10, 'echo', 'started');
  expect(run.code).toBe(124);
  expect(run.out).toBe('');
  expect(run.said).toContain(
    '::error title=the benches::The 60 s budget for the benches was spent before: echo started',
  );
});
