import { describe, expect, it } from 'vitest';
import { frameStats } from './frame-meter.ts';

describe('frameStats', () => {
  it('reports nothing for no frames', () => {
    expect(frameStats([])).toBeUndefined();
  });

  it('gives the median and the 95th percentile by nearest rank', () => {
    const intervals = Array.from({ length: 100 }, (_, i) => i + 1).reverse();
    expect(frameStats(intervals)).toEqual({ median: 50, p95: 95, frames: 100 });
  });

  it('shows one slow frame in twenty at the 95th percentile and not in the median', () => {
    const intervals = [...Array<number>(19).fill(16.7), 333];
    expect(frameStats(intervals)).toEqual({ median: 16.7, p95: 16.7, frames: 20 });
    expect(frameStats([...intervals, 333])?.p95).toBe(333);
  });
});
