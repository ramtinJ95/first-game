import { describe, expect, it } from 'vitest';
import { buildFixture, FIXTURE } from '../sim/fixture.ts';
import type { ArmyId, ConvoyId } from '../sim/ids.ts';
import { drawnArmies } from './markers.ts';

function positionOf(state: ReturnType<typeof buildFixture>, army: ArmyId) {
  const activity = state.armies[army]?.activity;
  if (!activity || activity.kind === 'embarked') throw new Error(`fixture lacks ${army} on land`);
  return activity.position;
}

const start = positionOf(buildFixture(), FIXTURE.romanArmy);
const end = { x: start.x + 100, y: start.y + 100 };

function marched() {
  const previous = buildFixture();
  const current = buildFixture();
  const roman = current.armies[FIXTURE.romanArmy];
  if (!roman) throw new Error('fixture lacks the Roman army');
  roman.activity = { kind: 'idle', position: end };
  return { previous, current };
}

const romanAt = (armies: ReturnType<typeof drawnArmies>) =>
  armies.find((army) => army.id === FIXTURE.romanArmy)?.position;

describe('drawnArmies', () => {
  it('draws an army that moved between two days part of the way, by the progress through the day', () => {
    const { previous, current } = marched();
    const at = (progress: number) => romanAt(drawnArmies(previous, current, progress));
    expect(at(0)).toEqual(start);
    expect(at(0.25)?.x).toBeCloseTo(start.x + 25);
    expect(at(0.25)?.y).toBeCloseTo(start.y + 25);
    expect(at(0.5)?.x).toBeCloseTo(start.x + 50);
    expect(at(0.5)?.y).toBeCloseTo(start.y + 50);
    expect(at(1)).toEqual(end);
  });

  it('draws an army that stood still at its place, with its owner', () => {
    const state = buildFixture();
    expect(drawnArmies(state, state, 0.7)).toContainEqual({
      id: FIXTURE.punicArmy,
      owner: FIXTURE.carthage,
      position: positionOf(state, FIXTURE.punicArmy),
    });
  });

  it('draws an army new today at its current place, and an army at sea at its convoy', () => {
    const { previous, current } = marched();
    previous.armies = Object.fromEntries(
      Object.entries(previous.armies).filter(([id]) => id !== FIXTURE.romanArmy),
    );
    const punic = current.armies[FIXTURE.punicArmy];
    if (!punic) throw new Error('fixture lacks the Punic army');
    const convoy = 'convoy-1' as ConvoyId;
    punic.activity = { kind: 'embarked', convoy };
    current.convoys[convoy] = {
      id: convoy,
      owner: FIXTURE.carthage,
      position: { x: 2300, y: 2800 },
      armies: [FIXTURE.punicArmy],
      waypoints: [{ x: 2400, y: 2700 }],
    };
    const drawn = drawnArmies(previous, current, 0.5);
    expect(romanAt(drawn)).toEqual(end);
    const punicAt = drawn.find((army) => army.id === FIXTURE.punicArmy)?.position;
    const ashore = positionOf(previous, FIXTURE.punicArmy);
    expect(punicAt).toEqual({ x: (ashore.x + 2300) / 2, y: (ashore.y + 2800) / 2 });
  });
});
