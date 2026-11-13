import { expect, test, type Page } from '@playwright/test';
import type { ArmyId } from '../src/sim/ids.ts';
import type { GameState } from '../src/sim/state/game-state.ts';
import {
  armyOf,
  battleAt,
  day,
  dropSave,
  nextDay,
  openGame,
  pause,
  resume,
  rome,
  startGame,
  untilDay,
  untilDrawn,
} from './support.ts';

async function load(page: Page, state: GameState) {
  await pause(page);
  await dropSave(page, state);
  await expect(page.getByTestId('time-controls-day')).toHaveAttribute(
    'data-day',
    String(state.day),
  );
  await untilDrawn(page);
}

/**
 * Rome's army in skirmish order meets Mediolanum's line, which skirmish beats, on the
 * first day of their battle.
 */
function romeSkirmishesAtMediolanum(): GameState {
  const state = startGame();
  battleAt(state, 'mediolanum');
  armyOf(state, rome).stance = 'skirmishAndWithdraw';
  return nextDay(state);
}

const defenders = 'army-mediolanum' as ArmyId;

test('the battle panel says whose stance beats whose, follows the enemy when it answers, and tells of re-forming after a change', async ({
  page,
}) => {
  const start = romeSkirmishesAtMediolanum();
  expect(Object.keys(start.battles)).toHaveLength(1);
  // The day Mediolanum, beaten, changes its stance, played through the rules as the page plays it.
  let state = start;
  while (state.armies[defenders]?.stance === 'holdTheLine') {
    state = nextDay(state);
    if (state.day > start.day + 30 || !state.armies[defenders]) {
      throw new Error('Mediolanum never changed its stance');
    }
  }
  const changed = state.day;

  await openGame(page);
  await load(page, start);
  const battle = page.getByTestId('battle-panel');
  const standing = battle.getByTestId('stance-standing');
  await expect(standing).toHaveText('Your skirmishers beat their line');
  await expect(battle.getByTestId('stance-allOutAssault')).not.toHaveClass(/answers/);

  await resume(page);
  await untilDay(page, changed);
  await pause(page);
  await expect(standing).not.toHaveText('Your skirmishers beat their line');
  const theirs = battle.getByTestId('battle-army').filter({ hasText: /^\s*Army of Mediolanum ·/ });
  await expect(theirs).toContainText(
    /Army of Mediolanum · (All-out assault|Skirmish and withdraw)/,
  );

  const answer = battle.locator('[data-testid^="stance-"].answers');
  await expect(answer).toContainText(/re-forms \d+ days/);
  await answer.click();
  // The army panel keeps the army's stance after the battle ends, so it is read there.
  await battle.getByRole('button', { name: /^First Legion ·/ }).click();
  const army = page.getByTestId('army-panel');
  await expect(army.getByRole('heading', { level: 2 })).toHaveText('First Legion');
  const ordered = await day(page);
  await resume(page);
  await untilDay(page, ordered + 1);
  await pause(page);
  await expect(
    page.getByRole('complementary', { name: 'Selection' }).getByTestId('stance-reforming'),
  ).toHaveText(/^Re-forming, \d days? left$/);
});
