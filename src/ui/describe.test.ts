import { describe, expect, it } from 'vitest';
import { changeCityOwner } from '../sim/cities.ts';
import { buildFixture, FIXTURE as f, fixtureWorld } from '../sim/fixture.ts';
import type { ArmyId, BattleId, CityId, ConvoyId, FactionId, SiegeId } from '../sim/ids.ts';
import { newGame } from '../sim/new-game.ts';
import type { Order } from '../sim/orders/orders.ts';
import { sightOf } from '../sim/sight.ts';
import type { Day } from '../sim/state/day.ts';
import type { GameState } from '../sim/state/game-state.ts';
import { warKey } from '../sim/state/war.ts';
import { tick } from '../sim/tick.ts';
import {
  armiesAt,
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
    expect(stanceEffectText('allOutAssault')).toBe('Deals 50% more, takes 40% more');
    expect(stanceEffectText('skirmishAndWithdraw')).toBe(
      'Deals and takes 40% less, morale falls 2.5 times as fast',
    );
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
    expect(ordersWaitingText([army('army-1'), army('army-1'), recruit], f.rome)).toBe(
      '1 army has orders for the next day',
    );
    expect(ordersWaitingText([army('army-1'), army('army-2')], f.rome)).toBe(
      '2 armies have orders for the next day',
    );
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
    const overview = overviewOf(state, sightOf(state, world, f.rome));
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
    const capuaRow = (s: typeof sight) =>
      overviewOf(state, s).cities.find((c) => c.city === f.capua);
    expect(capuaRow(sight)?.status).toBe('Besieged by Carthage since day 3');
    expect(capuaRow({ ...sight, armies: new Set<ArmyId>() })?.status).toBe('Besieged since day 3');
    expect(overviewOf(state, sight).armies[0]?.at).toEqual(sea);
  });

  it('lists no war for a player at peace', () => {
    const state = buildFixture();
    expect(overviewOf(state, sightOf(state, world, f.rome)).wars).toEqual([]);
  });
});
