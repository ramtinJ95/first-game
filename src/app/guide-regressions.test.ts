import { describe, expect, it } from 'vitest';
import { buildFixture, FIXTURE as f, fixtureWorld } from '../sim/fixture.ts';
import type { ArmyId, CityId, FormationId, SiegeId } from '../sim/ids.ts';
import { newGame } from '../sim/new-game.ts';
import { moveArmy } from '../sim/orders/move-army.ts';
import type { MoveArmyOrder } from '../sim/orders/move-army.ts';
import { sightOf } from '../sim/sight.ts';
import type { Day } from '../sim/state/day.ts';
import { newWar, warKey } from '../sim/state/war.ts';
import { tick } from '../sim/tick.ts';
import { alertsOfDay, sightingsOfDay } from './alerts.ts';
import { planCommand, route } from './command.ts';
import { minorText, sackText } from '../ui/describe.ts';
import { cityBuildings } from '../ui/buildings-text.ts';
import { dailyBalances, limitsOf } from '../sim/systems/economy.ts';
import { parsePage } from './page.ts';
const world = fixtureWorld();
describe('guide and text regressions', () => {
  it('tells an arrival after a marching army is redirected to Roma within the day, not a halt or battle', () => {
    const before = buildFixture();
    const army = required(before.armies[f.romanArmy]);
    const roma = required(before.cities[f.roma]);
    army.activity = {
      kind: 'marching',
      position: { x: roma.position.x + 20, y: roma.position.y },
      waypoints: [required(before.cities[f.capua]).position],
    };
    const after = tick(
      before,
      [{ kind: 'moveArmy', faction: f.rome, army: army.id, to: roma.position }],
      world,
    );
    expect(after.rejected).toEqual([]);
    expect(
      alertsOfDay(before, after.state, after.events)
        .filter((a) => a.kind === 'armyArrived')
        .map((a) => a.text),
    ).toEqual(['First Legion arrived at Roma']);
    const halted = tick(before, [{ kind: 'halt', faction: f.rome, army: army.id }], world);
    expect(
      alertsOfDay(before, halted.state, halted.events).filter((a) => a.kind === 'armyArrived'),
    ).toEqual([]);
  });
  it('agrees the siege verb with multiple armies or multiple owners', () => {
    const before = buildFixture();
    const after = structuredClone(before);
    const second = 'army-second' as ArmyId;
    after.armies[second] = {
      ...required(after.armies[f.romanArmy]),
      id: second,
      name: 'Second Legion',
      formations: [],
    };
    const id = 'siege-test' as SiegeId;
    after.sieges[id] = {
      id,
      city: f.syracusae,
      besiegers: [f.romanArmy, second],
      startedOn: after.day,
    };
    expect(alertsOfDay(before, after, []).find((a) => a.kind === 'siegeBegan')?.text).toBe(
      'First Legion and Second Legion besiege Syracusae',
    );
    required(after.cities[f.syracusae]).owner = f.rome;
    required(after.armies[f.romanArmy]).owner = f.carthage;
    required(after.armies[second]).owner = f.syracusaeFaction;
    expect(alertsOfDay(before, after, []).find((a) => a.kind === 'siegeBegan')?.text).toBe(
      'Carthage and Syracusae besiege Syracusae',
    );
  });
  it('formats a sack beyond year one through dateText', () => {
    const state = buildFixture();
    const city = required(state.cities[f.roma]);
    state.day = 1250 as Day;
    city.sackedOn = 1242 as Day;
    expect(sackText(state, city)).toMatch(/^Sacked in Year 4, day 147:/);
  });
  it('labels a standing-army minor and stops promising a conquered league partner', () => {
    const state = buildFixture();
    const city = required(state.cities[f.syracusae]);
    const minor = required(state.factions[city.owner]);
    expect(minorText(state, sightOf(state, world, f.rome), city)).toBe(
      'Unleagued city: standard walls',
    );
    minor.league = f.carthage;
    required(state.factions[f.carthage]).kind = 'minor';
    expect(minorText(state, sightOf(state, world, f.rome), city)).toContain(
      'Leagued with Carthage',
    );
    required(state.cities[f.carthago]).owner = f.rome;
    expect(minorText(state, sightOf(state, world, f.rome), city)).toBe(
      'Leagued city: its partner is no longer independent',
    );
  });

  it('does not invent a standing army for an unpaired league or an army outside sight', () => {
    const state = newGame(world.map, { seed: 1, player: 'rome' });
    const babylon = required(state.cities['babylon' as CityId]);
    expect(minorText(state, sightOf(state, world, state.player), babylon)).toBe(
      'Unleagued city: standard walls',
    );
    const fixture = buildFixture();
    const city = required(fixture.cities[f.syracusae]);
    const army = required(fixture.armies[f.punicArmy]);
    army.owner = city.owner;
    army.activity = { kind: 'idle', position: city.position };
    const sight = sightOf(fixture, world, f.rome);
    expect(minorText(fixture, { ...sight, armies: new Set() }, city)).toBe(
      'Unleagued city: standard walls',
    );
    expect(minorText(fixture, { ...sight, armies: new Set([army.id]) }, city)).toBe(
      'Standing-army city. Keeps an army of 1,500 men at the city',
    );
  });
  it('warns for wasted food and a temple with no unrest, without refusing either order', () => {
    const state = buildFixture();
    required(state.factions[f.rome]).stores.gold = 30000;
    required(state.factions[f.rome]).stores.food = required(limitsOf(state).get(f.rome)).food;
    const city = required(state.cities[f.roma]);
    const options = () => cityBuildings(state, [], city).options;
    expect(options().find((o) => o.kind === 'canals')).toMatchObject({
      caution: 'Food full: the extra daily gain would be lost now.',
      why: undefined,
    });
    expect(options().find((o) => o.kind === 'temple')).toMatchObject({
      caution: 'No city whose unrest this would hasten is in unrest now.',
      why: undefined,
    });
    required(state.factions[f.rome]).stores.manpower = required(
      limitsOf(state).get(f.rome),
    ).manpower;
    expect(options().find((o) => o.kind === 'barracks')?.caution).toBeUndefined();
    required(state.cities[f.capua]).unrestDays = 40;
    expect(options().find((o) => o.kind === 'temple')?.caution).toBeUndefined();
    for (const formation of Object.values(state.formations))
      if (state.armies[formation.army]?.owner === f.rome) formation.men = 50000;
    expect(required(dailyBalances(state).get(f.rome)).food).toBeLessThan(0);
    required(state.factions[f.rome]).stores.food = required(limitsOf(state).get(f.rome)).food;
    expect(options().find((o) => o.kind === 'canals')?.caution).toBeUndefined();
  });
  it('counts another march and its arrival gap, including queued redirection and halt', () => {
    const state = buildFixture();
    const city = required(state.cities[f.capua]);
    city.owner = f.carthage;
    state.wars[warKey(f.rome, f.carthage)] = newWar(f.rome, f.carthage, state.day);
    const army = required(state.armies[f.romanArmy]);
    for (const id of army.formations) required(state.formations[id]).men = 400;
    const second = 'army-second' as ArmyId;
    const formation = 'formation-second' as FormationId;
    state.formations[formation] = {
      ...required(state.formations[f.hastati]),
      id: formation,
      army: second,
      men: 900,
    };
    state.armies[second] = {
      ...army,
      id: second,
      name: 'Second Legion',
      formations: [formation],
      activity: {
        kind: 'marching',
        position: { x: city.position.x, y: city.position.y - 500 },
        waypoints: [city.position],
      },
    };
    const target = { kind: 'city', city } as const;
    const planned = planCommand(state, world, army, target);
    expect(planned.notice).toContain('Second Legion (900 men) arrives in 20 days');
    expect(planned.notice).toMatch(/First Legion stands alone for \d+ days/);
    expect(planned.notice).toContain(
      '1,700 men are committed, enough to hold the siege before losses',
    );
    const halted = planCommand(state, world, army, target, [
      { kind: 'halt', faction: f.rome, army: second },
    ]);
    expect(halted.notice).not.toContain('Second Legion');
    expect(halted.notice).toContain('more men would hold the siege');
    const waiting = required(state.armies[second]);
    waiting.activity = { kind: 'idle', position: required(state.cities[f.roma]).position };
    const queued = planCommand(state, world, army, target, [
      { kind: 'moveArmy', faction: f.rome, army: second, to: city.position },
    ]);
    expect(queued.notice).toContain('Second Legion (900 men) arrives');
    expect(queued.notice).not.toContain('stands alone');
  });

  it('times the march actually issued, not a faster sea route that was not chosen', () => {
    const state = newGame(world.map, { seed: 1, player: 'rome' });
    const army = required(Object.values(state.armies).find((a) => a.owner === state.player));
    const arretium = required(state.cities['arretium' as CityId]).position;
    army.activity = { kind: 'idle', position: arretium };
    const city = required(state.cities['epidamnos' as CityId]);
    state.wars[warKey(state.player, city.owner)] = newWar(state.player, city.owner, state.day);
    const second = 'army-same-road' as ArmyId;
    state.armies[second] = {
      ...army,
      id: second,
      name: 'Second Legion',
      formations: [],
      activity: { kind: 'idle', position: arretium },
    };
    const rejected = moveArmy(
      state,
      { kind: 'moveArmy', faction: state.player, army: second, to: city.position },
      world,
    );
    expect(rejected).toBeUndefined();
    const planned = planCommand(state, world, army, { kind: 'city', city });
    expect(planned.kind).toBe('issue');
    if (planned.kind !== 'issue' || planned.order.kind !== 'moveArmy')
      throw new Error('not a march');
    const actual = route(state, world, planned.order as MoveArmyOrder);
    if (typeof actual === 'string') throw new Error(actual);
    expect(planned.notice).toContain(`First Legion (1,500 men) arrives in ${actual.days} days`);
    expect(planned.notice).not.toContain('stands alone');
  });
  it('does not retell fog flicker or losses, but tells growth and a changed target even in continuous sight', () => {
    const before = buildFixture();
    before.wars[warKey(f.rome, f.carthage)] = newWar(f.rome, f.carthage, before.day);
    const after = structuredClone(before);
    const roma = required(after.cities[f.roma]).position;
    required(after.armies[f.punicArmy]).activity = {
      kind: 'marching',
      position: { x: roma.x, y: roma.y + 100 },
      waypoints: [roma],
    };
    const saw = sightOf(before, world, f.rome);
    const sees = sightOf(after, world, f.rome);
    const told = new Set<string>();
    const news = (visibleBefore = saw) =>
      sightingsOfDay(before, after, visibleBefore, sees, world, told);
    expect(news()).toHaveLength(1);
    expect(news()).toEqual([]);
    const loaded = parsePage({ chronicle: [], occupied: [], told: [...told], weakSieges: [] });
    if (!loaded.ok || !loaded.page) throw new Error('page did not load');
    expect(sightingsOfDay(before, after, saw, sees, world, new Set(loaded.page.told))).toEqual([]);
    required(after.formations[f.citizenSpears]).men -= 10;
    expect(news()).toEqual([]);
    required(after.formations[f.citizenSpears]).men += 20;
    expect(news(sees)).toHaveLength(1);
    const activity = required(after.armies[f.punicArmy]).activity;
    if (activity.kind !== 'marching') throw new Error('not marching');
    activity.waypoints = [required(after.cities[f.capua]).position];
    expect(news(sees)).toHaveLength(1);
    expect(news(sees)).toEqual([]);
  });
});

function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error('fixture missing value');
  return value;
}
