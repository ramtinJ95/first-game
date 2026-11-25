import { expect, type Page } from '@playwright/test';
import { carthageClimbs } from '../../../e2e/climb-game.ts';
import { dropSave, openGame, pause, resizeTo, resume, untilDrawn } from '../../../e2e/support.ts';
import { defineScenario } from '../scenario.ts';

const CASES = [
  {
    name: 'band',
    title:
      'guards Carthage counted at Roma stop counting while it stands on notice: told, and the game runs on',
    save: () => carthageClimbs(0, 2),
    line: /The 1,000 guards at Roma no longer count against Carthage's war: it stands/,
    stops: false,
  },
  {
    name: 'ahead',
    title:
      'ten days before guards Carthage counts at Roma stop counting: told, with the day and the share it would then stand at, and the game runs on',
    save: () => carthageClimbs(0, 2, [], 111),
    line: /The 1,000 guards at Roma stop counting against Carthage's war in 10 days/,
    stops: false,
  },
  {
    name: 'climb',
    title:
      'Carthage stands 8 points above the share the game last stopped for: the game stops again',
    save: () => carthageClimbs(8, 0),
    line: /Carthage has climbed to \d+% near Roma, from \d+% at its last stop/,
    stops: true,
  },
  {
    name: 'climb-band',
    title: 'both on one day: one stop that tells the guards and the climb',
    save: () => carthageClimbs(8, 2),
    line: /The 1,000 guards at Roma no longer count\. Carthage has climbed/,
    stops: true,
  },
] as const;

/**
 * The case's line stands whole inside the window and inside the list that clips it, once the
 * list is scrolled to it: a line that runs the game on sinks below the news that comes after
 * it, and the corner gives such news less room than news that stops the game.
 */
async function whole(page: Page, where: 'alerts' | 'chronicle', line: RegExp) {
  const window = page.viewportSize();
  const list = page.getByTestId(where);
  const item = list.getByRole('listitem').filter({ hasText: line }).first();
  await item.waitFor();
  await item.scrollIntoViewIfNeeded();
  const box = await item.boundingBox();
  const room = await list.boundingBox();
  expect(box).not.toBeNull();
  expect(room).not.toBeNull();
  if (!box || !room || !window) return;
  expect(box.y).toBeGreaterThanOrEqual(Math.max(0, room.y) - 1);
  expect(box.x + box.width).toBeLessThanOrEqual(window.width);
  expect(box.y + box.height).toBeLessThanOrEqual(Math.min(window.height, room.y + room.height) + 1);
}

export default defineScenario({
  name: 'warning-climb',
  title:
    'A power on notice whose guards stop counting is told ten days ahead and on that day, and one that climbs 6 points or more above the share the game last stopped for stops it again',
  async run({ page, shot }) {
    await openGame(page, { pauses: true });
    for (const width of [1280, 1024]) {
      await resizeTo(page, { width, height: 720 });
      for (const c of CASES) {
        await pause(page);
        await dropSave(page, c.save());
        await expect(page.getByTestId('time-controls-day')).toHaveAttribute('data-day', '100');
        await untilDrawn(page);
        await resume(page);
        const item = page.getByTestId('alerts').getByRole('listitem').filter({ hasText: c.line });
        await item.first().waitFor();
        if (c.stops) await expect(item.first().getByTestId('alert-paused')).toHaveCount(1);
        else await expect(item.first().getByTestId('alert-paused')).toHaveCount(0);
        await pause(page);
        await untilDrawn(page);
        await whole(page, 'alerts', c.line);
        await shot(`warning-climb-${c.name}-${width}`, `${width} × 720: ${c.title}`);
      }
    }
    await resizeTo(page, { width: 390, height: 844 });
    await page.getByRole('button', { name: 'Chronicle' }).click();
    const chronicle = page.getByTestId('chronicle');
    await expect(chronicle).toBeVisible();
    await untilDrawn(page);
    await shot(
      'warning-climb-chronicle-390',
      'The last case, a climb and guards on one day, in the Chronicle at 390 px wide',
    );
    const ahead = CASES.find((c) => c.name === 'ahead');
    if (!ahead) throw new Error('no ahead case');
    await page.getByRole('button', { name: 'Chronicle' }).click();
    await pause(page);
    await dropSave(page, ahead.save());
    await expect(page.getByTestId('time-controls-day')).toHaveAttribute('data-day', '100');
    await untilDrawn(page);
    await resume(page);
    await page
      .getByTestId('alerts')
      .getByRole('listitem')
      .filter({ hasText: ahead.line })
      .first()
      .waitFor();
    await pause(page);
    await page.getByRole('button', { name: 'Chronicle' }).click();
    await expect(chronicle).toBeVisible();
    await whole(page, 'chronicle', ahead.line);
    await expect(
      chronicle.getByRole('listitem').filter({ hasText: ahead.line }).first(),
    ).toContainText('A new band counts 90 days, for 2,000 gold.');
    await untilDrawn(page);
    await shot(
      'warning-climb-ahead-chronicle-390',
      'The line ten days before guards stop counting, whole in the Chronicle at 390 px wide',
    );
  },
});
