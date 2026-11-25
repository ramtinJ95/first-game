# Advances

The realm studies one advance at a time from nine in three branches (Military, Economy, Statecraft). The player pays its gold when study starts. The top bar's Advances button names the advance and its days left, and the effect lasts once the days are done.

## Sub-features

- `adv-open` opens the panel from the top bar, with each advance's price, days, effect for the realm today and payback.
- `adv-suggest` names a building that would pay back sooner than any advance, when one does.
- `adv-study` orders an advance for the next day and refuses the others while one is ordered or studied.
- `adv-progress` shows `Studying` in its row, `<name> · <n> days` in the top bar, and `Studying <name>: <n> days left. Give up (<gold> back)` in the panel.
- `adv-give-up` gives up the study for half its gold back.
- `adv-news` tells in the corner when an advance is done, without stopping the game.

## How to get to it (user POV)

- The top bar's `Advances` button, whose second line reads `None studied` or the advance and its days. On a phone it shows only the days.
- The panel's `Study for <n> gold` buttons.

## Driving it with drive.ts

Preconditions:

- `open --moment romaTreasuryFull`: Rome with a full treasury on day 1, paused.

- **Open the panel.** `act "await page.getByTestId('advances-button').click(); return await page.getByTestId('advances').ariaSnapshot()"`. The region `Advances` lists three branches of three, each row with `Study for <n> gold`, and `advances-now` reads `Nothing is being studied.`
- **Order a study.** `act "const gold = await page.getByTestId('store-gold-amount').textContent(); await page.getByTestId('study-clemency').click(); await expect(page.getByTestId('advance-clemency')).toContainText('Ordered for the next day'); return { gold, others: await page.getByTestId('study-standardCoin').isDisabled() }"`. The row reads `Ordered for the next day` and `others` is `true`.
- **Play a day.** `act "const from = Number(await page.getByTestId('time-controls-day').getAttribute('data-day')); await page.getByRole('button', { name: 'Resume', exact: true }).click(); await expect.poll(async () => Number(await page.getByTestId('time-controls-day').getAttribute('data-day'))).toBeGreaterThan(from); await page.getByRole('button', { name: 'Pause', exact: true }).click(); return { line: await page.getByTestId('study-line').textContent(), now: await page.getByTestId('advances-now').textContent(), gold: await page.getByTestId('store-gold-amount').textContent() }"`. `line` is `Clemency · 119 days`, `now` starts `Studying Clemency: 119 days left`, and the gold fell by 1,500 plus one day's change.
- **Proof.** `shot advances-studying`. The top bar's button and the panel's row both say Clemency is studied.

## Gotchas

- A row's button is disabled with its reason as its name (`Studying Clemency; one at a time`), so find a study button by test id, `study-<kind>`, not by name.
- The panel scrolls to the advance under study. Scroll before you shoot another row.
- On a phone the top bar shows `study-days`, not `study-line`.
- Moments with an advance under way: `e2e/advances.spec.ts` builds them inline from `startGame()`; the capture scenario `advances` shoots them.
