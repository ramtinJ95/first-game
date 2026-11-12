import { CONVOY_KM_PER_DAY, MARCH_KM_PER_DAY, REFUGEE_KM_PER_DAY } from '../../src/sim/march.ts';
import { newGame } from '../../src/sim/new-game.ts';
import type { Order } from '../../src/sim/orders/orders.ts';
import type { GameState } from '../../src/sim/state/game-state.ts';
import { tick } from '../../src/sim/tick.ts';
import { distance, findPath } from '../../src/sim/world/find-path.ts';
import { buildWorld, type World } from '../../src/sim/world/world.ts';
import { cityAt, loadMap, pathLength, ROUTES } from './experiment.ts';

function median(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] as number;
}

function timeEach(run: () => void, repeats: number, warmup = 5): number[] {
  for (let i = 0; i < warmup; i += 1) run();
  return Array.from({ length: repeats }, () => {
    const started = performance.now();
    run();
    return performance.now() - started;
  });
}

function tickTimes(world: World, march: boolean): number[] {
  const start = newGame(world.map, { seed: 1, player: 'rome' });
  const far = ['persepolis', 'tingis', 'lutetia', 'ekbatana', 'gades'];
  const orders: Order[] = march
    ? Object.values(start.armies).map((army, i) => ({
        kind: 'moveArmy',
        faction: army.owner,
        army: army.id,
        to: cityAt(world.map, far[i % far.length] as string),
      }))
    : [];
  let state: GameState = tick(start, orders, world).state;
  const marching = Object.values(state.armies).filter((a) => a.activity.kind === 'marching');
  if (march && marching.length !== Object.keys(state.armies).length) {
    throw new Error('not every army set out');
  }
  return timeEach(() => {
    state = tick(state, [], world).state;
  }, 200);
}

function main() {
  const map = loadMap();
  const builds = timeEach(() => buildWorld(map), 10, 2);
  const world = buildWorld(map);
  const lines: string[] = [];
  lines.push(
    `Speeds: march ${MARCH_KM_PER_DAY} km a day, convoy ${CONVOY_KM_PER_DAY} km a day, refugees ${REFUGEE_KM_PER_DAY} km a day.`,
  );
  lines.push(`World build: median ${median(builds).toFixed(0)} ms over 10 builds.`);
  lines.push('');
  lines.push('| Route | Path | Straight line | Ratio | Days of marching | Path finding |');
  lines.push('|---|---|---|---|---|---|');
  for (const [a, b] of ROUTES) {
    const from = cityAt(map, a);
    const to = cityAt(map, b);
    const path = findPath(world.mesh, from, to, 'land');
    if (!path) throw new Error(`no land path ${a}-${b}`);
    const length = pathLength(from, path);
    const straight = distance(from, to);
    const ms = median(timeEach(() => findPath(world.mesh, from, to, 'land'), 50));
    lines.push(
      `| ${a} to ${b} | ${length.toFixed(0)} km | ${straight.toFixed(0)} km | ${(length / straight).toFixed(2)} | ${Math.ceil(length / MARCH_KM_PER_DAY)} | ${ms.toFixed(2)} ms |`,
    );
  }
  const idle = median(tickTimes(world, false));
  const marching = median(tickTimes(world, true));
  lines.push('');
  lines.push(
    `Tick on the new game, median of 200: idle ${idle.toFixed(3)} ms, every army marching ${marching.toFixed(3)} ms.`,
  );
  console.log(lines.join('\n'));
}

main();
