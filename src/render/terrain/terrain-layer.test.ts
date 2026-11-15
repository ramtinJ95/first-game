import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Container, type Renderer } from 'pixi.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseMap, type GameMap, type Point } from '../../sim/map.ts';
import { createTerrain } from './terrain-layer.ts';

/** The Persian plateau, open dry land with few marks to draw at the closest zoom. */
const PLATEAU = { x: 6080, y: 3330 };
const HALF_KM = 64;

/**
 * The map's provinces, terrain, rivers, coasts, peaks, and places within HALF_KM of the
 * plateau, moved to a map of their own. Building the layer for the whole map took a second
 * of every test, and what a test asks of the layer holds for any land it draws.
 */
function plateauMap(map: GameMap): GameMap {
  const near = ([x, y]: Point) =>
    Math.abs(x - PLATEAU.x) < HALF_KM && Math.abs(y - PLATEAU.y) < HALF_KM;
  const touches = (rings: readonly (readonly Point[])[]) => rings.some((ring) => ring.some(near));
  const shift = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.length === 2 && typeof value[0] === 'number' && typeof value[1] === 'number'
        ? [value[0] - PLATEAU.x + HALF_KM, value[1] - PLATEAU.y + HALF_KM]
        : value.map(shift)
      : value && typeof value === 'object'
        ? Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, shift(inner)]))
        : value;
  const side = 2 * HALF_KM;
  const cropped = {
    ...map,
    extent: [
      [PLATEAU.x - HALF_KM, PLATEAU.y - HALF_KM],
      [PLATEAU.x + HALF_KM, PLATEAU.y - HALF_KM],
      [PLATEAU.x + HALF_KM, PLATEAU.y + HALF_KM],
      [PLATEAU.x - HALF_KM, PLATEAU.y + HALF_KM],
    ],
    provinces: map.provinces.filter((province) => province.outline.some(touches)),
    terrain: map.terrain.filter((area) => area.outline.some(touches)),
    rivers: map.rivers.filter((river) => river.line.some(near)),
    coastline: map.coastline.filter((line) => line.some(near)),
    peaks: map.peaks.filter((peak) => near(peak.at)),
    settlements: map.settlements.filter((place) => near(place.at)),
  };
  return { ...(shift(cropped) as GameMap), width: side, height: side };
}

const map = plateauMap(
  parseMap(
    JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../data/map/map.json'), 'utf8')),
  ),
);
const viewport = { width: 320, height: 180 };
const closest = { centre: { x: HALF_KM, y: HALF_KM }, scale: 4.2 };

function renderer() {
  let renders = 0;
  const fake = { resolution: 1, render: () => void renders++ } as unknown as Renderer;
  return { fake, renders: () => renders };
}

describe('the terrain layer', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('builds the chunks of a new view between frames, and redraws its texture once they are in', () => {
    const gpu = renderer();
    const terrain = createTerrain(map, new Container(), gpu.fake);
    terrain.restroke(closest.scale);
    const first = terrain.update(closest, viewport, 0);
    expect(first.busy).toBe(true);
    const drawn = gpu.renders();
    vi.runOnlyPendingTimers();
    for (let n = 0; n < 50 && terrain.update(closest, viewport, performance.now()).busy; n++) {
      vi.advanceTimersByTime(100);
    }
    vi.advanceTimersByTime(1000);
    const settled = terrain.update(closest, viewport, performance.now());
    expect(settled.busy).toBe(false);
    expect(gpu.renders()).toBeGreaterThan(drawn);
    const again = terrain.update(closest, viewport, performance.now());
    expect(again).toEqual({ busy: false, redrawn: false });
    terrain.destroy();
  });

  it('says it redrew whenever it drew its texture again, so the frame shows the new terrain', () => {
    const gpu = renderer();
    const terrain = createTerrain(map, new Container(), gpu.fake);
    terrain.restroke(closest.scale);
    const before = gpu.renders();
    const result = terrain.update(closest, viewport, 0);
    expect(gpu.renders()).toBeGreaterThan(before);
    expect(result.redrawn).toBe(true);
    terrain.destroy();
  });

  it('builds nothing once destroyed', () => {
    const gpu = renderer();
    const parent = new Container();
    const terrain = createTerrain(map, parent, gpu.fake);
    terrain.restroke(closest.scale);
    terrain.update(closest, viewport, 0);
    terrain.destroy();
    expect(vi.getTimerCount()).toBe(0);
  });
});
