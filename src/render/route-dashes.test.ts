import { describe, expect, it } from 'vitest';
import { routeDashes, routeInkBounds } from './route-dashes.ts';

const bounds = { left: 0, top: 0, right: 100, bottom: 100 };
const p = (x: number, y = 0) => ({ x, y });

describe('visible route dashes', () => {
  it('keeps full world art for a view cache that may later pan beyond its old bounds', () => {
    expect(routeDashes([p(-10), p(20)])).toEqual([
      [p(-10), p(-3)],
      [p(2), p(9)],
      [p(14), p(20)],
    ]);
  });

  it('keeps seven ink pixels and five empty pixels through a corner', () => {
    expect(routeDashes([p(0), p(5), p(5, 10)], bounds)).toEqual([
      [p(0), p(5)],
      [p(5), p(5, 2)],
      [p(5, 7), p(5, 10)],
    ]);
  });

  it('retains phase after an entirely offscreen segment and repeated points', () => {
    expect(routeDashes([p(-20), p(-10), p(-10), p(20)], bounds)).toEqual([
      [p(4), p(11)],
      [p(16), p(20)],
    ]);
  });

  it('clips either direction on both axes', () => {
    expect(routeDashes([p(104, 50), p(90, 50)], bounds)).toEqual([
      [p(100, 50), p(97, 50)],
      [p(92, 50), p(90, 50)],
    ]);
    expect(routeDashes([p(50, -4), p(50, 10)], bounds)).toEqual([
      [p(50), p(50, 3)],
      [p(50, 8), p(50, 10)],
    ]);
  });

  it('rejects parallel and diagonal misses and handles empty paths', () => {
    for (const path of [[], [p(1)], [p(-1), p(-1, 100)], [p(-10, 5), p(5, -10)]])
      expect(routeDashes(path, bounds)).toEqual([]);
  });

  it('submits only the view, not a many-thousand-pixel sea crossing', () => {
    const dashes = routeDashes([p(-10000, 50), p(10000, 50)], bounds);
    expect(dashes.length).toBeLessThanOrEqual(10);
    expect(dashes.flat().every(({ x, y }) => x >= 0 && x <= 100 && y === 50)).toBe(true);
  });

  it('pan and zoom use the new screen path without shifting its dash origin', () => {
    const original = routeDashes([p(-10, 50), p(110, 50)], bounds);
    const panned = routeDashes([p(-15, 50), p(105, 50)], bounds);
    expect(original[1]?.[0].x).toBe(14);
    expect(panned[1]?.[0].x).toBe(9);
    const zoomed = routeDashes([p(0), p(40)], bounds);
    expect(zoomed[0]).toEqual([p(0), p(7)]);
    expect(zoomed[1]).toEqual([p(12), p(19)]);
  });
});

describe('cached route ink bounds', () => {
  it('includes the halo around actual dashes, not the unused whole texture', () => {
    expect(routeInkBounds([[p(20, 30), p(40, 30)]], bounds)).toEqual({
      left: 16,
      top: 26,
      right: 43,
      bottom: 34,
    });
  });

  it('clips long crossings and retains fringe entering from outside the texture', () => {
    expect(routeInkBounds([[p(-10000, 50), p(10000, 50)]], bounds)).toEqual({
      left: 0,
      top: 46,
      right: 100,
      bottom: 54,
    });
    expect(routeInkBounds([[p(20, -2), p(40, -2)]], bounds)).toEqual({
      left: 16,
      top: 0,
      right: 43,
      bottom: 2,
    });
  });

  it('has no quad for empty paths or ink wholly outside the cache', () => {
    expect(routeInkBounds([[], [p(20)]], bounds)).toBeUndefined();
    expect(routeInkBounds([[p(20, -5), p(40, -5)]], bounds)).toBeUndefined();
  });
});
