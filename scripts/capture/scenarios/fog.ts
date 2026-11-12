import type { Page } from '@playwright/test';
import { march, OUT_OF_SIGHT, romeSees, romeWithPunicArmyAt } from '../../../e2e/fog-game.ts';
import {
  armyOf,
  carthage,
  cityPoint,
  dropSave,
  map,
  pause,
  resume,
  rome,
} from '../../../e2e/support.ts';
import { fitCamera, mapToScreen, panBy, wheelFactor, zoomAt } from '../../../src/render/camera.ts';
import type { GameState } from '../../../src/sim/state/game-state.ts';
import type { MapPoint } from '../../../src/sim/state/map-point.ts';
import { defineScenario } from '../scenario.ts';

const viewport = { width: 1280, height: 720 };
const centre = { x: viewport.width / 2, y: viewport.height / 2 };
const CLIP_MS = 12_000;

const frames = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))),
  );

async function day(page: Page): Promise<number> {
  return Number(await page.getByTestId('time-controls-day').getAttribute('data-day'));
}

async function open(page: Page, url: string, state: GameState) {
  await page.goto(url);
  await page.getByTestId('top-bar').waitFor({ state: 'visible' });
  await pause(page);
  await dropSave(page, state);
  await page
    .getByTestId('time-controls-day')
    .and(page.locator(`[data-day="${state.day}"]`))
    .waitFor({ state: 'attached' });
  await frames(page);
}

/** Points inside the land of a power's provinces, away from their cities and names. */
function washPoints(state: GameState, owner: string): MapPoint[] {
  return map.provinces
    .filter((p) => state.cities[p.id as never]?.owner === owner)
    .flatMap((p) => {
      const ring = p.outline[0]?.[0] ?? [];
      const x = ring.reduce((sum, [px]) => sum + px, 0) / ring.length;
      const y = ring.reduce((sum, [, py]) => sum + py, 0) / ring.length;
      return [{ x: (x + p.city[0]) / 2 + 40, y: (y + p.city[1]) / 2 + 40 }];
    });
}

/** The mean brightness, 0 to 255, of a 9 px square around each screen point of a screenshot. */
async function brightness(page: Page, png: Buffer, points: MapPoint[]): Promise<number> {
  return page.evaluate(
    async ({ data, points }) => {
      const bitmap = await createImageBitmap(
        await (await fetch(`data:image/png;base64,${data}`)).blob(),
      );
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext('2d');
      if (!context) return NaN;
      context.drawImage(bitmap, 0, 0);
      let sum = 0;
      let count = 0;
      for (const { x, y } of points) {
        const pixels = context.getImageData(Math.round(x) - 4, Math.round(y) - 4, 9, 9).data;
        for (let i = 0; i < pixels.length; i += 4) {
          sum +=
            0.2126 * (pixels[i] ?? 0) +
            0.7152 * (pixels[i + 1] ?? 0) +
            0.0722 * (pixels[i + 2] ?? 0);
          count++;
        }
      }
      return sum / count;
    },
    { data: png.toString('base64'), points },
  );
}

export default defineScenario({
  name: 'fog',
  title:
    'Fog of war as Rome: a Punic army marches on Roma out of the north-west and appears at the edge of sight, while a Roman army marches from Ariminum toward Carnuntum and the fog follows it',
  viewport,
  async run({ page, shot }) {
    const started = Date.now();
    const state = romeWithPunicArmyAt(OUT_OF_SIGHT);
    march(armyOf(state, carthage), OUT_OF_SIGHT, cityPoint('roma'));
    march(armyOf(state, rome), cityPoint('ariminum'), cityPoint('carnuntum'));
    if (romeSees(state, OUT_OF_SIGHT)) throw new Error('the Punic army starts in sight');
    const startDay = state.day;
    let camera = fitCamera(viewport, map);
    const onScreen = (points: MapPoint[]) => points.map((p) => mapToScreen(camera, viewport, p));

    await open(page, '/?fog=off', state);
    const clear = await page.screenshot();
    await shot('whole-map-no-fog', 'The same map with the fog layer hidden, for comparison');
    await open(page, '/', state);
    const fogged = await page.screenshot();
    const compare = async (owner: string) => {
      const points = onScreen(washPoints(state, owner));
      const before = await brightness(page, clear, points);
      const after = await brightness(page, fogged, points);
      return `${owner} ${before.toFixed(0)} clear and ${after.toFixed(0)} fogged, ${((1 - after / before) * 100).toFixed(1)} % darker`;
    };
    const washes = `Wash brightness, 0 to 255: ${await compare('persia')}; ${await compare('egypt')}`;
    console.log(washes);
    await shot(
      'whole-map',
      `The whole map as Rome, with the fog marking where Roman sight ends. ${washes}`,
    );

    const zoomTo = async (at: MapPoint, notches: number) => {
      const screen = mapToScreen(camera, viewport, at);
      await page.mouse.move(screen.x, screen.y);
      for (let i = 0; i < notches; i++) {
        await page.mouse.wheel(0, -100);
        camera = zoomAt(camera, screen, wheelFactor(-100), viewport, map);
        await page.waitForTimeout(60);
      }
      const from = mapToScreen(camera, viewport, at);
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(centre.x, centre.y, { steps: 10 });
      await page.mouse.up();
      camera = panBy(camera, centre.x - from.x, centre.y - from.y, viewport, map);
    };

    await zoomTo({ x: 2520, y: 1950 }, 6);
    await frames(page);
    await page.getByRole('button', { name: 'Speed 2', exact: true }).click();
    await resume(page);
    await page.waitForFunction(
      (start) =>
        Number(
          document.querySelector('[data-testid=time-controls-day]')?.getAttribute('data-day'),
        ) >=
        start + 8,
      startDay,
      { timeout: 20_000 },
    );
    await pause(page);
    await frames(page);
    await shot(
      'army-in-sight',
      `Day ${await day(page)}: the Punic army has just come into Roman sight north of Arretium, and the Roman army's sight reaches past the Alps toward Carnuntum`,
    );

    await zoomTo({ x: 2250, y: 1990 }, 4);
    await frames(page);
    await shot(
      'fog-edge',
      `The edge of the fog at ${camera.scale.toFixed(1)} px per km: a band of pen hatching marks where Roman sight ends and fades away from it`,
    );
    await resume(page);

    // The clip takes a screenshot every 125 ms for its first 12 s, which would slow
    // every frame, so the measurement waits until it has stopped.
    await page.waitForTimeout(Math.max(0, CLIP_MS + 1000 - (Date.now() - started)));
    await page.getByRole('button', { name: 'Speed 3', exact: true }).click();
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Performance.enable');
    const taskSeconds = async () => {
      const { metrics } = await cdp.send('Performance.getMetrics');
      return metrics.find((metric) => metric.name === 'TaskDuration')?.value ?? NaN;
    };
    await page.evaluate(() => {
      const gaps: number[] = [];
      Reflect.set(globalThis, 'fogGaps', gaps);
      let last = performance.now();
      const step = (now: number) => {
        gaps.push(now - last);
        last = now;
        if (Reflect.get(globalThis, 'fogGaps') === gaps) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
    const busyBefore = await taskSeconds();
    for (const [x0, x1] of [
      [1000, 300],
      [300, 1000],
      [1000, 300],
      [300, 1000],
    ] as const) {
      await page.mouse.move(x0, 400);
      await page.mouse.down();
      await page.mouse.move(x1, 400, { steps: 40 });
      await page.mouse.up();
    }
    const busy = ((await taskSeconds()) - busyBefore) * 1000;
    const gaps = (
      await page.evaluate(() => {
        const recorded: unknown = Reflect.get(globalThis, 'fogGaps');
        Reflect.deleteProperty(globalThis, 'fogGaps');
        return Array.isArray(recorded) ? (recorded as number[]) : [];
      })
    )
      .slice(1)
      .sort((a, b) => a - b);
    const at = (p: number) => gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * p))] ?? NaN;
    const summary =
      `Pan with the fog on while both armies march at speed 3, ${camera.scale.toFixed(1)} px per km: ` +
      `${gaps.length} frames, frame interval median ${at(0.5).toFixed(1)} ms, p95 ${at(0.95).toFixed(1)} ms, ` +
      `main thread busy ${(busy / gaps.length).toFixed(1)} ms per frame`;
    console.log(summary);
    await shot('pan-frame-time', summary);
  },
});
