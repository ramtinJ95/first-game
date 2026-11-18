import { expect, test, type Locator, type Page } from '@playwright/test';
import { changeCityOwner } from '../src/sim/cities.ts';
import type { CityId, FactionId, FormationId } from '../src/sim/ids.ts';
import type { Day } from '../src/sim/state/day.ts';
import type { GameState } from '../src/sim/state/game-state.ts';
import {
  armyOf,
  carthage,
  carthageNearsWar,
  declareWar,
  dropSave,
  openGame,
  pause,
  rome,
  startGame,
  twoNearWarAtWar,
  untilDrawn,
} from './support.ts';

const persia = 'persia' as FactionId;

/**
 * Persia, the last power of the At peace list, holding Syracusae beside Rome with 30,000 men,
 * on notice against Rome since day 90 on day 100.
 */
function persiaOnNotice(): GameState {
  const state = startGame();
  state.day = 100 as Day;
  changeCityOwner(state, 'syracusae' as CityId, persia);
  const army = state.formations[armyOf(state, persia).formations[0] as FormationId];
  const power = state.factions[persia];
  if (!army || !power) throw new Error('no Persia');
  army.men = 30_000;
  power.noticeSince = 90 as Day;
  return state;
}

/** Carthage on notice as in `carthageNearsWar` while Rome is at war with Mediolanum, whose war fills the top of the panel. */
function carthageOnNoticeAtWar(): GameState {
  const state = carthageNearsWar();
  const city = state.cities['mediolanum' as never];
  const power = state.factions[carthage];
  if (!city || !power) throw new Error('no Mediolanum or Carthage');
  declareWar(state, rome, city.owner);
  power.noticeSince = state.day;
  return state;
}

async function openWars(page: Page, state: GameState) {
  await pause(page);
  await dropSave(page, state);
  await expect(page.getByTestId('time-controls-day')).toHaveAttribute(
    'data-day',
    String(state.day),
  );
  await untilDrawn(page);
  await page.getByTestId('wars-button').click();
  return page.getByTestId('wars-panel');
}

test.describe('the Wars panel at 1280 × 720 opens on the At peace line of a power on notice', () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  for (const [name, make, power] of [
    ['at peace, the last power of the list', persiaOnNotice, 'Persia'],
    ['at war with a minor city', carthageOnNoticeAtWar, 'Carthage'],
  ] as const) {
    test(name, async ({ page }) => {
      await openGame(page);
      const panel = await openWars(page, make());
      const row = panel.getByTestId('threat-row').filter({ hasText: `${power} has ` });
      await expect(row).toHaveCount(1);
      await expect(row).toContainText('It may declare from');
      const box = await row.boundingBox();
      const frame = await panel.boundingBox();
      if (!box || !frame) throw new Error('no row or panel');
      expect(await panel.evaluate((element) => element.scrollTop)).toBe(0);
      expect(box.y, 'the line starts inside the panel').toBeGreaterThanOrEqual(frame.y);
      expect(
        box.y + box.height,
        'the line ends inside the panel without a scroll',
      ).toBeLessThanOrEqual(frame.y + frame.height);
    });
  }
});

test.describe('the Wars panel at 1280 × 720 at war with two powers near war', () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test('shows both near-war lines with the armies that count, the war, and its first peace offer unscrolled', async ({
    page,
  }) => {
    await openGame(page);
    const panel = await openWars(page, twoNearWarAtWar());
    const frame = await panel.boundingBox();
    if (!frame) throw new Error('no panel');
    expect(await panel.evaluate((element) => element.scrollTop)).toBe(0);
    const inside = async (name: string, element: Locator) => {
      await expect(element, name).toHaveCount(1);
      const box = await element.boundingBox();
      if (!box) throw new Error(`no ${name}`);
      expect(box.y, `${name} starts inside the panel`).toBeGreaterThanOrEqual(frame.y);
      expect(
        box.y + box.height,
        `${name} ends inside the panel without a scroll`,
      ).toBeLessThanOrEqual(frame.y + frame.height);
    };
    for (const power of ['Egypt', 'Macedon'])
      await inside(
        `${power}'s line`,
        panel.getByTestId('threat-row').filter({ hasText: `${power} has 100%` }),
      );
    await inside(
      'the armies that count near Ariminum',
      panel.getByTestId('threat-note').filter({ hasText: 'Near Ariminum' }),
    );
    await expect(
      panel.getByTestId('threat-note').filter({ hasText: 'Near Ariminum' }),
    ).toContainText('Second Legion (3,000 men)');
    await inside('the war with Persia', panel.getByText('At war with Persia.'));
    await inside("the war's first peace offer", panel.getByTestId('peace-choice').first());
  });
});
