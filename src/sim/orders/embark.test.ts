import { describe, expect, it } from 'vitest';
import { changeCityOwner } from '../cities.ts';
import type { DayEvent } from '../events.ts';
import { buildFixture, FIXTURE, fixtureWorld } from '../fixture.ts';
import type { CityId } from '../ids.ts';
import { expectConsistent } from '../references.ts';
import type { GameState } from '../state/game-state.ts';
import type { MapPoint } from '../state/map-point.ts';
import { newWar, warKey } from '../state/war.ts';
import { SIEGE_DISTANCE } from '../systems/sieges.ts';
import { tick } from '../tick.ts';
import { distance, locate } from '../world/find-path.ts';
import { nearestSea } from '../world/world.ts';
import { embarkationAt, GATHER_DAYS, type EmbarkOrder } from './embark.ts';

const world = fixtureWorld();
const f = FIXTURE;

const inAfrica = { x: 2215, y: 2885 };
const farInAfrica = { x: 2120, y: 2860 };

function romans(state: GameState) {
  const army = state.armies[f.romanArmy];
  if (!army) throw new Error('no Roman army');
  return army;
}

function cityAt(state: GameState, id: CityId): MapPoint {
  const city = state.cities[id];
  if (!city) throw new Error(`no city ${id}`);
  return city.position;
}

/** The point of the Mediterranean nearest the point. */
function shoreNear(at: MapPoint): MapPoint {
  const harbour = world.harbours.get(f.syracusae);
  const sea = harbour && world.mesh.component[locate(world.mesh, harbour, 'sea')];
  const shore = sea === undefined ? undefined : nearestSea(world.mesh, at, sea);
  if (!shore) throw new Error('no shore');
  return { x: shore.x, y: shore.y };
}

function standAt(state: GameState, at: MapPoint) {
  romans(state).activity = { kind: 'idle', position: { ...at } };
}

function atWar(state: GameState, other: typeof f.carthage) {
  state.wars[warKey(f.rome, other)] = newWar(f.rome, other, state.day);
}

const sail = (to: CityId, from: MapPoint): EmbarkOrder => ({
  kind: 'embark',
  faction: f.rome,
  army: f.romanArmy,
  to,
  from,
});

/**
 * Plays the order and then days without orders until the Romans stand still, and tells
 * the day they reached the shore, the day their ships sailed, and the news of every day.
 */
function playOut(state: GameState, order: EmbarkOrder, between?: (state: GameState) => void) {
  const first = tick(state, [order], world);
  expect(first.rejected).toEqual([]);
  let current = first.state;
  const events: DayEvent[] = [...first.events];
  let ashore: number | undefined;
  let sailed: number | undefined;
  for (let day = 1; day < 200; day++) {
    const { activity } = romans(current);
    if (activity.kind === 'embarked') {
      ashore ??= day;
      const convoy = current.convoys[activity.convoy];
      if (sailed === undefined && convoy && (convoy.departsOn ?? 0) <= current.day) sailed = day;
    } else if (activity.kind !== 'marching') {
      expectConsistent(current);
      return { state: current, days: day, ashore, sailed, events };
    }
    between?.(current);
    const next = tick(current, [], world);
    current = next.state;
    events.push(...next.events);
  }
  throw new Error('the Romans never stood still');
}

describe('an order to march to a shore and sail from it', () => {
  it('gathers ships at the shore by a foreign port at peace, sails, and besieges the city at war it sails for, in the days of each leg', () => {
    const state = buildFixture();
    atWar(state, f.syracusaeFaction);
    standAt(state, inAfrica);
    const shore = shoreNear(inAfrica);
    expect(embarkationAt(state, world, f.rome, inAfrica, shore)).toBeUndefined();

    const { state: after, days, ashore, sailed } = playOut(state, sail(f.syracusae, shore));

    expect(ashore).toBe(1);
    expect(sailed).toBe(1 + GATHER_DAYS);
    expect(days).toBeGreaterThan(1 + GATHER_DAYS);
    const { activity } = romans(after);
    const siege = activity.kind === 'besieging' ? after.sieges[activity.siege] : undefined;
    expect(siege?.city).toBe(f.syracusae);
  });

  it('gathers ships at a shore near a city that is no port, and stands at the port at peace it sails for', () => {
    const state = buildFixture();
    changeCityOwner(state, f.roma, f.carthage);
    const capua = cityAt(state, f.capua);
    standAt(state, capua);

    const { state: after, sailed } = playOut(state, sail(f.carthago, shoreNear(capua)));

    expect(sailed).toBeGreaterThan(GATHER_DAYS);
    const { activity } = romans(after);
    expect(activity.kind).toBe('idle');
    if (activity.kind !== 'idle') return;
    expect(distance(activity.position, cityAt(after, f.carthago))).toBeLessThanOrEqual(
      SIEGE_DISTANCE,
    );
    expect(Object.keys(after.sieges)).toEqual([]);
  });

  it('gathers ships on a shore in the realm of a power at war with it, and lands at a port of its own', () => {
    const state = buildFixture();
    atWar(state, f.carthage);
    standAt(state, farInAfrica);

    const { state: after, sailed } = playOut(state, sail(f.roma, shoreNear(farInAfrica)));

    expect(sailed).toBeGreaterThan(GATHER_DAYS);
    const { activity } = romans(after);
    expect(activity.kind).toBe('idle');
    if (activity.kind !== 'idle') return;
    expect(distance(activity.position, cityAt(after, f.roma))).toBeLessThanOrEqual(SIEGE_DISTANCE);
  });

  it('sails from a port of its own the day after it arrives there, with no ships to gather', () => {
    const state = buildFixture();
    standAt(state, { x: 2600, y: 2400 });

    const { ashore, sailed } = playOut(state, sail(f.syracusae, cityAt(state, f.roma)));

    expect(ashore).toBeGreaterThan(1);
    expect(sailed).toBe(ashore);
  });

  it('stands idle with news of why when the port it marched to has changed hands and no shore is near', () => {
    const state = buildFixture();
    standAt(state, { x: 2600, y: 2400 });
    const lose = (current: GameState) => {
      if (current.cities[f.roma]?.owner === f.rome) changeCityOwner(current, f.roma, f.carthage);
    };

    const { state: after, events } = playOut(state, sail(f.syracusae, cityAt(state, f.roma)), lose);

    expect(romans(after).activity).toMatchObject({ kind: 'idle' });
    expect(events).toContainEqual(
      expect.objectContaining({
        kind: 'sailingRefused',
        army: f.romanArmy,
        owner: f.rome,
        to: f.syracusae,
        reason: expect.stringContaining('on no shore'),
      }),
    );
  });

  it('is refused at once, and the army stays, when the point it would sail from is on no shore', () => {
    const state = buildFixture();
    const { rejected, state: after } = tick(
      state,
      [sail(f.syracusae, { x: 2560, y: 2330 })],
      world,
    );
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toMatch(/on no shore of the sea to Syracusae/);
    expect(romans(after).activity).toEqual(romans(state).activity);
    expectConsistent(after);
  });
});
