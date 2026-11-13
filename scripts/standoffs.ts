import { planCommand } from '../src/app/command.ts';
import type { DeepReadonly } from '../src/sim/deep-readonly.ts';
import type { ArmyId } from '../src/sim/ids.ts';
import type { Army } from '../src/sim/state/army.ts';
import type { GameState } from '../src/sim/state/game-state.ts';
import { ENGAGEMENT_DISTANCE } from '../src/sim/systems/battles.ts';
import { areAtWar } from '../src/sim/wars.ts';
import { connected, distance } from '../src/sim/world/find-path.ts';
import type { World } from '../src/sim/world/world.ts';

/** An army that stands this many days or more counts as left there. */
export const STANDOFF_DAYS = 31;

type State = DeepReadonly<GameState>;

function fit(state: State, army: DeepReadonly<Army>): boolean {
  return army.formations.some((id) => {
    const formation = state.formations[id];
    return !!formation && formation.men > 0 && formation.morale > 0;
  });
}

/**
 * Counts, over one game, the armies that stand idle beside an enemy army or an enemy city
 * of a faction at war with theirs for STANDOFF_DAYS days in a row, and the armies that stand
 * idle overseas, with no city of their owner on their land, for as long, and of those the
 * ones that the player's menu would give no way to their owner's nearest city.
 */
export function createStandoffCounter(world: World) {
  const beside = new Map<ArmyId, number>();
  const overseas = new Map<ArmyId, number>();
  const besideArmies = new Set<ArmyId>();
  const overseasArmies = new Set<ArmyId>();
  const noWayHome = new Set<ArmyId>();

  function observe(state: State) {
    for (const army of Object.values(state.armies)) {
      const { activity } = army;
      const owner = state.factions[army.owner];
      if (activity.kind !== 'idle' || !fit(state, army) || owner?.defeatedOn !== null) {
        beside.delete(army.id);
        overseas.delete(army.id);
        continue;
      }
      const at = activity.position;
      const near =
        Object.values(state.armies).some(
          (other) =>
            other.activity.kind !== 'embarked' &&
            other.activity.kind !== 'retreating' &&
            areAtWar(state, army.owner, other.owner) &&
            fit(state, other) &&
            distance(at, other.activity.position) <= ENGAGEMENT_DISTANCE,
        ) ||
        Object.values(state.cities).some(
          (city) =>
            areAtWar(state, army.owner, city.owner) &&
            distance(at, city.position) <= ENGAGEMENT_DISTANCE,
        );
      const besideDays = near ? (beside.get(army.id) ?? 0) + 1 : 0;
      beside.set(army.id, besideDays);
      if (besideDays >= STANDOFF_DAYS) besideArmies.add(army.id);

      const own = Object.values(state.cities).filter((city) => city.owner === army.owner);
      const home = own.some((city) => connected(world.mesh, at, city.position, 'land'));
      const awayDays = home ? 0 : (overseas.get(army.id) ?? 0) + 1;
      overseas.set(army.id, awayDays);
      if (awayDays === STANDOFF_DAYS) {
        overseasArmies.add(army.id);
        const [nearest] = own.sort((a, b) => distance(at, a.position) - distance(at, b.position));
        const plan = nearest && planCommand(state, world, army, { kind: 'city', city: nearest });
        if (!plan || plan.kind === 'refuse') noWayHome.add(army.id);
      }
    }
  }

  function result() {
    return {
      idleBesideEnemy: besideArmies.size,
      idleOverseas: overseasArmies.size,
      noWayHome: noWayHome.size,
    };
  }

  return { observe, result };
}

export type Standoffs = ReturnType<ReturnType<typeof createStandoffCounter>['result']>;

/** The Markdown lines that report the counts summed over seeds. */
export function standoffLines(all: readonly Standoffs[]): string[] {
  const sum = (key: keyof Standoffs) => all.reduce((total, one) => total + one[key], 0);
  return [
    `- Armies idle beside an enemy army or an enemy city at war for more than ${STANDOFF_DAYS - 1} days: ${sum('idleBesideEnemy')}.`,
    `- Armies idle overseas, with no city of their owner on their land, for more than ${STANDOFF_DAYS - 1} days: ${sum('idleOverseas')}, of which the menu gives no way to their owner's nearest city: ${sum('noWayHome')}.`,
  ];
}
