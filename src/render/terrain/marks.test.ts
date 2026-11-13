import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseMap } from '../../sim/map.ts';
import { Land, placeFields, placeRelief, TIERS, WOOD_RIM, type Mark, type Tier } from './marks.ts';

const map = parseMap(
  JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../data/map/map.json'), 'utf8')),
);
let land: Land;
beforeAll(() => {
  land = new Land(map);
});

const ALPS = { left: 2048, top: 1536, right: 2560, bottom: 2048 };
const GAUL = { left: 1536, top: 1024, right: 2560, bottom: 1536 };
const SAHARA = { left: 1024, top: 3072, right: 2048, bottom: 3584 };
const NILE_DELTA = { left: 3968, top: 3584, right: 4160, bottom: 3776 };
const ROMA = { left: 2432, top: 2304, right: 2560, bottom: 2432 };

interface Foot {
  kind: Mark['kind'];
  x: number;
  y: number;
}

function feet(marks: readonly Mark[]): Foot[] {
  return marks.flatMap((m): Foot[] =>
    'points' in m
      ? m.points.map(([x, y]) => ({ kind: m.kind, x, y }))
      : [{ kind: m.kind, x: m.x, y: m.y }],
  );
}

function chunks(rect: typeof ALPS, tier: Tier) {
  const size = TIERS[tier].chunk;
  const rects = [];
  for (let x = rect.left; x < rect.right; x += size) {
    for (let y = rect.top; y < rect.bottom; y += size)
      rects.push({ left: x, top: y, right: x + size, bottom: y + size });
  }
  return rects;
}

describe('placing the terrain', () => {
  it('places the same drawings every time for the same place', () => {
    expect(placeRelief(land, ALPS, 'middle')).toEqual(placeRelief(land, ALPS, 'middle'));
    expect(placeFields(land, ROMA)).toEqual(placeFields(land, ROMA));
    expect(new Land(map).woods).toEqual(land.woods);
  });

  it('places mountains in the Alps, woods in Gaul, and dunes in the Sahara', () => {
    const count = (marks: Mark[], kind: Mark['kind']) =>
      marks.filter((m) => m.kind === kind).length;
    expect(count(placeRelief(land, ALPS, 'middle'), 'mountain')).toBeGreaterThan(300);
    expect(count(placeRelief(land, GAUL, 'middle'), 'tree')).toBeGreaterThan(300);
    expect(count(placeRelief(land, SAHARA, 'middle'), 'dune')).toBeGreaterThan(50);
    expect(count(placeFields(land, ROMA), 'field')).toBeGreaterThan(20);
    expect(count(placeFields(land, NILE_DELTA), 'field')).toBeGreaterThan(200);
  });

  it('places nothing in the sea or a lake, and each kind only inside its own area', () => {
    const inside: Partial<Record<Mark['kind'], (x: number, y: number) => boolean>> = {
      mountain: (x, y) => land.mountains.inside(x, y),
      hill: (x, y) => land.hills.inside(x, y),
      tree: (x, y) => land.forest.inside(x, y),
      dune: (x, y) => land.desert.inside(x, y),
      stipple: (x, y) => land.desert.inside(x, y),
    };
    for (const tier of ['wide', 'middle', 'close'] as const) {
      const rects =
        tier === 'close'
          ? [ROMA, NILE_DELTA, { left: 2176, top: 1792, right: 2304, bottom: 1920 }]
          : [...chunks(ALPS, tier), ...chunks(SAHARA, tier)];
      for (const rect of rects) {
        for (const { kind, x, y } of feet([
          ...placeRelief(land, rect, tier),
          ...(tier === 'close' ? placeFields(land, rect) : []),
        ])) {
          expect(
            land.land.inside(x, y) && !land.lakes.inside(x, y),
            `${kind} at ${x},${y} is at sea`,
          ).toBe(true);
          expect(inside[kind]?.(x, y) ?? true, `${kind} at ${x},${y} is outside its area`).toBe(
            true,
          );
        }
      }
    }
  });

  it('keeps every wood, rim included, on land', () => {
    const atSea: string[] = [];
    for (const wood of land.woods) {
      for (const lobe of wood.lobes) {
        for (let k = 0; k < 12; k++) {
          const a = (k / 12) * Math.PI * 2;
          const x = lobe.x + Math.cos(a) * lobe.r * WOOD_RIM;
          const y = lobe.y + Math.sin(a) * lobe.r * WOOD_RIM;
          if (!land.land.inside(x, y)) atSea.push(`${x.toFixed(1)},${y.toFixed(1)}`);
        }
      }
    }
    expect(land.woods.length).toBeGreaterThan(300);
    expect(atSea).toEqual([]);
  });

  it('draws the higher mountains larger', () => {
    const mountains = placeRelief(land, ALPS, 'middle').flatMap((m) =>
      m.kind === 'mountain' ? [m] : [],
    );
    const low = mountains.filter((m) => m.high < 0.3);
    const high = mountains.filter((m) => m.high > 0.7);
    const mean = (list: typeof mountains) =>
      list.reduce((sum, m) => sum + m.width, 0) / list.length;
    expect(low.length).toBeGreaterThan(10);
    expect(high.length).toBeGreaterThan(10);
    expect(mean(high)).toBeGreaterThan(mean(low) * 1.3);
  });

  it('tells Mediterranean woods from northern ones by their trees', () => {
    const shapes = (rect: typeof ALPS) =>
      new Set(
        placeRelief(land, rect, 'close').flatMap((m) => (m.kind === 'tree' ? [m.shape] : [])),
      );
    expect(shapes({ left: 2048, top: 1152, right: 2176, bottom: 1280 }).has('cypress')).toBe(false);
  });
});
