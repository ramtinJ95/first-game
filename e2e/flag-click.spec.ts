import { expect, test, type Page } from '@playwright/test';
import { buildScene, type Sprite } from '../src/render/armies/scene.ts';
import { screenToMap, symbolGrowth, type Camera } from '../src/render/camera.ts';
import { provinceAt } from '../src/render/pick.ts';
import { sightOf } from '../src/sim/sight.ts';
import { buildWorld } from '../src/sim/world/world.ts';
import type { GameState } from '../src/sim/state/game-state.ts';
import type { CityId } from '../src/sim/ids.ts';
import {
  armyOf,
  camera,
  cityPoint,
  declareWar,
  map,
  openGame,
  pause,
  playDays,
  rome,
  startGame,
} from './support.ts';
import { loadSave } from './watch.ts';

/** Rome's army stands idle beside Mediolanum, where it camps at the city. */
function besideMediolanum(): GameState {
  const state = startGame();
  const at = cityPoint('mediolanum');
  armyOf(state, rome).activity = { kind: 'idle', position: { x: at.x + 3, y: at.y + 2 } };
  return state;
}

/** Rome's army three days into the siege of a minor city, camped round it, as the tester found Mediolanum. */
function besieging(id: string): GameState {
  const state = startGame();
  const city = state.cities[id as CityId];
  if (!city) throw new Error(`no city ${id}`);
  declareWar(state, rome, city.owner);
  armyOf(state, rome).activity = { kind: 'idle', position: { ...city.position } };
  return playDays(state, 3);
}

const world = buildWorld(map);

/** A minor city in the desert, with no town about it to move the camp off the place the test works out. */
const SIEGED = 'ammon';

/** The figures the page draws for a state it shows still, as the renderer works them out. */
function figuresOn(page: Page, state: GameState, at: Camera): Sprite[] {
  const viewport = page.viewportSize();
  if (!viewport) throw new Error('no viewport');
  const sight = sightOf(state, world, rome);
  return buildScene({
    previous: state,
    current: state,
    progress: 0,
    camera: at,
    viewport,
    previousSight: sight,
    sight,
    motion: 0,
    now: 0,
    growth: symbolGrowth(at.scale),
    land: (screen) => provinceAt(map, screenToMap(at, viewport, screen)) !== undefined,
  }).sprites;
}

test.describe("a click on an army's flag or its camp", () => {
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

  test('on a tent or a stack of arms at a siege selects the army', async ({ page }) => {
    const state = besieging(SIEGED);
    await loadSave(page, state);
    const view = camera(page);
    await view.jumpTo(cityPoint(SIEGED), 2);
    const city = view.city(SIEGED);
    const sprites = figuresOn(page, state, view.camera);
    const men = sprites.filter((s) => s.hit && !/^(tent|commandTent|arms)\./.test(s.key));
    const onMan = (spot: { x: number; y: number }) =>
      men.some(
        (s) =>
          s.hit &&
          spot.x >= s.hit.left - 2 &&
          spot.x <= s.hit.right + 2 &&
          spot.y >= s.hit.top - 2 &&
          spot.y <= s.hit.bottom + 2,
      );
    const camp = sprites
      .filter((s) => /^(tent|commandTent|arms)\./.test(s.key))
      .map((s) => ({ key: s.key, x: s.x, y: s.y - 0.35 * s.size }))
      .filter((spot) => !onMan(spot) && Math.hypot(spot.x - city.x, spot.y - city.y) > 30);
    const tent = camp.find((spot) => spot.key.includes('ent.'));
    const arms = camp.find((spot) => spot.key.startsWith('arms.'));
    if (!tent || !arms) throw new Error('no tent and no arms clear of the men');
    await expect
      .poll(async () => Number(await page.getByTestId('map').getAttribute('data-figures')), {
        timeout: 60_000,
      })
      .toBeGreaterThan(0);
    const panel = page.getByTestId('army-panel');
    for (const spot of [tent, arms]) {
      await page.mouse.click(spot.x, spot.y);
      await expect(panel.getByTestId('army-name'), spot.key).toHaveText('First Legion');
      await page.keyboard.press('Escape');
      await expect(panel).toBeHidden();
    }
  });
});
