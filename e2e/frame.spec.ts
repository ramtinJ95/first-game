import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { BANNER } from '../src/render/markers.ts';
import type { CityId } from '../src/sim/ids.ts';
import { POWERS } from '../src/sim/map.ts';
import { POWER_NAMES } from '../src/sim/new-game.ts';
import { outcomeOf } from '../src/sim/outcome.ts';
import { loadGame, SAVE_FORMAT, saveGame } from '../src/sim/save.ts';
import type { GameState } from '../src/sim/state/game-state.ts';
import { buildWorld } from '../src/sim/world/world.ts';
import {
  armyOf,
  camera,
  cityPoint,
  day,
  dropSave,
  map,
  mediolanumFallsTomorrow,
  nextDay,
  openGame,
  pause,
  playDays,
  romaFallsTomorrow,
  rome,
  romeWinsTomorrow,
  startGame,
  untilDay,
} from './support.ts';

const world = buildWorld(map);

/** Drops the save and waits until the page shows its day. */
async function load(page: Page, state: GameState) {
  await dropSave(page, state);
  await expect(page.getByTestId('time-controls-day')).toHaveAttribute(
    'data-day',
    String(state.day),
  );
}

/** The page's first screen, with nothing in storage. */
async function openStart(page: Page) {
  await page.goto('/');
  await page.getByTestId('start-screen').waitFor();
}

async function gameMenu(page: Page) {
  await page.getByRole('button', { name: 'Game', exact: true }).click();
  return page.getByTestId('save-menu');
}

/** A state like `make()` is played to the day the rules say, so the test knows its day. */
function checked(make: () => GameState, holds: (next: GameState) => boolean): GameState {
  const state = make();
  expect(holds(nextDay(state)), 'the rules play the planned day').toBe(true);
  return state;
}

test.describe('the frame round the game', () => {
  const errors: string[] = [];

  test.beforeEach(({ page }) => {
    errors.length = 0;
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('pageerror', (error) => errors.push(error.message));
  });

  test.afterEach(() => {
    expect(errors).toEqual([]);
  });

  test('the page opens on the start screen with the game not running and every power to choose', async ({
    page,
  }) => {
    await openStart(page);
    const start = page.getByTestId('start-screen');
    await expect(start.getByRole('heading', { level: 1 })).toHaveText('The Middle Sea');
    for (const power of POWERS) {
      const card = start.getByTestId(`power-${power}`);
      const capital = map.provinces.find((p) => p.owner === power && p.capital);
      await expect(card).toContainText(POWER_NAMES[power]);
      await expect(card).toContainText(`Capital ${capital?.name}`);
      for (const city of map.provinces.filter((p) => p.owner === power)) {
        await expect(card).toContainText(city.name);
      }
    }
    await expect(start.getByRole('button', { name: 'Continue' })).toHaveCount(0);
    await expect(page.getByTestId('top-bar')).toHaveCount(0);
  });

  for (const power of POWERS) {
    test(`choosing ${POWER_NAMES[power]} starts a paused game as it, on its capital, with the guide`, async ({
      page,
    }) => {
      await openStart(page);
      await page.getByTestId(`power-${power}`).click();

      const guide = page.getByTestId('guide');
      await expect(guide).toContainText(`You rule ${POWER_NAMES[power]}`);
      const capital = map.provinces.find((p) => p.owner === power && p.capital);
      if (!capital) throw new Error(`${power} has no capital`);
      await expect(guide.getByTestId('guide-goal')).toHaveText(
        `Hold 32 of the 80 provinces, with ${capital.name} and 2 other great capitals among them, and you win. Lose your last city and you lose.`,
      );
      await page.keyboard.press('Enter');
      await expect(guide).toHaveCount(0);

      await expect(page.getByTestId('top-bar')).toContainText(POWER_NAMES[power]);
      await expect(page.getByTestId('time-controls-speed')).toHaveText('Paused');
      expect(await day(page)).toBe(1);

      const viewport = page.viewportSize();
      if (!viewport) throw new Error('no viewport');
      await page.mouse.click(viewport.width / 2, viewport.height / 2 + 14);
      await expect(page.getByTestId('city-name')).toHaveText(capital.name);
      expect(await day(page)).toBe(1);
    });
  }

  test('the guide opens again from the top bar and closes with a click beside it', async ({
    page,
  }) => {
    await openGame(page);
    await page.getByRole('button', { name: 'Guide' }).click();
    const guide = page.getByTestId('guide');
    await expect(guide).toContainText('You rule Rome');
    await page.mouse.click(8, 700);
    await expect(guide).toHaveCount(0);
  });

  test('losing the last city stops the game on the defeat screen, which watches on or starts again', async ({
    page,
  }) => {
    const state = checked(
      romaFallsTomorrow,
      (next) => outcomeOf(next, world, rome).kind === 'lost',
    );
    await openGame(page);
    await dropSave(page, state);

    const defeat = page.getByTestId('defeat');
    await expect(defeat).toContainText('Rome has fallen');
    await expect(defeat).toContainText('Year 1, day 1');
    await expect(defeat.getByTestId('defeat-text')).toContainText(
      'Roma, your last city, fell to Carthage.',
    );
    await expect(page.getByTestId('time-controls-speed')).toHaveText('Paused');
    await expect(defeat.getByRole('button', { name: 'Load a file' })).toBeVisible();

    const stopped = await day(page);
    await defeat.getByRole('button', { name: 'Watch on' }).click();
    await expect(defeat).toHaveCount(0);
    await untilDay(page, stopped + 1);

    await pause(page);
    await page.getByRole('button', { name: 'Game', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Start screen' }).click();
    await expect(page.getByTestId('start-screen')).toBeVisible();
  });

  test('a save of a game already lost opens on the defeat screen', async ({ page }) => {
    const lost = nextDay(romaFallsTomorrow());
    expect(outcomeOf(lost, world, rome).kind).toBe('lost');
    await openGame(page);
    await dropSave(page, lost);
    const defeat = page.getByTestId('defeat');
    await expect(defeat.getByTestId('defeat-text')).toContainText('Your last city has fallen.');
    await expect(page.getByTestId('time-controls-speed')).toHaveText('Paused');
    await defeat.getByRole('button', { name: 'Watch on' }).click();
    await untilDay(page, lost.day + 1);
  });

  test('meeting the victory rule announces the win once, and the game plays on', async ({
    page,
  }) => {
    const state = checked(
      romeWinsTomorrow,
      (next) =>
        outcomeOf(romeWinsTomorrow(), world, rome).kind === 'playing' &&
        outcomeOf(next, world, rome).kind === 'won',
    );
    await openGame(page);
    await dropSave(page, state);

    const victory = page.getByTestId('victory');
    await expect(victory).toContainText('Rome is victorious');
    await expect(victory.getByTestId('victory-text')).toHaveText(
      'You hold 32 of the 80 provinces and the great capitals Alexandria, Carthago, Roma. You have won.',
    );
    await expect(page.getByTestId('time-controls-speed')).toHaveText('Paused');
    await victory.getByRole('button', { name: 'Play on' }).click();
    await expect(victory).toHaveCount(0);

    // Mediolanum fell the same day, so its fate is asked next.
    await page.getByTestId('fate-occupy').click();
    const after = await day(page);
    await untilDay(page, after + 3);
    await expect(victory).toHaveCount(0);
  });

  test('a save in the browser survives a reload, and Continue brings back the same day and armies', async ({
    page,
  }) => {
    const state = playDays(startGame(), 39);
    const spearmen = state.formations[armyOf(state, rome).formations[0] ?? ('' as never)];
    if (spearmen) spearmen.men = 1234;
    await openGame(page);
    await load(page, state);
    await pause(page);
    const saved = await day(page);

    const army = page.getByTestId('army-panel');
    const before = camera(page).banner(cityPoint('roma'));
    await page.mouse.click(before.x, before.y);
    await expect(army.getByTestId('army-men')).toHaveText('1,534 men');
    const activity = await army.getByTestId('army-activity').textContent();

    const menu = await gameMenu(page);
    await menu.getByRole('menuitem', { name: 'Save in this browser' }).click();
    await gameMenu(page);
    await expect(page.getByRole('menuitem', { name: /^Load your save/ })).toContainText(
      `Rome, Year 1, day ${saved}`,
    );

    await page.goto('/');
    const start = page.getByTestId('start-screen');
    await expect(start.getByTestId('continue-info')).toHaveText(`Rome, Year 1, day ${saved}`);
    await start.getByRole('button', { name: 'Continue' }).click();
    await expect(start).toHaveCount(0);
    expect(await day(page)).toBe(saved);
    await expect(page.getByTestId('time-controls-speed')).toHaveText('Paused');

    const viewport = page.viewportSize();
    if (!viewport) throw new Error('no viewport');
    await page.mouse.click(
      viewport.width / 2 + BANNER.flagWidth / 2,
      viewport.height / 2 - BANNER.pole + 5,
    );
    await expect(army.getByTestId('army-men')).toHaveText('1,534 men');
    await expect(army.getByTestId('army-activity')).toHaveText(activity ?? '');
  });

  test('the game saves itself at the start of a month, and Continue loads that save', async ({
    page,
  }) => {
    await openGame(page);
    await load(page, playDays(startGame(), 57));
    await untilDay(page, 62);
    await pause(page);
    await page.goto('/');
    await expect(page.getByTestId('continue-info')).toHaveText('Rome, Year 1, day 61');
  });

  test('a save exports to a file, imports back, and an old format is refused with its notice', async ({
    page,
  }) => {
    await openGame(page);
    const state = playDays(startGame(), 44);
    await load(page, state);
    await pause(page);
    const exported = await day(page);

    const menu = await gameMenu(page);
    const download = page.waitForEvent('download');
    await menu.getByRole('menuitem', { name: 'Export to a file' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe(`rome-day-${exported}.json`);
    const path = await file.path();
    const text = readFileSync(path, 'utf8');
    const loaded = loadGame(text);
    expect(loaded.ok && loaded.state.day).toBe(exported);

    await load(page, startGame());
    await page.getByTestId('import-file').setInputFiles(path);
    await expect(page.getByTestId('time-controls-day')).toHaveAttribute(
      'data-day',
      String(exported),
    );
    await expect(page.getByTestId('time-controls-speed')).toHaveText('Paused');

    const old = JSON.stringify({
      format: SAVE_FORMAT - 1,
      state: JSON.parse(saveGame(state)).state,
    });
    await page.getByTestId('import-file').setInputFiles({
      name: 'old.json',
      mimeType: 'application/json',
      buffer: Buffer.from(old),
    });
    await expect(page.getByTestId('notice')).toHaveText(
      `The save did not load. The save has format ${SAVE_FORMAT - 1}, but this game reads format ${SAVE_FORMAT}.`,
    );
    expect(await day(page)).toBe(exported);
  });

  test('Continue refuses an old save in the browser with the same notice', async ({ page }) => {
    const old = JSON.stringify({ format: SAVE_FORMAT - 1, state: {} });
    await page.addInitScript((text) => {
      localStorage.setItem(
        'save:auto',
        JSON.stringify({ savedAt: 1, day: 90, realm: 'Rome', text }),
      );
    }, old);
    await openStart(page);
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByTestId('notice')).toHaveText(
      `The save did not load. The save has format ${SAVE_FORMAT - 1}, but this game reads format ${SAVE_FORMAT}.`,
    );
    await expect(page.getByTestId('start-screen')).toBeVisible();
  });

  for (const fate of ['occupy', 'sack', 'enslave'] as const) {
    test(`a city the player takes pauses the game on its fate, and ${fate} applies`, async ({
      page,
    }) => {
      const state = checked(
        mediolanumFallsTomorrow,
        (next) => next.cities['mediolanum' as CityId]?.owner === rome,
      );
      await openGame(page);
      await dropSave(page, state);

      const prompt = page.getByTestId('fate-prompt');
      await expect(prompt).toContainText('Mediolanum has fallen to you');
      await expect(page.getByTestId('time-controls-speed')).toHaveText('Paused');
      await page.keyboard.press('Space');
      await expect(page.getByTestId('time-controls-speed')).toHaveText('Paused');
      const choice = prompt.getByTestId(`fate-${fate}`);
      const unrest = Number(/Unrest for (\d+) days/.exec((await choice.textContent()) ?? '')?.[1]);
      if (fate === 'sack') await expect(choice).toContainText(/\+[\d,]+ gold/);
      if (fate === 'enslave') await expect(choice).toContainText(/\+[\d,]+ manpower/);
      const asked = await day(page);

      await choice.click();
      await expect(prompt).toHaveCount(0);
      await untilDay(page, asked + 1);
      await pause(page);
      const now = await day(page);

      const at = cityPoint('mediolanum');
      const screen = camera(page).screen(at);
      await page.mouse.click(screen.x, screen.y + 14);
      const panel = page.getByTestId('city-panel');
      await expect(panel.getByTestId('city-name')).toHaveText('Mediolanum');
      await expect(panel.getByTestId('city-unrest')).toHaveText(
        `Unrest · ${unrest - (now - asked)} days left`,
      );
      await expect(panel.getByText('Fate of the city', { exact: false })).toHaveCount(
        fate === 'occupy' ? 1 : 0,
      );
    });
  }

  test('with the pause on a fate turned off, a captured city is occupied by default and an alert says so', async ({
    page,
  }) => {
    const state = checked(
      mediolanumFallsTomorrow,
      (next) => next.cities['mediolanum' as CityId]?.owner === rome,
    );
    await openGame(page);
    await dropSave(page, state);
    const prompt = page.getByTestId('fate-prompt');
    await prompt
      .getByRole('checkbox', { name: 'Pause and ask when a city falls to you' })
      .uncheck();
    await prompt.getByTestId('fate-occupy').click();

    await dropSave(page, state);
    await page.getByRole('button', { name: 'Speed 3', exact: true }).click();
    await untilDay(page, 3);
    await expect(prompt).toHaveCount(0);
    await expect(page.getByTestId('time-controls-speed')).toHaveText('Speed 3');
    await untilDay(page, 13);
    await expect(page.getByTestId('alerts')).toContainText(
      'No fate was chosen for Mediolanum: you occupy it as it stands',
    );
  });
});
