import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { fitCamera, mapToScreen } from '../src/render/camera.ts';
import { BANNER } from '../src/render/markers.ts';
import { provinceAt } from '../src/render/pick.ts';
import type { CityId, FactionId } from '../src/sim/ids.ts';
import { parseMap } from '../src/sim/map.ts';
import { newGame } from '../src/sim/new-game.ts';
import { saveGame } from '../src/sim/save.ts';
import type { MapPoint } from '../src/sim/state/map-point.ts';

const map = parseMap(
  JSON.parse(readFileSync(resolve(import.meta.dirname, '../data/map/map.json'), 'utf8')),
);

function cityPoint(id: string): MapPoint {
  const province = map.provinces.find((p) => p.id === id);
  if (!province) throw new Error(`no province ${id}`);
  return { x: province.city[0], y: province.city[1] };
}

function onScreen(page: Page, point: MapPoint): MapPoint {
  const viewport = page.viewportSize();
  if (!viewport) throw new Error('no viewport');
  return mapToScreen(fitCamera(viewport, map), viewport, point);
}

async function dropSave(page: Page, text: string) {
  const dataTransfer = await page.evaluateHandle((save) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([save], 'save.json', { type: 'application/json' }));
    return transfer;
  }, text);
  await page.dispatchEvent('canvas', 'drop', { dataTransfer });
}

test.describe('the map', () => {
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

  test("a click at Roma's position selects its province and the readout shows the name", async ({
    page,
  }) => {
    const roma = onScreen(page, cityPoint('roma'));
    await page.mouse.click(roma.x, roma.y);
    const readout = page.getByTestId('selection-readout');
    await expect(readout.getByTestId('readout-province')).toHaveText('Roma');
    await expect(readout.getByTestId('readout-city')).toHaveText('Roma');
    await expect(readout.getByTestId('readout-owner')).toHaveText('Rome');
    await expect(readout.getByTestId('readout-population')).toHaveText('40,000');
  });

  test('a click on the sea clears the selection', async ({ page }) => {
    const roma = onScreen(page, cityPoint('roma'));
    await page.mouse.click(roma.x, roma.y);
    await expect(page.getByTestId('selection-readout')).toBeVisible();

    const seaPoint = { x: 2400, y: 2500 };
    expect(provinceAt(map, seaPoint)).toBeUndefined();
    const sea = onScreen(page, seaPoint);
    await page.mouse.click(sea.x, sea.y);
    await expect(page.getByTestId('selection-readout')).toHaveCount(0);
  });

  test('a click on the banner over Roma selects the Roman army', async ({ page }) => {
    const roma = onScreen(page, cityPoint('roma'));
    await page.mouse.click(roma.x + BANNER.flagWidth / 2, roma.y - BANNER.pole + 5);
    const readout = page.getByTestId('selection-readout');
    await expect(readout.getByTestId('readout-army-of')).toHaveText('Rome');
    await expect(readout.getByTestId('readout-men')).toHaveText('1,500');
  });

  test('a dropped save in which Rome holds Syracusae makes Rome its owner', async ({ page }) => {
    const syracusae = onScreen(page, cityPoint('syracusae'));
    await page.mouse.click(syracusae.x, syracusae.y);
    const owner = page.getByTestId('readout-owner');
    await expect(owner).toHaveText('Syracusae');

    const state = newGame(map, { seed: 1, player: 'rome' });
    const city = state.cities['syracusae' as CityId];
    if (!city) throw new Error('new game lacks Syracusae');
    city.owner = 'rome' as FactionId;
    await dropSave(page, saveGame(state));
    await expect(owner).toHaveText('Rome');
  });
});
