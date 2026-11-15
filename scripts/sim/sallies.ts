import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import {
  BATTLE_PAUSE_MEN,
  BATTLE_PAUSE_SHARE,
  importantBattle,
} from '../../src/app/battle-importance.ts';
import { decideAll } from '../../src/sim/ai/decide.ts';
import type { DayEvent } from '../../src/sim/events.ts';
import type { CityId, FactionId } from '../../src/sim/ids.ts';
import { parseMap } from '../../src/sim/map.ts';
import { newGame } from '../../src/sim/new-game.ts';
import type { Order } from '../../src/sim/orders/orders.ts';
import type { GameState } from '../../src/sim/state/game-state.ts';
import { menOf } from '../../src/sim/systems/economy.ts';
import { tick } from '../../src/sim/tick.ts';
import { buildWorld } from '../../src/sim/world/world.ts';

/**
 * Rome declares war on Mediolanum and marches every army it has to the city, then waits.
 * Prints each battle Rome fights there with the men on each side, and whether it stops
 * the game by the rule of pull request 54 (500 of Rome's men in the battle or a tenth
 * of its field army) and by the rule in `importantBattle` (enemy men in the battle).
 * `--men <n>` scales Rome's armies to about n men first, as the tester's 1,900.
 */

const { values } = parseArgs({
  options: {
    seeds: { type: 'string', default: '5' },
    days: { type: 'string', default: '240' },
    men: { type: 'string' },
  },
});
const map = parseMap(JSON.parse(readFileSync('data/map/map.json', 'utf8')));
const world = buildWorld(map);
const rome = 'rome' as FactionId;
const mediolanum = 'mediolanum' as CityId;

type Began = Extract<DayEvent, { kind: 'battleBegan' }>;

function byMenInBattle(state: GameState, event: Began): boolean {
  const ours = event.forces
    .filter((force) => force.faction === rome)
    .reduce((sum, force) => sum + force.men, 0);
  const fielded = Object.values(state.armies)
    .filter((army) => army.owner === rome)
    .reduce((sum, army) => sum + menOf(state, army), 0);
  return ours >= BATTLE_PAUSE_MEN || (ours > 0 && ours >= fielded * BATTLE_PAUSE_SHARE);
}

console.log(
  '| Seed | Day | Mediolanum men | Rome men in it | Rome under arms | Stops before | Stops after |',
);
console.log('| ---: | --: | ---: | ---: | ---: | :-: | :-: |');
for (let seed = 1; seed <= Number(values.seeds); seed++) {
  let state = newGame(map, { seed, player: 'rome' });
  const city = state.cities[mediolanum];
  if (!city) throw new Error('no Mediolanum');
  const owner = city.owner;
  const romans = Object.values(state.formations).filter(
    (formation) => state.armies[formation.army]?.owner === rome,
  );
  const total = romans.reduce((sum, formation) => sum + formation.men, 0);
  if (values.men)
    for (const formation of romans)
      formation.men = Math.round((formation.men * Number(values.men)) / total);
  const orders: Order[] = [
    { kind: 'declareWar', faction: rome, against: owner },
    ...Object.values(state.armies)
      .filter((army) => army.owner === rome)
      .map((army): Order => ({
        kind: 'moveArmy',
        faction: rome,
        army: army.id,
        to: city.position,
      })),
  ];
  for (let day = 0; day < Number(values.days); day++) {
    const before = state;
    const result = tick(state, [...(day === 0 ? orders : []), ...decideAll(state, world)], world);
    state = result.state;
    for (const event of result.events) {
      if (event.kind !== 'battleBegan' || !event.forces.some((force) => force.faction === rome))
        continue;
      if (!event.forces.some((force) => force.faction === owner)) continue;
      const men = (faction: FactionId) =>
        event.forces
          .filter((force) => force.faction === faction)
          .reduce((sum, force) => sum + force.men, 0);
      const fielded = Object.values(before.armies)
        .filter((army) => army.owner === rome)
        .reduce((sum, army) => sum + menOf(before, army), 0);
      console.log(
        `| ${seed} | ${before.day} | ${men(owner)} | ${men(rome)} | ${fielded} | ${byMenInBattle(before, event) ? 'yes' : 'no'} | ${importantBattle(before, event) ? 'yes' : 'no'} |`,
      );
    }
    if (state.cities[mediolanum]?.owner === rome) break;
  }
}
