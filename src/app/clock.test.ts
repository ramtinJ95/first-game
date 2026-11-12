import { describe, expect, it } from 'vitest';
import { buildFixture, FIXTURE, fixtureWorld } from '../sim/fixture.ts';
import type { System } from '../sim/systems.ts';
import { createClock } from './clock.ts';

const world = fixtureWorld();

function fakeTime() {
  let ms = 0;
  return {
    now: () => ms,
    advance(byMs: number) {
      ms += byMs;
    },
  };
}

function run(clock: { frame(): void }, time: ReturnType<typeof fakeTime>, totalMs: number) {
  for (let elapsed = 0; elapsed < totalMs; elapsed += 16) {
    time.advance(16);
    clock.frame();
  }
}

describe('clock', () => {
  it("asks the AI once a day for orders and plays them in the same tick as the player's", () => {
    const time = fakeTime();
    const asked: number[] = [];
    const clock = createClock({
      world,
      state: buildFixture(),
      now: time.now,
      decide: (state) => {
        asked.push(state.day);
        return state.day === 1
          ? [
              {
                kind: 'setStance',
                faction: FIXTURE.carthage,
                army: FIXTURE.punicArmy,
                stance: 'skirmishAndWithdraw',
              },
            ]
          : [];
      },
    });
    clock.issue({
      kind: 'setStance',
      faction: FIXTURE.rome,
      army: FIXTURE.romanArmy,
      stance: 'allOutAssault',
    });
    run(clock, time, 1000);

    expect(clock.state.day).toBe(2);
    expect(asked).toEqual([1]);
    expect(clock.state.armies[FIXTURE.romanArmy]?.stance).toBe('allOutAssault');
    expect(clock.state.armies[FIXTURE.punicArmy]?.stance).toBe('skirmishAndWithdraw');

    run(clock, time, 2000);
    expect(asked).toEqual([1, 2, 3]);
  });

  it('runs no tick while paused, and applies an order issued in the pause on the first tick after resume', () => {
    const time = fakeTime();
    const clock = createClock({ world, state: buildFixture(), now: time.now });
    clock.pause();
    clock.issue({
      kind: 'setStance',
      faction: FIXTURE.rome,
      army: FIXTURE.romanArmy,
      stance: 'allOutAssault',
    });
    run(clock, time, 60_000);
    time.advance(3_600_000);
    clock.frame();

    expect(clock.state.day).toBe(1);
    expect(clock.state.armies[FIXTURE.romanArmy]?.stance).toBe('holdTheLine');

    time.advance(3_600_000);
    clock.resume();
    clock.frame();
    expect(clock.state.day).toBe(1);

    run(clock, time, 1000);
    expect(clock.state.day).toBe(2);
    expect(clock.state.armies[FIXTURE.romanArmy]?.stance).toBe('allOutAssault');
  });

  it('runs exactly twice the ticks at speed 2 as at speed 1 over the same time', () => {
    const daysAfter = (speed: 1 | 2) => {
      const time = fakeTime();
      const clock = createClock({ world, state: buildFixture(), now: time.now });
      clock.setSpeed(speed);
      run(clock, time, 10_000);
      return clock.state.day - 1;
    };
    expect(daysAfter(1)).toBe(10);
    expect(daysAfter(2)).toBe(20);
  });

  it('counts time before a speed change at the old speed', () => {
    const time = fakeTime();
    const clock = createClock({ world, state: buildFixture(), now: time.now });
    time.advance(900);
    clock.setSpeed(3);
    clock.frame();
    expect(clock.state.day).toBe(1);
    expect(clock.progress).toBeCloseTo(0.9);

    time.advance(100);
    clock.frame();
    expect(clock.state.day).toBe(2);
    expect(clock.progress).toBeCloseTo(0.4);
  });

  it('runs the day a delayed pause owes, then runs no tick until resume', () => {
    const time = fakeTime();
    const clock = createClock({ world, state: buildFixture(), now: time.now });
    time.advance(1500);
    clock.pause();
    expect(clock.state.day).toBe(2);
    expect(clock.progress).toBeCloseTo(0.5);

    time.advance(5000);
    clock.frame();
    expect(clock.state.day).toBe(2);
    expect(clock.progress).toBeCloseTo(0.5);

    clock.resume();
    expect(clock.progress).toBeCloseTo(0.5);
    time.advance(500);
    clock.frame();
    expect(clock.state.day).toBe(3);
    expect(clock.progress).toBeCloseTo(0);
  });

  it('keeps progress below 1 after any control action', () => {
    const time = fakeTime();
    const clock = createClock({ world, state: buildFixture(), now: time.now, maxTicksPerFrame: 4 });
    const actions = [
      () => clock.setSpeed(3),
      () => clock.pause(),
      () => clock.resume(),
      () => clock.setSpeed(1),
      () => clock.togglePause(),
      () => clock.togglePause(),
      () => clock.frame(),
    ];
    for (const delay of [0, 300, 999, 1000, 1700, 10_000]) {
      for (const action of actions) {
        time.advance(delay);
        action();
        expect(clock.progress).toBeGreaterThanOrEqual(0);
        expect(clock.progress).toBeLessThan(1);
      }
    }
  });

  it('throws with the day and the broken links when a system updates one side of a link', () => {
    const linkOneSide: System = (state) => {
      state.armies[FIXTURE.romanArmy]?.formations.push(FIXTURE.citizenSpears);
    };
    const time = fakeTime();
    const clock = createClock({
      world,
      state: buildFixture(),
      now: time.now,
      systems: [linkOneSide],
    });
    time.advance(1000);
    expect(() => clock.frame()).toThrow(
      'Day 1 left broken links: army army-roman lists formation formation-citizen-spears, which does not name it back',
    );
  });

  it('runs at most maxTicksPerFrame ticks in a long frame and does not catch up afterwards', () => {
    const time = fakeTime();
    const clock = createClock({ world, state: buildFixture(), now: time.now, maxTicksPerFrame: 4 });
    time.advance(10_000);
    clock.frame();
    expect(clock.state.day).toBe(5);

    time.advance(16);
    clock.frame();
    expect(clock.state.day).toBe(5);
  });

  it('reports progress as the fraction of the way to the next tick', () => {
    const time = fakeTime();
    const clock = createClock({ world, state: buildFixture(), now: time.now });
    expect(clock.progress).toBe(0);

    time.advance(250);
    clock.frame();
    expect(clock.progress).toBeCloseTo(0.25);

    clock.setSpeed(3);
    time.advance(100);
    clock.frame();
    expect(clock.progress).toBeCloseTo(0.75);

    time.advance(100);
    clock.frame();
    expect(clock.state.day).toBe(2);
    expect(clock.progress).toBeCloseTo(0.25);
  });

  it('keeps the state from before the latest tick as previous', () => {
    const time = fakeTime();
    const clock = createClock({ world, state: buildFixture(), now: time.now });
    expect(clock.previous.day).toBe(1);

    time.advance(1000);
    clock.frame();
    expect(clock.previous.day).toBe(1);
    expect(clock.state.day).toBe(2);

    time.advance(1000);
    clock.frame();
    expect(clock.previous.day).toBe(2);
    expect(clock.state.day).toBe(3);
  });

  it('reports the rejections of a tick to onRejected', () => {
    const time = fakeTime();
    const rejected: string[] = [];
    const clock = createClock({
      world,
      state: buildFixture(),
      now: time.now,
      onRejected: (batch) => rejected.push(...batch.map((r) => r.order.kind)),
    });
    clock.issue({
      kind: 'setStance',
      faction: FIXTURE.rome,
      army: FIXTURE.punicArmy,
      stance: 'allOutAssault',
    });
    time.advance(1000);
    clock.frame();
    expect(rejected).toEqual(['setStance']);
    expect(clock.state.armies[FIXTURE.punicArmy]?.stance).toBe('holdTheLine');
  });

  it('runs a loaded game from its own day and drops the orders queued before the load', () => {
    const time = fakeTime();
    const clock = createClock({ world, state: buildFixture(), now: time.now });
    run(clock, time, 3000);
    clock.issue({
      kind: 'setStance',
      faction: FIXTURE.rome,
      army: FIXTURE.romanArmy,
      stance: 'allOutAssault',
    });
    const loaded = buildFixture();
    const capua = loaded.cities[FIXTURE.capua];
    if (!capua) throw new Error('fixture lacks Capua');
    capua.owner = FIXTURE.carthage;
    clock.load(loaded);
    expect(clock.state).toBe(loaded);
    expect(clock.previous).toBe(loaded);
    expect(clock.progress).toBe(0);

    run(clock, time, 1000);
    expect(clock.state.day).toBe(2);
    expect(clock.state.cities[FIXTURE.capua]?.owner).toBe(FIXTURE.carthage);
    expect(clock.state.armies[FIXTURE.romanArmy]?.stance).toBe('holdTheLine');
  });

  it('hands onDay each day before and after its tick, and keeps issued orders pending until then', () => {
    const time = fakeTime();
    const days: [number, number][] = [];
    const clock = createClock({
      world,
      state: buildFixture(),
      now: time.now,
      onDay: (before, after) => days.push([before.day, after.day]),
    });
    const order = {
      kind: 'setStance',
      faction: FIXTURE.rome,
      army: FIXTURE.romanArmy,
      stance: 'allOutAssault',
    } as const;
    clock.issue(order);
    expect(clock.pending).toEqual([order]);
    run(clock, time, 2000);
    expect(days).toEqual([
      [1, 2],
      [2, 3],
    ]);
    expect(clock.pending).toEqual([]);
  });
});
