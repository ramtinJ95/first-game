import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Container, type Renderer } from 'pixi.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseMap } from '../../sim/map.ts';
import { createTerrain } from './terrain-layer.ts';

const map = parseMap(
  JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../data/map/map.json'), 'utf8')),
);
const viewport = { width: 1280, height: 720 };
const closest = { centre: { x: 2420, y: 1880 }, scale: 4.2 };

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
