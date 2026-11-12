import { expect, test, type Page } from '@playwright/test';
import { dropSave, outnumberedAt, pause, resume, startGame } from './support.ts';

async function today(page: Page): Promise<number> {
  return Number(await page.getByTestId('time-controls-day').getAttribute('data-day'));
}

test('a beaten army beside its own city retreats to safety, is alive 30 days on, and the alerts tell it all', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.getByTestId('top-bar').waitFor({ state: 'visible' });
  await pause(page);
  const state = startGame();
  outnumberedAt(state, 'capua', 4500);
  await dropSave(page, state);
  await expect(page.getByTestId('time-controls-day')).toHaveAttribute('data-day', '1');

  await page.getByRole('button', { name: 'Speed 1', exact: true }).click();
  await resume(page);
  const alerts = page.getByTestId('alerts');
  const ended = alerts.getByRole('button', {
    name: /Carthage held the field (at|near) Capua after \d+ days?\. You lost \d+ men, Carthage lost \d+\./,
  });
  await expect(ended).toBeVisible({ timeout: 15_000 });
  await pause(page);
  await expect(
    alerts.getByRole('button', { name: /Battle (at|near) Capua against Carthage/ }),
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
  const brokeOn = await today(page);

  await page.getByRole('button', { name: 'Speed 3', exact: true }).click();
  await resume(page);
  await expect.poll(() => today(page), { timeout: 30_000 }).toBeGreaterThanOrEqual(brokeOn + 30);
  await pause(page);
  await expect(panel.getByTestId('army-activity')).toBeVisible();
  expect(errors).toEqual([]);
});
