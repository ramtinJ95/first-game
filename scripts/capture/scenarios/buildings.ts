import { expect, type Page } from '@playwright/test';
import {
  camera,
  cityPoint,
  dropSave,
  mediolanumFallenWithBuildings,
  openGame,
  pause,
  playDays,
  resizeTo,
  rome,
  setRich,
  startGame,
  untilDrawn,
} from '../../../e2e/support.ts';
import type { CityId } from '../../../src/sim/ids.ts';
import type { GameState } from '../../../src/sim/state/game-state.ts';
import { defineScenario } from '../scenario.ts';

const WIDE = { width: 1280, height: 720 };
const PHONE = { width: 390, height: 844 };
const roma = 'roma' as CityId;

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

function richRome(): GameState {
  const state = startGame();
  setRich(state);
  return state;
}

/** Shoots Roma's buildings at 1280 by 720 and on a phone, where the side column is a sheet. */
async function bothSizes(
  page: Page,
  shot: (name: string, title: string) => Promise<void>,
  name: string,
  title: string,
) {
  const buildings = page.getByTestId('city-buildings');
  await buildings.scrollIntoViewIfNeeded();
  await shot(`${name}-1280`, `${title}, at 1280 by 720`);
  await resize(page, PHONE);
  await buildings.scrollIntoViewIfNeeded();
  await shot(`${name}-390`, `${title}, at 390 px wide, where the side column is a sheet`);
  await resize(page, WIDE);
}

export default defineScenario({
  name: 'buildings',
  title:
    "A city's buildings: what each costs and does, the one under way with its days and its cancel, those that stand, and what each fate does to them",
  viewport: WIDE,
  async run({ page, shot }) {
    await openGame(page);

    await load(page, richRome());
    await openRoma(page);
    await bothSizes(
      page,
      shot,
      'nothing-built',
      'Roma has built nothing: each building gives its gold, its days, and what it adds here by the rules',
    );

    await load(
      page,
      playDays(richRome(), 19, [{ kind: 'build', faction: rome, city: roma, building: 'forum' }]),
    );
    await openRoma(page);
    await bothSizes(
      page,
      shot,
      'forum-under-way',
      'A Forum under way in Roma with its days left and what a cancel gives back, and the rest wait their turn',
    );

    const built = richRome();
    const city = built.cities[roma];
    if (!city) throw new Error('no Roma');
    city.buildings = ['forum', 'canals', 'temple'];
    city.construction = { building: 'barracks', daysLeft: 12 };
    await load(page, built);
    await openRoma(page);
    await bothSizes(
      page,
      shot,
      'several-built',
      'Roma with a Forum, Canals, and a Temple standing, each with what it adds, and Barracks under way',
    );

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('city-panel')).toHaveCount(0);
    await load(page, mediolanumFallenWithBuildings());
    const prompt = page.getByTestId('fate-prompt');
    await prompt.waitFor();
    await shot(
      'fate-prompt-1280',
      'Mediolanum falls with Canals and Towers: occupying and enslaving keep them, a sack destroys them',
    );
    await resize(page, PHONE);
    await shot('fate-prompt-390', 'The same fate prompt at 390 px wide');
    await resize(page, WIDE);
  },
});
