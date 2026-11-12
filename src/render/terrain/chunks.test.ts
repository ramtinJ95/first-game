import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseMap } from '../../sim/map.ts';
import { chunkRect, chunksNear, OVERHANG } from './chunks.ts';
import { Land, placeFields, placeRelief, placeTexture, TIERS, type Mark } from './marks.ts';
import type { Rect } from './scatter.ts';

const map = parseMap(
  JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../data/map/map.json'), 'utf8')),
);
let land: Land;
beforeAll(() => {
  land = new Land(map);
});

/** The box a mark's drawing covers, generously, in km. */
function extent(m: Mark): Rect {
  switch (m.kind) {
    case 'mountain':
    case 'hill':
      return {
        left: m.x - m.width / 2,
        top: m.y - m.height * 1.4,
        right: m.x + m.width / 2,
        bottom: m.y,
      };
    case 'tree':
      return { left: m.x - m.size, top: m.y - m.size * 1.3, right: m.x + m.size, bottom: m.y };
    case 'dune':
      return {
        left: m.x - m.length,
        top: m.y - m.length,
        right: m.x + m.length,
        bottom: m.y + m.length,
      };
    case 'stipple':
      return {
        left: m.x - m.spread,
        top: m.y - m.spread,
        right: m.x + m.spread,
        bottom: m.y + m.spread,
      };
    case 'field':
    case 'orchard': {
      const r = Math.hypot(m.width, m.depth) / 2;
      return { left: m.x - r, top: m.y - r, right: m.x + r, bottom: m.y + r };
    }
    case 'track': {
      const xs = m.points.map(([x]) => x);
      const ys = m.points.map(([, y]) => y);
      return {
        left: Math.min(...xs),
        top: Math.min(...ys),
        right: Math.max(...xs),
        bottom: Math.max(...ys),
      };
    }
  }
}

const grown = (rect: Rect, by: number): Rect => ({
  left: rect.left - by,
  top: rect.top - by,
  right: rect.right + by,
  bottom: rect.bottom + by,
});
const within = (inner: Rect, outer: Rect) =>
  inner.left >= outer.left &&
  inner.top >= outer.top &&
  inner.right <= outer.right &&
  inner.bottom <= outer.bottom;

describe('chunks and their overhang', () => {
  const cases = [
    {
      name: 'wide',
      size: TIERS.wide.chunk,
      key: 1 * 4096 + 0,
      place: (r: Rect) => placeRelief(land, r, 'wide'),
    },
    {
      name: 'texture',
      size: TIERS.texture.chunk,
      key: 8 * 4096 + 5,
      place: (r: Rect) => placeTexture(land, r),
    },
    {
      name: 'middle',
      size: TIERS.middle.chunk,
      key: 8 * 4096 + 7,
      place: (r: Rect) => placeRelief(land, r, 'middle'),
    },
    {
      name: 'close',
      size: TIERS.close.chunk,
      key: 35 * 4096 + 28,
      place: (r: Rect) => placeRelief(land, r, 'close'),
    },
    {
      name: 'fields',
      size: TIERS.close.chunk,
      key: 39 * 4096 + 36,
      place: (r: Rect) => placeFields(land, r),
    },
  ] as const;

  it('keeps every drawing inside its chunk grown by the overhang', () => {
    for (const { name, size, key, place } of cases) {
      const rect = chunkRect(size, key);
      const marks = place(rect);
      expect(marks.length, name).toBeGreaterThan(0);
      const outer = grown(rect, OVERHANG[name]);
      const outside = marks.filter((m) => !within(extent(m), outer));
      expect(outside, name).toEqual([]);
    }
  });

  it("shows a chunk while a view meets only its drawings' overhang, as during a pan across its edge", () => {
    const size = TIERS.middle.chunk;
    const rect = chunkRect(size, 8 * 4096 + 7);
    const justRight = {
      left: rect.right + 1,
      top: rect.top,
      right: rect.right + 400,
      bottom: rect.bottom,
    };
    expect(chunksNear(justRight, size, OVERHANG.middle, 0, map.width, map.height)).toContain(
      8 * 4096 + 7,
    );
    const farRight = {
      left: rect.right + OVERHANG.middle + 1,
      top: rect.top,
      right: rect.right + 600,
      bottom: rect.bottom,
    };
    expect(chunksNear(farRight, size, OVERHANG.middle, 0, map.width, map.height)).not.toContain(
      8 * 4096 + 7,
    );
  });
});
