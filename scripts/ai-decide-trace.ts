import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { decideAll } from '../src/sim/ai/decide.ts';
import type { FactionId } from '../src/sim/ids.ts';
import { parseMap } from '../src/sim/map.ts';
import { newGame } from '../src/sim/new-game.ts';
import type { GameState } from '../src/sim/state/game-state.ts';
import { tick } from '../src/sim/tick.ts';
import { buildWorld } from '../src/sim/world/world.ts';

// Wall time on a shared machine mostly measures the scheduler, so each day also records
// main-thread CPU time and the GC time inside it. The per-seed hash of the order stream
// shows that a change to the AI decides exactly what it did before.

const { values } = parseArgs({
  options: {
    seeds: { type: 'string', default: '20' },
    first: { type: 'string', default: '1' },
    years: { type: 'string', default: '5' },
    passive: { type: 'string', default: '' },
    out: { type: 'string' },
    worst: { type: 'string', default: '0' },
    replay: { type: 'string' },
    repeat: { type: 'string', default: '50' },
  },
});

const map = parseMap(
  JSON.parse(readFileSync(new URL('../data/map/map.json', import.meta.url), 'utf8')),
);
const world = buildWorld(map);
const passive = values.passive ? values.passive.split(',').map((id) => id as FactionId) : [];

function quantile(sorted: readonly number[], q: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
}

if (values.replay) {
  const state = JSON.parse(readFileSync(values.replay, 'utf8')) as GameState;
  const times: number[] = [];
  const cpus: number[] = [];
  let orders = '';
  for (let i = 0; i < Number(values.repeat); i++) {
    const copy = JSON.parse(JSON.stringify(state)) as GameState;
    const cpuBefore = process.threadCpuUsage();
    const started = performance.now();
    const today = decideAll(copy, world, passive);
    times.push(performance.now() - started);
    const cpuUsed = process.threadCpuUsage(cpuBefore);
    cpus.push((cpuUsed.user + cpuUsed.system) / 1000);
    orders = JSON.stringify(today);
  }
  const sortedTimes = [...times].sort((a, b) => a - b);
  const sortedCpus = [...cpus].sort((a, b) => a - b);
  console.log(
    `replay ${values.replay}: wall first ${times[0]?.toFixed(2)}, median ${quantile(sortedTimes, 0.5).toFixed(2)}, min ${sortedTimes[0]?.toFixed(2)} ms; cpu median ${quantile(sortedCpus, 0.5).toFixed(2)}, min ${sortedCpus[0]?.toFixed(2)} ms; day ${state.day}, ${JSON.parse(orders).length} orders ${createHash('sha256').update(orders).digest('hex').slice(0, 16)}`,
  );
} else {
  const seeds = Number(values.seeds);
  const days = Number(values.years) * 365;
  const worstKept = Number(values.worst);
  const out = values.out;
  if (out) mkdirSync(out, { recursive: true });
  const gcs: { start: number; end: number }[] = [];
  new PerformanceObserver((list) => {
    for (const e of list.getEntries())
      gcs.push({ start: e.startTime, end: e.startTime + e.duration });
  }).observe({ entryTypes: ['gc'] });
  const all: { seed: number; day: number; start: number; ms: number; cpu: number; gc: number }[] =
    [];
  const hashes: string[] = [];
  const started = performance.now();
  for (let seed = Number(values.first); seed <= seeds; seed++) {
    let state = newGame(map, { seed, player: 'rome' });
    const hash = createHash('sha256');
    const worst: { day: number; cpu: number; state: string }[] = [];
    for (let day = 1; day <= days; day++) {
      const cpuBefore = process.threadCpuUsage();
      const before = performance.now();
      const today = decideAll(state, world, passive);
      const ms = performance.now() - before;
      const cpuUsed = process.threadCpuUsage(cpuBefore);
      const cpu = (cpuUsed.user + cpuUsed.system) / 1000;
      all.push({ seed, day, start: before, ms, cpu, gc: 0 });
      hash.update(`${day}:${JSON.stringify(today)}\n`);
      if (worstKept > 0 && (worst.length < worstKept || cpu > (worst.at(-1)?.cpu ?? 0))) {
        worst.push({ day, cpu, state: JSON.stringify(state) });
        worst.sort((a, b) => b.cpu - a.cpu);
        worst.length = Math.min(worst.length, worstKept);
      }
      state = tick(state, today, world).state;
      if (day % 50 === 0) await new Promise((resolve) => setImmediate(resolve));
    }
    const digest = hash.digest('hex');
    hashes.push(`seed ${seed} ${digest}`);
    console.log(`seed ${seed} ${digest}`);
    if (out) {
      for (const w of worst) writeFileSync(join(out, `worst-s${seed}-d${w.day}.json`), w.state);
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 100));
  gcs.sort((a, b) => a.start - b.start);
  let g = 0;
  for (const d of all) {
    const end = d.start + d.ms;
    while (g < gcs.length && (gcs[g]?.end ?? 0) < d.start) g++;
    for (let i = g; i < gcs.length && (gcs[i]?.start ?? end) < end; i++) {
      const e = gcs[i] as { start: number; end: number };
      d.gc += Math.max(0, Math.min(end, e.end) - Math.max(d.start, e.start));
    }
  }
  const stats = (name: string, pick: (d: (typeof all)[number]) => number) => {
    const values = all.map(pick).sort((a, b) => a - b);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const top = [...all].sort((a, b) => pick(b) - pick(a)).slice(0, 8);
    console.log(
      `${name}: mean ${mean.toFixed(2)}, p50 ${quantile(values, 0.5).toFixed(2)}, p99 ${quantile(values, 0.99).toFixed(2)}, p999 ${quantile(values, 0.999).toFixed(2)}, max ${(values.at(-1) ?? 0).toFixed(2)}; worst ${top.map((d) => `s${d.seed}d${d.day} ${pick(d).toFixed(1)}`).join(', ')}`,
    );
  };
  console.log(`${all.length} days, ${gcs.length} GCs`);
  stats('decide wall ms', (d) => d.ms);
  stats('decide thread cpu ms', (d) => d.cpu);
  stats('gc ms inside decide', (d) => d.gc);
  stats('wall less gc ms', (d) => d.ms - d.gc);
  stats('descheduled ms (wall less cpu)', (d) => Math.max(0, d.ms - d.cpu));
  console.log(`wall ${((performance.now() - started) / 1000).toFixed(1)} s`);
  if (out) {
    writeFileSync(join(out, 'hashes.txt'), hashes.join('\n') + '\n');
    writeFileSync(join(out, 'days.json'), JSON.stringify(all));
  }
}
