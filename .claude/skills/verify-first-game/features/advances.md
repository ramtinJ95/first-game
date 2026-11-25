# Advances

The realm studies one advance at a time from nine in three branches (Military, Economy, Statecraft). The player pays its gold when study starts. The top bar's Advances button names the advance and its days left, and the effect lasts once the days are done.

## Sub-features

- `adv-open` opens the panel from the top bar: the rule, `advances-now`, then three branches of three cards, each with price and days, effect, `For you today: …`, payback and a `study-<kind>` button.
- `adv-mark` `advances-marked` names the advance that pays back soonest of those you can start, `Pays back soonest of what you can start: <name>, in <x> years.`, with `Show it` (`advances-show-marked`), which scrolls to its card; the card carries `Pays back soonest` (`advance-suggested`).
- `adv-building` `advances-building-first` names a building in one of your cities that pays back sooner. If the treasury holds its price: `… Build first, and study with the gold left.` If not, it is counted from today: `… but it costs <price> gold, <n> more than you hold, which today's income brings in <d> days, so counted from today it pays back in <x> years.` Then either `That is still sooner than any advance you can start …`, or the advance you can pay for now that is sooner, with the delay: `Studying it puts the <building> off to about <d> days from now. You choose.` A realm that has taken no city is offered no Temple or Sanctuary.
- `adv-study` orders an advance for the next day and refuses the others while one is ordered or studied.
- `adv-progress` shows `Studying` in its row, `<name> · <n> days` in the top bar, and `Studying <name>: <n> days left. Give up (<gold> gold back)` in the panel.
- `adv-give-up` `advances-cancel` gives up the study for half its gold back; it then reads `Giving up ordered`.
- `adv-news` when an advance finishes and nothing else is studied, the corner says `<Name> is studied, for good. Nothing is being studied now: choose the next advance in the Advances panel.` and the game stops, unless `pause-advance` is off in the Game menu. A click on the line opens the panel.
- `adv-hint` once a game, as a treasury that studies nothing nears its limit, the corner says `Your treasury is nearly full and nothing is being studied. …` without stopping; a click opens the panel.

## How to get to it (user POV)

- The top bar's `Advances` button, whose second line reads `None studied` or the advance and its days. On a phone it shows only the days.
- The panel's `Study for <n> gold` buttons.

## Driving it with drive.ts

Preconditions:

- `open --moment romaTreasuryFull`: Rome with a full treasury on day 1, paused.

- **Open the panel.** `act "await page.getByTestId('advances-button').click(); return await page.getByTestId('advances').ariaSnapshot()"`. The region `Advances` lists three branches of three, each row with `Study for <n> gold`, and `advances-now` reads `Nothing is being studied.`
- **Order a study.** `act "const gold = await page.getByTestId('store-gold-amount').textContent(); await page.getByTestId('study-clemency').click(); await expect(page.getByTestId('advance-clemency')).toContainText('Ordered for the next day'); return { gold, others: await page.getByTestId('study-standardCoin').isDisabled() }"`. The row reads `Ordered for the next day` and `others` is `true`, and their buttons are named `Clemency is ordered for the next day`.
- **Play a day.** `act "const from = Number(await page.getByTestId('time-controls-day').getAttribute('data-day')); await page.getByRole('button', { name: 'Resume', exact: true }).click(); await expect.poll(async () => Number(await page.getByTestId('time-controls-day').getAttribute('data-day'))).toBeGreaterThan(from); await page.getByRole('button', { name: 'Pause', exact: true }).click(); return { line: await page.getByTestId('study-line').textContent(), now: await page.getByTestId('advances-now').textContent(), gold: await page.getByTestId('store-gold-amount').textContent() }"`. `line` is `Clemency · 119 days`, `now` is `Studying Clemency: 119 days left. Give up (750 gold back)`, and the gold went from 8,568 to 7,089, the 1,500 price plus one day's +20.7.
- **Give up.** `act "await page.getByTestId('advances-cancel').click(); return page.getByTestId('advances-now').innerText()"` ends `Giving up ordered`. A day later `now` is `Nothing is being studied.` and the 750 is back.
- **The building line.** On `romaTreasuryFull` it reads `Building Forum at Roma would pay back in 2.1 years, sooner than any advance you can start: the soonest, Citizen rolls, takes 2.3. Build first, and study with the gold left.` For the other forms, `open --moment .claude/skills/verify-first-game/moments.ts:romeHolds --args '[6000]'`: the Forum is 500 gold short and still sooner. With `[4500]` it is 2,000 short, Citizen rolls is sooner, the line ends `Studying it puts the Forum off to about 242 days from now. You choose.`, and the mark shows.
- **The mark.** `open --moment .claude/skills/verify-first-game/moments.ts:advanceMarked`. `advances-marked` reads `Pays back soonest of what you can start: Citizen rolls, in 2.3 years. Show it`, and `Show it` brings the card with `advance-suggested` into view.
- **The finished advance.** `open --moment .claude/skills/verify-first-game/moments.ts:advanceDoneTomorrow`, then `play --until-text 'is studied, for good'`. It stops on day 2 with `Marching rations is studied, for good. Nothing is being studied now: …`, and `study-line` reads `None studied`. Uncheck `pause-advance` in the Game menu and open the moment again: the same line comes without `Paused`, and `play` lists no stop. Check it again after.
- **The hint.** `open --moment .claude/skills/verify-first-game/moments.ts:advanceHintNear`, then `play --until-text 'nothing is being studied'`. The line comes on day 2 without a stop.
- **Proof.** `shot advances-studying`. The top bar's button and the panel's row both say Clemency is studied.

## Gotchas

- A row's button is disabled with its reason as its name (`Clemency is ordered for the next day`, then `Studying Clemency; one at a time`), so find a study button by test id, `study-<kind>`, not by name.
- The panel scrolls to the advance under study. Scroll before you shoot another row.
- On a phone the top bar shows `study-days`, not `study-line`.
- `e2e/advances.spec.ts` builds its moments inline; the skill's `moments.ts` exports the same states (`advanceDoneTomorrow`, `advanceMarked`, `advanceHintNear`) plus `romeHolds`. The capture scenario `advances` shoots them.
- `advances-now` ends with a space; trim it or match with `toContainText`.
