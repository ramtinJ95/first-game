import { describe, expect, test } from 'vitest';
import { alongTrail, dayPath, trailLength } from './trail.ts';

describe('dayPath', () => {
  test('passes the corners turned during the day', () => {
    const path = dayPath(
      { x: 0, y: 0 },
      [
        { x: 10, y: 0 },
        { x: 10, y: 20 },
        { x: 10, y: 40 },
      ],
      { x: 10, y: 15 },
    );
    expect(path).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 15 },
    ]);
    expect(trailLength(path)).toBeCloseTo(25);
  });

  test('a mover still on its first leg walks straight', () => {
    expect(dayPath({ x: 0, y: 0 }, [{ x: 30, y: 0 }], { x: 25, y: 0 })).toEqual([
      { x: 0, y: 0 },
      { x: 25, y: 0 },
    ]);
  });
});

describe('alongTrail', () => {
  const trail = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
  ];

  test('faces along the leg it stands on', () => {
    expect(alongTrail(trail, 5)).toEqual({ point: { x: 5, y: 0 }, heading: { x: 1, y: 0 } });
    expect(alongTrail(trail, 15)).toEqual({ point: { x: 10, y: 5 }, heading: { x: 0, y: 1 } });
  });

  test('runs straight on behind the back and past the head', () => {
    expect(alongTrail(trail, -4)).toEqual({ point: { x: -4, y: 0 }, heading: { x: 1, y: 0 } });
    expect(alongTrail(trail, 24)).toEqual({ point: { x: 10, y: 14 }, heading: { x: 0, y: 1 } });
  });

  test('a trail without length uses the fallback heading', () => {
    expect(alongTrail([{ x: 3, y: 3 }], -2, { x: 0, y: -1 })).toEqual({
      point: { x: 3, y: 5 },
      heading: { x: 0, y: -1 },
    });
  });
});
