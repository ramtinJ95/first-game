import { expect, type Page } from '@playwright/test';
import {
  armyOf,
  camera,
  cityPoint,
  dropSave,
  openGame,
  pause,
  resizeTo,
  rome,
  romaWithEveryBuilding,
  untilDrawn,
} from '../../../e2e/support.ts';
import { foodShortUnlessWaiting, loadWarnings, showOwnCity } from '../../../e2e/warnings-game.ts';
import type { CityId, FormationId } from '../../../src/sim/ids.ts';
import type { GameState } from '../../../src/sim/state/game-state.ts';
import { BUILDINGS } from '../../../src/sim/buildings/buildings.ts';
import { UPKEEP_PER_MAN } from '../../../src/sim/systems/economy.ts';
import { defineScenario } from '../scenario.ts';

const WIDE = { width: 1280, height: 720 };
const PHONE = { width: 390, height: 844 };

async function load(page: Page, state: GameState) {
  await pause(page);
  await dropSave(page, state);
  await expect(page.getByTestId('time-controls-day')).toHaveAttribute(
    'data-day',
    String(state.day),
  );
  await untilDrawn(page);
}

async function resize(page: Page, size: { width: number; height: number }) {
  await resizeTo(page, size);
  await page.locator('canvas[data-terrain="ready"]').waitFor();
}

/** Opens Roma's panel from a click 40 km south of it, clear of the army on its symbol. */
async function openRoma(page: Page) {
  const at = cityPoint('roma');
  const point = camera(page).screen({ x: at.x, y: at.y + 40 });
  await page.mouse.click(point.x, point.y);
  await expect(page.getByTestId('city-name')).toHaveText('Roma');
}

/** Shoots a part of Roma's panel at 1280 by 720 and on a phone, where the side column is a sheet. */
async function bothSizes(
  page: Page,
  shot: (name: string, title: string) => Promise<void>,
  testId: string,
  name: string,
  title: string,
) {
  const part = page.getByTestId(testId).first();
  await part.scrollIntoViewIfNeeded();
  await shot(`${name}-1280`, `${title}, at 1280 by 720`);
  await resize(page, PHONE);
  await part.scrollIntoViewIfNeeded();
  await shot(`${name}-390`, `${title}, at 390 px wide, where the side column is a sheet`);
  await resize(page, WIDE);
}

/** Roma with every building at level 2 and a Treasury hall standing: nothing left to offer. */
function everyLevelBuilt(): GameState {
  const state = romaWithEveryBuilding();
  const roma = state.cities['roma' as CityId];
  if (!roma) throw new Error('no Roma');
  roma.buildings.push(
    'lawCourts',
    'reservoirs',
    'drillField',
    'outerWalls',
    'sanctuary',
    'treasuryHall',
  );
  return state;
}

/**
 * Rome as in `foodShortUnlessWaiting`, short of men for Spearmen, with `standing` at Roma and,
 * with Canals, the men they feed under arms, so the recruit card offers their second levels there.
 */
function secondLevelsOnTheCard(standing: 'canals' | 'barracks'): GameState {
  const state = foodShortUnlessWaiting();
  const stores = state.factions[rome]?.stores;
  const formation = state.formations[armyOf(state, rome).formations[0] as FormationId];
  const roma = state.cities['roma' as CityId];
  if (!stores || !formation || !roma) throw new Error('no Roman stores, army, or Roma');
  stores.manpower = standing === 'barracks' ? 200 : 600;
  formation.men += 500;
  if (standing === 'canals')
    formation.men += Math.ceil(BUILDINGS.canals.food / UPKEEP_PER_MAN.food);
  roma.buildings = [standing];
  return state;
}

export default defineScenario({
  name: 'city-projects',
  title:
    "A grown city's projects: each building's level, the second levels and great works it offers with their payback, a city with everything built, and the recruit card's second-level lines",
  viewport: WIDE,
  async run({ page, shot }) {
    await openGame(page);

    await load(page, romaWithEveryBuilding());
    await openRoma(page);
    await expect(page.getByTestId('build-lawCourts')).toContainText('pays back in');
    await bothSizes(
      page,
      shot,
      'build-second',
      'levels-offered',
      'Roma with all five first buildings at level 1, offering each second level and the three great works with what each adds here, its price, its days, and its payback',
    );
    await bothSizes(
      page,
      shot,
      'build-work',
      'works-offered',
      'The great works Roma may choose one of, each with its payback here',
    );

    await load(page, everyLevelBuilt());
    await openRoma(page);
    await expect(page.getByTestId('city-built')).toContainText('Treasury hall · great work');
    await bothSizes(
      page,
      shot,
      'city-built',
      'everything-built',
      'Roma with every building at level 2 and a Treasury hall standing, each with what it adds',
    );

    await page.keyboard.press('Escape');
    await loadWarnings(page, secondLevelsOnTheCard('canals'));
    await showOwnCity(page, 'Roma');
    await page
      .getByTestId('recruit-cards')
      .getByRole('button', { name: /^Skirmishers/ })
      .click();
    await expect(page.getByTestId('recruit-canal')).toContainText(
      'Or build Reservoirs at Roma for 6,500 gold',
    );
    await bothSizes(
      page,
      shot,
      'recruit-canal',
      'recruit-reservoirs',
      'In a city with Canals the Skirmishers warning names Reservoirs there and the day they feed the raise',
    );

    await page.keyboard.press('Escape');
    await loadWarnings(page, secondLevelsOnTheCard('barracks'));
    await showOwnCity(page, 'Roma');
    await expect(page.getByTestId('recruit-barracks').first()).toContainText(
      'Or build a Drill field at Roma for 7,500 gold',
    );
    await bothSizes(
      page,
      shot,
      'recruit-barracks',
      'recruit-drill-field',
      'In a city with Barracks the Spearmen card names a Drill field there and the day it lets the raise',
    );
  },
});
