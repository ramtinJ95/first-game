import { expect, test } from '@playwright/test';
import { decideAll } from '../src/sim/ai/decide.ts';
import type { GameState } from '../src/sim/state/game-state.ts';
import { tick } from '../src/sim/tick.ts';
import { buildWorld } from '../src/sim/world/world.ts';
import { camera, day, map, openGame, pause, startGame } from './support.ts';

const FOREIGN_POWERS = ['Carthage', 'Macedon', 'Egypt', 'Persia'];
const MINORS = new Set<string>(
  map.provinces.filter((p) => p.owner === 'independent').map((p) => p.id),
);

/** The first day on which the new game, played by the rules with no orders from Rome, has a foreign power holding a minor city. */
function firstForeignConquest(): number {
  const world = buildWorld(map);
  let state: GameState = startGame();
  const taken = (s: GameState) =>
    Object.values(s.cities).some(
      (city) =>
        MINORS.has(city.id) &&
        city.owner !== 'rome' &&
        s.factions[city.owner]?.kind === 'greatPower',
    );
  while (!taken(state)) {
    if (state.day > 730) throw new Error('no foreign power takes a minor city in two years');
    state = tick(state, decideAll(state, world), world).state;
  }
  return state.day;
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
    .toBeGreaterThanOrEqual(conquest);
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
