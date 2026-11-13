import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseMap } from '../../sim/map.ts';
import { PAPER } from '../palette.ts';
import { groundTint, TINT_CELL } from './draw.ts';
import {
  foldOutline,
  Land,
  placeFields,
  placeRelief,
  TIERS,
  WOOD_RIM,
  type Mark,
  type Tier,
} from './marks.ts';

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
/** The Zagros and the plateau between Susa, Aspadana, and Persepolis. */
const ZAGROS = { left: 5632, top: 3072, right: 6144, bottom: 3584 };
/** The plain north of Persepolis, between the folds of the Zagros. */
const PERSIS = { left: 6016, top: 3264, right: 6144, bottom: 3392 };
/** The western edge of the Dasht-e Kavir. */
const KAVIR = { left: 5952, top: 2880, right: 6080, bottom: 3008 };
/** The steppe between Olbia and Tanais. */
const STEPPE = { left: 4096, top: 1536, right: 4608, bottom: 2048 };

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
      fold: (x, y) => land.mountains.inside(x, y) && land.cover(x, y) !== 'green',
      hill: (x, y) => land.hills.inside(x, y),
      tree: (x, y) => land.forest.inside(x, y) || land.riverAt(x, y, 4) !== undefined,
      dune: (x, y) => land.desert.inside(x, y),
      stipple: (x, y) => land.desert.inside(x, y),
      crack: (x, y) => land.salt.inside(x, y) && land.panDepth(x, y) > 0,
      tumulus: (x, y) => land.cover(x, y) === 'dry',
      hamlet: (x, y) => land.cover(x, y) !== 'green' && !land.desert.inside(x, y),
      qanat: (x, y) => land.cover(x, y) === 'arid' && !land.mountains.inside(x, y),
    };
    for (const tier of ['wide', 'middle', 'close'] as const) {
      const rects =
        tier === 'close'
          ? [ROMA, NILE_DELTA, { left: 2176, top: 1792, right: 2304, bottom: 1920 }, PERSIS, KAVIR]
          : [...chunks(ALPS, tier), ...chunks(SAHARA, tier), ...chunks(ZAGROS, tier)];
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

describe('the ground at the closest zoom', () => {
  it('keeps every tuft, bush, rock, and stream on land along the coast round Roma', () => {
    const rect = { left: 2440, top: 2240, right: 2720, bottom: 2480 };
    const marks = placeRelief(land, rect, 'close');
    const ground = marks.filter(
      (m) => m.kind === 'tuft' || m.kind === 'scrub' || m.kind === 'rock',
    );
    const streams = marks.filter((m) => m.kind === 'stream');
    expect(ground.length).toBeGreaterThan(50);
    const wet = ground.filter((m) =>
      [
        [m.x - m.size, m.y],
        [m.x + m.size, m.y],
        [m.x, m.y - m.size],
      ].some(([x = 0, y = 0]) => !land.open(x, y)),
    );
    expect(wet).toEqual([]);
    for (const s of streams) for (const [x, y] of s.points) expect(land.open(x, y)).toBe(true);
  });
});

describe('the dry lands', () => {
  const count = (marks: readonly Mark[], kind: Mark['kind']) =>
    marks.filter((m) => m.kind === kind).length;
  const across = (area: typeof ALPS, tier: Tier) =>
    chunks(area, tier).flatMap((rect) => placeRelief(land, rect, tier));

  it('tells the green land of the forests from the dry steppe and the arid plateau', () => {
    const at = (id: string) => {
      const province = map.provinces.find((p) => p.id === id);
      if (!province) throw new Error(`no ${id}`);
      return land.cover(province.city[0], province.city[1]);
    };
    expect(at('lutetia')).toBe('green');
    expect(at('olbia')).toBe('dry');
    expect(at('ankyra')).toBe('dry');
    expect(at('numantia')).toBe('dry');
    expect(at('persepolis')).toBe('arid');
    expect(at('aspadana')).toBe('arid');
    expect(at('babylon')).toBe('arid');
  });

  it('colours the bare ground paper on green land and warmer the drier it is', () => {
    const tint = groundTint(land, map.width, map.height);
    const colour = (id: string) => {
      const province = map.provinces.find((p) => p.id === id);
      if (!province) throw new Error(`no ${id}`);
      const i = Math.floor(province.city[0] / TINT_CELL);
      const j = Math.floor(province.city[1] / TINT_CELL);
      const k = (j * tint.width + i) * 4;
      return (
        ((tint.pixels[k] ?? 0) << 16) | ((tint.pixels[k + 1] ?? 0) << 8) | (tint.pixels[k + 2] ?? 0)
      );
    };
    const blue = (c: number) => c & 0xff;
    expect(colour('lutetia')).toBe(PAPER);
    expect(blue(colour('olbia'))).toBeLessThan(blue(PAPER));
    expect(blue(colour('persepolis'))).toBeLessThan(blue(colour('olbia')));
  });

  it('lays the dry ranges as folds and keeps the green ranges as peaks', () => {
    const zagros = across(ZAGROS, 'middle');
    const alps = placeRelief(land, ALPS, 'middle');
    expect(count(zagros, 'fold')).toBeGreaterThan(100);
    expect(count(zagros, 'fold')).toBeGreaterThan(count(zagros, 'mountain') * 4);
    expect(count(alps, 'mountain')).toBeGreaterThan(300);
    expect(count(alps, 'fold') * 15).toBeLessThan(count(alps, 'mountain'));
  });

  it('keeps the whole of every fold on the coastal ranges of Cilicia, Cyprus, and Tingis on land', () => {
    const coasts = [
      { left: 4352, top: 2816, right: 4608, bottom: 3072 },
      { left: 4096, top: 3072, right: 4352, bottom: 3328 },
      { left: 640, top: 2432, right: 896, bottom: 2688 },
    ];
    let folds = 0;
    for (const tier of ['middle', 'close'] as const) {
      for (const rect of coasts.flatMap((c) => chunks(c, tier))) {
        for (const m of placeRelief(land, rect, tier)) {
          if (m.kind !== 'fold') continue;
          folds++;
          for (const [x, y] of foldOutline(m)) {
            expect(land.open(x, y), `fold at ${m.x},${m.y} reaches ${x},${y}`).toBe(true);
          }
        }
      }
    }
    expect(folds).toBeGreaterThan(20);
  });

  it('shows the ground of the dry land from the middle zoom, with burial mounds on the steppe', () => {
    const steppe = across(STEPPE, 'middle');
    expect(count(steppe, 'tuft')).toBeGreaterThan(200);
    expect(count(steppe, 'tumulus')).toBeGreaterThan(10);
    expect(count(across(GAUL, 'middle'), 'tuft') * 20).toBeLessThan(count(steppe, 'tuft'));
  });

  it('lays salt crust only on the pans of the salt desert, and no dunes on it', () => {
    expect(land.pans.length).toBeGreaterThan(4);
    for (const pan of land.pans) {
      for (const lobe of pan.lobes) expect(land.salt.inside(lobe.x, lobe.y)).toBe(true);
    }
    const [pan] = land.pans;
    if (!pan) throw new Error('no pan');
    const around = { left: pan.x - 64, top: pan.y - 64, right: pan.x + 64, bottom: pan.y + 64 };
    const marks = [...placeRelief(land, around, 'close'), ...placeRelief(land, around, 'middle')];
    expect(count(marks, 'crack')).toBeGreaterThan(50);
    const onPans = marks.filter(
      (m) => (m.kind === 'dune' || m.kind === 'stipple') && land.panDepth(m.x, m.y) > 0,
    );
    expect(onPans).toEqual([]);
    expect(count(across(SAHARA, 'middle'), 'crack')).toBe(0);
  });

  it('brings each qanat down from the foot of a range to a hamlet on open land', () => {
    const marks = [PERSIS, ZAGROS].flatMap((area) =>
      chunks(area, 'close').flatMap((rect) => placeFields(land, rect)),
    );
    const hamlets = marks.flatMap((m) => (m.kind === 'hamlet' ? [m] : []));
    const qanats = marks.flatMap((m) => (m.kind === 'qanat' ? [m] : []));
    expect(hamlets.length).toBeGreaterThan(20);
    expect(qanats.length).toBeGreaterThan(5);
    for (const { points } of qanats) {
      for (const [x, y] of points) {
        expect(land.open(x, y) && !land.mountains.inside(x, y), `${x},${y}`).toBe(true);
      }
      const [mx, my] = points[0] as readonly [number, number];
      const foot = [0, 1, 2, 3, 4, 5, 6, 7].some((n) =>
        land.mountains.inside(mx + Math.cos(n * 0.785) * 3, my + Math.sin(n * 0.785) * 3),
      );
      expect(foot, `the mother well at ${mx},${my} lies at a range's foot`).toBe(true);
      const [ex, ey] = points[points.length - 1] as readonly [number, number];
      const end = hamlets.some((h) => Math.hypot(h.x - ex, h.y - ey) < 4);
      expect(end, `the qanat ending at ${ex},${ey} reaches a hamlet`).toBe(true);
    }
    const gaul = chunks(GAUL, 'close').flatMap((rect) => placeFields(land, rect));
    expect(count(gaul, 'hamlet') * 10).toBeLessThan(hamlets.length);
  });
});
