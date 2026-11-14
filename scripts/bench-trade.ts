import { readFileSync } from 'node:fs';
import { decideAll } from '../src/sim/ai/decide.ts';
import { parseMap } from '../src/sim/map.ts';
import { newGame } from '../src/sim/new-game.ts';
import { tick } from '../src/sim/tick.ts';
import { buildWorld } from '../src/sim/world/world.ts';

/** Copy this unchanged to another checkout's scripts/ to compare its rules and AI. */
const map = parseMap(
  JSON.parse(readFileSync(new URL('../data/map/map.json', import.meta.url), 'utf8')),
);
const world = buildWorld(map);
const times: number[] = [];
for (const seed of [21, 1, 2, 3]) {
  let state = newGame(map, { seed, player: 'rome' });
  for (let day = 1; day <= (seed === 21 ? 365 : 5 * 365); day++) {
    const start = performance.now();
    state = tick(state, decideAll(state, world, []), world).state;
    if (seed !== 21) times.push(performance.now() - start);
  }
}
times.sort((a, b) => a - b);
const quantile = (share: number) =>
  (times[Math.min(times.length - 1, Math.floor(times.length * share))] ?? NaN).toFixed(3);
console.log('| days | median ms | p95 ms | slowest ms |');
console.log('| --- | --- | --- | --- |');
console.log(`| ${times.length} | ${quantile(0.5)} | ${quantile(0.95)} | ${quantile(1)} |`);
