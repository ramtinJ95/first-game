import { expect, test, type Page } from '@playwright/test';
import { screenToMap, symbolGrowth, type Camera } from '../src/render/camera.ts';
import { buildScene, type Sprite } from '../src/render/armies/scene.ts';
import { provinceAt } from '../src/render/pick.ts';
import { sightOf } from '../src/sim/sight.ts';
import type { GameState } from '../src/sim/state/game-state.ts';
import { buildWorld } from '../src/sim/world/world.ts';
import { armyAtRest, armyOf, camera, cityPoint, map, pause, rome } from './support.ts';
import { loadSave } from './watch.ts';

const world = buildWorld(map);

/** The figures the page draws for a state that it shows still, as the renderer works them out. */
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

/** How many figures of armies the page drew in its last frame of figures. */
const drawn = async (page: Page) =>
  Number((await page.getByTestId('map').getAttribute('data-figures')) ?? 0);

/** Waits until the page has drawn at least the figures of the scene, once their sheets are painted. */
async function untilDrawn(page: Page, sprites: readonly Sprite[]) {
  const figures = sprites.filter((s) => s.army).length;
  await expect.poll(() => drawn(page), { timeout: 60_000 }).toBeGreaterThanOrEqual(figures);
}

const centre = (sprite: Sprite) => ({
  x: ((sprite.hit?.left ?? 0) + (sprite.hit?.right ?? 0)) / 2,
  y: (sprite.hit?.top ?? 0) * 0.3 + (sprite.hit?.bottom ?? 0) * 0.7,
});

test.describe('armies drawn as figures', () => {
  // The page draws in software here, and zooming to the closest view paints the figures' sheet.
  test.describe.configure({ timeout: 90_000 });
  const errors: string[] = [];

  test.beforeEach(async ({ page }) => {
    errors.length = 0;
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/');
    await page.getByTestId('top-bar').waitFor({ state: 'visible' });
    await pause(page);
  });

  test.afterEach(() => {
    expect(errors).toEqual([]);
  });

  test('a click on one of its figures selects the army', async ({ page }) => {
    const state = armyAtRest();
    await loadSave(page, state);
    const view = camera(page);
    await view.jumpTo(cityPoint('roma'), 4);
    const sprites = figuresOn(page, state, view.camera);
    await untilDrawn(page, sprites);
    const archer = sprites.find((s) => s.key.startsWith('archers.'));
    if (!archer) throw new Error('no archer drawn');
    const at = centre(archer);
    await page.mouse.click(at.x, at.y);
    await expect(page.getByTestId('army-panel')).toBeVisible();
    await expect(page.getByTestId('army-panel')).toContainText('Archers');
  });

  test('a formation that loses all its men is no longer drawn', async ({ page }) => {
    const state = armyAtRest();
    await loadSave(page, state);
    const view = camera(page);
    await view.jumpTo(cityPoint('roma'), 4);
    const before = figuresOn(page, state, view.camera);
    await untilDrawn(page, before);
    const shown = await drawn(page);
    const archers = before.filter((s) => s.key.startsWith('archers.'));
    expect(archers.length).toBe(10);

    const emptied = structuredClone(state);
    const army = armyOf(emptied, rome);
    const archerId = army.formations.find((id) => emptied.formations[id]?.troop === 'archers');
    const formation = archerId && emptied.formations[archerId];
    if (!formation) throw new Error('no archers');
    formation.men = 0;
    await loadSave(page, emptied);
    await expect.poll(() => drawn(page)).toBe(shown - archers.length);
    const after = figuresOn(page, emptied, view.camera);
    expect(after.some((s) => s.key.startsWith('archers.'))).toBe(false);

    // Where an archer stood, a click no longer finds the army: nothing is drawn there.
    const lone = archers.find(
      (a) =>
        !after.some(
          (s) =>
            s.hit &&
            centre(a).x >= s.hit.left &&
            centre(a).x <= s.hit.right &&
            centre(a).y >= s.hit.top &&
            centre(a).y <= s.hit.bottom,
        ),
    );
    if (!lone) throw new Error('every archer is covered by another figure');
    await page.mouse.click(centre(lone).x, centre(lone).y);
    await expect(page.getByTestId('army-panel')).toHaveCount(0);
  });
});
