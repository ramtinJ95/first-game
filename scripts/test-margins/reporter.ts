import { appendFileSync } from 'node:fs';
import { relative } from 'node:path';
import type { RunnerTask, RunnerTestSuite } from 'vitest';
import type { Reporter, Vitest } from 'vitest/node';
import { DOWNLOAD_LIMIT_MS } from '../map/sources.ts';

export interface Timing {
  file: string;
  name: string;
  kind: 'test' | 'beforeAll';
  ms: number;
  limitMs: number;
  state: string;
}

const TEST_LIMIT_MS = 5_000;
const HOOK_LIMIT_MS = 10_000;
/**
 * The hooks that pass their own timeout, by file and name. `run.ts` fails when a test file
 * gains another.
 */
export const HOOK_LIMITS: Record<string, number> = {
  'scripts/map/build-coast.test.ts > beforeAll': DOWNLOAD_LIMIT_MS + 30_000,
  'scripts/map/build-coast.test.ts > the drawing coast > beforeAll': 60_000,
  'scripts/map/build-map.test.ts > beforeAll': DOWNLOAD_LIMIT_MS + 30_000,
  'scripts/map/build-map.test.ts > the map built from the pinned sources > beforeAll': 60_000,
};
/** A suite whose first test starts this much after the suite does ran a beforeAll. */
const HOOK_GAP_MS = 20;

function walk(file: string, suite: RunnerTestSuite, path: string[], out: Timing[]) {
  const children = suite.tasks.filter((task) => task.result?.startTime !== undefined);
  const suiteStart = suite.result?.startTime;
  const firstStart = Math.min(...children.map((task) => task.result?.startTime ?? Infinity));
  // A beforeAll that fails or times out leaves every test unstarted, and so took the whole suite.
  const hookMs =
    suiteStart === undefined
      ? 0
      : Number.isFinite(firstStart)
        ? firstStart - suiteStart
        : (suite.result?.duration ?? 0);
  const name = [...path, 'beforeAll'].join(' > ');
  if (hookMs > HOOK_GAP_MS) {
    out.push({
      file,
      name,
      kind: 'beforeAll',
      ms: hookMs,
      limitMs: HOOK_LIMITS[`${file} > ${name}`] ?? HOOK_LIMIT_MS,
      state: suite.result?.state ?? 'unknown',
    });
  }
  for (const task of suite.tasks as RunnerTask[]) {
    if (task.type === 'suite') walk(file, task, [...path, task.name], out);
    else if (task.result?.duration !== undefined)
      out.push({
        file,
        name: [...path, task.name].join(' > '),
        kind: 'test',
        ms: task.result.duration,
        limitMs: task.timeout || TEST_LIMIT_MS,
        state: task.result.state ?? 'unknown',
      });
  }
}

/** Appends one JSON line per test and per beforeAll to the file `TEST_MARGINS_OUT` names. */
export default class MarginReporter implements Reporter {
  private vitest: Vitest | undefined;

  onInit(vitest: Vitest) {
    this.vitest = vitest;
  }

  onTestRunEnd() {
    const out = process.env.TEST_MARGINS_OUT;
    if (!out) return;
    const timings: Timing[] = [];
    for (const file of this.vitest?.state.getFiles() ?? []) {
      walk(relative(process.cwd(), file.filepath), file, [], timings);
    }
    appendFileSync(out, timings.map((t) => JSON.stringify(t)).join('\n') + '\n');
  }
}
