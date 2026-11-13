import { describe, expect, it } from 'vitest';
import { changeCityOwner } from '../sim/cities.ts';
import { buildFixture, FIXTURE, fixtureWorld } from '../sim/fixture.ts';
import type { CityId } from '../sim/ids.ts';
import { newGame } from '../sim/new-game.ts';
import { expectConsistent } from '../sim/references.ts';
import type { GameState } from '../sim/state/game-state.ts';
import { warKey, newWar } from '../sim/state/war.ts';
import { tick } from '../sim/tick.ts';
import { fateChoices } from './fates.ts';
import { turningPoints } from './turning-points.ts';

const world = fixtureWorld();
const f = FIXTURE;

/** Rome's army stands at Syracusae, at war with it, and the city has no garrison left. */
function syracusaeFalls(): GameState {
  const state = buildFixture();
  state.wars[warKey(f.rome, f.syracusaeFaction)] = newWar(f.rome, f.syracusaeFaction, state.day);
  const roman = state.armies[f.romanArmy];
  const syracusae = state.cities[f.syracusae];
  if (!roman || !syracusae) throw new Error('fixture changed');
  roman.activity = { kind: 'idle', position: { ...syracusae.position } };
  syracusae.garrison = 0;
  return state;
}

describe('turningPoints', () => {
  it('asks for the fate of a city the player takes, on the day it falls and not after', () => {
    const before = syracusaeFalls();
    const after = tick(before, [], world).state;
    expect(after.cities[f.syracusae]?.owner).toBe(f.rome);
    expect(turningPoints(before, after, world)).toEqual([{ kind: 'fate', city: f.syracusae }]);
    const later = tick(after, [], world).state;
    expect(turningPoints(after, later, world)).toEqual([]);
    expectConsistent(later);
  });

  it('tells of the loss with the last city and who took it', () => {
    const before = buildFixture();
    changeCityOwner(before, f.capua, f.carthage);
    const after = structuredClone(before);
    changeCityOwner(after, f.roma, f.carthage);
    expect(turningPoints(before, after, world)).toEqual([
      { kind: 'lost', on: before.day, city: f.roma, by: f.carthage },
    ]);
    expect(turningPoints(after, after, world)).toEqual([]);
    expectConsistent(after);
  });

  it('names no last city when several fell on the same day', () => {
    const before = buildFixture();
    const after = structuredClone(before);
    changeCityOwner(after, f.capua, f.syracusaeFaction);
    changeCityOwner(after, f.roma, f.carthage);
    expect(turningPoints(before, after, world)).toEqual([
      { kind: 'lost', on: before.day, city: undefined, by: undefined },
    ]);
    expectConsistent(after);
  });

  it('tells of the win on the day the rule is first met', () => {
    const before = newGame(world.map, { seed: 1, player: 'rome' });
    for (const id of ['carthago', 'alexandria'] as CityId[]) changeCityOwner(before, id, f.rome);
    const minors = Object.values(before.cities).filter((city) => city.rank === 'minorCity');
    for (const city of minors.slice(0, 25)) changeCityOwner(before, city.id, f.rome);
    const after = structuredClone(before);
    const next = minors[25];
    if (!next) throw new Error('the map has more minor cities');
    changeCityOwner(after, next.id, f.rome);
    expect(turningPoints(before, after, world)).toEqual([{ kind: 'won', on: after.day }]);
    expect(turningPoints(after, after, world)).toEqual([]);
    expectConsistent(after);
  });
});

describe('fateChoices', () => {
  it("gives each fate's gold, manpower, people, and unrest as its order would apply them", () => {
    const before = syracusaeFalls();
    const state = tick(before, [], world).state;
    const city = state.cities[f.syracusae];
    if (!city) throw new Error('no Syracusae');
    const untouched = structuredClone(state);
    const choices = fateChoices(state, world, f.syracusae);
    expect(state).toEqual(untouched);
    expect(choices.map((c) => c.kind)).toEqual(['occupy', 'sack', 'enslave']);
    for (const choice of choices) {
      const played = tick(state, choice.order ? [choice.order] : [], world).state;
      const had = state.factions[f.rome]?.stores;
      const has = played.factions[f.rome]?.stores;
      expect(choice.refusal).toBeUndefined();
      expect(played.cities[f.syracusae]?.population).toBeCloseTo(
        city.population - choice.peopleLost,
        -1,
      );
      if (choice.kind === 'occupy') {
        expect([choice.gold, choice.manpower, choice.peopleLost]).toEqual([0, 0, 0]);
      } else {
        expect(choice.peopleLost).toBeGreaterThan(0);
        expect(played.cities[f.syracusae]?.unrestDays).toBe(choice.unrestDays - 1);
      }
      if (choice.kind === 'sack') expect(choice.gold).toBeGreaterThan(0);
      if (choice.kind === 'enslave') {
        expect(choice.manpower).toBeGreaterThan(0);
        expect(choice.peopleMoved + choice.manpower).toBe(choice.peopleLost);
        expect(has && had && has.manpower - had.manpower).toBeGreaterThanOrEqual(choice.manpower);
      }
    }
  });

  it('gives the reason a fate is refused once no army of the player stands at the city', () => {
    const state = tick(syracusaeFalls(), [], world).state;
    const moved = structuredClone(state);
    const army = moved.armies[f.romanArmy];
    if (army) army.activity = { kind: 'idle', position: { x: 0, y: 0 } };
    const [, sack, enslave] = fateChoices(moved, world, f.syracusae);
    expect(sack?.refusal).toMatch(/no army of rome stands at syracusae/);
    expect(enslave?.refusal).toMatch(/no army of rome stands at syracusae/);
  });
});

it('an offer of peace to the player stops the game once, on the day it is made', () => {
  const state = buildFixture();
  state.wars[warKey(f.rome, f.carthage)] = newWar(f.carthage, f.rome, state.day);
  const terms = { kind: 'asThingsStand' } as const;
  const offered = tick(
    state,
    [{ kind: 'offerPeace', faction: f.carthage, to: f.rome, terms }],
    world,
  ).state;
  expect(turningPoints(state, offered, world)).toEqual([{ kind: 'peaceOffer', from: f.carthage }]);
  expect(turningPoints(offered, tick(offered, [], world).state, world)).toEqual([]);
  const own = tick(
    state,
    [{ kind: 'offerPeace', faction: f.rome, to: f.carthage, terms }],
    world,
  ).state;
  expect(turningPoints(state, own, world)).toEqual([]);
});
