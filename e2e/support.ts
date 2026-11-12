import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';
import {
  fitCamera,
  mapToScreen,
  panBy,
  wheelFactor,
  zoomAt,
  type Camera,
} from '../src/render/camera.ts';
import { BANNER } from '../src/render/markers.ts';
import { changeCityOwner } from '../src/sim/cities.ts';
import type { CityId, FactionId } from '../src/sim/ids.ts';
import { parseMap } from '../src/sim/map.ts';
import { newGame } from '../src/sim/new-game.ts';
import type { Order } from '../src/sim/orders/orders.ts';
import { saveGame } from '../src/sim/save.ts';
import type { Army } from '../src/sim/state/army.ts';
import type { GameState } from '../src/sim/state/game-state.ts';
import type { MapPoint } from '../src/sim/state/map-point.ts';
import { warKey } from '../src/sim/state/war.ts';
import { tick } from '../src/sim/tick.ts';
import { buildWorld, type World } from '../src/sim/world/world.ts';

export const map = parseMap(
  JSON.parse(readFileSync(resolve(import.meta.dirname, '../data/map/map.json'), 'utf8')),
);

let world: World | undefined;

export function cityPoint(id: string): MapPoint {
  const province = map.provinces.find((p) => p.id === id);
  if (!province) throw new Error(`no province ${id}`);
  return { x: province.city[0], y: province.city[1] };
}

export const rome = 'rome' as FactionId;
export const carthage = 'carthage' as FactionId;

/** A new game as the page starts it, with Rome as the player. */
export function startGame(): GameState {
  return newGame(map, { seed: 1, player: 'rome' });
}

/** Plays the days through the rules, with the orders on the first of them. */
export function playDays(state: GameState, days: number, orders: Order[] = []): GameState {
  world ??= buildWorld(map);
  let current = state;
  for (let i = 0; i < days; i++) current = tick(current, i === 0 ? orders : [], world).state;
  return current;
}

export function armyOf(state: GameState, owner: FactionId): Army {
  const army = Object.values(state.armies).find((a) => a.owner === owner);
  if (!army) throw new Error(`no army of ${owner}`);
  return army;
}

export function declareWar(state: GameState, a: FactionId, b: FactionId) {
  state.wars[warKey(a, b)] = { since: state.day };
}

export function setRich(state: GameState) {
  const stores = state.factions[rome]?.stores;
  if (stores) Object.assign(stores, { gold: 20_000, food: 5_000, manpower: 6_000 });
}

/** Rome's army stands at the city with Carthage's 12 km east of it, at war, so they fight the next day. */
export function battleAt(state: GameState, city: string) {
  declareWar(state, rome, carthage);
  const roman = armyOf(state, rome);
  const punic = armyOf(state, carthage);
  const at = cityPoint(city);
  roman.activity = { kind: 'idle', position: at };
  punic.activity = { kind: 'idle', position: { x: at.x + 12, y: at.y } };
}

/** Rome's army stands at the city, which fell to Rome today, so its fate is open. */
export function fallenTo(state: GameState, id: string) {
  const city = state.cities[id as CityId];
  if (!city) throw new Error(`no city ${id}`);
  armyOf(state, rome).activity = { kind: 'idle', position: { ...city.position } };
  changeCityOwner(state, city.id, rome);
  city.fellOn = state.day;
}

export async function dropSave(page: Page, state: GameState) {
  const dataTransfer = await page.evaluateHandle((save) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([save], 'save.json', { type: 'application/json' }));
    return transfer;
  }, saveGame(state));
  await page.dispatchEvent('canvas', 'drop', { dataTransfer });
}

/** Follows the page's camera with the same maths while it drives the mouse. */
export function camera(page: Page) {
  const viewport = page.viewportSize();
  if (!viewport) throw new Error('no viewport');
  let at: Camera = fitCamera(viewport, map);
  return {
    screen: (point: MapPoint) => mapToScreen(at, viewport, point),
    city(id: string) {
      return this.screen(cityPoint(id));
    },
    /** A point on the flag of a banner whose foot stands at the map point. */
    banner(point: MapPoint) {
      const foot = this.screen(point);
      return { x: foot.x + BANNER.flagWidth / 2, y: foot.y - BANNER.pole + 5 };
    },
    async zoom(screen: MapPoint, notches: number, pauseMs = 60) {
      await page.mouse.move(screen.x, screen.y);
      for (let i = 0; i < Math.abs(notches); i++) {
        const deltaY = notches > 0 ? -100 : 100;
        await page.mouse.wheel(0, deltaY);
        at = zoomAt(at, screen, wheelFactor(deltaY), viewport, map);
        await page.waitForTimeout(pauseMs);
      }
    },
    async drag(from: MapPoint, to: MapPoint, steps = 12) {
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(to.x, to.y, { steps });
      await page.mouse.up();
      at = panBy(at, to.x - from.x, to.y - from.y, viewport, map);
    },
    /** Zooms in on a map point and brings it to the middle of the view. */
    async closeUp(point: MapPoint, notches: number) {
      await this.zoom(this.screen(point), notches);
      await this.drag(this.screen(point), { x: viewport.width / 2, y: viewport.height / 2 });
    },
  };
}

export async function pause(page: Page) {
  if (await page.getByRole('button', { name: 'Pause' }).isVisible()) {
    await page.getByRole('button', { name: 'Pause' }).click();
  }
}

export async function resume(page: Page) {
  if (await page.getByRole('button', { name: 'Resume' }).isVisible()) {
    await page.getByRole('button', { name: 'Resume' }).click();
  }
}

export async function day(page: Page): Promise<number> {
  return Number(await page.getByTestId('time-controls-day').getAttribute('data-day'));
}
