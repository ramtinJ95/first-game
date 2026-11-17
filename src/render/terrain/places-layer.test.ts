import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Container } from 'pixi.js';
import { expect, it } from 'vitest';
import { parseMap } from '../../sim/map.ts';
import { createPlaces } from './places-layer.ts';

const map = parseMap(
  JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../data/map/map.json'), 'utf8')),
);

it('says that a step changed the picture whenever it did, the last step of a fade too', () => {
  const towns = new Container();
  const places = createPlaces(map, towns, new Container());
  const camera = { centre: { x: 2600, y: 2200 }, scale: 1.2 };
  places.layout(camera, { width: 1280, height: 720 }, []);
  const drawn = () => towns.children.map((symbol) => `${symbol.alpha}/${symbol.visible}`).join();
  let now = 0;
  let steps = 0;
  for (let quiet = 0; quiet < 3; now += 16) {
    const before = drawn();
    const changed = places.step(now);
    expect(changed, `step at ${now} ms`).toBe(drawn() !== before);
    if (changed) steps++;
    else quiet++;
  }
  expect(steps, 'a fade drawn over several steps').toBeGreaterThan(3);
  expect(towns.children.some((symbol) => symbol.visible && symbol.alpha === 1)).toBe(true);
});
