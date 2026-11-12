import { expect, test, type Page } from '@playwright/test';
import { openGame } from './support.ts';

async function day(page: Page): Promise<number> {
  const text = await page.getByTestId('time-controls-day').getAttribute('data-day');
  if (!text || !/^\d+$/.test(text)) throw new Error(`unexpected day: ${text}`);
  return Number(text);
}

/**
 * Waits until the day passes `after`. The rate of the days at each speed is the clock's
 * unit test, so a browser test waits for a day and never counts days in real seconds.
 */
async function nextDay(page: Page, after: number) {
  await expect.poll(() => day(page)).toBeGreaterThan(after);
}

test.describe('time controls', () => {
  const errors: string[] = [];

  test.beforeEach(async ({ page }) => {
    errors.length = 0;
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('pageerror', (error) => errors.push(error.message));
    await openGame(page);
  });

  test.afterEach(() => {
    expect(errors).toEqual([]);
  });

  test('the day advances while the game runs', async ({ page }) => {
    await nextDay(page, await day(page));
  });

  test('Space pauses the day and Space resumes it', async ({ page }) => {
    await nextDay(page, 1);
    await page.keyboard.press('Space');
    await expect(page.getByRole('button', { name: 'Resume' })).toBeVisible();
    await expect(page.getByTestId('time-controls-speed')).toHaveText('Paused');

    const paused = await day(page);
    await page.keyboard.press('Space');
    await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
    await expect(page.getByTestId('time-controls-speed')).toHaveText('Speed 1');
    await nextDay(page, paused);
  });

  test('speed 3 sets the clock to speed 3, shows as pressed, and the days run on', async ({
    page,
  }) => {
    const speed1 = page.getByRole('button', { name: 'Speed 1', exact: true });
    const speed3 = page.getByRole('button', { name: 'Speed 3', exact: true });
    await expect(speed1).toHaveAttribute('aria-pressed', 'true');

    await speed3.click();
    await expect(speed3).toHaveAttribute('aria-pressed', 'true');
    await expect(speed1).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('time-controls-speed')).toHaveText('Speed 3');
    await nextDay(page, await day(page));
  });

  test('Space toggles pause once after a speed button is clicked', async ({ page }) => {
    await page.getByRole('button', { name: 'Speed 2', exact: true }).click();
    await page.keyboard.press('Space');
    await expect(page.getByRole('button', { name: 'Resume' })).toBeVisible();
    await expect(page.getByTestId('time-controls-speed')).toHaveText('Paused');
  });

  test('Space toggles pause once while the pause button has focus', async ({ page }) => {
    const pause = page.getByRole('button', { name: 'Pause' });
    await pause.click();
    const resume = page.getByRole('button', { name: 'Resume' });
    await resume.click();
    await expect(pause).toBeFocused();

    await page.keyboard.press('Space');
    await expect(resume).toBeVisible();
    await expect(page.getByTestId('time-controls-speed')).toHaveText('Paused');
  });

  test('Space toggles pause once while a button has keyboard focus', async ({ page }) => {
    await page.getByRole('button', { name: 'Pause' }).focus();
    await page.keyboard.press('Space');
    await expect(page.getByRole('button', { name: 'Resume' })).toBeVisible();
    await page.keyboard.press('Space');
    await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
  });
});
