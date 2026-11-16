import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Container, type Renderer } from 'pixi.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseMap, type GameMap, type Point } from '../../sim/map.ts';
import { BATCH_MS, createTerrain, drawDecision } from './terrain-layer.ts';

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

  /** Frames 16 ms apart until the layer is no longer busy, and the times it redrew. */
  function play(terrain: ReturnType<typeof createTerrain>, at: typeof closest, from: number) {
    const redraws: number[] = [];
    let now = from;
    for (let n = 0; n < 2000; n++) {
      const result = terrain.update(at, viewport, now);
      if (result.redrawn) redraws.push(now);
      if (!result.busy && n > 0) break;
      vi.advanceTimersByTime(16);
      now += 16;
    }
    return { redraws, now };
  }

  const panned = (px: number) => ({
    ...closest,
    centre: { x: closest.centre.x + px / closest.scale, y: closest.centre.y },
  });

  it('finds the chunks of its margin drawn on a pan inside it, and draws nothing again', () => {
    const gpu = renderer();
    const terrain = createTerrain(map, new Container(), gpu.fake);
    terrain.restroke(closest.scale);
    const { now } = play(terrain, closest, 0);
    const drawn = gpu.renders();
    for (let px = 20; px <= 240; px += 20) {
      expect(terrain.update(panned(px), viewport, now + px)).toEqual({
        busy: false,
        redrawn: false,
      });
    }
    expect(gpu.renders()).toBe(drawn);
    terrain.destroy();
  });

  it('draws its texture again once the view leaves it, and not while the view stays inside', () => {
    const gpu = renderer();
    const terrain = createTerrain(map, new Container(), gpu.fake);
    terrain.restroke(closest.scale);
    let { now } = play(terrain, closest, 0);
    const redraws: number[] = [];
    for (let px = 16; px <= 400; px += 16) {
      now += 16;
      vi.advanceTimersByTime(16);
      if (terrain.update(panned(px), viewport, now).redrawn) redraws.push(px);
    }
    // The texture reaches 256 px past the view, so the first drawing again comes after that.
    expect(redraws[0]).toBeGreaterThan(256);
    expect(redraws.filter((px) => px <= 256)).toEqual([]);
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

describe('drawing chunks built while others wait', () => {
  const chunk = { built: true, other: false, waiting: true };

  it('waits while other chunks the texture shows are still queued', () => {
    const first = drawDecision(chunk, 1000, undefined);
    expect(first).toEqual({ draw: false, since: 1000 });
    expect(drawDecision(chunk, 1000 + BATCH_MS - 1, first.since)).toEqual({
      draw: false,
      since: 1000,
    });
  });

  it('draws by the deadline though chunks are still queued', () => {
    expect(drawDecision(chunk, 1000 + BATCH_MS, 1000)).toEqual({ draw: true, since: undefined });
  });

  it('draws as soon as the queue is done', () => {
    expect(drawDecision({ ...chunk, waiting: false }, 1100, 1000)).toEqual({
      draw: true,
      since: undefined,
    });
  });

  it('draws at once for a move, a zoom or a repaint, and keeps no wait', () => {
    expect(drawDecision({ ...chunk, other: true }, 1100, 1000)).toEqual({
      draw: true,
      since: undefined,
    });
  });

  it('keeps an earlier wait through a frame with nothing new', () => {
    expect(drawDecision({ built: false, other: false, waiting: true }, 1200, 1000)).toEqual({
      draw: false,
      since: 1000,
    });
  });
});
