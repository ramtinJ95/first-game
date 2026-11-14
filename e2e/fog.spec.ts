import { expect, test, type Page } from '@playwright/test';
import { fitCamera, screenToMap } from '../src/render/camera.ts';
import { BANNER } from '../src/render/markers.ts';
import { POWER_COLOURS } from '../src/render/palette.ts';
import { provinceAt } from '../src/render/pick.ts';
import type { CityId } from '../src/sim/ids.ts';
import type { Day } from '../src/sim/state/day.ts';
import type { GameState } from '../src/sim/state/game-state.ts';
import type { MapPoint } from '../src/sim/state/map-point.ts';
import {
  egypt,
  firstDayWhen,
  IN_SIGHT,
  macedon,
  march,
  OUT_OF_SIGHT,
  romeSees,
  romeSeesArmy,
  romeWithPunicArmyAt,
} from './fog-game.ts';
import {
  armyOf,
  battleAt,
  camera,
  carthage,
  declareWar,
  dropSave,
  map,
  openGame,
  pause,
  playDays,
  resume,
  untilDay,
  untilDrawn,
} from './support.ts';

async function load(page: Page, state: GameState) {
  await dropSave(page, state);
  await expect(page.getByTestId('time-controls-day')).toHaveAttribute(
    'data-day',
    String(state.day),
  );
  await untilDrawn(page);
}

/** The name of the city whose province lies under a screen point at the widest zoom. */
function cityUnder(page: Page, state: GameState, screen: MapPoint): string {
  const viewport = page.viewportSize();
  if (!viewport) throw new Error('no viewport');
  const province = provinceAt(map, screenToMap(fitCamera(viewport, map), viewport, screen));
  const city = province && state.cities[province as string as CityId];
  if (!city) throw new Error('the point should lie on a province');
  return city.name;
}

/** How many pixels of Carthage's banner colour the page shows over the flag of a banner at `point`. */
async function punicPixels(page: Page, point: MapPoint): Promise<number> {
  const foot = camera(page).screen(point);
  const png = await page.screenshot({
    clip: { x: foot.x - 6, y: foot.y - BANNER.pole - 6, width: BANNER.flagWidth + 12, height: 24 },
  });
  return page.evaluate(
    async ({ data, colour }) => {
      const bitmap = await createImageBitmap(
        await (await fetch(`data:image/png;base64,${data}`)).blob(),
      );
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext('2d');
      if (!context) return -1;
      context.drawImage(bitmap, 0, 0);
      const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
      const [r, g, b] = [(colour >> 16) & 0xff, (colour >> 8) & 0xff, colour & 0xff];
      let count = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        const near =
          Math.abs((pixels[i] ?? 0) - r) < 16 &&
          Math.abs((pixels[i + 1] ?? 0) - g) < 16 &&
          Math.abs((pixels[i + 2] ?? 0) - b) < 16;
        if (near) count++;
      }
      return count;
    },
    { data: png.toString('base64'), colour: POWER_COLOURS.carthage },
  );
}

test.describe('fog of war', () => {
  const errors: string[] = [];

  test.beforeEach(async ({ page }) => {
    errors.length = 0;
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('pageerror', (error) => errors.push(error.message));
    await openGame(page);
    await pause(page);
  });

  test.afterEach(() => {
    expect(errors).toEqual([]);
  });

  test('a foreign army out of sight is not drawn, and a click where it stands selects the province', async ({
    page,
  }) => {
    const state = romeWithPunicArmyAt(OUT_OF_SIGHT);
    expect(romeSees(state, OUT_OF_SIGHT)).toBe(false);
    await load(page, state);

    expect(await punicPixels(page, OUT_OF_SIGHT)).toBe(0);
    const flag = camera(page).banner(OUT_OF_SIGHT);
    await page.mouse.click(flag.x, flag.y);
    // The point lies by Lugdunum's name, so the click means Lugdunum, whose province it
    // is not, and never the hidden army.
    await expect(page.getByTestId('city-name')).toHaveText('Lugdunum');
    expect(cityUnder(page, state, flag)).not.toBe('Lugdunum');
    await expect(page.getByTestId('army-panel')).toHaveCount(0);
  });

  test('a foreign army that marches into sight is drawn and can be selected', async ({ page }) => {
    const state = romeWithPunicArmyAt(OUT_OF_SIGHT);
    expect(romeSees(state, IN_SIGHT)).toBe(true);
    march(state, armyOf(state, carthage), OUT_OF_SIGHT, IN_SIGHT);
    // The day after it halts, the banner stands still on IN_SIGHT between both days.
    const halted = firstDayWhen(state, (s) => armyOf(s, carthage).activity.kind === 'idle');
    await load(page, state);
    await page.getByRole('button', { name: 'Speed 3', exact: true }).click();
    await resume(page);
    await untilDay(page, halted + 1);
    await pause(page);

    const flag = camera(page).banner(IN_SIGHT);
    await page.mouse.click(flag.x, flag.y);
    const heading = page.getByTestId('army-panel').getByRole('heading', { level: 2 });
    await expect(heading).toHaveText("Carthage's Host of Hanno");
    expect(await punicPixels(page, IN_SIGHT)).toBeGreaterThan(20);
  });

  test('a selected foreign army that marches out of sight is no longer selected', async ({
    page,
  }) => {
    const state = romeWithPunicArmyAt(IN_SIGHT);
    await load(page, state);
    const flag = camera(page).banner(IN_SIGHT);
    await page.mouse.click(flag.x, flag.y);
    const panel = page.getByTestId('army-panel');
    await expect(panel.getByRole('heading', { level: 2 })).toHaveText("Carthage's Host of Hanno");

    const leaving = romeWithPunicArmyAt(IN_SIGHT);
    leaving.day = (state.day + 1) as Day;
    march(leaving, armyOf(leaving, carthage), IN_SIGHT, OUT_OF_SIGHT);
    const gone = firstDayWhen(leaving, (s) => !romeSeesArmy(s, armyOf(s, carthage)));
    await load(page, leaving);
    await page.getByRole('button', { name: 'Speed 3', exact: true }).click();
    await resume(page);
    await untilDay(page, gone);
    await pause(page);
    await expect(panel).toHaveCount(0);
    expect(await punicPixels(page, OUT_OF_SIGHT)).toBe(0);
  });

  test('a battle of two other powers out of sight has no marker, no panel, and no alert, while the battle Rome fights far from home has all three', async ({
    page,
  }) => {
    const state = romeWithPunicArmyAt(OUT_OF_SIGHT);
    battleAt(state, 'massalia');
    declareWar(state, macedon, egypt);
    armyOf(state, macedon).activity = { kind: 'idle', position: OUT_OF_SIGHT };
    armyOf(state, egypt).activity = {
      kind: 'idle',
      position: { x: OUT_OF_SIGHT.x + 12, y: OUT_OF_SIGHT.y },
    };
    const fought = Object.values(playDays(structuredClone(state), 1).battles);
    const hidden = fought.find((b) => !romeSees(state, b.position));
    const ours = fought.find((b) => b !== hidden);
    if (!hidden || !ours) throw new Error('both battles should begin on the first day');

    await load(page, state);
    await resume(page);
    await untilDay(page, state.day + 1);
    await pause(page);
    await untilDrawn(page);
    const alerts = page.getByTestId('alerts').getByRole('button');
    await expect(alerts.filter({ hasText: /Battle .*Massalia/ })).toHaveCount(1);
    await expect(alerts.filter({ hasText: /Macedon|Egypt/ })).toHaveCount(0);

    const view = camera(page);
    const at = view.screen(hidden.position);
    await page.mouse.click(at.x, at.y);
    await expect(page.getByTestId('city-name')).toHaveText(cityUnder(page, state, at));
    const panels = page.getByTestId('battle-panel');
    await expect(panels.filter({ hasText: /Macedon|Egypt/ })).toHaveCount(0);

    const mark = view.screen(ours.position);
    await page.mouse.click(mark.x + 1, mark.y + 6);
    await expect(panels.filter({ hasText: 'Massalia' })).toHaveCount(1);
    await expect(page.getByTestId('city-panel')).toHaveCount(0);
  });
});
