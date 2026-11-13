import { defeatFaction } from '../sim/defeat.ts';
import { describe, expect, it } from 'vitest';
import { changeCityOwner } from '../sim/cities.ts';
import { buildFixture, FIXTURE as f, fixtureWorld } from '../sim/fixture.ts';
import type { ArmyId, BattleId, CityId, ConvoyId, FactionId, SiegeId } from '../sim/ids.ts';
import { newGame } from '../sim/new-game.ts';
import { executeOrder, type Order } from '../sim/orders/orders.ts';
import { sightOf } from '../sim/sight.ts';
import type { Day } from '../sim/state/day.ts';
import type { GameState } from '../sim/state/game-state.ts';
import { warKey } from '../sim/state/war.ts';
import { tick } from '../sim/tick.ts';
import {
  armiesAt,
  cityFoodText,
  sackText,
  storeNote,
  activityText,
  stormText,
  weakSiegeText,
  ordersWaitingText,
  overviewOf,
  rankText,
  shownBattles,
  stanceEffectText,
  whyNotBesieging,
} from './describe.ts';

const world = fixtureWorld();

function withBattle() {
  const state = buildFixture();
  const id = 'battle-9' as BattleId;
  state.battles[id] = {
    id,
    position: { x: 2516, y: 2340 },
    attackers: [f.punicArmy],
    defenders: [f.romanArmy],
    startedOn: 1 as Day,
    sides: { attackers: { factions: [], lost: 0 }, defenders: { factions: [], lost: 0 } },
  };
  return { state, id };
}

function atWar(state: GameState, a: FactionId, b: FactionId, since = state.day) {
  state.wars[warKey(a, b)] = { since };
}

function roman(state: GameState) {
  const army = state.armies[f.romanArmy];
  if (!army) throw new Error('fixture changed');
  return army;
}

/** Rome's army stands idle 3 km from Syracusae. */
function atSyracusae() {
  const state = buildFixture();
  const city = state.cities[f.syracusae];
  if (!city) throw new Error('fixture changed');
  roman(state).activity = {
    kind: 'idle',
    position: { x: city.position.x + 3, y: city.position.y },
  };
  return state;
}

function besiegesNextDay(state: GameState): boolean {
  return tick(state, [], world).state.armies[f.romanArmy]?.activity.kind === 'besieging';
}

describe('shownBattles', () => {
  it('shows the selected battle while it lasts', () => {
    const { state, id } = withBattle();
    expect(shownBattles(state, { kind: 'battle', battle: id }).map((b) => b.id)).toEqual([id]);
  });

  it("falls back to the player's battles once the selected one has ended", () => {
    const { state, id } = withBattle();
    const ended = 'battle-1' as BattleId;
    expect(shownBattles(state, { kind: 'battle', battle: ended }).map((b) => b.id)).toEqual([id]);
    expect(shownBattles(state, { kind: 'army', army: f.punicArmy }).map((b) => b.id)).toEqual([id]);
  });

  it('shows no battle when none of the player is fought and none is selected', () => {
    expect(shownBattles(buildFixture(), undefined)).toEqual([]);
  });
});

describe('stanceEffectText', () => {
  it('says what each stance does to the blows and the morale', () => {
    expect(stanceEffectText('holdTheLine')).toBe('Deals and takes normal blows');
    expect(stanceEffectText('allOutAssault')).toBe('Deals and takes 25% more');
    expect(stanceEffectText('skirmishAndWithdraw')).toBe('Deals and takes 25% less');
  });
});

describe('rankText', () => {
  const map = world.map;
  const game = () => newGame(map, { seed: 1, player: 'rome' });
  const city = (state: GameState, id: string) => {
    const found = state.cities[id as CityId];
    if (!found) throw new Error(`no city ${id}`);
    return found;
  };

  it("names a great power's own capital, its other cities, and a minor's city", () => {
    const state = game();
    expect(rankText(state, map, city(state, 'roma'))).toBe('Capital');
    expect(rankText(state, map, city(state, 'capua'))).toBe('City');
    expect(rankText(state, map, city(state, 'mediolanum'))).toBe('Independent city');
  });

  it('says whose a city was once another faction holds it', () => {
    const state = game();
    changeCityOwner(state, 'mediolanum' as CityId, f.rome);
    changeCityOwner(state, 'carthago' as CityId, f.rome);
    changeCityOwner(state, 'capua' as CityId, 'massalia' as FactionId);
    expect(rankText(state, map, city(state, 'mediolanum'))).toBe('City, taken from Mediolanum');
    expect(rankText(state, map, city(state, 'carthago'))).toBe('Capital of Carthage, held by Rome');
    expect(rankText(state, map, city(state, 'capua'))).toBe('Independent city, taken from Rome');
  });
});

describe('whyNotBesieging', () => {
  it('says the army is at peace with the city, and the rules leave the city alone', () => {
    const state = atSyracusae();
    expect(whyNotBesieging(state, roman(state), [])).toBe(
      'At peace with Syracusae. Declare war to besiege it.',
    );
    expect(besiegesNextDay(state)).toBe(false);
  });

  it('does not promise a siege with a declared war while the army is short of food', () => {
    const state = atSyracusae();
    const stores = state.factions[f.rome]?.stores;
    if (!stores) throw new Error('fixture changed');
    stores.food = -10;
    const declare: Order = { kind: 'declareWar', faction: f.rome, against: f.syracusaeFaction };
    expect(whyNotBesieging(state, roman(state), [declare])).toBe(
      'Short of food, so this army cannot besiege Syracusae.',
    );
    expect(tick(state, [declare], world).state.armies[f.romanArmy]?.activity.kind).toBe('idle');
  });

  it('says a declared war begins the siege with the next day, as the rules do', () => {
    const state = atSyracusae();
    const declare: Order = { kind: 'declareWar', faction: f.rome, against: f.syracusaeFaction };
    expect(whyNotBesieging(state, roman(state), [declare])).toBe(
      'War on Syracusae begins with the next day, and the siege with it.',
    );
    expect(tick(state, [declare], world).state.armies[f.romanArmy]?.activity.kind).toBe(
      'besieging',
    );
  });

  it('says the army is short of gold or food, and the rules leave the city alone', () => {
    const state = atSyracusae();
    atWar(state, f.rome, f.syracusaeFaction);
    const stores = state.factions[f.rome]?.stores;
    if (!stores) throw new Error('fixture changed');
    stores.gold = -1;
    expect(whyNotBesieging(state, roman(state), [])).toBe(
      'Short of gold, so this army cannot besiege Syracusae.',
    );
    expect(besiegesNextDay(state)).toBe(false);
    stores.food = -1;
    expect(whyNotBesieging(state, roman(state), [])).toBe(
      'Short of gold and food, so this army cannot besiege Syracusae.',
    );
  });

  it('says every formation is broken', () => {
    const state = atSyracusae();
    atWar(state, f.rome, f.syracusaeFaction);
    for (const id of roman(state).formations) {
      const formation = state.formations[id];
      if (formation) formation.morale = 0;
    }
    expect(whyNotBesieging(state, roman(state), [])).toBe(
      'Every formation is broken. The siege of Syracusae waits for morale.',
    );
  });

  it('says nothing for an army the rules set besieging, or one at no foreign city', () => {
    const state = atSyracusae();
    atWar(state, f.rome, f.syracusaeFaction);
    expect(whyNotBesieging(state, roman(state), [])).toBeUndefined();
    expect(besiegesNextDay(state)).toBe(true);
    const home = buildFixture();
    expect(whyNotBesieging(home, roman(home), [])).toBeUndefined();
  });
});

describe('ordersWaitingText', () => {
  const army = (id: string): Order => ({
    kind: 'setStance',
    faction: f.rome,
    army: id as ArmyId,
    stance: 'allOutAssault',
  });
  const recruit: Order = { kind: 'recruit', faction: f.rome, city: f.roma, troop: 'spearmen' };

  it('counts the armies that the waiting orders are for', () => {
    expect(ordersWaitingText([army('army-1'), army('army-1'), recruit], f.rome)).toEqual({
      short: '1 army',
      full: '1 army has orders for the next day',
    });
    expect(ordersWaitingText([army('army-1'), army('army-2')], f.rome)).toEqual({
      short: '2 armies',
      full: '2 armies have orders for the next day',
    });
  });

  it('says nothing when no waiting order is for one of your armies', () => {
    expect(ordersWaitingText([recruit], f.rome)).toBeUndefined();
    expect(ordersWaitingText([{ ...army('army-9'), faction: f.carthage }], f.rome)).toBeUndefined();
  });
});

describe('armiesAt', () => {
  it('lists the armies in sight at a place, yours first, and leaves out the ones out of sight', () => {
    const state = buildFixture();
    const roma = state.cities[f.roma]?.position;
    const punic = state.armies[f.punicArmy];
    if (!roma || !punic) throw new Error('fixture changed');
    const sight = sightOf(state, world, f.rome);
    expect(armiesAt(state, sight, roma).map((a) => a.id)).toEqual([f.romanArmy]);
    expect(armiesAt(state, sight, roma, f.romanArmy)).toEqual([]);

    punic.activity = { kind: 'idle', position: { x: roma.x - 4, y: roma.y } };
    const seen = sightOf(state, world, f.rome);
    expect(armiesAt(state, seen, roma).map((a) => a.id)).toEqual([f.romanArmy, f.punicArmy]);
    const blind = { ...seen, armies: new Set([f.romanArmy]) };
    expect(armiesAt(state, blind, roma).map((a) => a.id)).toEqual([f.romanArmy]);
  });
});

/** The overview of a realm that still stands. */
function standing(...args: Parameters<typeof overviewOf>) {
  const overview = overviewOf(...args);
  if (overview.kind !== 'standing') throw new Error('the realm has fallen');
  return overview;
}

describe('overviewOf', () => {
  it("lists the player's cities with their state, its armies, and its wars", () => {
    const state = buildFixture();
    atWar(state, f.rome, f.carthage, 4 as Day);
    const capua = state.cities[f.capua];
    const roma = state.cities[f.roma];
    if (!capua || !roma) throw new Error('fixture changed');
    capua.unrestDays = 30;
    roma.recruits = [
      { troop: 'spearmen', readyOn: 9 as Day },
      { troop: 'spearmen', readyOn: 9 as Day },
      { troop: 'archers', readyOn: 9 as Day },
    ];
    const overview = standing(state, sightOf(state, world, f.rome));
    expect(
      overview.cities.map(({ name, population, status }) => [name, population, status]),
    ).toEqual([
      ['Roma', 40_000, 'Training Spearmen ×2, Archers'],
      ['Capua', 18_000, 'In unrest for 30 more days'],
    ]);
    expect(overview.cities[0]?.pick).toEqual({ kind: 'province', province: f.latium });
    expect(overview.armies.map(({ activity, men }) => [activity, men])).toEqual([
      ['Idle at Roma', 1500],
    ]);
    expect(overview.wars.map(({ name, since }) => [name, since])).toEqual([['Carthage', 4]]);
  });

  it('names only the besiegers in sight, and puts an army at sea at its convoy', () => {
    const state = buildFixture();
    atWar(state, f.rome, f.carthage);
    const siege = 'siege-1' as SiegeId;
    const punic = state.armies[f.punicArmy];
    const capua = state.cities[f.capua];
    if (!punic || !capua) throw new Error('fixture changed');
    punic.activity = { kind: 'besieging', position: { ...capua.position }, siege };
    state.sieges[siege] = {
      id: siege,
      city: f.capua,
      besiegers: [f.punicArmy],
      startedOn: 3 as Day,
    };
    const convoy = 'convoy-1' as ConvoyId;
    const sea = { x: 2400, y: 2500 };
    state.convoys[convoy] = {
      id: convoy,
      owner: f.rome,
      position: sea,
      armies: [f.romanArmy],
      waypoints: [sea],
    };
    roman(state).activity = { kind: 'embarked', convoy };

    const sight = sightOf(state, world, f.rome);
    const capuaRow = (s: typeof sight) => standing(state, s).cities.find((c) => c.city === f.capua);
    expect(capuaRow(sight)?.status).toBe('Besieged by Carthage since day 3');
    expect(capuaRow({ ...sight, armies: new Set<ArmyId>() })?.status).toBe('Besieged since day 3');
    expect(standing(state, sight).armies[0]?.at).toEqual(sea);
  });

  it("lists the player's people on the road, with their route, and selects where they go", () => {
    const state = buildFixture();
    const next = tick(
      state,
      [{ kind: 'evacuate', faction: f.rome, city: f.roma, to: f.capua, share: 0.1 }],
      world,
    ).state;
    const rows = standing(next, sightOf(next, world, f.rome)).columns;
    expect(rows.map(({ people, route, pick }) => [people, route, pick])).toEqual([
      [4000, 'Roma to Capua', { kind: 'province', province: f.campania }],
    ]);
  });

  it('lists no war for a player at peace', () => {
    const state = buildFixture();
    expect(standing(state, sightOf(state, world, f.rome)).wars).toEqual([]);
  });

  it('lists nothing to do once the realm has fallen, and gives the day it fell', () => {
    const state = buildFixture();
    atWar(state, f.rome, f.carthage, 4 as Day);
    defeatFaction(state, f.rome);
    expect(overviewOf(state, sightOf(state, world, f.rome))).toEqual({
      kind: 'fallen',
      on: state.day,
    });
  });
});

describe('cityFoodText', () => {
  it("gives what a calm city grows and eats a day, and what that adds to its owner's food", () => {
    const state = buildFixture();
    const roma = state.cities[f.roma];
    if (!roma) throw new Error('fixture changed');
    roma.population = 10_000;
    roma.unrestDays = 0;
    expect(cityFoodText(state, roma)).toBe('Grows 6.0, eats 4.0 a day · +2.0');
  });

  it('grows less in unrest but eats as much', () => {
    const state = buildFixture();
    const roma = state.cities[f.roma];
    if (!roma) throw new Error('fixture changed');
    roma.population = 10_000;
    roma.unrestDays = 365;
    expect(cityFoodText(state, roma)).toBe('Grows 1.5, eats 4.0 a day · −2.5');
  });
});

describe('sackText', () => {
  it('tells for how many more days a sacked city yields half its gold, and nothing after', () => {
    const state = buildFixture();
    const roma = state.cities[f.roma];
    if (!roma) throw new Error('fixture changed');
    expect(sackText(state, roma)).toBeUndefined();
    roma.sackedOn = 1 as Day;
    state.day = 101 as Day;
    expect(sackText(state, roma)).toBe('Sacked on day 1: yields half its gold for 995 more days');
    state.day = (1 + 3 * 365) as Day;
    expect(sackText(state, roma)).toBeUndefined();
  });
});

describe('storeNote', () => {
  it('says how many days a falling store of gold or food lasts, and warns within two months', () => {
    expect(storeNote('gold', 1000, -5, undefined)).toMatchObject({
      text: '200 days left',
      why: "Runs out in 200 days at today's balance. Formations desert once it runs out.",
      bad: false,
    });
    expect(storeNote('food', 100, -5, 500)).toMatchObject({ text: '20 days left', bad: true });
    expect(storeNote('gold', 0, -5, undefined)).toMatchObject({
      text: 'Ran out',
      why: expect.stringMatching(/^Ran out: formations desert\./) as string,
      bad: true,
    });
  });

  it('says when food or manpower stops growing at its limit, and nothing below it', () => {
    expect(storeNote('food', 500, 5, 500)).toMatchObject({
      text: 'Full',
      why: expect.stringMatching(/^Granaries full\. /) as string,
      bad: false,
    });
    expect(storeNote('food', 95, 10, 100)).toMatchObject({
      text: 'Full tomorrow',
      why: expect.stringMatching(/^Granaries full tomorrow\. /) as string,
    });
    expect(storeNote('manpower', 299, 4, 300)).toMatchObject({
      text: 'At limit tomorrow',
      why: expect.stringMatching(/^At the call-up limit tomorrow\. /) as string,
    });
    expect(storeNote('manpower', 300, 1, 300)).toMatchObject({
      why: expect.stringMatching(/^At the call-up limit\. /) as string,
    });
    expect(storeNote('food', 400, 5, 500)).toBeUndefined();
    expect(storeNote('gold', 400, 5, undefined)).toBeUndefined();
  });
});

describe('weakSiegeText', () => {
  function siegeOfSyracusae(men: number) {
    const state = buildFixture();
    state.wars[warKey(f.rome, f.syracusaeFaction)] = { since: state.day };
    const roman = state.armies[f.romanArmy];
    const syracusae = state.cities[f.syracusae];
    if (!roman || !syracusae) throw new Error('fixture changed');
    roman.activity = { kind: 'idle', position: { ...syracusae.position } };
    for (const id of roman.formations) {
      const formation = state.formations[id];
      if (formation) formation.men = Math.round(men / roman.formations.length);
    }
    const next = tick(state, [], world).state;
    const siege = Object.values(next.sieges)[0];
    if (!siege) throw new Error('no siege began');
    return { state: next, siege };
  }

  it('tells a siege with fewer men than the garrison that it does not starve the city, and how many more it needs', () => {
    const { state, siege } = siegeOfSyracusae(600);
    const garrison = state.cities[f.syracusae]?.garrison ?? 0;
    const men = Object.values(state.formations)
      .filter((formation) => formation.army === f.romanArmy)
      .reduce((sum, formation) => sum + formation.men, 0);
    expect(weakSiegeText(state, sightOf(state, world, f.rome), siege)).toBe(
      `Too few to starve Syracusae: ${men.toLocaleString('en')} besiegers against a garrison of ${garrison.toLocaleString('en')}. The food does not fall, and sallies cut down besiegers each day. ${(garrison - men).toLocaleString('en')} more men would cut the food.`,
    );
  });

  it('says nothing of a siege strong enough to cut the food', () => {
    const { state, siege } = siegeOfSyracusae(3000);
    expect(weakSiegeText(state, sightOf(state, world, f.rome), siege)).toBeUndefined();
  });

  it('promises no storm while a field army of the city defends it, as the storm order refuses', () => {
    const { state, siege } = siegeOfSyracusae(6000);
    const copy = structuredClone(state) as GameState;
    const garrison = copy.armies[f.punicArmy];
    const syracusae = copy.cities[f.syracusae];
    if (!garrison || !syracusae) throw new Error('fixture changed');
    garrison.owner = f.syracusaeFaction;
    garrison.activity = { kind: 'idle', position: { ...syracusae.position } };
    expect(stormText(copy, siege)).toBe(
      'No storm while an army of Syracusae defends Syracusae in the field. Beat it first.',
    );
    expect(
      executeOrder(
        structuredClone(copy),
        { kind: 'storm', faction: f.rome, city: f.syracusae },
        world,
      ),
    ).toBeDefined();
  });

  it('gives the odds of a storm as often as storms played on many days take the city, and what one costs', () => {
    for (const men of [3000, 4500, 6000]) {
      const { state, siege } = siegeOfSyracusae(men);
      const text = stormText(state, siege) ?? '';
      const percent = /takes Syracusae (\d+) times in 100/.exec(text)?.[1];
      const cost = Number(/cost ([\d,]+) of your/.exec(text)?.[1]?.replace(/,/g, ''));
      const tries = 400;
      let taken = 0;
      let lost = 0;
      for (let i = 0; i < tries; i++) {
        const copy = structuredClone(state) as GameState;
        copy.rng = (i * 2654435761) >>> 0;
        const romans = () =>
          Object.values(copy.formations)
            .filter((formation) => formation.army === f.romanArmy)
            .reduce((sum, formation) => sum + formation.men, 0);
        const had = romans();
        executeOrder(copy, { kind: 'storm', faction: f.rome, city: f.syracusae }, world);
        const won = copy.cities[f.syracusae]?.owner === f.rome;
        if (won) taken += 1;
        // The winners leave men of their own as the new garrison, which the storm did not kill.
        lost += had - romans() - (won ? (copy.cities[f.syracusae]?.garrison ?? 0) : 0);
      }
      if (percent === undefined) {
        expect(text, `${men} men`).toMatch(/cannot take|for certain/);
        expect(taken === 0 || taken === tries, `${men} men`).toBe(true);
      } else {
        expect(taken / tries, `${men} men: ${text}`).toBeCloseTo(Number(percent) / 100, 1);
      }
      expect(lost / tries / cost, `${men} men`).toBeCloseTo(1, 1);
    }
  });
});

describe('activityText', () => {
  function retreatingTo(end: { x: number; y: number }) {
    const state = buildFixture();
    const roman = state.armies[f.romanArmy];
    const roma = state.cities[f.roma];
    if (!roman || !roma) throw new Error('fixture changed');
    const from = { x: end.x + 60, y: end.y };
    roman.activity = { kind: 'retreating', position: from, waypoints: [end] };
    return activityText(state, roman);
  }

  it('names the city of its own a retreat ends at', () => {
    const roma = buildFixture().cities[f.roma]?.position;
    if (!roma) throw new Error('fixture changed');
    expect(retreatingTo(roma)).toBe('Retreating to Roma · 3 days left');
  });

  it("says a retreat that ends in the field falls back into it, and names no enemy's city", () => {
    const carthago = buildFixture().cities[f.carthago]?.position;
    if (!carthago) throw new Error('fixture changed');
    expect(retreatingTo({ x: carthago.x, y: carthago.y + 30 })).toBe(
      'Falling back into the field · 3 days left',
    );
  });
});
