import { expect, type Page } from '@playwright/test';
import {
  armyOf,
  cityPoint,
  dropSave,
  outnumberedAt,
  mediolanumFallsTomorrow,
  openGame,
  pause,
  resizeTo,
  resume,
  rome,
  startGame,
  untilDrawn,
  withFormations,
} from '../../../e2e/support.ts';
import { nameNewArmy } from '../../../src/sim/army-names.ts';
import { allocateId } from '../../../src/sim/ids.ts';
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

/** Rome with its starting legion at Roma and two more raised at Capua and Arretium. */
function threeLegions(): GameState {
  const state = startGame();
  for (const [city, troops] of [
    ['capua', [['spearmen', 600]]],
    [
      'arretium',
      [
        ['archers', 400],
        ['lightCavalry', 200],
      ],
    ],
  ] as const) {
    const id = allocateId(state, 'army');
    state.armies[id] = {
      id,
      owner: rome,
      name: nameNewArmy(state, rome),
      formations: [],
      stance: 'holdTheLine',
      generalSkill: 3,
      activity: { kind: 'idle', position: cityPoint(city) },
    };
    withFormations(state, state.armies[id], troops);
  }
  armyOf(state, rome).activity = { kind: 'idle', position: cityPoint('roma') };
  return state;
}

/** Rome's army beside Roma and Carthage's of 1,500 men, at war, so they fight the next day. */
function battleTomorrow() {
  const state = startGame();
  outnumberedAt(state, 'roma', 1500);
  return state;
}

async function battleBegins(page: Page) {
  await load(page, battleTomorrow());
  await page.getByRole('button', { name: 'Speed 3', exact: true }).click();
  await resume(page);
  await page.getByTestId('battle-panel').waitFor();
}

export default defineScenario({
  name: 'page-truth',
  title:
    'The page tells the truth and stops when the player must decide: the fate prompt with each yield once calm, the pause at a battle, the chronicle, the battle panel at 600 px, the phone sheet, and named armies',
  async run({ page, shot }) {
    await openGame(page, { pauses: true });

    await load(page, mediolanumFallsTomorrow());
    await resume(page);
    const prompt = page.getByTestId('fate-prompt');
    await prompt.waitFor();
    await shot(
      'fate-prompt',
      'Mediolanum falls to Rome: each fate on one line, with what it gives now, how long the unrest lasts, the yield a day at first, and the yield once calm',
    );
    await prompt.getByTestId('fate-occupy').click();

    await battleBegins(page);
    await page.getByTestId('alert-paused').waitFor();
    await shot(
      'battle-pause',
      'A battle of Rome begins at speed 3: the game pauses on its first day, and the alert says why, with the camera where it was',
    );

    await resizeTo(page, { width: 1280, height: 600 });
    await page.getByRole('button', { name: 'Overview' }).click();
    await page.getByTestId('overview-armies').getByRole('button').first().click();
    await page.getByRole('button', { name: 'Overview' }).click();
    await page.getByTestId('army-in-battle').waitFor();
    await shot(
      'battle-panel-600',
      'At 1280x600 the selected army in battle shows its stance controls once, in the battle panel, and the side column scrolls to the defenders',
    );
    await resizeTo(page, { width: 1280, height: 720 });

    await resume(page);
    await page
      .getByTestId('alerts')
      .getByText(/held the field/)
      .waitFor({ timeout: 60_000 });
    await pause(page);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Chronicle' }).click();
    await page.getByTestId('chronicle').waitFor();
    await shot(
      'chronicle',
      'The chronicle keeps every alert of the game with its day, and a save keeps it',
    );
    await page.getByRole('button', { name: 'Chronicle' }).click();

    await resizeTo(page, { width: 390, height: 844 });
    await battleBegins(page);
    await pause(page);
    await page.getByRole('button', { name: 'Overview' }).click();
    await page.getByTestId('overview-armies').getByRole('button').first().click();
    await page.getByRole('button', { name: 'Overview' }).click();
    await page.getByTestId('army-panel').waitFor();
    await shot(
      'phone-sheet',
      'At 390 px the open sheet stands alone at the bottom: the alerts wait in the chronicle',
    );
    await resizeTo(page, { width: 1280, height: 720 });

    await load(page, threeLegions());
    await page.getByRole('button', { name: 'Overview' }).click();
    await page.getByTestId('overview-armies').waitFor();
    await shot('overview-names', 'The overview names each army: First, Second, and Third Legion');
  },
});
