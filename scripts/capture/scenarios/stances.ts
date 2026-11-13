import { expect, type Page } from '@playwright/test';
import {
  armyOf,
  battleAt,
  dropSave,
  nextDay,
  openGame,
  pause,
  rome,
  startGame,
  untilDrawn,
} from '../../../e2e/support.ts';
import type { ArmyId } from '../../../src/sim/ids.ts';
import type { Stance } from '../../../src/sim/state/army.ts';
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
  await page.getByTestId('battle-panel').waitFor();
}

/** Rome's army in one stance meets Mediolanum's in another, on their battle's first day. */
function battle(ours: Stance, theirs: Stance, reforming = false): GameState {
  const state = startGame();
  battleAt(state, 'mediolanum');
  const army = armyOf(state, rome);
  army.stance = ours;
  const enemy = state.armies['army-mediolanum' as ArmyId];
  if (enemy) enemy.stance = theirs;
  const next = nextDay(state);
  const played = next.armies[army.id];
  if (reforming && played) played.stanceChangedOn = next.day;
  return next;
}

export default defineScenario({
  name: 'stances',
  title:
    'The battle panel says whose stance beats whose, marks the stance that answers the enemy with its cost, and tells of re-forming',
  async run({ page, shot }) {
    await openGame(page);

    await load(page, battle('holdTheLine', 'skirmishAndWithdraw'));
    await shot(
      'stance-beaten',
      "Beaten: Mediolanum's skirmishers beat Rome's line, and the panel marks all-out assault, which beats them, with its three days of re-forming",
    );

    await load(page, battle('skirmishAndWithdraw', 'holdTheLine'));
    await shot('stance-beating', "Beating: Rome's skirmishers beat Mediolanum's line");

    await load(page, battle('allOutAssault', 'skirmishAndWithdraw', true));
    await shot(
      'stance-reforming',
      'Re-forming: Rome changed to all-out assault today, so for three days every enemy stance beats it, and the panel counts the days',
    );
  },
});
