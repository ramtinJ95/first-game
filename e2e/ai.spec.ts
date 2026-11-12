import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { fitCamera, mapToScreen } from '../src/render/camera.ts';
import { parseMap } from '../src/sim/map.ts';

const map = parseMap(
  JSON.parse(readFileSync(resolve(import.meta.dirname, '../data/map/map.json'), 'utf8')),
);
const FOREIGN_POWERS = ['Carthage', 'Macedon', 'Egypt', 'Persia'];

async function day(page: Page): Promise<number> {
  const text = await page.getByTestId('time-controls-day').textContent();
  return Number(/Day (\d+)/.exec(text ?? '')?.[1] ?? 0);
}

test('after 200 days at the highest speed a foreign army has marched and taken a minor city', async ({
  page,
}) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.getByTestId('time-controls').waitFor({ state: 'visible' });

  await page.getByRole('button', { name: 'Speed 3', exact: true }).click();
  await expect.poll(() => day(page), { timeout: 100_000, intervals: [1000] }).toBeGreaterThan(200);
  await page.keyboard.press('Space');
  await expect(page.getByRole('button', { name: 'Resume' })).toBeVisible();

  const viewport = page.viewportSize();
  if (!viewport) throw new Error('no viewport');
  const camera = fitCamera(viewport, map);
  const owners: string[] = [];
  for (const province of map.provinces.filter((p) => p.owner === 'independent')) {
    const at = mapToScreen(camera, viewport, { x: province.city[0], y: province.city[1] });
    await page.mouse.click(at.x, at.y);
    const readout = page.getByTestId('selection-readout');
    const cityName = readout.getByTestId('readout-city');
    if ((await cityName.count()) === 0 || (await cityName.textContent()) !== province.name)
      continue;
    owners.push((await readout.getByTestId('readout-owner').textContent()) ?? '');
  }
  expect(owners.length).toBeGreaterThan(30);
  expect(owners.filter((owner) => FOREIGN_POWERS.includes(owner)).length).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});
