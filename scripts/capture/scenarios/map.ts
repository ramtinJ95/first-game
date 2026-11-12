import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';
import {
  fitCamera,
  mapToScreen,
  panBy,
  wheelFactor,
  zoomAt,
  type Camera,
} from '../../../src/render/camera.ts';
import type { CityId, FactionId } from '../../../src/sim/ids.ts';
import { parseMap } from '../../../src/sim/map.ts';
import { newGame } from '../../../src/sim/new-game.ts';
import { saveGame } from '../../../src/sim/save.ts';
import type { MapPoint } from '../../../src/sim/state/map-point.ts';
import { defineScenario } from '../scenario.ts';

const map = parseMap(
  JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../data/map/map.json'), 'utf8')),
);
const viewport = { width: 1280, height: 720 };
const centre = { x: viewport.width / 2, y: viewport.height / 2 };
const CLIP_MS = 12_000;

function cityPoint(id: string): MapPoint {
  const province = map.provinces.find((p) => p.id === id);
  if (!province) throw new Error(`no province ${id}`);
  return { x: province.city[0], y: province.city[1] };
}

const frames = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))),
  );

/** Drives the page with real mouse input and follows the page's camera with the same maths. */
function controls(page: Page) {
  let camera: Camera = fitCamera(viewport, map);
  return {
    screen: (point: MapPoint) => mapToScreen(camera, viewport, point),
    get scale() {
      return camera.scale;
    },
    async zoom(at: MapPoint, notches: number, pauseMs = 90) {
      await page.mouse.move(at.x, at.y);
      for (let i = 0; i < Math.abs(notches); i++) {
        const deltaY = notches > 0 ? -100 : 100;
        await page.mouse.wheel(0, deltaY);
        camera = zoomAt(camera, at, wheelFactor(deltaY), viewport, map);
        await page.waitForTimeout(pauseMs);
      }
    },
    async drag(from: MapPoint, to: MapPoint, steps = 15) {
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(to.x, to.y, { steps });
      await page.mouse.up();
      camera = panBy(camera, to.x - from.x, to.y - from.y, viewport, map);
    },
    async bringToCentre(point: MapPoint) {
      await this.drag(this.screen(point), centre);
    },
  };
}

async function dropSave(page: Page, text: string) {
  const dataTransfer = await page.evaluateHandle((save) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([save], 'save.json', { type: 'application/json' }));
    return transfer;
  }, text);
  await page.dispatchEvent('canvas', 'drop', { dataTransfer });
}

function percentile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? NaN;
}

export default defineScenario({
  name: 'map',
  title:
    'The atlas map: zoom toward Italy, pan, hold while the sea moves, select Syracusae, load a save in which Rome holds it, zoom out',
  viewport,
  async run({ page, shot }) {
    const started = Date.now();
    await page.goto('/');
    await page.getByTestId('time-controls').waitFor({ state: 'visible' });
    await frames(page);
    await shot(
      'whole-map',
      'The widest zoom shows the whole map, from Britain to the Iranian plateau',
    );

    const camera = controls(page);
    await camera.zoom(camera.screen({ x: 2650, y: 2500 }), 6, 120);
    await camera.bringToCentre({ x: 2620, y: 2480 });
    await frames(page);
    await shot('italy', `Italy at ${camera.scale.toFixed(2)} px per km`);
    await page.waitForTimeout(1500);

    const syracusae = camera.screen(cityPoint('syracusae'));
    await page.mouse.click(syracusae.x, syracusae.y);
    await page.getByTestId('city-name').filter({ hasText: 'Syracusae' }).waitFor();
    await frames(page);
    await shot(
      'selected-province',
      'Syracusae selected: its outline is inked and the city panel shows the city, its owner, and its defences',
    );

    const state = newGame(map, { seed: 1, player: 'rome' });
    const city = state.cities['syracusae' as CityId];
    if (!city) throw new Error('new game lacks Syracusae');
    city.owner = 'rome' as FactionId;
    await dropSave(page, saveGame(state));
    await page.getByTestId('city-owner').filter({ hasText: 'Rome' }).waitFor();
    await page.waitForTimeout(400);
    await shot(
      'owner-changed',
      'After a save in which Rome holds Syracusae is dropped on the page, Sicily takes the Roman wash',
    );

    await camera.zoom(centre, -7, 110);
    await page.waitForTimeout(600);

    await camera.zoom(camera.screen({ x: 6150, y: 3150 }), 5, 60);
    await camera.bringToCentre({ x: 6000, y: 3150 });
    await frames(page);
    await shot('persia', `Persia and the Iranian plateau at ${camera.scale.toFixed(2)} px per km`);

    await camera.zoom(centre, -10, 30);
    await camera.zoom(camera.screen(cityPoint('roma')), 18, 30);
    await camera.bringToCentre(cityPoint('roma'));
    await frames(page);
    await shot(
      'closest-roma',
      `The closest zoom, ${camera.scale.toFixed(1)} px per km, on Roma and the Roman army's banner`,
    );

    // The capture records the clip with a screenshot every 125 ms for its first 12 s,
    // which would slow every frame, so the measurement waits until it has stopped.
    await page.waitForTimeout(Math.max(0, CLIP_MS + 1000 - (Date.now() - started)));
    await camera.zoom(centre, -7, 30);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Performance.enable');
    const taskSeconds = async () => {
      const { metrics } = await cdp.send('Performance.getMetrics');
      return metrics.find((metric) => metric.name === 'TaskDuration')?.value ?? NaN;
    };
    const idle = await page.evaluate(
      () =>
        new Promise<number[]>((done) => {
          const gaps: number[] = [];
          let last = performance.now();
          const end = last + 2000;
          const step = (now: number) => {
            gaps.push(now - last);
            last = now;
            if (now < end) requestAnimationFrame(step);
            else done(gaps);
          };
          requestAnimationFrame(step);
        }),
    );
    const idleMedian = percentile(
      idle.slice(1).sort((a, b) => a - b),
      0.5,
    );
    const collector = 'frameGaps';
    await page.evaluate((key) => {
      const gaps: number[] = [];
      Reflect.set(globalThis, key, gaps);
      let last = performance.now();
      const step = (now: number) => {
        gaps.push(now - last);
        last = now;
        if (Reflect.get(globalThis, key) === gaps) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }, collector);
    const busyBefore = await taskSeconds();
    const sweep = [
      [1000, 360, 200, 360],
      [640, 600, 640, 120],
      [200, 360, 1000, 360],
      [200, 360, 1000, 360],
      [640, 120, 640, 600],
      [640, 120, 640, 600],
      [1000, 360, 200, 360],
      [1000, 360, 200, 360],
    ] as const;
    for (const [x0, y0, x1, y1] of sweep) {
      await camera.drag({ x: x0, y: y0 }, { x: x1, y: y1 }, 40);
    }
    const busy = ((await taskSeconds()) - busyBefore) * 1000;
    const recorded = await page.evaluate((key) => {
      const gaps: unknown = Reflect.get(globalThis, key);
      Reflect.deleteProperty(globalThis, key);
      return Array.isArray(gaps) ? (gaps as number[]) : [];
    }, collector);
    const gaps = recorded.slice(1).sort((a, b) => a - b);
    const median = percentile(gaps, 0.5);
    const p95 = percentile(gaps, 0.95);
    const summary =
      `Pan over the map at ${camera.scale.toFixed(2)} px per km: ${gaps.length} frames, ` +
      `frame interval median ${median.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms, ` +
      `main thread busy ${(busy / gaps.length).toFixed(1)} ms per frame; ` +
      `idle frame interval median ${idleMedian.toFixed(1)} ms`;
    console.log(summary);
    await shot('pan-frame-time', summary);
  },
});
