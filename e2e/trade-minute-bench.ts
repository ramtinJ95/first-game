import { chromium, type Browser, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { preview } from 'vite';
import { SOFTWARE_GL } from '../playwright.config.ts';
import type { GameState } from '../src/sim/state/game-state.ts';
import { camera, cityPoint, dropSave, openGame, pause, untilDrawn } from './support.ts';

/**
 * Plays the seventh play-through's minute on each built checkout: Rome has opened
 * three routes from Roma (the Mogontiacum road, the Carthago and Massalia lanes) on
 * day 1, and the game runs at speed 2 while the camera pans steadily, with Roma
 * selected and with nothing selected. It counts the frames the GPU finished and the
 * longest gap between two of them, as a player sees them, so the page runs without
 * `?frames` and its frame pacer holds frames as it does in a game.
 *
 * Each checkout builds its own world with its own rules and save format, so an older
 * build loads a save it understands. Build each checkout first (`npm run build`).
 *
 *   node e2e/trade-minute-bench.ts [--roots /a,/b] [--zooms closest,middle] [--seconds 60] [--rounds 3] [--budget]
 *
 * `--budget` exits non-zero unless, on every root and zoom, Roma selected draws at least
 * nine tenths of the frames of nothing selected and its longest gap is no longer.
 */
const { values } = parseArgs({
  options: {
    roots: { type: 'string', default: '.' },
    zooms: { type: 'string', default: 'closest,middle' },
    seconds: { type: 'string', default: '60' },
    rounds: { type: 'string', default: '3' },
    selections: { type: 'string', default: 'roma,none' },
    budget: { type: 'boolean', default: false },
    args: { type: 'string' },
    profile: { type: 'string' },
    query: { type: 'string', default: '' },
    css: { type: 'string' },
  },
});

const VIEW = { width: 1280, height: 720 };
const ZOOMS: Record<string, number> = { closest: 4, middle: 1 };
/** A steady pan: the pointer sweeps this far either side of the middle at this speed. */
const PAN = { reach: 360, pxPerSecond: 120, stepMs: 50 };
/** Gold for three openings on day 1; a new game's treasury pays for one. */
const TREASURY = 7000;

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? NaN;
const roots = values.roots.split(',').map((root) => resolve(root));
const zooms = values.zooms.split(',');
for (const zoom of zooms) if (!(zoom in ZOOMS)) throw new Error(`unknown zoom ${zoom}`);
const selections = values.selections.split(',');
const seconds = Number(values.seconds);
const rounds = Number(values.rounds);

interface Run {
  frames: number;
  longestGap: number;
  medianGap: number;
  days: number;
  paths: string | null;
  merchants: number;
}

async function worldOf(root: string): Promise<{ save: string; day: number }> {
  const support = (await import(pathToFileURL(`${root}/e2e/support.ts`).href)) as {
    startGame(): GameState;
    playDays(state: GameState, days: number, orders: unknown[]): GameState;
  };
  const save = (await import(pathToFileURL(`${root}/src/sim/save.ts`).href)) as {
    saveGame(state: GameState): string;
  };
  const state = support.startGame();
  const rome = state.factions[state.player];
  if (!rome) throw new Error('Rome is missing');
  rome.stores.gold = TREASURY;
  const open = (to: string, mode: 'land' | 'sea') => ({
    kind: 'openTrade',
    faction: state.player,
    from: 'roma',
    to,
    mode,
  });
  const played = support.playDays(state, 1, [
    open('mogontiacum', 'land'),
    open('carthago', 'sea'),
    open('massalia', 'sea'),
  ]);
  const running = Object.values(played.tradeRoutes).filter((r) => r.status === 'running');
  if (running.length !== 3) throw new Error(`${root}: expected 3 routes, opened ${running.length}`);
  return { save: save.saveGame(played), day: played.day };
}

async function measure(
  browser: Browser,
  base: string,
  world: { save: string; day: number },
  zoom: string,
  roma: boolean,
) {
  const context = await browser.newContext({ viewport: VIEW });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await openGame(page, { base, query: ['draw=full', values.query].filter(Boolean).join('&') });
    if (values.css) await page.addStyleTag({ content: values.css });
    await pause(page);
    await dropSave(page, world.save);
    await page.locator(`[data-testid="time-controls-day"][data-day="${world.day}"]`).waitFor();
    await untilDrawn(page);
    const view = camera(page);
    if (roma) {
      const at = view.city('roma');
      await page.mouse.click(at.x, at.y);
      await page.getByTestId('city-name').and(page.getByText('Roma')).waitFor();
    }
    await view.jumpTo(cityPoint('roma'), ZOOMS[zoom] ?? 1);
    await page.locator('canvas[data-terrain="ready"]').waitFor({ timeout: 120_000 });
    const drawnZoom = await page.locator('canvas[data-renderer]').getAttribute('data-zoom');
    if (Number(drawnZoom) !== ZOOMS[zoom]) throw new Error(`${zoom}: drew zoom ${drawnZoom}`);
    await page.getByRole('button', { name: 'Speed 2', exact: true }).click();
    const firstDay = await dayOf(page);
    await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>('canvas[data-renderer]');
      const record = { at: [performance.now()], stop: false };
      Object.assign(globalThis, { benchFrames: record });
      let seen = canvas?.dataset['drawnFrames'];
      const watch = () => {
        const now = canvas?.dataset['drawnFrames'];
        if (now !== seen) {
          seen = now;
          record.at.push(performance.now());
        }
        if (!record.stop) requestAnimationFrame(watch);
      };
      requestAnimationFrame(watch);
    });
    await page.getByRole('button', { name: 'Resume', exact: true }).click();
    const middle = { x: VIEW.width / 2, y: VIEW.height / 2 };
    await page.mouse.move(middle.x, middle.y);
    await page.mouse.down();
    const label = `${zoom}-${roma ? 'roma' : 'none'}-${Date.now()}`;
    const cdp = values.profile ? await context.newCDPSession(page) : undefined;
    if (cdp) {
      await cdp.send('Profiler.enable');
      await cdp.send('Profiler.start');
      await browser.startTracing(page, {
        path: join(values.profile ?? '', `${label}.trace.json`),
        categories: [
          'devtools.timeline',
          'gpu',
          'viz',
          'toplevel',
          'disabled-by-default-devtools.timeline',
        ],
      });
    }
    const start = Date.now();
    while (Date.now() - start < seconds * 1000) {
      const travelled = ((Date.now() - start) / 1000) * PAN.pxPerSecond;
      const period = 4 * PAN.reach;
      const phase = travelled % period;
      const offset =
        phase < PAN.reach ? phase : phase < 3 * PAN.reach ? 2 * PAN.reach - phase : phase - period;
      await page.mouse.move(middle.x + offset, middle.y);
      await delay(PAN.stepMs);
    }
    const at = await page.evaluate(() => {
      const record = (globalThis as unknown as { benchFrames: { at: number[]; stop: boolean } })
        .benchFrames;
      record.stop = true;
      return [...record.at, performance.now()];
    });
    await page.mouse.up();
    if (cdp) {
      await browser.stopTracing();
      const { profile } = await cdp.send('Profiler.stop');
      writeFileSync(join(values.profile ?? '', `${label}.cpuprofile`), JSON.stringify(profile));
    }
    const canvas = page.locator('canvas[data-renderer]');
    const run: Run = {
      frames: at.length - 2,
      longestGap: Math.max(...at.slice(1).map((t, i) => t - (at[i] ?? t))),
      medianGap: median(at.slice(2, -1).map((t, i) => t - (at[i + 1] ?? t))),
      days: (await dayOf(page)) - firstDay,
      paths: await canvas.getAttribute('data-trade-paths'),
      merchants: Number((await canvas.getAttribute('data-trade-figures')) ?? 0),
    };
    if (roma && (await page.getByTestId('city-name').textContent()) !== 'Roma')
      throw new Error('Roma lost its selection during the minute');
    if (run.days <= 0) throw new Error('the game did not advance');
    if (errors.length > 0) throw new Error(errors.join('; '));
    return run;
  } finally {
    await context.close();
  }
}

async function dayOf(page: Page): Promise<number> {
  return Number(await page.getByTestId('time-controls-day').getAttribute('data-day'));
}

const servers = await Promise.all(
  roots.map(async (root) => {
    const server = await preview({
      root,
      logLevel: 'warn',
      preview: { host: '127.0.0.1', port: 0, open: false },
    });
    const base = server.resolvedUrls?.local[0]?.replace(/\/$/, '');
    if (!base) throw new Error('vite preview gave no URL');
    return { root, base, server, world: await worldOf(root) };
  }),
);
const browser = await chromium.launch({
  args: values.args ? values.args.split(' ') : [...SOFTWARE_GL],
});
const results = new Map<string, Run[]>();
if (values.profile) mkdirSync(values.profile, { recursive: true });
try {
  for (let round = 0; round < rounds; round++) {
    const order = round % 2 ? [...servers].reverse() : servers;
    for (const { root, base, world } of order)
      for (const zoom of zooms) {
        const sides = round % 2 ? [...selections].reverse() : selections;
        for (const selection of sides) {
          const key = `${root} | ${zoom} | ${selection}`;
          const run = await measure(browser, base, world, zoom, selection === 'roma');
          results.set(key, [...(results.get(key) ?? []), run]);
          console.error(
            `round ${round + 1} ${key}: ${run.frames} frames, longest gap ${(run.longestGap / 1000).toFixed(2)} s, median ${run.medianGap.toFixed(0)} ms, ${run.days} days, paths ${run.paths}, merchants ${run.merchants}`,
          );
        }
      }
  }
} finally {
  await browser.close();
  await Promise.all(servers.map(({ server }) => server.close()));
}

console.log(
  `Rome, three routes from Roma, speed 2, a ${PAN.pxPerSecond} px/s pan, ${seconds} s, ${rounds} rounds`,
);
console.log(
  '| Build | Zoom | Selected | Frames drawn (each round) | Longest gap, s (each round) |',
);
console.log('| --- | --- | --- | --- | --- |');
for (const [key, runs] of results) {
  const [root, zoom, selection] = key.split(' | ');
  console.log(
    `| ${root} | ${zoom} | ${selection} | ${median(runs.map((r) => r.frames))} (${runs.map((r) => r.frames).join(', ')}) | ${(median(runs.map((r) => r.longestGap)) / 1000).toFixed(2)} (${runs.map((r) => (r.longestGap / 1000).toFixed(2)).join(', ')}) |`,
  );
}

if (values.budget) {
  const failures: string[] = [];
  for (const root of roots)
    for (const zoom of zooms) {
      const selected = results.get(`${root} | ${zoom} | roma`) ?? [];
      const none = results.get(`${root} | ${zoom} | none`) ?? [];
      const frames = median(selected.map((r) => r.frames));
      const floor = 0.9 * median(none.map((r) => r.frames));
      const gap = median(selected.map((r) => r.longestGap));
      const ceiling = median(none.map((r) => r.longestGap));
      if (!(frames >= floor))
        failures.push(`${zoom}: Roma selected drew ${frames} frames, under ${floor.toFixed(1)}`);
      if (!(gap <= ceiling))
        failures.push(
          `${zoom}: Roma selected's longest gap ${gap.toFixed(0)} ms exceeds ${ceiling.toFixed(0)} ms`,
        );
    }
  if (failures.length > 0) {
    console.log(failures.join('\n'));
    process.exitCode = 1;
  }
}
