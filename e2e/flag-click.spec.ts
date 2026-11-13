import { expect, test, type Page } from '@playwright/test';
import type { GameState } from '../src/sim/state/game-state.ts';
import { armyOf, camera, cityPoint, openGame, pause, rome, startGame } from './support.ts';
import { loadSave } from './watch.ts';

/** Rome's army stands idle beside Mediolanum, as the tester found it. */
function besideMediolanum(): GameState {
  const state = startGame();
  const at = cityPoint('mediolanum');
  armyOf(state, rome).activity = { kind: 'idle', position: { x: at.x + 3, y: at.y + 2 } };
  return state;
}

type Area = { x: number; y: number; width: number; height: number };

/**
 * Where Rome's colour shows in the area, in screen px: its highest point, which is the
 * top of the standard over the men, and its lowest.
 */
async function romanInk(page: Page, area: Area) {
  const png = (await page.screenshot({ clip: area })).toString('base64');
  const found = await page.evaluate(async (png) => {
    const image = new Image();
    image.src = `data:image/png;base64,${png}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d');
    if (!context) return undefined;
    context.drawImage(image, 0, 0);
    const { data, width, height } = context.getImageData(0, 0, image.width, image.height);
    let top: { x: number; y: number } | undefined;
    let bottom = -1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const off =
          Math.abs((data[i] ?? 0) - 0xb3) +
          Math.abs((data[i + 1] ?? 0) - 0x35) +
          Math.abs((data[i + 2] ?? 0) - 0x2a);
        if (off >= 40) continue;
        top ??= { x, y };
        bottom = y;
      }
    }
    return top && { top, bottom, px: width };
  }, png);
  if (!found) throw new Error("no pixel of Rome's colour in the area");
  const k = area.width / found.px;
  return {
    top: { x: area.x + found.top.x * k, y: area.y + found.top.y * k },
    bottom: area.y + found.bottom * k,
  };
}

test.describe("a click on an army's flag", () => {
  test.describe.configure({ timeout: 90_000 });

  test.beforeEach(async ({ page }) => {
    await openGame(page);
    await pause(page);
  });

  for (const scale of [0.3, 0.6, 0.85]) {
    test(`beside a city selects the army where armies are flags, at ${scale} px per km`, async ({
      page,
    }) => {
      const state = besideMediolanum();
      await loadSave(page, state);
      const view = camera(page);
      await view.jumpTo(cityPoint('mediolanum'), scale);
      const { activity } = armyOf(state, rome);
      if (activity.kind !== 'idle') throw new Error('not idle');
      const flag = view.banner(activity.position);
      await page.mouse.click(flag.x, flag.y);
      await expect(page.getByTestId('army-panel').getByTestId('army-name')).toHaveText(
        'First Legion',
      );
    });
  }

  test('beside a city selects the army where armies are figures, on its standard or between its men', async ({
    page,
  }) => {
    await loadSave(page, besideMediolanum());
    const view = camera(page);
    await view.jumpTo(cityPoint('mediolanum'), 2);
    await expect
      .poll(async () => Number(await page.getByTestId('map').getAttribute('data-figures')), {
        timeout: 60_000,
      })
      .toBeGreaterThan(0);
    const city = view.city('mediolanum');
    const { top, bottom } = await romanInk(page, {
      x: city.x - 200,
      y: city.y - 120,
      width: 400,
      height: 200,
    });
    const spots = [top, { x: top.x, y: top.y + 6 }];
    for (const dx of [-24, 0, 24]) {
      for (const share of [0.3, 0.6, 0.9]) {
        spots.push({ x: top.x + dx, y: top.y + 15 + share * (bottom - top.y - 20) });
      }
    }
    const panel = page.getByTestId('army-panel');
    for (const spot of spots) {
      await page.mouse.click(spot.x, spot.y);
      await expect(panel.getByTestId('army-name'), `a click at ${spot.x}, ${spot.y}`).toHaveText(
        'First Legion',
      );
      await page.keyboard.press('Escape');
      await expect(panel).toBeHidden();
    }
  });
});
