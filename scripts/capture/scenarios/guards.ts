import { expect, type Page } from '@playwright/test';
import {
  camera,
  carthageNearsWar,
  cityPoint,
  day,
  dropSave,
  openGame,
  pause,
  resizeTo,
  resume,
  romaBandLeavesTomorrow,
  romaTreasuryFull,
  untilDay,
  untilDrawn,
} from '../../../e2e/support.ts';
import type { GameState } from '../../../src/sim/state/game-state.ts';
import { defineScenario } from '../scenario.ts';

const WIDE = { width: 1280, height: 720 };
const PHONE = { width: 390, height: 844 };

async function load(page: Page, state: GameState) {
  await pause(page);
  await dropSave(page, state);
  await expect(page.getByTestId('time-controls-day')).toHaveAttribute(
    'data-day',
    String(state.day),
  );
  await untilDrawn(page);
}

/** Opens Roma's panel from a click 40 km south of it, clear of the army on its symbol. */
async function openRoma(page: Page) {
  const at = cityPoint('roma');
  const point = camera(page).screen({ x: at.x, y: at.y + 40 });
  await page.mouse.click(point.x, point.y);
  await expect(page.getByTestId('city-name')).toHaveText('Roma');
}

/** Shoots Roma's guards at 1280 by 720 and on a phone, where the side column is a sheet. */
async function bothSizes(
  page: Page,
  shot: (name: string, title: string) => Promise<void>,
  name: string,
  title: string,
) {
  const guards = page.getByTestId('city-guards');
  await guards.scrollIntoViewIfNeeded();
  await shot(`${name}-1280`, `${title}, at 1280 by 720`);
  await resizeTo(page, PHONE);
  await page.locator('canvas[data-terrain="ready"]').waitFor();
  await guards.scrollIntoViewIfNeeded();
  await shot(`${name}-390`, `${title}, at 390 px wide, where the side column is a sheet`);
  await resizeTo(page, WIDE);
  await page.locator('canvas[data-terrain="ready"]').waitFor();
}

export default defineScenario({
  name: 'guards',
  title:
    "Guards a city hires for a year: Roma's full treasury, the hire with its price and what it changes, the guards on the walls the next day with the day they leave and the day great powers stop counting them, the hire against Carthage's threat, and a band that leaves",
  viewport: WIDE,
  async run({ page, shot }) {
    await openGame(page);
    await load(page, romaTreasuryFull());
    await page.getByTestId('store-gold-note').waitFor();
    const why = await page.getByTestId('store-gold').getAttribute('title');
    await shot(
      'treasury-full',
      `The top bar with Rome's treasury full. Its tooltip reads: "${why}"`,
    );

    await openRoma(page);
    await bothSizes(
      page,
      shot,
      'before-hire',
      "Roma's guards before a hire: none held, and Hire 500 guards for a year with its price and the garrison before and after",
    );

    await page.getByTestId('guards-hire').click();
    await expect(page.getByTestId('guards-line')).toContainText('500 more hired for the next day');
    const from = await day(page);
    await resume(page);
    await untilDay(page, from + 1);
    await pause(page);
    await expect(page.getByTestId('guards-line')).toHaveText(/^500 guards · 500 leave Year /);
    await bothSizes(
      page,
      shot,
      'after-hire',
      'The next day Roma holds 500 guards, its garrison is 500 higher, the line names the day the band leaves, and the next line the day great powers stop counting it against a war, 90 days on',
    );

    await load(page, carthageNearsWar());
    await resume(page);
    await page
      .getByTestId('alerts')
      .getByText(/could soon declare war on you/)
      .waitFor();
    await pause(page);
    await openRoma(page);
    await expect(page.getByTestId('guards-threat')).toContainText(/^Carthage \d+% → \d+%/);
    await bothSizes(
      page,
      shot,
      'threat-hire',
      "Carthage nears the strength it needs against Roma: Roma's Guards section says how near it stands now and with one more band, and until when the band counts",
    );

    await load(page, romaBandLeavesTomorrow());
    const left = await day(page);
    await resume(page);
    await untilDay(page, left + 1);
    await pause(page);
    await page
      .getByTestId('alerts')
      .getByText(/have served their year and left/)
      .waitFor();
    await shot(
      'band-left',
      'A band leaves Roma: the news says how long fresh guards count against a war, and to hire them when the news warns of one',
    );
    await openRoma(page);
    await expect(page.getByTestId('guards-weighed')).toHaveText('None count against a war now');
    await page.getByTestId('city-guards').scrollIntoViewIfNeeded();
    await shot(
      'none-count',
      'Roma still holds a band hired 100 days ago, on its walls till its year ends, but great powers no longer count it against a war',
    );
  },
});
