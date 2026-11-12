import { expect, test } from '@playwright/test';
import { camera, day, map, openGame, pause } from './support.ts';

const FOREIGN_POWERS = ['Carthage', 'Macedon', 'Egypt', 'Persia'];

// The map redraws every frame while armies march and CI draws it in software, so on a small
// page the 200 days at the highest speed run near their real rate.
test.use({ viewport: { width: 640, height: 360 } });

test('after 200 days at the highest speed a foreign army has marched and taken a minor city', async ({
  page,
}) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  await openGame(page);

  await page.getByRole('button', { name: 'Speed 3', exact: true }).click();
  await expect.poll(() => day(page), { timeout: 240_000, intervals: [1000] }).toBeGreaterThan(200);
  await pause(page);

  const view = camera(page);
  const panel = page.getByTestId('city-panel');
  const owners: string[] = [];
  for (const province of map.provinces.filter((p) => p.owner === 'independent')) {
    const at = view.city(province.id);
    await page.mouse.click(at.x, at.y);
    const name = panel.getByTestId('city-name');
    if ((await name.count()) === 0 || (await name.textContent()) !== province.name) continue;
    owners.push((await panel.getByTestId('city-owner').textContent())?.trim() ?? '');
  }
  expect(owners.length).toBeGreaterThan(20);
  expect(owners.filter((owner) => FOREIGN_POWERS.includes(owner)).length).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});
