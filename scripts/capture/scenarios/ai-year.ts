import type { Page } from '@playwright/test';
import { defineScenario } from '../scenario.ts';

async function day(page: Page): Promise<number> {
  return Number(await page.getByTestId('time-controls-day').getAttribute('data-day'));
}

async function until(page: Page, target: number) {
  while ((await day(page)) < target) await page.waitForTimeout(250);
}

export default defineScenario({
  name: 'ai-year',
  title:
    'Faction AI: a year at the highest speed on the whole map, with armies marching and cities changing owner',
  viewport: { width: 1280, height: 720 },
  async run({ page, shot }) {
    await page.goto('/');
    await page.getByTestId('top-bar').waitFor({ state: 'visible' });
    await shot('start', 'Day 1: every power stands at its capital and the minor cities are free');
    await page.getByRole('button', { name: 'Speed 3', exact: true }).click();
    for (const [target, title] of [
      [30, 'Day 30: the AI powers have declared war on minor neighbours and their armies march'],
      [90, 'Day 90: the first minor cities have fallen and wear the colours of their conquerors'],
      [180, 'Day 180: half a year in, every AI power has grown, while Rome, the player, waits'],
      [365, 'Day 365: a year of conquest at the highest speed'],
    ] as const) {
      await until(page, target);
      await shot(`day-${target}`, title);
    }
  },
});
