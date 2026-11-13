import { expect, test } from '@playwright/test';
import { decideAll } from '../src/sim/ai/decide.ts';
import type { GameState } from '../src/sim/state/game-state.ts';
import { tick } from '../src/sim/tick.ts';
import { buildWorld } from '../src/sim/world/world.ts';
import { camera, cityPoint, day, map, openGame, pause, startGame } from './support.ts';

const FOREIGN_POWERS = ['Carthage', 'Macedon', 'Egypt', 'Persia'];
const MINORS = new Set<string>(
  map.provinces.filter((p) => p.owner === 'independent').map((p) => p.id),
);

/** Banners within this many km of a city are picked before the city. */
const CLEAR_KM = 30;
/** Some city symbols lie under others, so the test waits for several taken cities. */
const TAKEN = 3;

/**
 * The first day on which the new game, played by the rules with no orders from Rome, has
 * foreign powers holding TAKEN minor cities with no army standing on them, and those
 * cities, so a click picks the city.
 */
function firstForeignConquest(): { day: number; taken: string[] } {
  const world = buildWorld(map);
  let state: GameState = startGame();
  const clear = (s: GameState, at: { x: number; y: number }) =>
    Object.values(s.armies).every(
      (army) =>
        army.activity.kind === 'embarked' ||
        Math.hypot(army.activity.position.x - at.x, army.activity.position.y - at.y) > CLEAR_KM,
    );
  const takenIn = (s: GameState) =>
    Object.values(s.cities).filter(
      (city) =>
        MINORS.has(city.id) &&
        city.owner !== 'rome' &&
        s.factions[city.owner]?.kind === 'greatPower' &&
        clear(s, city.position),
    );
  while (takenIn(state).length < TAKEN) {
    if (state.day > 730) throw new Error('no foreign power takes a minor city in two years');
    state = tick(state, decideAll(state, world), world).state;
  }
  return { day: state.day, taken: takenIn(state).map((city) => city.id) };
}

// The map redraws every frame while armies march and CI draws it in software, so on a small
// page the days at the highest speed run near their real rate.
test.use({ viewport: { width: 640, height: 360 } });

test('at the highest speed the page plays on until a foreign army has marched and taken a minor city', async ({
  page,
}) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  await openGame(page);

  const conquest = firstForeignConquest();
  await page.getByRole('button', { name: 'Speed 3', exact: true }).click();
  await expect
    .poll(() => day(page), { timeout: 240_000, intervals: [1000] })
    .toBeGreaterThanOrEqual(conquest.day);
  await pause(page);

  const view = camera(page);
  const panel = page.getByTestId('city-panel');
  const owners: string[] = [];
  for (const province of map.provinces.filter((p) => p.owner === 'independent')) {
    // The open sheet covers the bottom of this small page, so it is closed before each click.
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    const at = view.city(province.id);
    await page.mouse.click(at.x, at.y);
    const name = panel.getByTestId('city-name');
    await name.waitFor({ timeout: 1000 }).catch(() => undefined);
    if ((await name.count()) === 0 || (await name.textContent()) !== province.name) continue;
    owners.push((await panel.getByTestId('city-owner').textContent())?.trim() ?? '');
  }
  expect(owners.length).toBeGreaterThan(20);
  // On this small page the open panel and the alerts cover much of the map, so the panel
  // is closed and each taken city is brought to the open top left before it is clicked.
  const conquerors: string[] = [];
  for (const id of conquest.taken) {
    await page.keyboard.press('Escape');
    await view.drag(view.screen(cityPoint(id)), { x: 120, y: 100 });
    const at = view.city(id);
    await page.mouse.click(at.x, at.y);
    await expect(panel.getByTestId('city-name')).toBeVisible();
    conquerors.push((await panel.getByTestId('city-owner').textContent())?.trim() ?? '');
  }
  expect(conquerors.filter((owner) => FOREIGN_POWERS.includes(owner)).length).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});
