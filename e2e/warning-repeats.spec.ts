import { expect, test, type Page } from '@playwright/test';
import { dateText } from '../src/app/names.ts';
import {
  CARTHAGE_STOPPED_ON,
  carthageWarnsAgain,
  day,
  dropSave,
  openGame,
  pause,
  resume,
  untilDay,
  untilDrawn,
} from './support.ts';

async function load(page: Page, share: number) {
  await openGame(page, { pauses: true });
  await pause(page);
  await dropSave(page, carthageWarnsAgain(share));
  await expect(page.getByTestId('time-controls-day')).toHaveAttribute('data-day', '300');
  await untilDrawn(page);
  await page.getByRole('button', { name: 'Speed 3', exact: true }).click();
  await resume(page);
}

const warning = (page: Page) =>
  page
    .getByTestId('alerts')
    .getByRole('listitem')
    .filter({ hasText: /Carthage could soon declare war on you/ });

test('a warning soon after a stop for the same power, no higher, runs the game on and is told in the corner, the At peace list and the chronicle', async ({
  page,
}) => {
  await load(page, 100);
  const line = warning(page);
  await line.waitFor();
  await expect(line).toContainText(
    `The game ran on: its stop on ${dateText(CARTHAGE_STOPPED_ON)} was at 100%, and it stands no higher.`,
  );
  await expect(line.getByTestId('alert-paused')).toHaveCount(0);
  const warnedOn = await day(page);
  await untilDay(page, warnedOn + 3);
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  await pause(page);
  await page.getByTestId('wars-button').click();
  await expect(
    page.getByTestId('wars-panel').getByTestId('threat-row').filter({ hasText: 'Carthage has' }),
  ).toContainText(`and the game ran on: its stop on ${dateText(CARTHAGE_STOPPED_ON)} was at 100%.`);
  await page.getByRole('button', { name: 'Chronicle' }).click();
  await expect(
    page
      .getByTestId('chronicle')
      .getByRole('listitem')
      .filter({ hasText: /Carthage could soon declare war on you.*The game ran on/ }),
  ).toHaveCount(1);
});

test('a warning soon after a stop for the same power, clearly higher, stops the game', async ({
  page,
}) => {
  await load(page, 50);
  const line = warning(page);
  await line.waitFor();
  await expect(line.getByTestId('alert-paused')).toHaveCount(1);
  await expect(line).not.toContainText('The game ran on');
  await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
});
