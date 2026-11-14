import { expect, type Page } from '@playwright/test';
import type { ArmyId, CityId, ConvoyId, FactionId, FormationId } from '../src/sim/ids.ts';
import { dailyBalances, limitsOf } from '../src/sim/systems/economy.ts';
import { warKey } from '../src/sim/state/war.ts';
import {
  armyOf,
  camera,
  cityPoint,
  declareWar,
  pause,
  rome,
  setRich,
  startGame,
  untilDrawn,
} from './support.ts';
import type { GameState } from '../src/sim/state/game-state.ts';
import { saveGame } from '../src/sim/save.ts';
import type { City } from '../src/sim/state/city.ts';
import { clampCamera, fitCamera, mapToScreen, type Camera } from '../src/render/camera.ts';
import { map } from './support.ts';
const carthage = 'carthage' as FactionId;
export function discoveryGame(): GameState {
  const state = startGame();
  setRich(state);
  declareWar(state, carthage, rome);
  state.peaceOffers[warKey(rome, carthage)] = {
    from: carthage,
    terms: { kind: 'asThingsStand' },
    madeOn: state.day,
  };
  const stores = required(state.factions[rome]).stores;
  const limits = required(limitsOf(state).get(rome));
  stores.food = limits.food - required(dailyBalances(state).get(rome)).food / 2;
  stores.manpower = limits.manpower;
  return state;
}
export function fullBuildingGame(): GameState {
  const state = discoveryGame();
  required(state.factions[rome]).stores.food = required(limitsOf(state).get(rome)).food;
  return state;
}
/** Two weak legions, 17 days apart on the road to Mediolanum. */
export function staggeredSiege(): GameState {
  const state = startGame();
  const city = required(state.cities['mediolanum' as CityId]);
  declareWar(state, rome, city.owner);
  const army = armyOf(state, rome);
  for (const id of army.formations) required(state.formations[id]).men = 350;
  const second = 'army-guide-second' as ArmyId;
  const formation = 'formation-guide-second' as FormationId;
  state.formations[formation] = {
    ...required(state.formations[required(army.formations[0])]),
    id: formation,
    army: second,
    men: 700,
  };
  // A road through Roma makes this army 17 days behind the first, at 25 km a day.
  const roma = cityPoint('roma');
  state.armies[second] = {
    ...army,
    id: second,
    name: 'Second Legion',
    formations: [formation],
    activity: {
      kind: 'marching',
      position: { x: roma.x, y: roma.y + 425 },
      waypoints: [roma, city.position],
    },
  };
  required(state.factions[rome]).armiesRaised = 2;
  return state;
}
export function convoyOverRoma(): GameState {
  const state = startGame();
  const convoy = 'convoy-guide' as ConvoyId;
  const army = armyOf(state, carthage);
  const roma = cityPoint('roma');
  state.convoys[convoy] = {
    id: convoy,
    owner: carthage,
    position: { ...roma },
    waypoints: [{ x: roma.x, y: roma.y + 30 }],
    armies: [army.id],
  };
  army.activity = { kind: 'embarked', convoy };
  return state;
}
export async function loadDiscovery(page: Page, state: GameState) {
  const viewport = page.viewportSize();
  if (!viewport) throw new Error('no viewport');
  await loadAt(page, state, fitCamera(viewport, map));
}
export async function pickCity(page: Page, id: string) {
  const point = camera(page).city(id);
  await page.mouse.click(point.x, point.y);
  await expect(page.getByTestId('city-name')).toHaveText(
    required(startGame().cities[id as CityId]).name,
  );
}
export async function showSiegeWarning(page: Page) {
  const banner = camera(page).banner(cityPoint('roma'));
  await page.mouse.click(banner.x, banner.y);
  await expect(page.getByTestId('army-name')).toHaveText('First Legion');
  const city = camera(page).city('mediolanum');
  await page.mouse.click(city.x, city.y, { button: 'right' });
  await expect(page.getByTestId('notice')).toContainText('Second Legion');
}

/** Start at a saved camera rather than dragging thousands of km from an off-screen point. */
export async function pickMinor(page: Page, state: GameState, city: City) {
  await pause(page);
  // Bring the sample into sight, without inventing knowledge of a hidden field army.
  armyOf(state, rome).activity = {
    kind: 'idle',
    position: { x: city.position.x + 100, y: city.position.y },
  };
  const viewport = page.viewportSize();
  if (!viewport) throw new Error('no viewport');
  const at = clampCamera({ centre: city.position, scale: 0.6 }, viewport, map);
  await loadAt(page, state, at);
  const point = mapToScreen(at, viewport, city.position);
  await page.mouse.click(point.x, point.y);
  await expect(page.getByTestId('city-name')).toHaveText(city.name);
}

async function loadAt(page: Page, state: GameState, at: Camera) {
  await pause(page);
  const transfer = await page.evaluateHandle(
    (save) => {
      const data = new DataTransfer();
      data.items.add(new File([save], 'save.json', { type: 'application/json' }));
      return data;
    },
    saveGame(state, { chronicle: [], camera: at, occupied: [], told: [], weakSieges: [] }),
  );
  await page.dispatchEvent('canvas', 'drop', { dataTransfer: transfer });
  await expect(page.getByTestId('time-controls-day')).toHaveAttribute(
    'data-day',
    String(state.day),
  );
  await untilDrawn(page);
}

export function minorSamples(state: GameState) {
  const minors = Object.values(state.cities).filter(
    (city) => state.factions[city.owner]?.kind === 'minor',
  );
  return [
    ['rich', required(minors.find((city) => city.fortified > 1))],
    ['poor', required(minors.find((city) => city.fortified < 1))],
    ['leagued', required(minors.find((city) => state.factions[city.owner]?.league))],
    [
      'standing',
      required(
        minors.find(
          (city) =>
            city.fortified === 1 &&
            !state.factions[city.owner]?.league &&
            Object.values(state.armies).some((army) => army.owner === city.owner),
        ),
      ),
    ],
  ] as const;
}

export async function queueStance(page: Page) {
  await pickCity(page, 'roma');
  await page
    .getByTestId('armies-here')
    .getByRole('button', { name: /First Legion/ })
    .click();
  await page
    .getByTestId('army-panel')
    .getByRole('button', { name: /^All-out assault/ })
    .click();
  await expect(page.getByTestId('orders-waiting')).toBeVisible();
}

function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error('fixture missing value');
  return value;
}
