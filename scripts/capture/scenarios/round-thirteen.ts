import { expect, type Page } from '@playwright/test';
import {
  armyOf,
  carthage,
  carthageNearsWar,
  openGame,
  playDays,
  resizeTo,
  resume,
  rome,
} from '../../../e2e/support.ts';
import { foodShortUnlessWaiting, loadWarnings, showOwnCity } from '../../../e2e/warnings-game.ts';
import type { CityId, FormationId } from '../../../src/sim/ids.ts';
import type { Day } from '../../../src/sim/state/day.ts';
import type { GameState } from '../../../src/sim/state/game-state.ts';
import { defineScenario } from '../scenario.ts';

const WIDE = { width: 1280, height: 720 };
const PHONE = { width: 390, height: 844 };

/** Rome as in `foodShortUnlessWaiting` with 6,200 gold: the Canals line names a raise 18 days on, while the Canals are still at work. */
function canalsWithinTheirWork(): GameState {
  const state = foodShortUnlessWaiting();
  const stores = state.factions[rome]?.stores;
  if (!stores) throw new Error('no Roman stores');
  stores.gold = 6200;
  return state;
}

const canalsAtRoma = {
  kind: 'build',
  faction: rome,
  city: 'roma' as CityId,
  building: 'canals',
} as const;

/**
 * Carthage near war with Rome as in `carthageNearsWar` on day 100, on notice since day 80, with
 * Spearmen in training at Roma who muster tomorrow and end the notice whatever Rome orders.
 */
function noticeEndsAnyway(): GameState {
  const state = carthageNearsWar();
  state.day = 100 as Day;
  for (const truce of Object.values(state.truces)) truce.endsOn = 465 as Day;
  const punic = state.factions[carthage];
  if (!punic) throw new Error('no Carthage');
  punic.noticeSince = 80 as Day;
  state.cities['roma' as CityId]?.recruits.push({ troop: 'spearmen', readyOn: 101 as Day });
  return state;
}

/** Carthage pressing Rome by its field armies, with Heavy cavalry in training at Roma for 20 days. */
function pressedWithMenInTraining(): GameState {
  const state = carthageNearsWar();
  const punic = state.formations[armyOf(state, carthage).formations[0] as FormationId];
  const roman = state.formations[armyOf(state, rome).formations[0] as FormationId];
  const stores = state.factions[rome]?.stores;
  if (!punic || !roman || !stores) throw new Error('no armies or Roman stores');
  punic.men = 2000;
  roman.men = 1000;
  stores.gold = 2229;
  stores.manpower = 300;
  state.cities['roma' as CityId]?.recruits.push({
    troop: 'heavyCavalry',
    readyOn: (state.day + 20) as Day,
  });
  return state;
}

async function both(
  page: Page,
  shot: (name: string, title: string) => Promise<void>,
  show: () => Promise<void>,
  name: string,
  title: string,
) {
  await resizeTo(page, WIDE);
  await page.locator('canvas[data-terrain="ready"]').waitFor();
  await show();
  await shot(`${name}-1280`, `${title}, at 1280 by 720`);
  await resizeTo(page, PHONE);
  await page.locator('canvas[data-terrain="ready"]').waitFor();
  await show();
  await shot(`${name}-390`, `${title}, at 390 px wide, where the side column is a sheet`);
}

export default defineScenario({
  name: 'round-thirteen',
  title:
    "The thirteenth play-through's cards: on the day the Canals line names, a card counts the Canals at work and agrees, a fall that comes anyway is said to come with or without the troop, and the corner says whether the men in training are enough",
  viewport: WIDE,
  async run({ page, shot }) {
    await openGame(page);
    const state = canalsWithinTheirWork();
    await loadWarnings(page, state);
    await showOwnCity(page, 'Roma');
    const cards = page.getByTestId('recruit-cards');
    const warning = page.getByTestId('recruit-warning');
    await cards.getByRole('button', { name: /^Spearmen/ }).click();
    await expect(page.getByTestId('recruit-canal')).toContainText(
      'fed if raised in about 18 days, on Year 1, day 19',
    );
    await both(
      page,
      shot,
      () => page.getByTestId('recruit-canal').scrollIntoViewIfNeeded(),
      'canal-named',
      'The Spearmen card names Canals at Roma and a raise in 18 days, on Year 1, day 19',
    );
    await resizeTo(page, WIDE);
    await loadWarnings(page, playDays(state, 18, [canalsAtRoma]));
    await showOwnCity(page, 'Roma');
    await expect(page.getByTestId('city-construction')).toContainText('Canals');
    await expect(page.getByTestId('recruit-runway-food')).not.toHaveClass(/bad/);
    await cards.getByRole('button', { name: /^Spearmen/ }).click();
    await expect(page.getByTestId('city-raising')).toContainText('Spearmen');
    await expect(warning).toHaveCount(0);
    await both(
      page,
      shot,
      () => page.getByTestId('recruit-forecast').scrollIntoViewIfNeeded(),
      'canal-day',
      'On Year 1, day 19, with the Canals still at work, the Spearmen are raised with no warning, as the line said',
    );

    await resizeTo(page, WIDE);
    await loadWarnings(page, noticeEndsAnyway());
    await showOwnCity(page, 'Roma');
    await expect(page.getByTestId('recruit-threat').first()).toContainText(
      'it falls below 80% on Year 1, day 101 with or without them',
    );
    await both(
      page,
      shot,
      () => page.getByTestId('recruit-threat').first().scrollIntoViewIfNeeded(),
      'threat-anyway',
      'Spearmen in training end the notice tomorrow, so each card says the fall comes with or without its troop and what the troop changes',
    );

    await resizeTo(page, PHONE);
    await page.locator('canvas[data-terrain="ready"]').waitFor();
    await openGame(page, { pauses: true });
    await resizeTo(page, PHONE);
    await loadWarnings(page, pressedWithMenInTraining());
    await resume(page);
    const line = page
      .getByTestId('alerts')
      .getByRole('listitem')
      .filter({ hasText: /Heavy cavalry in training muster on Year 1, day 21, which is enough\./ })
      .first();
    await line.waitFor();
    await shot(
      'training-warning-390',
      'The warning says the Heavy cavalry in training are enough, at 390 px wide',
    );
  },
});
