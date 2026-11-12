import { expect, test, type Page } from '@playwright/test';

/** The day the page shows, and the page's clock in ms when it showed it. */
async function reading(page: Page): Promise<{ day: number; at: number }> {
  const read = await page.getByTestId('time-controls-day').evaluate((el) => ({
    day: el.getAttribute('data-day'),
    at: performance.now(),
  }));
  if (!read.day || !/^\d+$/.test(read.day)) throw new Error(`unexpected day: ${read.day}`);
  return { day: Number(read.day), at: read.at };
}

async function day(page: Page): Promise<number> {
  return (await reading(page)).day;
}

/** Waits until the day passes `after`, whatever the speed of the machine. */
async function nextDay(page: Page, after: number) {
  await expect.poll(() => day(page)).toBeGreaterThan(after);
}

/**
 * Days that pass while the page's clock runs `ms`, counted after two more animation
 * frames, so the clock has had its chance to run the days that time owes. Only a
 * check that no day passes waits for a time, because nothing happening has no state.
 */
async function daysOver(page: Page, ms: number): Promise<number> {
  const start = await day(page);
  await page.evaluate(
    (ms) =>
      new Promise<void>((done) => {
        const until = performance.now() + ms;
        const frame = () =>
          performance.now() < until
            ? requestAnimationFrame(frame)
            : requestAnimationFrame(() => requestAnimationFrame(() => done()));
        requestAnimationFrame(frame);
      }),
    ms,
  );
  return (await day(page)) - start;
}

/** Game days per second of the page's own clock, over the time `days` days take. */
async function daysPerSecond(page: Page, days: number): Promise<number> {
  const start = await reading(page);
  await expect.poll(() => day(page)).toBeGreaterThanOrEqual(start.day + days);
  const end = await reading(page);
  return (end.day - start.day) / ((end.at - start.at) / 1000);
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
    await nextDay(page, await day(page));
  });

  test('Space pauses the day and Space resumes it', async ({ page }) => {
    await nextDay(page, 1);
    await page.keyboard.press('Space');
    await expect(page.getByRole('button', { name: 'Resume' })).toBeVisible();
    expect(await daysOver(page, 1500)).toBe(0);

    const paused = await day(page);
    await page.keyboard.press('Space');
    await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
    await nextDay(page, paused);
  });

  test('speed 3 advances days faster than speed 1 and shows as pressed', async ({ page }) => {
    const speed1 = page.getByRole('button', { name: 'Speed 1', exact: true });
    const speed3 = page.getByRole('button', { name: 'Speed 3', exact: true });
    await expect(speed1).toHaveAttribute('aria-pressed', 'true');
    const slow = await daysPerSecond(page, 3);

    await speed3.click();
    await expect(speed3).toHaveAttribute('aria-pressed', 'true');
    await expect(speed1).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('time-controls-speed')).toContainText('Speed 3');
    const fast = await daysPerSecond(page, 10);

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
