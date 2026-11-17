import { expect, type Page } from '@playwright/test';
import {
  armyOf,
  carthage,
  carthageNearsWar,
  dropSave,
  openGame,
  pause,
  rome,
  untilDrawn,
} from '../../../e2e/support.ts';
import type { FormationId } from '../../../src/sim/ids.ts';
import type { Day } from '../../../src/sim/state/day.ts';
import type { GameState } from '../../../src/sim/state/game-state.ts';
import { defineScenario } from '../scenario.ts';

/**
 * Carthage pressing Rome by its field armies on day 100, on notice for 22 days, so it may first
 * declare on day 108, before any troop Rome can afford finishes training.
 */
function carthagePressesSoon(): GameState {
  const state = carthageNearsWar();
  state.day = 100 as Day;
  const punic = state.formations[armyOf(state, carthage).formations[0] as FormationId];
  const roman = state.formations[armyOf(state, rome).formations[0] as FormationId];
  const power = state.factions[carthage];
  const stores = state.factions[rome]?.stores;
  if (!punic || !roman || !power || !stores) throw new Error('no armies or Roman stores');
  punic.men = 2000;
  roman.men = 1000;
  stores.gold = 2229;
  stores.manpower = 5000;
  power.noticeSince = 78 as Day;
  return state;
}

async function load(page: Page, state: GameState) {
  await pause(page);
  await dropSave(page, state);
  await expect(page.getByTestId('time-controls-day')).toHaveAttribute(
    'data-day',
    String(state.day),
  );
  await untilDrawn(page);
}

export default defineScenario({
  name: 'threat-standing',
  title:
    'At peace with every power, the wars panel says how near each great power stands to declaring war on Rome, and, days before war may come, which troop to order now and the day it musters',
  async run({ page, shot }) {
    await openGame(page);
    await load(page, carthageNearsWar());
    await page.getByTestId('wars-button').click();
    const rows = page.getByTestId('wars-panel').getByTestId('threat-row');
    await expect(rows.filter({ hasText: /^Carthage has \d+% of the strength/ })).toHaveCount(1);
    await expect(rows).toHaveCount(4);
    await shot(
      'threat-standing-panel',
      "Carthage, grown to twelve cities, stands near the strength it needs against Rome, and the other powers stand further off, each with what Rome's treasury and guards do",
    );
    await page.getByTestId('wars-button').click();
    await load(page, carthagePressesSoon());
    await page.getByTestId('wars-button').click();
    await expect(
      rows.filter({ hasText: 'order Skirmishers now for 900 gold; they muster and lower it from' }),
    ).toHaveCount(1);
    await shot(
      'threat-standing-muster',
      'Eight days before Carthage may declare, Skirmishers cannot finish training in time, and the At peace line says to order them now and the day they muster and lower the threat',
    );
  },
});
