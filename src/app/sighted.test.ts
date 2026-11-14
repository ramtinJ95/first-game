import { describe, expect, it } from 'vitest';
import { buildFixture, FIXTURE, fixtureWorld } from '../sim/fixture.ts';
import type { ArmyId, FormationId } from '../sim/ids.ts';
import { tick } from '../sim/tick.ts';
import type { FactionId } from '../sim/ids.ts';
import { newGame } from '../sim/new-game.ts';
import { sightOf } from '../sim/sight.ts';
import type { Day } from '../sim/state/day.ts';
import type { Alert } from './alerts.ts';
import { alertsInSight, followJoin, seesPick, sightOfAll } from './sighted.ts';

const world = fixtureWorld();
const state = newGame(world.map, { seed: 1, player: 'rome' });
const sight = sightOf(state, world, 'rome' as FactionId);
const roman = Object.values(state.armies).find((a) => a.owner === 'rome');
const persian = Object.values(state.armies).find((a) => a.owner === 'persia');
if (!roman || !persian || persian.activity.kind === 'embarked') throw new Error('starting armies');
const roma = state.cities['roma' as never];
if (!roma) throw new Error('no Roma');

function alert(focus: Alert['focus']): Alert {
  return {
    kind: 'battleEnded',
    day: 1 as Day,
    text: 'news',
    tone: 'neutral',
    ...(focus && { focus }),
  };
}

describe('seesPick', () => {
  it('sees provinces always, its own army, and no hidden army', () => {
    expect(seesPick(sight, { kind: 'province', province: roma.province })).toBe(true);
    expect(seesPick(sight, { kind: 'army', army: roman.id })).toBe(true);
    expect(seesPick(sight, { kind: 'army', army: persian.id })).toBe(false);
    expect(seesPick(sight, undefined)).toBe(true);
  });
});

describe('alertsInSight', () => {
  it('drops an alert about a hidden army or a hidden place and keeps the rest', () => {
    const at = persian.activity.kind === 'embarked' ? roma.position : persian.activity.position;
    const kept = alertsInSight(
      [
        alert({ at, select: { kind: 'army', army: persian.id } }),
        alert({ at }),
        alert({ at: roma.position, select: { kind: 'army', army: roman.id } }),
        alert({ at: roma.position }),
        alert(undefined),
      ],
      sight,
      sight,
    );
    expect(kept).toHaveLength(3);
    expect(kept.every((a) => a.focus?.at !== at)).toBe(true);
  });
});

describe('sightOfAll', () => {
  it('sees every army, battle, and place, as a defeated player watching on does', () => {
    const all = sightOfAll(state);
    expect(seesPick(all, { kind: 'army', army: persian.id })).toBe(true);
    expect(all.armies.size).toBe(Object.keys(state.armies).length);
    expect(
      all.sees(persian.activity.kind === 'embarked' ? roma.position : persian.activity.position),
    ).toBe(true);
    expect(all.sees({ x: 0, y: 0 })).toBe(true);
  });
});

describe('followJoin', () => {
  it('picks the army that a picked army joined, and keeps every other pick', () => {
    const before = buildFixture();
    const roma = before.cities[FIXTURE.roma];
    const first = before.armies[FIXTURE.romanArmy];
    if (!roma || !first) throw new Error('fixture changed');
    first.activity = { kind: 'idle', position: { ...roma.position } };
    const id = 'army-roman-2' as ArmyId;
    const formation = 'formation-roman-2' as FormationId;
    before.formations[formation] = {
      id: formation,
      army: id,
      troop: 'archers',
      men: 300,
      morale: 1,
    };
    before.armies[id] = { ...first, id, name: 'Second Legion', formations: [formation] };
    const { state: after, rejected } = tick(
      before,
      [{ kind: 'joinArmy', faction: FIXTURE.rome, army: id, into: FIXTURE.romanArmy }],
      world,
    );
    expect(rejected).toEqual([]);
    expect(followJoin(before, after, { kind: 'army', army: id })).toEqual({
      kind: 'army',
      army: FIXTURE.romanArmy,
    });
    const province = { kind: 'province', province: roma.province } as const;
    expect(followJoin(before, after, province)).toBe(province);
    expect(followJoin(before, after, { kind: 'army', army: 'army-gone' as ArmyId })).toEqual({
      kind: 'army',
      army: 'army-gone',
    });
  });
});
