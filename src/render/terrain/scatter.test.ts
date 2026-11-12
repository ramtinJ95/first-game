import { describe, expect, it } from 'vitest';
import { scatter } from './scatter.ts';

const everywhere = () => 6;

describe('scatter', () => {
  it('places the same points for the same rect and salt', () => {
    const rect = { left: 0, top: 0, right: 200, bottom: 120 };
    expect(scatter(rect, 3, 7, everywhere, 6)).toEqual(scatter(rect, 3, 7, everywhere, 6));
    expect(scatter(rect, 3, 8, everywhere, 6)).not.toEqual(scatter(rect, 3, 7, everywhere, 6));
  });

  it('gives two neighbouring chunks the same points as one chunk over both, with no seam', () => {
    const whole = scatter({ left: 0, top: 0, right: 256, bottom: 128 }, 3, 1, everywhere, 6);
    const halves = [
      ...scatter({ left: 0, top: 0, right: 128, bottom: 128 }, 3, 1, everywhere, 6),
      ...scatter({ left: 128, top: 0, right: 256, bottom: 128 }, 3, 1, everywhere, 6),
    ];
    const key = (p: { x: number; y: number }) => `${p.x},${p.y}`;
    expect(new Set(halves.map(key))).toEqual(new Set(whole.map(key)));
  });

  it('keeps every two points apart by their spacing, and does not lay them on a grid', () => {
    const points = scatter({ left: 0, top: 0, right: 300, bottom: 300 }, 3, 3, everywhere, 6);
    let closest = Infinity;
    for (const [i, a] of points.entries()) {
      for (const b of points.slice(i + 1))
        closest = Math.min(closest, Math.hypot(a.x - b.x, a.y - b.y));
    }
    expect(closest).toBeGreaterThanOrEqual(6);
    const columns = new Set(points.map((p) => Math.round(p.x * 100)));
    expect(columns.size).toBeGreaterThan(points.length * 0.95);
  });

  it('places nothing where the rule allows none', () => {
    const points = scatter(
      { left: 0, top: 0, right: 100, bottom: 100 },
      2,
      1,
      (x) => (x < 50 ? 4 : undefined),
      4,
    );
    expect(points.length).toBeGreaterThan(0);
    expect(points.every((p) => p.x < 50)).toBe(true);
  });
});
