import { chromium, type Browser, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { preview } from 'vite';
import { SOFTWARE_GL } from '../playwright.config.ts';
import { fitCamera, mapToScreen, MAX_SCALE, wheelFactor, zoomAt } from '../src/render/camera.ts';
import { LAYERS } from '../src/render/renderer.ts';
import { decideAll } from '../src/sim/ai/decide.ts';
import { saveGame } from '../src/sim/save.ts';
import { tick } from '../src/sim/tick.ts';
import type { MapPoint } from '../src/sim/state/map-point.ts';
import { buildWorld } from '../src/sim/world/world.ts';
import { map, openGame, pause, resume, startGame } from './support.ts';
import { yieldToTests } from '../scripts/runs.ts';

/**
 * Plays the built page under each drawing and prints the frame interval that the
 * page's own `?frames` readout reports, median and p95, in rounds that take the
 * drawings in turn so drift favours none. Build first with `npm run build`.
 *
 * Each page loads a game that the faction AI has played for `--days` days, so armies
 * march, fight, and besiege on it, and plays on at speed 1.
 *
 * `--zooms widest,middle,closest` measures each drawing at those zooms: the whole map,
 * 1 px per km over Italy, and the 4 px per km camera limit over the Alps.
 * `plateau-middle` and `plateau-closest` look at the Persian plateau at 1.6 and 4.
 * A loaded game stays paused through camera setup; sampling then runs at speed 1.
 * `--root <dir>` compares another checkout's build, which must report drawn state
 * and zoom metadata so the loaded game and measured view can be verified.
 *
 *   node e2e/frame-bench.ts [--rounds 3] [--days 300] [--only full,draw=test] [--zooms widest,middle,closest] [--args "--flag ..."]
 */
await yieldToTests();
const { values } = parseArgs({
  options: {
    rounds: { type: 'string', default: '3' },
    only: { type: 'string' },
    args: { type: 'string' },
    shots: { type: 'string' },
    channel: { type: 'string' },
    days: { type: 'string', default: '300' },
    zooms: { type: 'string', default: 'widest' },
    root: { type: 'string' },
  },
});

const ALL: Record<string, string> = {
  full: '',
  ...Object.fromEntries(LAYERS.map(({ name }) => [`hide=${name}`, `hide=${name}`])),
  'swell=off': 'swell=off',
  'antialias=off': 'antialias=off',
  'resolution=0.5': 'resolution=0.5',
  'draw=test': 'draw=test',
};
const names = values.only ? values.only.split(',') : Object.keys(ALL);
const rounds = Number(values.rounds);
const launchArgs = values.args ? values.args.split(' ') : [...SOFTWARE_GL];
const WARM_MS = 1500;
const WINDOW_MS = 5000;

interface Reading {
  median: number;
  p95: number;
  drawMedian: number;
  drawP95: number;
}

const ZOOMS: Record<string, { at: MapPoint; scale: number } | undefined> = {
  widest: undefined,
  middle: { at: { x: 2600, y: 2200 }, scale: 1 },
  closest: { at: { x: 2420, y: 1880 }, scale: 4.2 },
  'plateau-middle': { at: { x: 6000, y: 3150 }, scale: 1.6 },
  'plateau-closest': { at: { x: 6080, y: 3330 }, scale: 4.2 },
  'delta-closest': { at: { x: 4053, y: 3616 }, scale: 4 },
  'azov-closest': { at: { x: 4423, y: 1890 }, scale: 4 },
  'aegean-closest': { at: { x: 3540, y: 2989 }, scale: 4 },
  'bosporus-closest': { at: { x: 3850, y: 2526 }, scale: 4 },
  'atlantic-closest': { at: { x: 684, y: 2171 }, scale: 4 },
};
const zooms = values.zooms.split(',');
for (const zoom of zooms) if (!(zoom in ZOOMS)) throw new Error(`unknown zoom ${zoom}`);

/** Wheels to the exact requested scale, capped at the camera limit, then centres `at`. */
async function zoomTo(page: Page, at: MapPoint, scale: number) {
  const viewport = { width: 1280, height: 720 };
  let camera = fitCamera(viewport, map);
  const notch = Math.log(wheelFactor(-100));
  const cursor = mapToScreen(camera, viewport, at);
  await page.mouse.move(cursor.x, cursor.y);
  for (let n = Math.round(Math.log(scale / camera.scale) / notch); n > 0; n--) {
    await page.mouse.wheel(0, -100);
    camera = zoomAt(camera, cursor, wheelFactor(-100), viewport, map);
    await delay(30);
  }
  const exactScale = Math.min(scale, MAX_SCALE);
  const finalDelta = -Math.log(exactScale / camera.scale) / 0.002;
  await page.mouse.wheel(0, finalDelta);
  camera = zoomAt(camera, cursor, wheelFactor(finalDelta), viewport, map);
  const from = mapToScreen(camera, viewport, at);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(viewport.width / 2, viewport.height / 2, { steps: 5 });
  await page.mouse.up();
  const busy = page.locator('canvas[data-terrain="busy"]');
  const flagged = await page.locator('canvas[data-terrain]').count();
  if (flagged > 0) {
    // The flag still says "ready" for the old view until the page draws a frame of the new one.
    await busy.waitFor({ timeout: 10_000 }).catch(() => undefined);
    await busy.waitFor({ state: 'detached', timeout: 120_000 }).catch(() => undefined);
  }
}

async function measure(browser: Browser, base: string, query: string, zoom: string, shot?: string) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openGame(page, { base, query: `frames${query ? `&${query}` : ''}` });
  const meter = page.getByTestId('frame-meter');
  await meter.waitFor();
  if (save) {
    await pause(page);
    await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => done())));
    await page.locator('canvas[data-latest-state]').waitFor();
    const beforeLoad = await page.locator('canvas').getAttribute('data-latest-state');
    if (!beforeLoad) throw new Error('Cannot verify save receipt without a state marker');
    const dataTransfer = await page.evaluateHandle((text) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([text], 'save.json', { type: 'application/json' }));
      return transfer;
    }, save);
    await page.dispatchEvent('canvas', 'drop', { dataTransfer });
    // The opening game can already have this day. A changed, drawn state while
    // its predecessor was paused witnesses receipt of this file, not a clock tick.
    await page
      .waitForFunction(
        ({ before, day }) => {
          const canvas = document.querySelector('canvas');
          const latest = canvas?.dataset['latestState'];
          return (
            latest !== undefined &&
            latest !== before &&
            latest === canvas?.dataset['drawnState'] &&
            Number(
              document.querySelector('[data-testid="time-controls-day"]')?.getAttribute('data-day'),
            ) >= day
          );
        },
        { before: beforeLoad, day: days },
      )
      .catch(async (error: unknown) => {
        console.error(
          'Save receipt failed',
          { beforeLoad, expectedDay: days },
          await page.evaluate(() => ({
            canvas: { ...document.querySelector('canvas')?.dataset },
            day: document.querySelector('[data-testid="time-controls-day"]')?.outerHTML,
            text: document.body.innerText.slice(-2500),
          })),
        );
        throw error;
      });
  }
  const view = ZOOMS[zoom];
  if (view) {
    await zoomTo(page, view.at, view.scale);
    const expected = Math.min(view.scale, MAX_SCALE).toFixed(4);
    const actual = await page.locator('canvas[data-renderer]').getAttribute('data-zoom');
    if (actual !== expected) throw new Error(`${zoom}: expected zoom ${expected}, drew ${actual}`);
  }
  await resume(page);
  await delay(WARM_MS + WINDOW_MS);
  const reading = await meter.evaluate((el) => ({
    median: Number(el.dataset['median']),
    p95: Number(el.dataset['p95']),
    drawMedian: Number(el.dataset['drawMedian']),
    drawP95: Number(el.dataset['drawP95']),
  }));
  const gl = await page.evaluate(() => {
    const context = document.createElement('canvas').getContext('webgl2');
    const info = context?.getExtension('WEBGL_debug_renderer_info');
    return info ? String(context?.getParameter(info.UNMASKED_RENDERER_WEBGL)) : 'no WebGL 2';
  });
  if (shot) await page.screenshot({ path: shot });
  await context.close();
  if (errors.length > 0) throw new Error(`${query}: ${errors.join('; ')}`);
  if (!(reading.drawMedian > 0)) throw new Error(`${query}: the meter read nothing`);
  return { reading, gl };
}

const days = 1 + Number(values.days);
const world = buildWorld(map);
let game = startGame();
while (game.day < days) game = tick(game, decideAll(game, world), world).state;
const save = days > 1 ? saveGame(game) : undefined;
const armies = Object.values(game.armies);
console.error(
  `day ${game.day}: ${armies.length} armies, ${armies.filter((a) => a.activity.kind === 'marching').length} marching, ${Object.keys(game.battles).length} battles, ${Object.keys(game.sieges).length} sieges`,
);

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? NaN;

const server = await preview({
  root: values.root,
  logLevel: 'warn',
  preview: { host: '127.0.0.1', port: 0, open: false },
});
const base = server.resolvedUrls?.local[0]?.replace(/\/$/, '');
if (!base) throw new Error('vite preview gave no URL');
const browser = await chromium.launch({ args: launchArgs, channel: values.channel });
const results = new Map<string, Reading[]>(
  names.flatMap((name) => zooms.map((zoom) => [`${name} @ ${zoom}`, []] as [string, Reading[]])),
);
let renderer = '';
try {
  if (values.shots) mkdirSync(values.shots, { recursive: true });
  for (let round = 0; round < rounds; round++) {
    for (const name of names) {
      for (const zoom of zooms) {
        const query = ALL[name];
        if (query === undefined) throw new Error(`unknown drawing ${name}`);
        const shot =
          round === 0 && values.shots
            ? join(resolve(values.shots), `${name.replace(/[=,]/g, '-')}-${zoom}.png`)
            : undefined;
        const { reading, gl } = await measure(browser, base, query, zoom, shot);
        renderer = gl;
        results.get(`${name} @ ${zoom}`)?.push(reading);
        console.error(
          `round ${round + 1} ${name} @ ${zoom}: interval ${reading.median} / ${reading.p95}, drawn ${reading.drawMedian} / ${reading.drawP95} ms`,
        );
      }
    }
  }
} finally {
  await browser.close();
  await server.close();
}

console.log(`GL renderer: ${renderer}`);
console.log(`Game: day ${days} of a game the faction AI played, at speed 1`);
console.log(`Chromium args: ${launchArgs.join(' ')}`);
console.log(
  `| Drawing | Frame interval median (ms) | p95 | Drawn frame median (ms) | p95 | Interval medians of ${rounds} rounds |`,
);
console.log('| --- | --- | --- | --- | --- | --- |');
for (const [name, readings] of results) {
  const pick = (key: keyof Reading) => median(readings.map((r) => r[key]));
  console.log(
    `| ${name} | ${pick('median')} | ${pick('p95')} | ${pick('drawMedian')} | ${pick('drawP95')} | ${readings.map((r) => r.median).join(', ')} |`,
  );
}
