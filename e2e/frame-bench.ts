import { chromium, type Browser } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { preview } from 'vite';
import { SOFTWARE_GL } from '../playwright.config.ts';
import { LAYERS } from '../src/render/renderer.ts';

/**
 * Plays the built page under each drawing and prints the frame interval that the
 * page's own `?frames` readout reports, median and p95, in rounds that take the
 * drawings in turn so drift favours none. Build first with `npm run build`.
 *
 *   node e2e/frame-bench.ts [--rounds 3] [--only full,draw=test] [--args "--flag ..."]
 */
const { values } = parseArgs({
  options: {
    rounds: { type: 'string', default: '3' },
    only: { type: 'string' },
    args: { type: 'string' },
    shots: { type: 'string' },
    channel: { type: 'string' },
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

async function measure(browser: Browser, base: string, query: string, shot?: string) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${base}/?frames${query ? `&${query}` : ''}`);
  const meter = page.getByTestId('frame-meter');
  await meter.waitFor();
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

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? NaN;

const server = await preview({
  logLevel: 'warn',
  preview: { host: '127.0.0.1', port: 0, open: false },
});
const base = server.resolvedUrls?.local[0]?.replace(/\/$/, '');
if (!base) throw new Error('vite preview gave no URL');
const browser = await chromium.launch({ args: launchArgs, channel: values.channel });
const results = new Map<string, Reading[]>(names.map((name) => [name, []]));
let renderer = '';
try {
  if (values.shots) mkdirSync(values.shots, { recursive: true });
  for (let round = 0; round < rounds; round++) {
    for (const name of names) {
      const query = ALL[name];
      if (query === undefined) throw new Error(`unknown drawing ${name}`);
      const shot =
        round === 0 && values.shots
          ? join(resolve(values.shots), `${name.replace(/[=,]/g, '-')}.png`)
          : undefined;
      const { reading, gl } = await measure(browser, base, query, shot);
      renderer = gl;
      results.get(name)?.push(reading);
      console.error(
        `round ${round + 1} ${name}: interval ${reading.median} / ${reading.p95}, drawn ${reading.drawMedian} / ${reading.drawP95} ms`,
      );
    }
  }
} finally {
  await browser.close();
  await server.close();
}

console.log(`GL renderer: ${renderer}`);
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
