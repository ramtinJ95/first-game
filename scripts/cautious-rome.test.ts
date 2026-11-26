import { describe, expect, it } from 'vitest';
import { changeCityOwner } from '../src/sim/cities.ts';
import { allocateId, type CityId, type FactionId } from '../src/sim/ids.ts';
import { nameNewArmy } from '../src/sim/army-names.ts';
import type { GameState } from '../src/sim/state/game-state.ts';
import { newGame } from '../src/sim/new-game.ts';
import { executeOrder, type Order } from '../src/sim/orders/orders.ts';
import type { Day } from '../src/sim/state/day.ts';
import { warKey } from '../src/sim/state/war.ts';
import { expectConsistent } from '../src/sim/references.ts';
import { limitsOf } from '../src/sim/systems/economy.ts';
import { map, playCautiousRome, rome, warnedPowers, world } from './cautious-rome.ts';

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

function played(answer: boolean, follows = false, start = warnedTomorrow()) {
  const seen: { day: number; accepted: readonly Order[]; answered: readonly Order[] }[] = [];
  playCautiousRome(
    1,
    3 / 365,
    ({ before, accepted, answered }) => seen.push({ day: before.day, accepted, answered }),
    { peaceful: true, answer, follows, guards: answer ? 'enough' : 'never', start },
  );
  return seen;
}

/**
 * `warnedTomorrow` with Rome's 4,000 men eating more than its land grows and 50 food in store,
 * beside a Carthage of 9,000, which still warns.
 */
function hungryWarnedTomorrow() {
  const state = warnedTomorrow();
  const army = Object.values(state.armies).find((a) => a.owner === rome);
  const spearmen = army && state.formations[army.formations[0] as never];
  const romans = state.factions[rome];
  if (!spearmen || !romans) throw new Error('no Rome');
  spearmen.men = 4000;
  romans.stores.food = 50;
  const punic = Object.values(state.armies).find((a) => a.owner === carthage);
  const theirs = punic && state.formations[punic.formations[0] as never];
  if (!theirs) throw new Error('no Carthage');
  theirs.men = 9000;
  return state;
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

describe('a Rome that follows the advice', () => {
  it('raises no troop its food cannot feed, where a Rome that answers every line does', () => {
    const recruits = (seen: ReturnType<typeof played>) =>
      seen.flatMap((d) => kinds(d.answered)).filter((k) => k === 'recruit').length;
    const every = played(true, false, hungryWarnedTomorrow());
    const follows = played(true, true, hungryWarnedTomorrow());
    expect(recruits(every)).toBe(1);
    expect(recruits(follows)).toBe(0);
    expect(follows.flatMap((d) => kinds(d.answered))).toContain('hireGuards');
  });
});

describe('a Rome that follows the advice, with men of two troops in training', () => {
  it('raises no more when the warning says the men in training will come', () => {
    const start = warnedTomorrow();
    const roma = start.cities['roma' as CityId];
    const capua = start.cities['capua' as CityId];
    if (!roma || !capua) throw new Error('no Roma or Capua');
    roma.recruits.push({ troop: 'skirmishers', readyOn: 105 as Day });
    capua.recruits.push({ troop: 'archers', readyOn: 108 as Day });
    const recruits = (seen: ReturnType<typeof played>) =>
      seen.flatMap((d) => kinds(d.answered)).filter((k) => k === 'recruit').length;
    expect(recruits(played(true, false, structuredClone(start)))).toBe(1);
    expect(recruits(played(true, true, structuredClone(start)))).toBe(0);
  });
});

describe('the powers a warning names', () => {
  it('reads one power from a first warning, a reminder, a climb and a climb told with guards', () => {
    for (const text of [
      'Carthage could soon declare war on you: it has 82% of the strength it needs.',
      'Carthage still stands near war, as warned on Year 9, day 141: 82% near Ariminum.',
      'Carthage has climbed to 95% near Roma, from 87% at its last stop on Year 1, day 70.',
      'The 1,000 guards at Roma no longer count. Carthage has climbed to 95% near Roma, from 87% at its last stop on Year 1, day 70.',
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

describe('a Rome that fights back', () => {
  /** Rome on day 200, with 10,000 gold, in a war Carthage declared on day 100 and in which it took Capua: Rome is losing it. */
  function losingWar() {
    const state = newGame(map, { seed: 1, player: 'rome' });
    state.day = 200 as Day;
    expect(
      executeOrder(state, { kind: 'declareWar', faction: carthage, against: rome }, world),
    ).toBeUndefined();
    const war = state.wars[warKey(carthage, rome)];
    if (!war) throw new Error('no war');
    war.since = 100 as Day;
    changeCityOwner(state, 'capua' as CityId, carthage);
    expectConsistent(state);
    const romans = state.factions[rome];
    if (!romans) throw new Error('no Rome');
    romans.stores.gold = 10_000;
    return state;
  }

  const offers = (fights: boolean) => {
    const made: Order[] = [];
    playCautiousRome(
      1,
      1 / 365,
      ({ accepted }) => made.push(...accepted.filter((o) => o.kind === 'offerPeace')),
      { peaceful: true, answer: true, follows: true, guards: 'enough', fights, start: losingWar() },
    );
    return made;
  };

  it('offers peace in a war it is losing, with no city, where the answering Rome offers none', () => {
    const [offer, ...more] = offers(true);
    expect(more).toEqual([]);
    expect(offer).toMatchObject({ kind: 'offerPeace', faction: rome, to: carthage });
    if (offer?.kind !== 'offerPeace') throw new Error('no offer');
    expect(offer.terms.kind === 'payment' ? offer.terms.cities : []).toEqual([]);
    expect(offers(false)).toEqual([]);
  });

  it('keeps the gold it offered until the enemy answers, so the peace is made', () => {
    const made: string[] = [];
    let spent = 0;
    playCautiousRome(
      1,
      5 / 365,
      ({ before, accepted, events }) => {
        for (const e of events)
          if (e.kind === 'peaceMade' || e.kind === 'peaceRefused')
            made.push(`${before.day} ${e.kind}`);
        if (before.day <= 201)
          spent += accepted.filter((o) =>
            ['build', 'recruit', 'study', 'hireGuards'].includes(o.kind),
          ).length;
      },
      {
        peaceful: true,
        answer: true,
        follows: true,
        guards: 'enough',
        fights: true,
        start: losingWar(),
      },
    );
    expect(made).toEqual(['201 peaceMade']);
    expect(spent).toBe(0);
  });

  /** The state with 800 Carthaginian spearmen idle halfway between Roma and Capua, prey for Rome's 4,000 once at war. */
  function withPrey(state: GameState): GameState {
    const roma = state.cities['roma' as CityId];
    const capua = state.cities['capua' as CityId];
    if (!roma || !capua) throw new Error('no Roma or Capua');
    const id = allocateId(state, 'army');
    const formation = allocateId(state, 'formation');
    state.armies[id] = {
      id,
      owner: carthage,
      name: nameNewArmy(state, carthage),
      formations: [formation],
      stance: 'holdTheLine',
      generalSkill: 3,
      activity: {
        kind: 'idle',
        position: {
          x: (roma.position.x + capua.position.x) / 2,
          y: (roma.position.y + capua.position.y) / 2,
        },
      },
    };
    state.formations[formation] = {
      id: formation,
      army: id,
      troop: 'spearmen',
      men: 800,
      morale: 1,
    };
    return state;
  }

  it('at war, lets its own AI move its armies against an army in the field, where the answering Rome holds them at the warned city', () => {
    const start = withPrey(warnedTomorrow());
    const punic = Object.values(start.armies)
      .filter((a) => a.owner === carthage)
      .at(-1);
    const prey = punic?.activity.kind === 'idle' ? punic.activity.position : undefined;
    if (!prey) throw new Error('no prey');
    const moves = (fights: boolean) => {
      let count = 0;
      playCautiousRome(
        1,
        20 / 365,
        ({ before, accepted, answered }) => {
          if (before.day <= 101) return;
          // A march on the prey: to a point within 30 km of where it stands.
          count += accepted.filter(
            (o) =>
              !answered.includes(o) &&
              o.kind === 'moveArmy' &&
              Math.hypot(o.to.x - prey.x, o.to.y - prey.y) <= 30,
          ).length;
        },
        {
          peaceful: true,
          answer: true,
          follows: true,
          guards: 'enough',
          fights,
          start: structuredClone(start),
          orders: (orders, state) =>
            state.day === 101
              ? [{ kind: 'declareWar', faction: carthage, against: rome }, ...orders]
              : orders,
        },
      );
      return count;
    };
    expect(moves(false)).toBe(0);
    expect(moves(true)).toBeGreaterThan(0);
  });
});
