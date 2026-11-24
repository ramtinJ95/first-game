import { chromium, type Page } from '@playwright/test';
import { parseArgs } from 'node:util';
import { preview } from 'vite';
import { SOFTWARE_GL } from '../playwright.config.ts';
import type { CityId, FormationId } from '../src/sim/ids.ts';
import type { Day } from '../src/sim/state/day.ts';
import type { GameState } from '../src/sim/state/game-state.ts';
import { GUARD_BAND, GUARD_DAYS, GUARD_GOLD } from '../src/sim/guards.ts';
import { yieldToTests } from '../scripts/runs.ts';
import {
  armyOf,
  camera,
  carthage,
  carthageNearsWar,
  cityPoint,
  dropSave,
  openGame,
  pause,
  resume,
} from './support.ts';

/**
 * The frames of a game in which the player answered a warning, so the page plays the game
 * without the answer beside it (`createAnswerNews`), against the same days with the same
 * guards already on the walls and no answer given, so no copy runs. Both start from
 * `carthageNearsWar` with 6,400 Carthaginians on notice since day 80, on day 100, and play
 * at speed 3 on the full map. It prints, for each, the frame interval's median, p95 and
 * longest, and the share of frames over 16.7 ms. Build first with `npm run build`.
 *
 *   node e2e/answer-frame-bench.ts [--rounds 2] [--seconds 20] [--only full,draw=test]
 */
await yieldToTests();
const { values } = parseArgs({
  options: {
    rounds: { type: 'string', default: '2' },
    seconds: { type: 'string', default: '20' },
    only: { type: 'string', default: 'full,draw=test' },
  },
});

const BANDS = 3;
const FRAME_MS = 1000 / 60;

/** Carthage of 6,400 at full strength against Roma on day 100, warned, with `guards` bands already hired today. */
function carthageWarned(guards: number): GameState {
  const state = carthageNearsWar();
  state.day = 100 as Day;
  for (const truce of Object.values(state.truces)) truce.endsOn = (100 + 3650) as Day;
  const spearmen = state.formations[armyOf(state, carthage).formations[0] as FormationId];
  const punic = state.factions[carthage];
  const roma = state.cities['roma' as CityId];
  const stores = state.factions['rome' as never]?.stores;
  if (!spearmen || !punic || !roma || !stores) throw new Error('no Carthage, Roma or Rome');
  spearmen.men = 6400;
  punic.noticeSince = 80 as Day;
  for (let i = 0; i < guards; i++) roma.guards.push({ until: (100 + GUARD_DAYS) as Day });
  roma.garrison += guards * GUARD_BAND;
  stores.gold -= guards * GUARD_GOLD;
  return state;
}

/**
 * Opens Roma's panel, hires the bands there when `hire`, as a player answers the warning, and
 * closes it, so both games play with the same panels shut.
 */
async function visitRoma(page: Page, hire: boolean) {
  const at = cityPoint('roma');
  const point = camera(page).screen({ x: at.x, y: at.y + 40 });
  await page.mouse.click(point.x, point.y);
  await page.getByTestId('city-name').filter({ hasText: 'Roma' }).waitFor();
  if (hire) for (let i = 0; i < BANDS; i++) await page.getByTestId('guards-hire').click();
  await page.keyboard.press('Escape');
  await page.getByTestId('city-panel').waitFor({ state: 'detached' });
}

/** The intervals between animation frames over `ms`, as the page draws them, each with the day shown after it. */
function intervals(page: Page, ms: number): Promise<{ gap: number; day: number }[]> {
  return page.evaluate(
    (span) =>
      new Promise<{ gap: number; day: number }[]>((done) => {
        const times: number[] = [];
        const days: number[] = [];
        const shown = document.querySelector('[data-testid="time-controls-day"]');
        const step = (t: number) => {
          times.push(t);
          days.push(Number(shown?.getAttribute('data-day')));
          if (t - (times[0] ?? t) < span) requestAnimationFrame(step);
          else
            done(
              times
                .slice(1)
                .map((time, i) => ({ gap: time - (times[i] ?? time), day: days[i + 1] ?? 0 })),
            );
        };
        requestAnimationFrame(step);
      }),
    ms,
  );
}

interface Reading {
  median: number;
  p95: number;
  longest: number;
  /** The day shown after the longest frame. */
  longestDay: number;
  over: number;
  days: number;
}

const at = (sorted: number[], share: number) =>
  sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))] ?? 0;

async function measure(base: string, query: string, answered: boolean): Promise<Reading> {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await openGame(page, { base, query });
  await pause(page);
  await dropSave(page, carthageWarned(answered ? 0 : BANDS));
  await visitRoma(page, answered);
  await page.getByRole('button', { name: 'Speed 3', exact: true }).click();
  const from = Number(await page.getByTestId('time-controls-day').getAttribute('data-day'));
  await resume(page);
  const frames = await intervals(page, Number(values.seconds) * 1000);
  const gaps = frames.map((frame) => frame.gap);
  const worst = frames.reduce((a, b) => (b.gap > a.gap ? b : a), { gap: 0, day: 0 });
  const to = Number(await page.getByTestId('time-controls-day').getAttribute('data-day'));
  await page.close();
  const sorted = [...gaps].sort((a, b) => a - b);
  return {
    median: at(sorted, 0.5),
    p95: at(sorted, 0.95),
    longest: sorted.at(-1) ?? 0,
    longestDay: worst.day,
    over: gaps.filter((gap) => gap > FRAME_MS).length / Math.max(1, gaps.length),
    days: to - from,
  };
}

const server = await preview({
  logLevel: 'warn',
  preview: { host: '127.0.0.1', port: 0, open: false },
});
const base = server.resolvedUrls?.local[0]?.replace(/\/$/, '');
if (!base) throw new Error('vite preview gave no URL');
const browser = await chromium.launch({ args: [...SOFTWARE_GL] });
const results = new Map<string, Reading[]>();
for (let round = 0; round < Number(values.rounds); round++)
  for (const draw of values.only.split(','))
    for (const answered of [true, false]) {
      const key = `${draw} | ${answered ? 'answered, copy running' : 'same guards, no copy'}`;
      const query = draw === 'full' ? '' : draw;
      results.set(key, [...(results.get(key) ?? []), await measure(base, query, answered)]);
    }
await browser.close();
await server.close();

const ms = (n: number) => `${n.toFixed(1)} ms`;
console.log(
  `| drawing | game | days played | median frame | p95 | longest, on day | frames over ${FRAME_MS.toFixed(1)} ms |`,
);
console.log('| --- | --- | ---: | ---: | ---: | ---: | ---: |');
for (const [key, readings] of results)
  for (const r of readings)
    console.log(
      `| ${key.replace(' | ', ' | ')} | ${r.days} | ${ms(r.median)} | ${ms(r.p95)} | ${ms(r.longest)}, ${r.longestDay} | ${(r.over * 100).toFixed(1)} % |`,
    );
