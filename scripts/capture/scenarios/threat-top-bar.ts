import { expect, type Page } from '@playwright/test';
import {
  armyOf,
  carthage,
  carthageNearsWar,
  dropSave,
  openGame,
  pause,
  resizeTo,
  resume,
  rome,
  untilDrawn,
} from '../../../e2e/support.ts';
import type { FormationId } from '../../../src/sim/ids.ts';
import type { GameState } from '../../../src/sim/state/game-state.ts';
import { defineScenario } from '../scenario.ts';

async function load(page: Page, state: GameState) {
  await pause(page);
  await dropSave(page, state);
  await expect(page.getByTestId('time-controls-day')).toHaveAttribute(
    'data-day',
    String(state.day),
  );
  await untilDrawn(page);
}

/** The same Rome beside a Carthage of 2,000 men and with an empty treasury: no power near war. */
function carthageFarFromWar(): GameState {
  const state = carthageNearsWar();
  const punic = state.formations[armyOf(state, carthage).formations[0] as FormationId];
  const stores = state.factions[rome]?.stores;
  if (!punic || !stores) throw new Error('no Carthaginian army or Roman stores');
  punic.men = 2000;
  stores.gold = 0;
  return state;
}

export default defineScenario({
  name: 'threat-top-bar',
  title:
    'The Wars button says when a great power at peace stands near war, at 1280 and 1024 px, and the warning says where to watch it',
  async run({ page, shot }) {
    await openGame(page);
    const bar = page.getByTestId('top-bar');
    for (const width of [1280, 1024]) {
      await resizeTo(page, { width, height: 720 });
      await load(page, carthageFarFromWar());
      await expect(page.getByTestId('wars-button')).toHaveText('Wars 0');
      const plain = (await bar.boundingBox())?.height;
      await shot(
        `top-bar-plain-${width}`,
        `${width} px: no power near war, the Wars button reads Wars 0`,
      );
      await load(page, carthageNearsWar());
      await expect(page.getByTestId('wars-threat')).toHaveText('· 1 threat');
      expect((await bar.boundingBox())?.height, 'the top bar keeps one row').toBe(plain);
      expect(
        await bar.evaluate((header) => header.scrollWidth <= header.clientWidth),
        'nothing in the top bar runs past its edge',
      ).toBe(true);
      await shot(
        `top-bar-threat-${width}`,
        `${width} px: Carthage stands at 90% of what it needs, and the Wars button reads Wars 0 · 1 threat in the warning colour`,
      );
    }
    await resizeTo(page, { width: 1280, height: 720 });
    await resume(page);
    await page
      .getByTestId('alerts')
      .getByText(/See At peace in Wars\.$/)
      .waitFor();
    await pause(page);
    await page.getByRole('button', { name: 'Chronicle' }).click();
    await page
      .getByTestId('chronicle')
      .getByText(/See At peace in Wars\.$/)
      .waitFor();
    await shot('threat-top-bar-news', 'The warning ends by saying where to watch the threat');
  },
});
