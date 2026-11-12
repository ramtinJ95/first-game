import type { Page } from '@playwright/test';
import { camera, cityPoint, day, pause, resume } from '../../../e2e/support.ts';
import { defineScenario } from '../scenario.ts';

async function until(page: Page, target: number) {
  while ((await day(page)) < target) await page.waitForTimeout(250);
}

export default defineScenario({
  name: 'ai-year',
  title:
    'Faction AI: a year at the highest speed on the whole map, as Rome sees it. The other powers take the minor cities, which change colour, and armies march in Roman sight',
  viewport: { width: 1280, height: 720 },
  async run({ page, shot }) {
    await page.goto('/');
    await page.getByTestId('top-bar').waitFor({ state: 'visible' });
    await pause(page);
    await shot(
      'start',
      'Day 1: every power holds its homeland, the minor cities are free, and the fog hides what Rome cannot see',
    );

    const view = camera(page);
    const banner = view.banner(cityPoint('roma'));
    await page.mouse.click(banner.x, banner.y);
    const target = view.city('mediolanum');
    await page.mouse.click(target.x, target.y, { button: 'right' });
    await page.getByRole('button', { name: 'Speed 3', exact: true }).click();
    await resume(page);

    for (const [at, title] of [
      [
        30,
        "Day 30: Rome's army marches north, and the AI powers have declared war on minor neighbours",
      ],
      [90, 'Day 90: the first minor cities have fallen and wear the colours of their conquerors'],
      [180, 'Day 180: half a year in, every AI power has grown into the land between them'],
      [365, 'Day 365: a year of conquest at the highest speed'],
    ] as const) {
      await until(page, at);
      await shot(`day-${at}`, title);
    }
  },
});
