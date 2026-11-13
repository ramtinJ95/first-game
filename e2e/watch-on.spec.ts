import { expect, test } from '@playwright/test';
import type { GameState } from '../src/sim/state/game-state.ts';
import {
  camera,
  day,
  dropSave,
  nextDay,
  openGame,
  pause,
  resume,
  romaFallsTomorrow,
  rome,
  untilDrawn,
} from './support.ts';

/** Banners closer than this on screen could take each other's click. */
const CLEAR_PX = 40;

/** Plays the save forward as the page does, to the day the page shows. */
function playTo(state: GameState, target: number): GameState {
  let current = state;
  while (current.day < target) current = nextDay(current);
  return current;
}

test('a defeated player who watches on sees every army, and the top bar and the overview say the realm has fallen', async ({
  page,
}) => {
  const save = romaFallsTomorrow();
  await openGame(page);
  await pause(page);
  await dropSave(page, save);
  await expect(page.getByTestId('time-controls-day')).toHaveAttribute('data-day', String(save.day));
  await resume(page);

  const defeat = page.getByTestId('defeat');
  await expect(defeat).toContainText('Rome has fallen');
  await expect(page.getByTestId('realm-fallen')).toHaveText('Your realm has fallen');
  await expect(page.getByTestId('store-gold')).toHaveCount(0);
  await expect(page.getByTestId('alerts')).not.toContainText('ran out');

  await defeat.getByRole('button', { name: 'Watch on' }).click();
  await expect(defeat).toHaveCount(0);
  await pause(page);
  await untilDrawn(page);
  const shown = await day(page);
  const before = playTo(save, shown - 1);
  const state = playTo(before, shown);

  const view = camera(page);
  const banners = Object.values(state.armies).flatMap((army) =>
    army.activity.kind === 'embarked' ? [] : [{ army, at: view.banner(army.activity.position) }],
  );
  const persian = banners.find(({ army, at }) => {
    if (army.owner !== 'persia' || army.activity.kind !== 'idle') return false;
    const was = before.armies[army.id]?.activity;
    if (was?.kind !== 'idle') return false;
    if (
      was.position.x !== army.activity.position.x ||
      was.position.y !== army.activity.position.y
    ) {
      return false;
    }
    return banners.every(
      (other) => other.army === army || Math.hypot(other.at.x - at.x, other.at.y - at.y) > CLEAR_PX,
    );
  });
  if (!persian) throw new Error('no Persian army stands clear of the others');

  await page.mouse.click(persian.at.x, persian.at.y);
  const panel = page.getByTestId('army-panel');
  await expect(panel.getByRole('heading')).toHaveText('Army of Persia');

  await page.getByRole('button', { name: 'Overview' }).click();
  const overview = page.getByTestId('overview');
  await expect(overview.getByTestId('overview-fallen')).toHaveText(
    `Your realm has fallen. Rome lost its last city on Year 1, day ${state.factions[rome]?.defeatedOn}, and nothing is left to command.`,
  );
  await expect(overview.getByTestId('overview-armies')).toHaveCount(0);
  await expect(overview.getByTestId('overview-wars')).toHaveCount(0);
});
