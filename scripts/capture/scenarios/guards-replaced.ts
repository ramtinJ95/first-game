import { expect, type Page } from '@playwright/test';
import {
  armyOf,
  camera,
  carthage,
  carthageNearsWar,
  cityPoint,
  day,
  dropSave,
  openGame,
  pause,
  resizeTo,
  resume,
  untilDay,
  untilDrawn,
} from '../../../e2e/support.ts';
import type { CityId, FormationId } from '../../../src/sim/ids.ts';
import type { Day } from '../../../src/sim/state/day.ts';
import type { GameState } from '../../../src/sim/state/game-state.ts';
import { defineScenario } from '../scenario.ts';

const WIDE = { width: 1280, height: 720 };
const PHONE = { width: 390, height: 844 };

/**
 * Carthage of 6,000 men on notice against Roma since day 80, on day 100, and Roma holding the
 * most guards it may, 3,000, all hired on day 1, so no great power still counts them: the
 * refusal the thirteenth play-through met at Ariminum with 9,000 gold in hand.
 */
function romaFullOfOldGuards(): GameState {
  const state = carthageNearsWar();
  state.day = 100 as Day;
  const punic = state.formations[armyOf(state, carthage).formations[0] as FormationId];
  const power = state.factions[carthage];
  const roma = state.cities['roma' as CityId];
  if (!punic || !power || !roma) throw new Error('no Carthaginian army or Roma');
  punic.men = 6000;
  power.noticeSince = 80 as Day;
  roma.guards = Array.from({ length: 6 }, () => ({ until: 366 as Day }));
  roma.garrison += 3000;
  return state;
}

async function openRoma(page: Page) {
  const at = cityPoint('roma');
  const point = camera(page).screen({ x: at.x, y: at.y + 40 });
  await page.mouse.click(point.x, point.y);
  await expect(page.getByTestId('city-name')).toHaveText('Roma');
}

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
  name: 'guards-replaced',
  title:
    'A city full of guards no great power still counts hires a new band in place of the oldest: the panel names the band it replaces and counts the bands it may still hire, and the news tells of the band that left to make room',
  viewport: WIDE,
  async run({ page, shot }) {
    await openGame(page);
    await pause(page);
    await dropSave(page, romaFullOfOldGuards());
    await expect(page.getByTestId('time-controls-day')).toHaveAttribute('data-day', '100');
    await untilDrawn(page);
    await openRoma(page);
    await expect(page.getByTestId('guards-refused')).toHaveCount(0);
    await expect(page.getByTestId('guards-change')).toHaveText(
      'Takes the place of the 500 who leave Year 2, day 1, whom no great power still counts',
    );
    await expect(page.getByTestId('guards-threat')).toContainText(
      'takes it to 88%; 2 bands, 4,000 gold, take it to 78%, below 80%',
    );
    await bothSizes(
      page,
      shot,
      'replace-before',
      'Roma holds the most guards it may, none still counted: the hire names the band it replaces, and the Guards section counts 2 bands, 4,000 gold, to take Carthage below 80%',
    );
    await page.getByTestId('guards-hire').click();
    await expect(page.getByTestId('guards-line')).toContainText('500 more hired for the next day');
    await expect(page.getByTestId('guards-threat')).toContainText('with the band you hired: 88%');
    await bothSizes(
      page,
      shot,
      'replace-hired',
      'With one band hired for the next day, the section counts it as hired though the guards on the walls stay at 3,000',
    );
    const from = await day(page);
    await resume(page);
    await untilDay(page, from + 1);
    await pause(page);
    await page
      .getByTestId('alerts')
      .getByText(/left today to make room for the band you hired in their place/)
      .waitFor();
    await untilDrawn(page);
    await shot(
      'replace-news-1280',
      'The next day the news tells of the 500 guards who left to make room, and the day great powers count the new band until',
    );
  },
});
