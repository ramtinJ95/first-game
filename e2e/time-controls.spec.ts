import { expect, test, type Page } from '@playwright/test';

async function day(page: Page): Promise<number> {
  const text = await page.getByTestId('time-controls-day').getAttribute('data-day');
  if (!text || !/^\d+$/.test(text)) throw new Error(`unexpected day: ${text}`);
  return Number(text);
}

async function daysOver(page: Page, ms: number): Promise<number> {
  const start = await day(page);
  await page.waitForTimeout(ms);
  return (await day(page)) - start;
}

test.describe('time controls', () => {
  const errors: string[] = [];

  test.beforeEach(async ({ page }) => {
    errors.length = 0;
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/');
    await page.getByTestId('time-controls').waitFor({ state: 'visible' });
  });

  test.afterEach(() => {
    expect(errors).toEqual([]);
  });

  test('the day advances while the game runs', async ({ page }) => {
    await expect.poll(() => day(page), { timeout: 5000 }).toBeGreaterThanOrEqual(3);
  });

  test('Space pauses the day and Space resumes it', async ({ page }) => {
    await expect.poll(() => day(page)).toBeGreaterThanOrEqual(2);
    await page.keyboard.press('Space');
    await expect(page.getByRole('button', { name: 'Resume' })).toBeVisible();
    expect(await daysOver(page, 1500)).toBe(0);

    await page.keyboard.press('Space');
    await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
    expect(await daysOver(page, 1500)).toBeGreaterThanOrEqual(1);
  });

  test('speed 3 advances days faster than speed 1 and shows as pressed', async ({ page }) => {
    const speed1 = page.getByRole('button', { name: 'Speed 1', exact: true });
    const speed3 = page.getByRole('button', { name: 'Speed 3', exact: true });
    await expect(speed1).toHaveAttribute('aria-pressed', 'true');
    const slow = await daysOver(page, 2000);

    await speed3.click();
    await expect(speed3).toHaveAttribute('aria-pressed', 'true');
    await expect(speed1).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('time-controls-speed')).toContainText('Speed 3');
    const fast = await daysOver(page, 2000);

    expect(fast).toBeGreaterThan(slow * 2);
  });

  test('Space toggles pause once after a speed button is clicked', async ({ page }) => {
    await page.getByRole('button', { name: 'Speed 2', exact: true }).click();
    await page.keyboard.press('Space');
    await expect(page.getByRole('button', { name: 'Resume' })).toBeVisible();
    expect(await daysOver(page, 1200)).toBe(0);
  });

  test('Space toggles pause once while the pause button has focus', async ({ page }) => {
    const pause = page.getByRole('button', { name: 'Pause' });
    await pause.click();
    const resume = page.getByRole('button', { name: 'Resume' });
    await resume.click();
    await expect(pause).toBeFocused();

    await page.keyboard.press('Space');
    await expect(resume).toBeVisible();
    expect(await daysOver(page, 1200)).toBe(0);
  });

  test('Space toggles pause once while a button has keyboard focus', async ({ page }) => {
    await page.getByRole('button', { name: 'Pause' }).focus();
    await page.keyboard.press('Space');
    await expect(page.getByRole('button', { name: 'Resume' })).toBeVisible();
    await page.keyboard.press('Space');
    await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
  });
});
