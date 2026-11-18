import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { HOOK_LIMITS, type Timing } from './reporter.ts';

const REPORTER = resolve(import.meta.dirname, 'reporter.ts');
const ALONE_RUNS = 3;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    runs: { type: 'string', default: '5' },
    out: { type: 'string', default: '.cache/test-margins/latest' },
    table: { type: 'boolean', default: false },
  },
});

interface Run {
  seconds: number;
  code: number | null;
  timings: Timing[];
}

const key = (t: Timing) => `${t.file} > ${t.name}`;

function vitest(args: string[], out: string): Run {
  const started = performance.now();
  const result = spawnSync('npm', ['run', '--silent', ...args], {
    env: { ...process.env, TEST_MARGINS_OUT: out },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  const seconds = (performance.now() - started) / 1000;
  const timings = readFileSync(out, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Timing);
  return { seconds, code: result.status, timings };
}

function checkHookLimits() {
  const listed = spawnSync('git', ['grep', '-lE', '^\\}, [0-9A-Z_]+\\);', '--', '*.test.ts'], {
    encoding: 'utf8',
  }).stdout;
  const unknown = listed
    .split('\n')
    .filter(Boolean)
    .filter((file) => !(file in HOOK_LIMITS));
  if (unknown.length > 0)
    throw new Error(`add the hook timeouts of ${unknown.join(', ')} to HOOK_LIMITS`);
}

function measure(dir: string, runs: number) {
  checkHookLimits();
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const suite: Run[] = [];
  for (let i = 1; i <= runs; i++) {
    const run = vitest(
      ['test', '--', `--reporter=default`, `--reporter=${REPORTER}`],
      join(dir, `suite-${i}.jsonl`),
    );
    suite.push(run);
    console.log(`suite run ${i}: ${run.seconds.toFixed(1)} s, exit ${run.code}`);
  }
  const atRisk = new Set(
    suite.flatMap((run) => run.timings.filter((t) => t.ms > t.limitMs / 2).map((t) => t.file)),
  );
  for (const file of atRisk) {
    for (let i = 1; i <= ALONE_RUNS; i++) {
      const name = file.replaceAll('/', '_');
      vitest(['test', '--', file, `--reporter=${REPORTER}`], join(dir, `alone-${name}-${i}.jsonl`));
    }
  }
  writeFileSync(
    join(dir, 'suite-seconds.json'),
    JSON.stringify(suite.map((run) => ({ seconds: run.seconds, code: run.code }))),
  );
}

interface Summary {
  seconds: { seconds: number; code: number | null }[];
  slowest: Map<string, Timing & { runs: number[] }>;
  alone: Map<string, number>;
}

function summarize(dir: string): Summary {
  const slowest = new Map<string, Timing & { runs: number[] }>();
  const alone = new Map<string, number>();
  for (const name of readdirSync(dir)
    .filter((n) => n.endsWith('.jsonl'))
    .sort()) {
    const timings = readFileSync(join(dir, name), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Timing);
    for (const t of timings) {
      if (name.startsWith('suite-')) {
        const seen = slowest.get(key(t));
        if (!seen) slowest.set(key(t), { ...t, runs: [t.ms] });
        else {
          seen.runs.push(t.ms);
          if (t.ms > seen.ms) Object.assign(seen, { ms: t.ms, state: t.state });
        }
      } else alone.set(key(t), Math.max(alone.get(key(t)) ?? 0, t.ms));
    }
  }
  const seconds = JSON.parse(
    readFileSync(join(dir, 'suite-seconds.json'), 'utf8'),
  ) as Summary['seconds'];
  return { seconds, slowest, alone };
}

const s = (ms: number | undefined) => (ms === undefined ? 'n/a' : `${(ms / 1000).toFixed(1)} s`);

function table(dirs: string[]) {
  const summaries = dirs.map(summarize);
  const rows = new Set(
    summaries.flatMap((summary) =>
      [...summary.slowest.values()].filter((t) => t.ms > t.limitMs / 2).map(key),
    ),
  );
  const header = [
    'Test or hook',
    'Limit',
    ...dirs.flatMap((d) => [`${d} slowest of ${summaries[0]?.seconds.length} runs`, `${d} alone`]),
  ];
  const lines = [`| ${header.join(' | ')} |`, `|${header.map(() => ' --- ').join('|')}|`];
  for (const row of [...rows].sort()) {
    const limit = summaries.find((summary) => summary.slowest.has(row))?.slowest.get(row)?.limitMs;
    const cells = summaries.flatMap((summary) => {
      const t = summary.slowest.get(row);
      const failed = t && t.state !== 'pass' ? ` (${t.state})` : '';
      return [`${s(t?.ms)}${failed}`, s(summary.alone.get(row))];
    });
    lines.push(`| \`${row}\` | ${s(limit)} | ${cells.join(' | ')} |`);
  }
  for (const [i, summary] of summaries.entries()) {
    const runs = summary.seconds.map(
      (run) => `${run.seconds.toFixed(0)} s${run.code === 0 ? '' : ` (exit ${run.code})`}`,
    );
    lines.push('', `${dirs[i]}: whole \`npm test\` ${runs.join(', ')}`);
  }
  console.log(lines.join('\n'));
}

if (values.table) table(positionals);
else {
  if (!existsSync('package.json')) throw new Error('run from the repository root');
  measure(values.out, Number(values.runs));
  table([values.out]);
}
