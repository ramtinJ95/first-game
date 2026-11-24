import { describe, expect, it } from 'vitest';
import { changeCityOwner } from '../src/sim/cities.ts';
import type { CityId, FactionId } from '../src/sim/ids.ts';
import { newGame } from '../src/sim/new-game.ts';
import type { Order } from '../src/sim/orders/orders.ts';
import type { Day } from '../src/sim/state/day.ts';
import { warKey } from '../src/sim/state/war.ts';
import { limitsOf } from '../src/sim/systems/economy.ts';
import { map, playCautiousRome, rome, warnedPowers } from './cautious-rome.ts';

const carthage = 'carthage' as FactionId;
const WEST = [
  'caralis',
  'cirta',
  'iol-caesarea',
  'cidamus',
  'tarraco',
  'carthago-nova',
] as CityId[];

/**
 * A new game on day 100 with a Carthage of 5,300 men on notice since day 94, so its warning
 * comes on the first day played, and Rome's stores full, so its own AI recruits as well.
 */
function warnedTomorrow() {
  const state = newGame(map, { seed: 1, player: 'rome' });
  state.day = 100 as Day;
  for (const id of WEST) changeCityOwner(state, id, carthage);
  for (const faction of Object.values(state.factions))
    if (faction.kind === 'minor')
      state.truces[warKey(carthage, faction.id)] = {
        since: state.day,
        endsOn: (state.day + 365) as Day,
      };
  const army = Object.values(state.armies).find((a) => a.owner === carthage);
  const spearmen = army && state.formations[army.formations[0] as never];
  const romans = state.factions[rome];
  const punic = state.factions[carthage];
  if (!spearmen || !romans || !punic) throw new Error('no Carthage or Rome');
  spearmen.men = 5300;
  punic.noticeSince = 94 as Day;
  romans.stores = { ...(limitsOf(state).get(rome) ?? romans.stores) };
  return state;
}

function played(answer: boolean) {
  const seen: { day: number; accepted: readonly Order[]; answered: readonly Order[] }[] = [];
  playCautiousRome(
    1,
    3 / 365,
    ({ before, accepted, answered }) => seen.push({ day: before.day, accepted, answered }),
    { peaceful: true, answer, guards: answer ? 'enough' : 'never', start: warnedTomorrow() },
  );
  return seen;
}

const kinds = (orders: readonly Order[]) =>
  orders.map((o) => o.kind).filter((k) => k !== 'moveArmy');

describe("the harness's word on which orders answered a warning", () => {
  it('marks the troop given the day after a warning, and not what the AI orders for Rome', () => {
    const answering = played(true);
    expect(answering.map((d) => [d.day, kinds(d.answered)])).toEqual([
      [100, []],
      [101, ['recruit']],
      [102, []],
    ]);
    const ignoring = played(false);
    expect(ignoring.flatMap((d) => d.accepted).some((o) => o.kind === 'recruit')).toBe(true);
    expect(ignoring.every((d) => d.answered.length === 0)).toBe(true);
  });
});

describe('the powers a warning names', () => {
  it('reads one power from a first warning, a reminder, a climb and a climb told with guards', () => {
    for (const text of [
      'Carthage could soon declare war on you: it has 82% of the strength it needs.',
      'Carthage still stands near war with you, as warned on Year 9, day 141: it has 82%.',
      'Carthage stands higher than when the game last stopped for it, on Year 1, day 70 at 87%: it has 95%.',
      "The 1,000 guards at Roma no longer count against Carthage's war. Carthage stands higher than when the game last stopped for it, on Year 1, day 70 at 87%: it has 95%.",
    ])
      expect(warnedPowers(text)).toEqual(['Carthage']);
  });

  it('reads every power of a line that folds a day of warnings', () => {
    expect(
      warnedPowers(
        'Carthage, Egypt and Macedon could soon declare war on you, with 82%, 90% and 81%.',
      ),
    ).toEqual(['Carthage', 'Egypt', 'Macedon']);
  });
});
