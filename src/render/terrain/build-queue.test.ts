import { describe, expect, it } from 'vitest';
import { BuildQueue, type Timers } from './chunks.ts';

/** Timers that run only when the test runs them, on a clock each build moves on. */
function handTimers() {
  let clock = 0;
  const waiting: (() => void)[] = [];
  const timers: Timers = {
    later: (run) => {
      waiting.push(run);
      return run;
    },
    cancel: (handle) => {
      const i = waiting.indexOf(handle as () => void);
      if (i >= 0) waiting.splice(i, 1);
    },
    now: () => clock,
  };
  return {
    timers,
    tick: (ms: number) => (clock += ms),
    runNext: () => waiting.shift()?.(),
    scheduled: () => waiting.length,
  };
}

type Item = { id: number; needed: boolean };

function queueOf(hand: ReturnType<typeof handTimers>, buildMs = 5) {
  const built: number[] = [];
  const queue = new BuildQueue<Item>(
    (item) => {
      built.push(item.id);
      hand.tick(buildMs);
    },
    (item) => built.includes(item.id),
    12,
    hand.timers,
  );
  return { queue, built };
}

describe('BuildQueue', () => {
  it('builds nothing at once, then builds in slices between frames until all are built', () => {
    const hand = handTimers();
    const { queue, built } = queueOf(hand);
    queue.want([0, 1, 2, 3, 4].map((id) => ({ id, needed: true })));
    expect(built).toEqual([]);
    expect(queue.waitingInView).toBe(true);
    hand.runNext();
    expect(built).toEqual([0, 1, 2]);
    hand.runNext();
    expect(built).toEqual([0, 1, 2, 3, 4]);
    expect(queue.waitingInView).toBe(false);
    expect(hand.scheduled()).toBe(0);
  });

  it('skips a chunk that is already built and keeps one slice scheduled at a time', () => {
    const hand = handTimers();
    const { queue, built } = queueOf(hand);
    queue.want([{ id: 1, needed: true }]);
    queue.want([
      { id: 1, needed: true },
      { id: 2, needed: false },
    ]);
    expect(hand.scheduled()).toBe(1);
    hand.runNext();
    queue.want([
      { id: 1, needed: true },
      { id: 2, needed: false },
    ]);
    hand.runNext();
    expect(built).toEqual([1, 2]);
  });

  it('says a chunk in view still waits only while one does', () => {
    const hand = handTimers();
    const { queue } = queueOf(hand);
    queue.want([{ id: 7, needed: false }]);
    expect(queue.waitingInView).toBe(false);
  });

  it('builds nothing more once destroyed', () => {
    const hand = handTimers();
    const { queue, built } = queueOf(hand);
    queue.want([0, 1, 2, 3, 4, 5].map((id) => ({ id, needed: true })));
    hand.runNext();
    queue.destroy();
    expect(hand.scheduled()).toBe(0);
    hand.runNext();
    expect(built).toEqual([0, 1, 2]);
    expect(queue.waitingInView).toBe(false);
  });
});
