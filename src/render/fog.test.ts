import { describe, expect, it } from 'vitest';
import { FIXTURE, buildFixture, fixtureWorld } from '../sim/fixture.ts';
import { sightOf } from '../sim/sight.ts';
import { fogCircles } from './fog.ts';

describe('fogCircles', () => {
  const world = fixtureWorld();

  it('moves an army circle between the two days by the progress and keeps city circles still', () => {
    const previous = buildFixture();
    const current = buildFixture();
    const roman = current.armies[FIXTURE.romanArmy];
    if (roman?.activity.kind !== 'idle') throw new Error('fixture Roman army is not idle');
    const start = roman.activity.position;
    roman.activity = { kind: 'idle', position: { x: start.x + 100, y: start.y - 40 } };
    const circles = fogCircles(
      sightOf(previous, world, FIXTURE.rome),
      sightOf(current, world, FIXTURE.rome),
      0.25,
    );
    const army = circles.find((c) => c.key === `army:${FIXTURE.romanArmy}`);
    expect(army?.centre).toEqual({ x: start.x + 25, y: start.y - 10 });
    const roma = circles.find((c) => c.key === `city:${FIXTURE.roma}`);
    expect(roma?.centre).toEqual(current.cities[FIXTURE.roma]?.position);
  });

  it('puts a source that was not there the day before at its current place', () => {
    const previous = buildFixture();
    const current = buildFixture();
    previous.armies = {};
    const circles = fogCircles(
      sightOf(previous, world, FIXTURE.rome),
      sightOf(current, world, FIXTURE.rome),
      0.5,
    );
    const roman = current.armies[FIXTURE.romanArmy]?.activity;
    if (roman?.kind !== 'idle') throw new Error('fixture Roman army is not idle');
    const army = circles.find((c) => c.key === `army:${FIXTURE.romanArmy}`);
    expect(army?.centre).toEqual(roman.position);
  });
});
