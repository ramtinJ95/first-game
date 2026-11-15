import { expect, test, type Page } from '@playwright/test';
import { BUILDINGS } from '../src/sim/buildings/buildings.ts';
import type { GameState } from '../src/sim/state/game-state.ts';
import {
  camera,
  cityPoint,
  day,
  dropSave,
  mediolanumFallenWithBuildings,
  openGame,
  pause,
  resume,
  romaTreasuryFull,
  setRich,
  startGame,
  untilDay,
  untilDrawn,
} from './support.ts';

const garrisonOf = (text: string | null) =>
  Number(/^([\d,]+) of/.exec(text ?? '')?.[1]?.replace(/,/g, ''));

async function load(page: Page, state: GameState) {
  await pause(page);
  await dropSave(page, state);
  await expect(page.getByTestId('time-controls-day')).toHaveAttribute(
    'data-day',
    String(state.day),
  );
  await untilDrawn(page);
}

/** Clicks the province 40 km south of the city, clear of the armies on its symbol. */
async function openCity(page: Page, id: string, name: string) {
  const at = cityPoint(id);
  const point = camera(page).screen({ x: at.x, y: at.y + 40 });
  await page.mouse.click(point.x, point.y);
  await expect(page.getByTestId('city-name')).toHaveText(name);
}

test.describe('buildings', () => {
  test.beforeEach(async ({ page }) => {
    await openGame(page);
  });

  test('Barracks ordered in Roma count their days down, are told when they stand, and shorten the days a recruit trains there', async ({
    page,
  }) => {
    const state = startGame();
    setRich(state);
    await load(page, state);
    await openCity(page, 'roma', 'Roma');
    const panel = page.getByTestId('city-panel');
    const barracks = panel.getByTestId('build-barracks');
    await expect(barracks).toContainText(/recruits train in .* the days/);
    const spearmen = panel.getByRole('button', { name: /^Spearmen/ });
    const trainingDays = async () =>
      Number(/(\d+) days/.exec((await spearmen.textContent()) ?? '')?.[1]);
    const before = await trainingDays();

    await barracks.click();
    const work = panel.getByTestId('city-construction');
    await expect(work).toHaveText('Barracks · ordered for the next day');
    await expect(panel.getByTestId('build-blocked')).toHaveText('Roma is building Barracks');

    await page.getByRole('button', { name: 'Speed 3', exact: true }).click();
    await resume(page);
    await expect(work).toHaveText(/^Barracks · \d+ days left/);
    const daysLeft = async () =>
      Number(/(\d+) days left/.exec((await work.textContent()) ?? '')?.[1]);
    const started = await daysLeft();
    await expect.poll(daysLeft).toBeLessThan(started - 5);

    const from = await day(page);
    for (let step = 15; step < started; step += 15) await untilDay(page, from + step);
    await expect(page.getByTestId('alerts')).toContainText('Barracks finished at Roma');
    await pause(page);

    await expect(work).toHaveCount(0);
    await expect(panel.getByTestId('city-built')).toContainText('Barracks');
    await expect(barracks).toHaveCount(0);
    expect(await trainingDays()).toBe(Math.ceil(before * BUILDINGS.barracks.trainingShare));
  });

  test('a sack destroys the buildings of a fallen city, as the fate prompt says, and the city panel lists none', async ({
    page,
  }) => {
    await load(page, mediolanumFallenWithBuildings());
    const prompt = page.getByTestId('fate-prompt');
    await expect(prompt.getByTestId('fate-occupy')).toContainText('Keeps its Canals and Towers');
    await expect(prompt.getByTestId('fate-enslave')).toContainText('Keeps its Canals and Towers');
    await expect(prompt.getByTestId('fate-sack')).toContainText('Destroys its Canals and Towers');

    await prompt.getByTestId('fate-sack').click();
    await expect(prompt).toHaveCount(0);
    await resume(page);
    await expect(page.getByTestId('alerts')).toContainText(
      'Sack of Mediolanum destroyed its Canals and Towers',
    );
    await pause(page);

    await openCity(page, 'mediolanum', 'Mediolanum');
    const buildings = page.getByTestId('city-panel').getByTestId('city-buildings');
    await expect(buildings).toContainText('None yet');
    await expect(buildings.getByTestId('city-built')).toHaveCount(0);
    await expect(buildings.getByTestId('build-towers')).toBeVisible();
  });

  test('a full treasury hires 500 guards in Roma, who stand on its walls the next day', async ({
    page,
  }) => {
    await load(page, romaTreasuryFull());
    await openCity(page, 'roma', 'Roma');
    const panel = page.getByTestId('city-panel');
    const garrison = panel.getByTestId('city-garrison');
    const line = panel.getByTestId('guards-line');
    await expect(line).toHaveText('No guards hired');
    await expect(panel.getByTestId('guards-dismiss')).toHaveCount(0);
    const before = garrisonOf(await garrison.textContent());

    const hire = panel.getByTestId('guards-hire');
    await expect(hire).toBeEnabled();
    await expect(hire).toHaveText('Hire 500 guards · 1,500 gold');
    await expect(panel.getByTestId('guards-change')).toContainText(
      `Garrison ${before.toLocaleString('en')} → ${(before + 500).toLocaleString('en')}`,
    );
    await hire.click();
    await expect(line).toHaveText('No guards hired · 500 more hired for the next day');

    const from = await day(page);
    await resume(page);
    await untilDay(page, from + 1);
    await pause(page);
    await expect(line).toHaveText(/^500 guards · 10 gold a day/);
    expect(garrisonOf(await garrison.textContent())).toBe(before + 500);
    await expect(panel.getByTestId('guards-dismiss')).toHaveText('Dismiss 500 · no gold back');
  });
});
