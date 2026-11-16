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
 *   node e2e/trade-minute-bench.ts [--roots /a,/b] [--zooms closest,middle] [--seconds 60] [--rounds 3] [--budget | --panel-budget]
 *   node e2e/trade-minute-bench.ts --alternate 4 [--segment 6] [--budget]
 *
 * `--budget` exits non-zero unless, on every root and zoom, Roma selected draws at least
 * nine tenths of the frames of nothing selected, its longest gap is at most a tenth longer,
 * and its panels run no more often than `MAX_REFRESHES_PER_DAY` a day played. Separate
 * pages need the full three rounds of a minute for the frame rules: on a 2-core software
 * GL host one build's frames spread by more than a tenth between page loads.
 * `--panel-budget` checks only the panels. With `--alternate`, both also fail when Roma's
 * routes drew their texture more often than the sea drew its own, beyond once a selection:
 * a count, since each such pass took most of a second on a software GPU and timing it is
 * noisy.
 *
 * `--open-day <d>` opens the routes on that day and `--from-day <d>` plays to that day
 * first, with the AI playing every power, as a played game would be; `--viewport 1600x900`
 * sizes the page. Each run prints its gaps over a second, with the days they spanned.
 *
 * `--alternate <n>` plays each zoom in one page and one game instead, in `n` segments of
 * `--segment` seconds that select Roma and nothing in the order none, Roma, Roma, none, so
 * a drift of the host or of the game falls on both alike, and compares frame rates: the
 * frames between each segment's first and last over the time they span. Each segment is one sweep of the
 * pan out and back, so the camera stands over Roma again when the next one picks. That is
 * short enough for CI's frame job.
 */
const { values } = parseArgs({
  options: {
    roots: { type: 'string', default: '.' },
    zooms: { type: 'string', default: 'closest,middle' },
    seconds: { type: 'string', default: '60' },
    rounds: { type: 'string', default: '3' },
    selections: { type: 'string', default: 'roma,none' },
    budget: { type: 'boolean', default: false },
    'panel-budget': { type: 'boolean', default: false },
    alternate: { type: 'string' },
    segment: { type: 'string', default: '6' },
    args: { type: 'string' },
    profile: { type: 'string' },
    query: { type: 'string', default: '' },
    css: { type: 'string' },
    'from-day': { type: 'string', default: '2' },
    'open-day': { type: 'string', default: '1' },
    viewport: { type: 'string', default: '1280x720' },
  },
});

const [viewWidth, viewHeight] = values.viewport.split('x').map(Number);
const VIEW = { width: viewWidth ?? 1280, height: viewHeight ?? 720 };
const ZOOMS: Record<string, number> = { closest: 4, middle: 1 };
/** A steady pan: the pointer sweeps this far either side of the middle at this speed. */
const PAN = { reach: 360, pxPerSecond: 120, stepMs: 50 };
/**
 * The panels run again when what they show changes: about once a day played, and on a
 * click. Republished unchanged ten times a second, they took the frames a selected city lost.
 */
const MAX_REFRESHES_PER_DAY = 1.5;
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
  /**
   * The frames between the first and the last of each segment, and the ms they span: a
   * frame rate that a segment's edges, which cut a frame in two, do not shift.
   */
  spannedFrames: number;
  spanned: number;
  longestGap: number;
  medianGap: number;
  days: number;
  paths: string | null;
  merchants: number;
  /** How often the panels ran again, from the page's `panels` measure. */
  refreshes: number;
  /** Textures of the view's size drawn again, from the canvas's `data-texture-passes`. */
  passes: number;
  /** The most of them in one frame. */
  framePasses: number;
  /** Of them, the sea's and a selected city's routes'. */
  seaPasses: number;
  tradePasses: number;
  /** How often the city was selected anew. */
  selections: number;
}

async function worldOf(root: string): Promise<{ save: string; day: number }> {
  const support = (await import(pathToFileURL(`${root}/e2e/support.ts`).href)) as {
    startGame(): GameState;
    playDays(state: GameState, days: number, orders: unknown[]): GameState;
    playAi(state: GameState, days: number): GameState;
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
  const openDay = Number(values['open-day']);
  const opening = openDay > state.day ? support.playAi(state, openDay - state.day) : state;
  const treasury = opening.factions[state.player];
  if (treasury) treasury.stores.gold = TREASURY;
  const played = support.playDays(opening, 1, [
    open('mogontiacum', 'land'),
    open('carthago', 'sea'),
    open('massalia', 'sea'),
  ]);
  const fromDay = Number(values['from-day']);
  const later = fromDay > played.day ? support.playAi(played, fromDay - played.day) : played;
  const running = Object.values(later.tradeRoutes).filter(
    (r) => r.status === 'running' && r.from === 'roma' && r.owner === state.player,
  );
  if (running.length !== 3) throw new Error(`${root}: expected 3 routes, opened ${running.length}`);
  return { save: save.saveGame(later), day: later.day };
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
      await page
        .getByTestId('city-name')
        .and(page.getByText('Roma'))
        .waitFor({ state: 'attached' });
    }
    await view.jumpTo(cityPoint('roma'), ZOOMS[zoom] ?? 1);
    await page.locator('canvas[data-terrain="ready"]').waitFor({ timeout: 120_000 });
    const drawnZoom = await page.locator('canvas[data-renderer]').getAttribute('data-zoom');
    if (Number(drawnZoom) !== ZOOMS[zoom]) throw new Error(`${zoom}: drew zoom ${drawnZoom}`);
    await page.getByRole('button', { name: 'Speed 2', exact: true }).click();
    const firstDay = await dayOf(page);
    await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>('canvas[data-renderer]');
      const record = { at: [performance.now()], stop: false, refreshes: 0 };
      Object.assign(globalThis, { benchFrames: record });
      new PerformanceObserver((list) => {
        if (!record.stop) record.refreshes += list.getEntriesByName('panels').length;
      }).observe({ type: 'measure' });
      const days: number[] = [];
      const passes: number[] = [];
      Object.assign(record, { days, passes });
      const day = document.querySelector<HTMLElement>('[data-testid="time-controls-day"]');
      let seen = canvas?.dataset['drawnFrames'];
      const watch = () => {
        const now = canvas?.dataset['drawnFrames'];
        if (now !== seen) {
          seen = now;
          record.at.push(performance.now());
          days.push(Number(day?.dataset['day']));
          passes.push(Number(canvas?.dataset['texturePasses'] ?? 0));
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
    const { at, refreshes, days, passes } = await page.evaluate(() => {
      const record = (
        globalThis as unknown as {
          benchFrames: {
            at: number[];
            stop: boolean;
            refreshes: number;
            days: number[];
            passes: number[];
          };
        }
      ).benchFrames;
      record.stop = true;
      return {
        at: [...record.at, performance.now()],
        refreshes: record.refreshes,
        days: record.days,
        passes: record.passes,
      };
    });
    const gaps = at
      .slice(1)
      .map((t, i) => ({
        from: at[i] ?? t,
        ms: t - (at[i] ?? t),
        days: `${days[i - 1]}-${days[i]}`,
      }))
      .filter((g) => g.ms > 1000)
      .map(
        (g) =>
          `${((g.from - (at[0] ?? 0)) / 1000).toFixed(1)}s+${(g.ms / 1000).toFixed(1)} d${g.days}`,
      );
    console.error(
      `gaps over 1 s at ${label} (start at ${(at[0] ?? 0).toFixed(0)}): ${gaps.join(', ')}`,
    );
    await page.mouse.up();
    if (cdp) {
      await browser.stopTracing();
      const { profile } = await cdp.send('Profiler.stop');
      writeFileSync(join(values.profile ?? '', `${label}.cpuprofile`), JSON.stringify(profile));
    }
    const canvas = page.locator('canvas[data-renderer]');
    const inside = at.slice(1, -1);
    const run: Run = {
      frames: at.length - 2,
      spannedFrames: Math.max(0, inside.length - 1),
      spanned: (inside.at(-1) ?? 0) - (inside[0] ?? 0),
      longestGap: Math.max(...at.slice(1).map((t, i) => t - (at[i] ?? t))),
      medianGap: median(at.slice(2, -1).map((t, i) => t - (at[i + 1] ?? t))),
      days: (await dayOf(page)) - firstDay,
      paths: await canvas.getAttribute('data-trade-paths'),
      merchants: Number((await canvas.getAttribute('data-trade-figures')) ?? 0),
      refreshes,
      passes: (passes.at(-1) ?? 0) - (passes[0] ?? 0),
      framePasses: Math.max(0, ...passes.slice(1).map((p, i) => p - (passes[i] ?? p))),
      seaPasses: 0,
      tradePasses: 0,
      selections: roma ? 1 : 0,
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

/** The bench's recorder in the page: when each frame finished, and the panels' refreshes. */
async function record(page: Page) {
  await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('canvas[data-renderer]');
    const record = { at: [] as number[], passes: [] as number[], stop: false, refreshes: 0 };
    Object.assign(globalThis, { benchFrames: record });
    new PerformanceObserver((list) => {
      record.refreshes += list.getEntriesByName('panels').length;
    }).observe({ type: 'measure' });
    let seen = canvas?.dataset['drawnFrames'];
    const watch = () => {
      const now = canvas?.dataset['drawnFrames'];
      if (now !== seen) {
        seen = now;
        record.at.push(performance.now());
        record.passes.push(Number(canvas?.dataset['texturePasses'] ?? 0));
      }
      if (!record.stop) requestAnimationFrame(watch);
    };
    requestAnimationFrame(watch);
  });
}

function recorded(page: Page) {
  return page.evaluate(() => {
    const { at, passes, refreshes } = (
      globalThis as unknown as {
        benchFrames: { at: number[]; passes: number[]; refreshes: number };
      }
    ).benchFrames;
    const canvas = document.querySelector<HTMLCanvasElement>('canvas[data-renderer]');
    return {
      at: [...at],
      passes: [...passes],
      passesNow: Number(canvas?.dataset['texturePasses'] ?? 0),
      seaNow: Number(canvas?.dataset['seaPasses'] ?? 0),
      tradeNow: Number(canvas?.dataset['tradePasses'] ?? 0),
      refreshes,
      now: performance.now(),
    };
  });
}

/** Sweeps the held pointer out and back once on one side, in `ms`. */
async function sweep(page: Page, side: 1 | -1, ms: number) {
  const middle = { x: VIEW.width / 2, y: VIEW.height / 2 };
  const start = Date.now();
  for (let t = 0; t < ms; t = Date.now() - start) {
    const out = (2 * t) / ms;
    await page.mouse.move(middle.x + side * PAN.reach * (out < 1 ? out : 2 - out), middle.y);
    await delay(PAN.stepMs);
  }
  await page.mouse.move(middle.x, middle.y);
}

async function alternate(
  browser: Browser,
  base: string,
  world: { save: string; day: number },
  zoom: string,
  segments: number,
  segmentMs: number,
): Promise<Record<'roma' | 'none', Run>> {
  const context = await browser.newContext({ viewport: VIEW });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (m) => {
    if (m.text().startsWith('PASSES')) console.error(m.text());
  });
  try {
    await openGame(page, { base, query: ['draw=full', values.query].filter(Boolean).join('&') });
    await pause(page);
    await dropSave(page, world.save);
    await page.locator(`[data-testid="time-controls-day"][data-day="${world.day}"]`).waitFor();
    await untilDrawn(page);
    const view = camera(page);
    await view.jumpTo(cityPoint('roma'), ZOOMS[zoom] ?? 1);
    await page.locator('canvas[data-terrain="ready"]').waitFor({ timeout: 120_000 });
    await page.getByRole('button', { name: 'Speed 2', exact: true }).click();
    await record(page);
    await page.getByRole('button', { name: 'Resume', exact: true }).click();
    const runs: Record<'roma' | 'none', Run> = {
      roma: {
        frames: 0,
        spannedFrames: 0,
        spanned: 0,
        longestGap: 0,
        medianGap: 0,
        days: 0,
        paths: null,
        merchants: 0,
        refreshes: 0,
        passes: 0,
        framePasses: 0,
        seaPasses: 0,
        tradePasses: 0,
        selections: 0,
      },
      none: {
        frames: 0,
        spannedFrames: 0,
        spanned: 0,
        longestGap: 0,
        medianGap: 0,
        days: 0,
        paths: null,
        merchants: 0,
        refreshes: 0,
        passes: 0,
        framePasses: 0,
        seaPasses: 0,
        tradePasses: 0,
        selections: 0,
      },
    };
    const intervals: Record<'roma' | 'none', number[]> = { roma: [], none: [] };
    const middle = { x: VIEW.width / 2, y: VIEW.height / 2 };
    const canvas = page.locator('canvas[data-renderer]');
    const name = page.getByTestId('city-name');
    for (let k = 0; k < segments; k++) {
      const selection = [0, 1, 1, 0][k % 4] ? 'roma' : 'none';
      // A click picks what the map last finished drawing, so wait for the camera's return.
      await untilDrawn(page);
      if (selection === 'roma') {
        if ((await name.count()) === 0) {
          await page.mouse.click(middle.x, middle.y);
          runs.roma.selections++;
        }
        await name.and(page.getByText('Roma')).waitFor({ state: 'attached' });
      } else {
        if ((await name.count()) > 0) await page.keyboard.press('Escape');
        await name.waitFor({ state: 'detached' });
      }
      const firstDay = await dayOf(page);
      const before = await recorded(page);
      await page.mouse.move(middle.x, middle.y);
      await page.mouse.down();
      await sweep(page, k % 2 ? -1 : 1, segmentMs);
      const after = await recorded(page);
      await page.mouse.up();
      const at = [before.now, ...after.at.filter((t) => t > before.now), after.now];
      const run = runs[selection];
      run.frames += at.length - 2;
      const inside = at.slice(1, -1);
      if (inside.length >= 2) {
        run.spannedFrames += inside.length - 1;
        run.spanned += (inside.at(-1) ?? 0) - (inside[0] ?? 0);
      }
      run.longestGap = Math.max(run.longestGap, ...at.slice(1).map((t, i) => t - (at[i] ?? t)));
      intervals[selection].push(...at.slice(2, -1).map((t, i) => t - (at[i + 1] ?? t)));
      run.days += (await dayOf(page)) - firstDay;
      run.refreshes += after.refreshes - before.refreshes;
      run.passes += after.passesNow - before.passesNow;
      run.seaPasses += after.seaNow - before.seaNow;
      run.tradePasses += after.tradeNow - before.tradeNow;
      const counted = after.passes.slice(before.passes.length - 1);
      run.framePasses = Math.max(
        run.framePasses,
        ...counted.slice(1).map((p, i) => p - (counted[i] ?? p)),
      );
      run.paths = await canvas.getAttribute('data-trade-paths');
      run.merchants = Number((await canvas.getAttribute('data-trade-figures')) ?? 0);
    }
    for (const selection of ['roma', 'none'] as const) {
      runs[selection].medianGap = median(intervals[selection]);
      if (runs[selection].days <= 0) throw new Error('the game did not advance');
    }
    if (runs.roma.paths !== '3' && runs.roma.paths !== null)
      throw new Error(`Roma selected drew ${runs.roma.paths} routes, not 3`);
    if (errors.length > 0) throw new Error(errors.join('; '));
    return runs;
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
        if (values.alternate) {
          const runs = await alternate(
            browser,
            base,
            world,
            zoom,
            Number(values.alternate),
            1000 * Number(values.segment),
          );
          for (const [selection, run] of Object.entries(runs)) {
            const key = `${root} | ${zoom} | ${selection}`;
            results.set(key, [...(results.get(key) ?? []), run]);
            console.error(
              `round ${round + 1} ${key}: ${run.frames} frames (${((1000 * run.spannedFrames) / run.spanned).toFixed(2)} a second), longest gap ${(run.longestGap / 1000).toFixed(2)} s, median ${run.medianGap.toFixed(0)} ms, ${run.days} days, ${run.refreshes} panel refreshes, ${run.passes} texture passes (at most ${run.framePasses} a frame; sea ${run.seaPasses}, routes ${run.tradePasses}), paths ${run.paths}, merchants ${run.merchants}`,
            );
          }
          continue;
        }
        const sides = round % 2 ? [...selections].reverse() : selections;
        for (const selection of sides) {
          const key = `${root} | ${zoom} | ${selection}`;
          const run = await measure(browser, base, world, zoom, selection === 'roma');
          results.set(key, [...(results.get(key) ?? []), run]);
          console.error(
            `round ${round + 1} ${key}: ${run.frames} frames (${((1000 * run.spannedFrames) / run.spanned).toFixed(2)} a second), longest gap ${(run.longestGap / 1000).toFixed(2)} s, median ${run.medianGap.toFixed(0)} ms, ${run.days} days, ${run.refreshes} panel refreshes, ${run.passes} texture passes (at most ${run.framePasses} a frame; sea ${run.seaPasses}, routes ${run.tradePasses}), paths ${run.paths}, merchants ${run.merchants}`,
          );
        }
      }
  }
} finally {
  await browser.close();
  await Promise.all(servers.map(({ server }) => server.close()));
}

console.log(
  values.alternate
    ? `Rome, three routes from Roma, speed 2, ${values.alternate} alternating ${values.segment} s sweeps of ${PAN.reach} px in one page a zoom, ${rounds} rounds`
    : `Rome, three routes from Roma, speed 2, a ${PAN.pxPerSecond} px/s pan, ${seconds} s, ${rounds} rounds`,
);
console.log(
  '| Build | Zoom | Selected | Frames drawn (each round) | Longest gap, s (each round) | Panel refreshes per day |',
);
console.log('| --- | --- | --- | --- | --- | --- |');
for (const [key, runs] of results) {
  const [root, zoom, selection] = key.split(' | ');
  console.log(
    `| ${root} | ${zoom} | ${selection} | ${median(runs.map((r) => r.frames))} (${runs.map((r) => r.frames).join(', ')}) | ${(median(runs.map((r) => r.longestGap)) / 1000).toFixed(2)} (${runs.map((r) => (r.longestGap / 1000).toFixed(2)).join(', ')}) | ${median(runs.map((r) => r.refreshes / r.days)).toFixed(1)} |`,
  );
}

if (values.budget || values['panel-budget']) {
  const failures: string[] = [];
  for (const root of roots)
    for (const zoom of zooms) {
      const selected = results.get(`${root} | ${zoom} | roma`) ?? [];
      const none = results.get(`${root} | ${zoom} | none`) ?? [];
      // One page a zoom compares frame rates over equal time; separate pages, frame counts.
      const count = (r: Run) =>
        values.alternate ? (1000 * r.spannedFrames) / r.spanned : r.frames;
      const unit = values.alternate ? 'frames a second' : 'frames';
      const frames = median(selected.map(count));
      const floor = 0.9 * median(none.map(count));
      const gap = median(selected.map((r) => r.longestGap));
      const ceiling = 1.1 * median(none.map((r) => r.longestGap));
      const perDay = median(selected.map((r) => r.refreshes / r.days));
      // The routes' texture follows the view as the sea's does, and is drawn anew once a selection.
      const extra = Math.max(...selected.map((r) => r.tradePasses - r.seaPasses - r.selections));
      if (values.alternate && extra > 0)
        failures.push(
          `${zoom}: Roma's routes drew their texture ${extra} more times than the sea's and the selections'`,
        );
      if (values.budget && !(frames >= floor))
        failures.push(
          `${zoom}: Roma selected drew ${frames.toFixed(2)} ${unit}, under ${floor.toFixed(2)}`,
        );
      if (values.budget && !(gap <= ceiling))
        failures.push(
          `${zoom}: Roma selected's longest gap ${gap.toFixed(0)} ms exceeds ${ceiling.toFixed(0)} ms`,
        );
      if (!(perDay <= MAX_REFRESHES_PER_DAY))
        failures.push(
          `${zoom}: with Roma selected the panels ran ${perDay.toFixed(1)} times a day, over ${MAX_REFRESHES_PER_DAY}`,
        );
    }
  if (failures.length > 0) {
    console.log(failures.join('\n'));
    process.exitCode = 1;
  }
}
