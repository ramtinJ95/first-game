import { expect, test } from '@playwright/test';
import { firstDayWhen } from './fog-game.ts';
import {
  armyOf,
  dropSave,
  outnumberedAt,
  pause,
  resume,
  rome,
  startGame,
  untilDay,
} from './support.ts';

test('a beaten army beside its own city retreats to safety, is alive 30 days on, and the alerts tell it all', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.getByTestId('top-bar').waitFor({ state: 'visible' });
  await pause(page);
  const state = startGame();
  outnumberedAt(state, 'capua', 4500);
  const roman = armyOf(state, rome).id;
  const brokeOn = firstDayWhen(state, (s) => s.armies[roman]?.activity.kind === 'retreating');
  await dropSave(page, state);
  await expect(page.getByTestId('time-controls-day')).toHaveAttribute('data-day', '1');

  await page.getByRole('button', { name: 'Speed 1', exact: true }).click();
  await resume(page);
  await untilDay(page, brokeOn);
  await pause(page);
  const alerts = page.getByTestId('alerts');
  await expect(
    alerts.getByRole('button', { name: /Battle (at|near) Capua against Carthage/ }),
  ).toBeVisible();
  await expect(
    alerts.getByRole('button', {
      name: /Carthage held the field (at|near) Capua after \d+ days?\. You lost \d+ men, Carthage lost \d+\./,
    }),
  ).toBeVisible();
  const retreat = alerts.getByRole('button', {
    name: /Your army broke (at|near) Capua, losing \d+ men to the pursuit, and falls back to Roma/,
  });
  await expect(retreat).toBeVisible();

  await retreat.click();
  const panel = page.getByTestId('army-panel');
  await expect(panel.getByTestId('army-activity')).toHaveText(
    /^Retreating to Roma · \d+ days? left$/,
  );

  await page.getByRole('button', { name: 'Speed 3', exact: true }).click();
  await resume(page);
  for (let target = brokeOn + 5; target <= brokeOn + 30; target += 5) {
    await untilDay(page, target);
  }
  await pause(page);
  await expect(panel.getByTestId('army-activity')).toBeVisible();
  expect(errors).toEqual([]);
});
