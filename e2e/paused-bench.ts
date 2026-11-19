import { chromium, type Browser, type CDPSession } from '@playwright/test';
import { setTimeout as delay } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { preview } from 'vite';
import { SOFTWARE_GL } from '../playwright.config.ts';
import { decideAll } from '../src/sim/ai/decide.ts';
import { saveGame } from '../src/sim/save.ts';
import { tick } from '../src/sim/tick.ts';
import { buildWorld } from '../src/sim/world/world.ts';
import { camera, cityPoint, map, openGame, pause, startGame, untilDrawn } from './support.ts';
import { yieldToTests } from '../scripts/runs.ts';

/**
 * What a paused game that nobody touches costs: the frames the map draws a second, the
 * page's main-thread time, and the CPU time of every process of the browser (the GPU
 * process draws in software under SwiftShader), over `--seconds` of a paused game at
 * the middle zoom over Roma, with nothing selected and with Roma selected. Build first
 * with `npm run build`; `--root <dir>` measures another checkout's build.
 *
 *   node e2e/paused-bench.ts [--seconds 30] [--days 300] [--rounds 1] [--root <dir>] [--args "--flag ..."]
 */
await yieldToTests();
const { values } = parseArgs({
  options: {
    seconds: { type: 'string', default: '30' },
    days: { type: 'string', default: '300' },
    rounds: { type: 'string', default: '1' },
    root: { type: 'string' },
    args: { type: 'string' },
  },
});
const seconds = Number(values.seconds);
const launchArgs = values.args ? values.args.split(' ') : [...SOFTWARE_GL];
const MIDDLE = 1;

interface Reading {
  frames: number;
  mainMs: number;
  scriptMs: number;
  cpuMs: number;
}

async function taskSeconds(cdp: CDPSession) {
  const { metrics } = await cdp.send('Performance.getMetrics');
  const value = (name: string) => metrics.find((m) => m.name === name)?.value ?? 0;
  return { task: value('TaskDuration'), script: value('ScriptDuration') };
}

async function browserCpuSeconds(cdp: CDPSession): Promise<number> {
  const { processInfo } = (await cdp.send('SystemInfo.getProcessInfo')) as {
    processInfo: { cpuTime: number }[];
  };
  return processInfo.reduce((sum, p) => sum + p.cpuTime, 0);
}

async function measure(browser: Browser, base: string, roma: boolean): Promise<Reading> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openGame(page, { base, query: 'draw=full' });
  await pause(page);
  if (save) {
    const before = await page.locator('canvas[data-renderer]').getAttribute('data-latest-state');
    const dataTransfer = await page.evaluateHandle((text) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([text], 'save.json', { type: 'application/json' }));
      return transfer;
    }, save);
    await page.dispatchEvent('canvas', 'drop', { dataTransfer });
    await page.waitForFunction(
      (was) => document.querySelector('canvas')?.dataset['latestState'] !== was,
      before,
    );
    await pause(page);
    await untilDrawn(page);
  }
  const view = camera(page);
  await view.jumpTo(cityPoint('roma'), MIDDLE);
  await page.locator('canvas[data-terrain="ready"]').waitFor({ timeout: 120_000 });
  if (roma) {
    const at = view.city('roma');
    await page.mouse.click(at.x, at.y);
    await page.getByTestId('city-name').filter({ hasText: 'Roma' }).waitFor();
    await untilDrawn(page);
  }
  // Out of the way of the map, so hovering picks nothing.
  await page.mouse.move(0, 0);
  if (!(await page.getByRole('button', { name: 'Resume', exact: true }).isVisible())) {
    throw new Error('the game is not paused');
  }
  await delay(2000);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  const browserCdp = await browser.newBrowserCDPSession();
  const frames = () =>
    page.evaluate(() => Number(document.querySelector('canvas')?.dataset['drawnFrames']));
  const startFrames = await frames();
  const startTask = await taskSeconds(cdp);
  const startCpu = await browserCpuSeconds(browserCdp);
  await delay(seconds * 1000);
  const endFrames = await frames();
  const endTask = await taskSeconds(cdp);
  const endCpu = await browserCpuSeconds(browserCdp);
  await browserCdp.detach();
  await context.close();
  if (errors.length > 0) throw new Error(errors.join('; '));
  return {
    frames: endFrames - startFrames,
    mainMs: (endTask.task - startTask.task) * 1000,
    scriptMs: (endTask.script - startTask.script) * 1000,
    cpuMs: (endCpu - startCpu) * 1000,
  };
}

const days = 1 + Number(values.days);
const world = buildWorld(map);
let game = startGame();
while (game.day < days) game = tick(game, decideAll(game, world), world).state;
const save = days > 1 ? saveGame(game) : undefined;

const server = await preview({
  root: values.root,
  logLevel: 'warn',
  preview: { host: '127.0.0.1', port: 0, open: false },
});
const base = server.resolvedUrls?.local[0]?.replace(/\/$/, '');
if (!base) throw new Error('vite preview gave no URL');
const browser = await chromium.launch({ args: launchArgs });
const rows: { name: string; reading: Reading }[] = [];
try {
  for (let round = 0; round < Number(values.rounds); round++) {
    for (const roma of [false, true]) {
      const reading = await measure(browser, base, roma);
      const name = roma ? 'Roma selected' : 'nothing selected';
      rows.push({ name, reading });
      console.error(`round ${round + 1} ${name}: ${JSON.stringify(reading)}`);
    }
  }
} finally {
  await browser.close();
  await server.close();
}

const perSecond = (n: number) => (n / seconds).toFixed(1);
console.log(`Paused ${seconds} s at the middle zoom over Roma, day ${days}, 1280 × 720, draw=full`);
console.log(`Chromium args: ${launchArgs.join(' ')}`);
console.log(
  '| Selection | Frames drawn a second | Main thread ms a second | Script ms a second | Browser CPU ms a second |',
);
console.log('| --- | --- | --- | --- | --- |');
for (const { name, reading } of rows) {
  console.log(
    `| ${name} | ${perSecond(reading.frames)} | ${perSecond(reading.mainMs)} | ${perSecond(reading.scriptMs)} | ${perSecond(reading.cpuMs)} |`,
  );
}
