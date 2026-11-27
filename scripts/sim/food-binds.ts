import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { recruitShortfall } from '../../src/sim/ai/budget.ts';
import { nextBuilding } from '../../src/sim/ai/build.ts';
import { decideAll } from '../../src/sim/ai/decide.ts';
import { balanceOf, menUnderArms, reserveOf } from '../../src/sim/ai/situation.ts';
import { bestStudy } from '../../src/sim/ai/study.ts';
import type { FactionId } from '../../src/sim/ids.ts';
import { parseMap, POWERS } from '../../src/sim/map.ts';
import { newGame } from '../../src/sim/new-game.ts';
import type { GameState } from '../../src/sim/state/game-state.ts';
import { tick } from '../../src/sim/tick.ts';
import { buildWorld } from '../../src/sim/world/world.ts';

// Counts, for each great power, the days its gold and men would raise its next formation and
// the days among them that food stopped it. `--trace 8:rome` prints that power's choices on
// every `--every`th such day.

const { values } = parseArgs({
  options: {
    seeds: { type: 'string', default: '1,8' },
    years: { type: 'string', default: '10' },
    trace: { type: 'string', default: '' },
    every: { type: 'string', default: '90' },
  },
});

const map = parseMap(
  JSON.parse(readFileSync(new URL('../../data/map/map.json', import.meta.url), 'utf8')),
);
const world = buildWorld(map);
const [traceSeed, tracePower] = values.trace.split(':');

function traceLine(state: GameState, faction: FactionId, orders: string[]): string {
  const record = state.factions[faction];
  if (!record) return '';
  const spare = Math.round(record.stores.gold - reserveOf(state, faction, 'gold'));
  const build = nextBuilding(state, faction);
  const study = bestStudy(state, faction, Infinity);
  const food = balanceOf(state, faction)?.food ?? 0;
  return [
    `day ${state.day} ${faction}: ${menUnderArms(state, faction)} men, food ${food.toFixed(1)} a day`,
    `gold ${Math.round(record.stores.gold)} (${spare} over the reserve)`,
    `soonest building ${build ? `${build.kind} at ${build.city.id} ${build.payback.toFixed(1)}y` : 'none'}`,
    `soonest advance ${study ? `${study.advance} ${study.payback.toFixed(1)}y` : 'none'}`,
    `studying ${record.study?.advance ?? 'nothing'}`,
    `orders ${orders.join(' ') || 'none'}`,
  ].join(', ');
}

for (const seed of values.seeds.split(',').map(Number)) {
  let state: GameState = newGame(map, { seed, player: 'rome' });
  const ready = new Map<string, number>();
  const stopped = new Map<string, number>();
  for (let day = 1; day <= Number(values.years) * 365; day++) {
    const orders = decideAll(state, world, []);
    for (const power of POWERS) {
      const faction = power as FactionId;
      if (state.factions[faction]?.defeatedOn !== null) continue;
      const short = recruitShortfall(state, faction);
      if (short.has('gold') || short.has('goldBalance') || short.has('manpower')) continue;
      ready.set(power, (ready.get(power) ?? 0) + 1);
      if (!short.has('food') && !short.has('foodBalance')) continue;
      const count = (stopped.get(power) ?? 0) + 1;
      stopped.set(power, count);
      if (
        String(seed) === traceSeed &&
        power === tracePower &&
        count % Number(values.every) === 1
      ) {
        const mine = orders
          .filter((order) => 'faction' in order && order.faction === faction)
          .filter((order) => order.kind === 'build' || order.kind === 'study')
          .map((order) => JSON.stringify(order));
        console.log(`seed ${seed} ${traceLine(state, faction, mine)}`);
      }
    }
    state = tick(state, orders, world).state;
  }
  const counts = POWERS.map(
    (power) => `${power} ${stopped.get(power) ?? 0} of ${ready.get(power) ?? 0}`,
  ).join(', ');
  const alive = POWERS.filter((power) => state.factions[power as FactionId]?.defeatedOn === null);
  console.log(
    `seed ${seed}: days food stopped a recruit of those gold was ready: ${counts}; alive ${alive.join(' ')}`,
  );
}
