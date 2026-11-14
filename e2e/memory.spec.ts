import { expect, test, type Page } from '@playwright/test';
import type { MapPoint } from '../src/sim/state/map-point.ts';
import { saveGame } from '../src/sim/save.ts';
import { camera, day, dropSave, map, openGame, playAi, startGame } from './support.ts';

/** The JS heap after two full collections, in MB. */
async function heapMb(page: Page): Promise<number> {
  const session = await page.context().newCDPSession(page);
  await session.send('HeapProfiler.collectGarbage');
  await session.send('HeapProfiler.collectGarbage');
  await session.send('Performance.enable');
  const { metrics } = await session.send('Performance.getMetrics');
  await session.detach();
  return (metrics.find((m) => m.name === 'JSHeapUsedSize')?.value ?? 0) / 2 ** 20;
}

/** Every third city of the map from west to east, so each zoom builds new ground. */
const PLACES: MapPoint[] = map.provinces
  .map(({ city: [x, y] }) => ({ x, y }))
  .sort((a, b) => a.x - b.x || a.y - b.y)
  .filter((_, i) => i % 3 === 0);

test('memory does not grow over thirty loads of a save with zooms to the closest view between them', async ({
  page,
}) => {
  test.setTimeout(900_000);
  const save = saveGame(playAi(startGame(), 60));
  const savedDay = JSON.parse(save).state.day as number;
  await openGame(page);
  const heap: number[] = [];
  const view = camera(page);
  for (let load = 1; load <= 30; load++) {
    await dropSave(page, save);
    await expect.poll(() => day(page)).toBe(savedDay);
    const place = PLACES[(load - 1) % PLACES.length] as MapPoint;
    await view.jumpTo(place, 1.6);
    await view.jumpTo(place, 4.2);
    await page.locator('canvas[data-terrain="ready"]').waitFor({ timeout: 120_000 });
    await view.jumpTo(place, 0.01);
    heap.push(await heapMb(page));
  }
  const [third, last] = [heap[2] ?? 0, heap[29] ?? 0];
  expect(last, `heap after each load, MB: ${heap.map(Math.round).join(', ')}`).toBeLessThanOrEqual(
    third * 1.1,
  );
});
