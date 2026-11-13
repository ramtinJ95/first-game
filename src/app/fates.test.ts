import { describe, expect, it } from 'vitest';
import { changeCityOwner } from '../sim/cities.ts';
import { buildFixture, FIXTURE as f, fixtureWorld } from '../sim/fixture.ts';
import mapData from '../../data/map/map.json' with { type: 'json' };
import type { CityId, FactionId } from '../sim/ids.ts';
import { parseMap } from '../sim/map.ts';
import { newGame } from '../sim/new-game.ts';
import { expectConsistent } from '../sim/references.ts';
import type { GameState } from '../sim/state/game-state.ts';
import { warKey } from '../sim/state/war.ts';
import { tick } from '../sim/tick.ts';
import { buildWorld } from '../sim/world/world.ts';
import { cityBalance } from '../ui/describe.ts';
import { dailyText, fateChoices, type FateChoice } from './fates.ts';

const map = parseMap(mapData);
const world = buildWorld(map);
const rome = 'rome' as FactionId;
const mediolanum = 'mediolanum' as CityId;

/** The tester's game: Rome's army stands at Mediolanum, whose garrison is gone, and takes it the next day. */
function mediolanumFalls(): GameState {
  const state = newGame(map, { seed: 1, player: 'rome' });
  const city = state.cities[mediolanum];
  const army = Object.values(state.armies).find((a) => a.owner === rome);
  if (!city || !army) throw new Error('the new game changed');
  state.wars[warKey(rome, city.owner)] = { since: state.day };
  army.activity = { kind: 'idle', position: { ...city.position } };
  city.garrison = 0;
  city.foodDays = 0;
  return tick(state, [], world).state;
}

function play(state: GameState, choice: FateChoice, days: number): GameState {
  let current = tick(state, choice.order ? [choice.order] : [], world).state;
  for (let i = 1; i < days; i++) current = tick(current, [], world).state;
  return current;
}

function yieldOf(state: GameState) {
  const city = state.cities[mediolanum];
  if (!city) throw new Error('no Mediolanum');
  return cityBalance(state, city);
}

describe('fateChoices', () => {
  it("gives each fate's yield in unrest and once calm, as the city yields them through the days", () => {
    const fallen = mediolanumFalls();
    expect(fallen.cities[mediolanum]?.owner).toBe(rome);
    const [occupy, sack, enslave] = fateChoices(fallen, world, mediolanum);
    if (!occupy || !sack || !enslave) throw new Error('three fates');

    expect(occupy.unrestDays).toBe(fallen.cities[mediolanum]?.unrestDays);
    expect(occupy.calm.gold).toBeGreaterThan(occupy.unrest.gold * 2);
    expect(occupy.calm.food).toBeGreaterThan(occupy.unrest.food);

    for (const choice of [occupy, sack, enslave]) {
      const nextDay = yieldOf(play(fallen, choice, 1));
      expect(nextDay.gold).toBeCloseTo(choice.unrest.gold, 1);
      expect(nextDay.food).toBeCloseTo(choice.unrest.food, 0);
    }

    const hundredDaysOn = play(fallen, occupy, 100);
    expect(hundredDaysOn.cities[mediolanum]?.unrestDays).toBe(0);
    const calm = yieldOf(hundredDaysOn);
    expect(occupy.calm.gold).toBeCloseTo(calm.gold, 0);
    expect(Math.abs(occupy.calm.food - calm.food)).toBeLessThan(0.1 * Math.abs(calm.food) + 0.5);
    expect(Math.abs(occupy.calm.manpower - calm.manpower)).toBeLessThan(0.1 * calm.manpower);

    for (const choice of [sack, enslave]) {
      const after = play(fallen, choice, choice.unrestDays + 1);
      expect(after.cities[mediolanum]?.unrestDays).toBe(0);
      const real = yieldOf(after);
      expect(Math.abs(choice.calm.gold - real.gold)).toBeLessThan(0.1 * real.gold);
      expect(Math.abs(choice.calm.food - real.food)).toBeLessThan(0.1 * Math.abs(real.food) + 0.5);
      expectConsistent(after);
    }
    expect(sack.calm.gold).toBeLessThan(occupy.calm.gold);
    expectConsistent(hundredDaysOn);
  });

  it('writes a day of yield with its sign', () => {
    expect(dailyText({ gold: 2.14, food: -0.4, manpower: 120 })).toBe(
      '+2.1 gold, −0.4 food, +120 manpower',
    );
  });
});

/** Carthago fell to Rome today with a Forum and Towers, and Rome's army stands at it. */
function carthagoFallen() {
  const state = buildFixture();
  const carthago = state.cities[f.carthago];
  const army = state.armies[f.romanArmy];
  if (!carthago || !army) throw new Error('no Carthago or no Roman army');
  carthago.buildings = ['forum', 'towers'];
  changeCityOwner(state, f.carthago, f.rome);
  carthago.fellOn = state.day;
  army.activity = { kind: 'idle', position: { ...carthago.position } };
  return state;
}

describe('fateChoices and buildings', () => {
  it('says that occupying and enslaving keep the buildings, and that a sack destroys them', () => {
    const choices = fateChoices(carthagoFallen(), fixtureWorld(), f.carthago);
    const byKind = Object.fromEntries(choices.map((choice) => [choice.kind, choice]));
    expect(byKind['occupy']).toMatchObject({
      buildingsKept: ['forum', 'towers'],
      buildingsLost: [],
    });
    expect(byKind['enslave']).toMatchObject({
      buildingsKept: ['forum', 'towers'],
      buildingsLost: [],
    });
    expect(byKind['sack']).toMatchObject({ buildingsKept: [], buildingsLost: ['forum', 'towers'] });
  });
});
