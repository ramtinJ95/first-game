import { spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { availableParallelism } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { HOOK_LIMITS, type Timing } from './reporter.ts';

const REPORTER = resolve(import.meta.dirname, 'reporter.ts');
const ALONE_RUNS = 3;
const MAP_CACHE = resolve(import.meta.dirname, '../../.cache/map');

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    runs: { type: 'string', default: '5' },
    out: { type: 'string', default: '.cache/test-margins/latest' },
    table: { type: 'boolean', default: false },
    cold: { type: 'boolean', default: false },
    beside: { type: 'string' },
    lead: { type: 'string', default: '0' },
  },
});

interface Run {
  seconds: number;
  code: number | null;
  /** The least memory the kernel had available while the run went, in MiB. */
  minAvailableMiB: number;
  /** The machine's busy cores, averaged over the run. */
  busyCores: number;
  timings: Timing[];
}

const key = (t: Timing) => `${t.file} > ${t.name}`;

const availableMiB = () =>
  Number(/MemAvailable:\s+(\d+)/.exec(readFileSync('/proc/meminfo', 'utf8'))?.[1] ?? 0) / 1024;

/** Busy and total jiffies of all cores since boot. */
function cpuTicks(): [busy: number, total: number] {
  const [, ...fields] = (readFileSync('/proc/stat', 'utf8').split('\n')[0] ?? '').split(/\s+/);
  const ticks = fields.filter(Boolean).map(Number);
  const idle = (ticks[3] ?? 0) + (ticks[4] ?? 0);
  const total = ticks.reduce((sum, tick) => sum + tick, 0);
  return [total - idle, total];
}

/** How long the command beside a run has to stop after a SIGTERM before it is killed. */
const STOP_GRACE_MS = 10_000;

/**
 * Starts `command` again each time it ends, in its own process group, until the returned stop.
 * The stop sends SIGTERM first, which a heavy command passes on to its copy in its own session.
 */
function beside(command: string, log: string): () => Promise<void> {
  const child = spawn('sh', ['-c', `trap 'exit 0' TERM; while :; do ${command}; done`], {
    detached: true,
    stdio: ['ignore', openSync(log, 'a'), openSync(log, 'a')],
  });
  const signal = (name: NodeJS.Signals) => {
    try {
      if (child.pid !== undefined) process.kill(-child.pid, name);
    } catch {
      // The group has gone already.
    }
  };
  return async () => {
    signal('SIGTERM');
    await delay(STOP_GRACE_MS);
    signal('SIGKILL');
  };
}

async function vitest(args: string[], out: string, load?: string): Promise<Run> {
  if (values.cold) rmSync(MAP_CACHE, { recursive: true, force: true });
  const stop = load === undefined ? undefined : beside(load, `${out}.beside.log`);
  if (stop) await delay(Number(values.lead) * 1000);
  let minAvailableMiB = availableMiB();
  const sampler = setInterval(() => {
    minAvailableMiB = Math.min(minAvailableMiB, availableMiB());
  }, 1000);
  const [busy0, total0] = cpuTicks();
  const started = performance.now();
  const code = await new Promise<number | null>((done) => {
    spawn('npm', ['run', '--silent', ...args], {
      env: { ...process.env, TEST_MARGINS_OUT: out },
      stdio: ['ignore', 'ignore', 'inherit'],
    }).on('close', done);
  });
  const seconds = (performance.now() - started) / 1000;
  const [busy1, total1] = cpuTicks();
  clearInterval(sampler);
  await stop?.();
  const cores = availableParallelism();
  const timings = existsSync(out)
    ? readFileSync(out, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Timing)
    : [];
  return {
    seconds,
    code,
    minAvailableMiB,
    busyCores: ((busy1 - busy0) / (total1 - total0)) * cores,
    timings,
  };
}

function checkHookLimits() {
  const listed = spawnSync('git', ['grep', '-lE', '^\\s*\\}, [0-9A-Z_]+\\);', '--', '*.test.ts'], {
    encoding: 'utf8',
  }).stdout;
  const known = new Set(Object.keys(HOOK_LIMITS).map((hook) => hook.split(' > ')[0]));
  const unknown = listed
    .split('\n')
    .filter(Boolean)
    .filter((file) => !known.has(file));
  if (unknown.length > 0)
    throw new Error(`add the hook timeouts of ${unknown.join(', ')} to HOOK_LIMITS`);
}

async function measure(dir: string, runs: number) {
  checkHookLimits();
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const suite: Run[] = [];
  for (let i = 1; i <= runs; i++) {
    const run = await vitest(
      ['test', '--', `--reporter=default`, `--reporter=${REPORTER}`],
      join(dir, `suite-${i}.jsonl`),
      values.beside,
    );
    suite.push(run);
    console.log(
      `suite run ${i}: ${run.seconds.toFixed(1)} s, exit ${run.code}, ${run.busyCores.toFixed(2)} cores busy, ${run.minAvailableMiB.toFixed(0)} MiB available at least`,
    );
  }
  const atRisk = new Set(
    suite.flatMap((run) => run.timings.filter((t) => t.ms > t.limitMs / 2).map((t) => t.file)),
  );
  for (const file of atRisk) {
    for (let i = 1; i <= ALONE_RUNS; i++) {
      const name = file.replaceAll('/', '_');
      await vitest(
        ['test', '--', file, `--reporter=${REPORTER}`],
        join(dir, `alone-${name}-${i}.jsonl`),
      );
    }
  }
  writeFileSync(
    join(dir, 'suite-seconds.json'),
    JSON.stringify(
      suite.map(({ seconds, code, busyCores, minAvailableMiB }) => ({
        seconds,
        code,
        busyCores,
        minAvailableMiB,
      })),
    ),
  );
  writeFileSync(
    join(dir, 'conditions.json'),
    JSON.stringify({
      cold: values.cold,
      beside: values.beside ?? null,
      lead: Number(values.lead),
    }),
  );
}

interface Summary {
  seconds: { seconds: number; code: number | null; busyCores?: number; minAvailableMiB?: number }[];
  conditions: string;
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
  const path = join(dir, 'conditions.json');
  const { cold, beside, lead } = existsSync(path)
    ? (JSON.parse(readFileSync(path, 'utf8')) as {
        cold: boolean;
        beside: string | null;
        lead?: number;
      })
    : { cold: false, beside: null };
  const conditions = [
    cold ? 'a cold .cache/map' : 'a warm .cache/map',
    beside ? `\`${beside}\` beside${lead ? `, started ${lead} s before` : ''}` : 'nothing beside',
  ].join(', ');
  return { seconds, conditions, slowest, alone };
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
    const memory = summary.seconds.map((run) => run.minAvailableMiB?.toFixed(0) ?? 'n/a');
    const cores = summary.seconds.map((run) => run.busyCores?.toFixed(2) ?? 'n/a');
    lines.push(
      '',
      `${dirs[i]}, with ${summary.conditions}: whole \`npm test\` ${runs.join(', ')}; least MiB available ${memory.join(', ')}; busy cores ${cores.join(', ')}`,
    );
  }
  console.log(lines.join('\n'));
}

if (values.table) table(positionals);
else {
  if (!existsSync('package.json')) throw new Error('run from the repository root');
  await measure(values.out, Number(values.runs));
  table([values.out]);
}
