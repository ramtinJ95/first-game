import type { Page } from '@playwright/test';
import type { GameState } from '../src/sim/state/game-state.ts';
import { dropSave } from './support.ts';

/**
 * Drops a save on the paused page and waits until the page shows its day and has drawn
 * it: a click picks what the map last drew.
 */
export async function loadSave(page: Page, state: GameState) {
  await dropSave(page, state);
  await page
    .getByTestId('time-controls-day')
    .and(page.locator(`[data-day="${state.day}"]`))
    .waitFor();
  await page.evaluate(
    () =>
      new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))),
  );
}

/** Waits until the page shows the day, then `ms` more. */
export async function untilDay(page: Page, day: number, ms = 0, timeout = 30_000) {
  await page.waitForFunction(
    (wanted) =>
      Number(
        document.querySelector('[data-testid="time-controls-day"]')?.getAttribute('data-day'),
      ) >= wanted,
    day,
    { timeout },
  );
  if (ms) await page.waitForTimeout(ms);
}

/**
 * Loads a save and lets it run `ms` at the speed shown, then pauses: with a save of the
 * day before, the picture is partway through the day after it.
 */
export async function stillAfter(page: Page, state: GameState, ms: number) {
  await loadSave(page, state);
  await page.getByRole('button', { name: 'Resume' }).click();
  await page.waitForTimeout(ms);
  await page.getByRole('button', { name: 'Pause' }).click();
  await page.waitForTimeout(200);
}

/**
 * Runs the paused game until the next tick, pauses from inside the page the moment it
 * comes, then runs `ms` more: a page that draws in software can lag by whole days, and
 * this stops it in the day after the tick. With `ms` 0 it stays paused at the tick.
 */
export async function intoNextDay(page: Page, ms: number) {
  const day = Number(await page.getByTestId('time-controls-day').getAttribute('data-day'));
  await page.getByRole('button', { name: 'Resume' }).click();
  await page.evaluate(
    (from) =>
      new Promise<void>((done) => {
        const check = () => {
          const shown = Number(
            document.querySelector('[data-testid="time-controls-day"]')?.getAttribute('data-day'),
          );
          if (shown > from) {
            [...document.querySelectorAll('button')]
              .find((b) => b.textContent?.trim() === 'Pause')
              ?.click();
            done();
          } else requestAnimationFrame(check);
        };
        check();
      }),
    day,
  );
  if (ms === 0) return;
  await page.getByRole('button', { name: 'Resume' }).click();
  await page.waitForTimeout(ms);
  await page.getByRole('button', { name: 'Pause' }).click();
}
