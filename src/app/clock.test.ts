import { describe, expect, it } from 'vitest';
import { buildFixture, FIXTURE, fixtureWorld } from '../sim/fixture.ts';
import type { System } from '../sim/systems.ts';
import { createClock, type Speed } from './clock.ts';

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

  it('runs the days of each speed over the same time, five times as many at speed 3 as at speed 1', () => {
    const daysAfter = (speed: Speed) => {
      const time = fakeTime();
      const clock = createClock({ world, state: buildFixture(), now: time.now });
      clock.setSpeed(speed);
      run(clock, time, 10_000);
      return clock.state.day - 1;
    };
    expect(daysAfter(1)).toBe(10);
    expect(daysAfter(2)).toBe(20);
    // 625 frames of 0.08 days add up to a hair under 50 in floating point.
    expect(daysAfter(3)).toBeGreaterThanOrEqual(49);
    expect(daysAfter(3)).toBeLessThanOrEqual(50);
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

  it('stops a delayed pause on the day the last frame showed, then runs no tick until resume', () => {
    const time = fakeTime();
    const clock = createClock({ world, state: buildFixture(), now: time.now });
    time.advance(500);
    clock.frame();
    time.advance(1500);
    clock.pause();
    expect(clock.state.day).toBe(1);
    expect(clock.progress).toBeCloseTo(0.5);

    time.advance(5000);
    clock.frame();
    expect(clock.state.day).toBe(1);
    expect(clock.progress).toBeCloseTo(0.5);

    clock.resume();
    expect(clock.progress).toBeCloseTo(0.5);
    time.advance(500);
    clock.frame();
    expect(clock.state.day).toBe(2);
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

  it('stops on the day whose news pauses it, though the frame owed more days', () => {
    const time = fakeTime();
    const played: number[] = [];
    const clock = createClock({
      world,
      state: buildFixture(),
      now: time.now,
      maxTicksPerFrame: 4,
      onDay: (_before, after) => {
        played.push(after.day);
        if (after.day === 3) clock.pause();
      },
    });
    time.advance(10_000);
    clock.frame();
    expect(played).toEqual([2, 3]);
    expect(clock.state.day).toBe(3);
    expect(clock.paused).toBe(true);
    expect(clock.progress).toBeLessThan(1);
    time.advance(5_000);
    clock.frame();
    expect(clock.state.day).toBe(3);
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

  describe('keeps one waiting order per army for each slot', () => {
    const fixture = buildFixture();
    const capua = fixture.cities[FIXTURE.capua]?.position;
    const roma = fixture.cities[FIXTURE.roma]?.position;
    if (!capua || !roma) throw new Error('fixture lacks Capua or Roma');
    const march = (army: typeof FIXTURE.romanArmy, to: { x: number; y: number }) =>
      ({ kind: 'moveArmy', faction: FIXTURE.rome, army, to }) as const;
    const stance = (value: 'allOutAssault' | 'skirmishAndWithdraw') =>
      ({
        kind: 'setStance',
        faction: FIXTURE.rome,
        army: FIXTURE.romanArmy,
        stance: value,
      }) as const;
    const recruit = {
      kind: 'recruit',
      faction: FIXTURE.rome,
      city: FIXTURE.roma,
      troop: 'spearmen',
    } as const;

    it('marches the army to the last of many destinations given in a pause', () => {
      const time = fakeTime();
      const clock = createClock({ world, state: buildFixture(), now: time.now });
      clock.pause();
      for (let i = 0; i < 20; i++)
        clock.issue(march(FIXTURE.romanArmy, { x: roma.x + i, y: roma.y + 40 }));
      clock.issue(march(FIXTURE.romanArmy, capua));
      expect(clock.pending).toEqual([march(FIXTURE.romanArmy, capua)]);

      clock.resume();
      run(clock, time, 1000);
      const activity = clock.state.armies[FIXTURE.romanArmy]?.activity;
      expect(activity?.kind).toBe('marching');
      expect(activity?.kind === 'marching' && activity.waypoints.at(-1)).toEqual(capua);
    });

    it('lets a halt, an embarkation, or a retreat replace a waiting march of the same army', () => {
      const clock = createClock({ world, state: buildFixture(), now: fakeTime().now });
      const halt = { kind: 'halt', faction: FIXTURE.rome, army: FIXTURE.romanArmy } as const;
      const embark = {
        kind: 'embark',
        faction: FIXTURE.rome,
        army: FIXTURE.romanArmy,
        to: FIXTURE.carthago,
      } as const;
      const retreat = { kind: 'retreat', faction: FIXTURE.rome, army: FIXTURE.romanArmy } as const;
      for (const order of [halt, embark, retreat]) {
        clock.issue(march(FIXTURE.romanArmy, capua));
        clock.issue(order);
        expect(clock.pending).toEqual([order]);
      }
    });

    it('keeps the latest stance beside the latest march, and the orders of other armies apart', () => {
      const time = fakeTime();
      const clock = createClock({ world, state: buildFixture(), now: time.now });
      clock.issue(stance('allOutAssault'));
      clock.issue(march(FIXTURE.romanArmy, roma));
      clock.issue(march(FIXTURE.punicArmy, roma));
      clock.issue(stance('skirmishAndWithdraw'));
      clock.issue(march(FIXTURE.romanArmy, capua));
      expect(clock.pending).toEqual([
        march(FIXTURE.punicArmy, roma),
        stance('skirmishAndWithdraw'),
        march(FIXTURE.romanArmy, capua),
      ]);

      run(clock, time, 1000);
      expect(clock.state.armies[FIXTURE.romanArmy]?.stance).toBe('skirmishAndWithdraw');
    });

    it('queues orders that name no army side by side', () => {
      const clock = createClock({ world, state: buildFixture(), now: fakeTime().now });
      clock.issue(recruit);
      clock.issue(recruit);
      expect(clock.pending).toEqual([recruit, recruit]);
    });
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
