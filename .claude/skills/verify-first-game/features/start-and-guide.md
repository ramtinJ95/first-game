# Start screen and guide

The start screen offers `Continue` when a save exists and five powers to choose from: Rome, Carthage, Macedon, Egypt and Persia. Choosing one starts a paused game on its capital with the guide open, which says the goal, how the realm stands, trade, pauses and stances.

## Sub-features

- `start-powers` five buttons, each with the capital, cities and a sentence.
- `start-continue` `Continue` with `continue-info`, only when a save exists (see [Saves](./saves.md)).
- `start-drop` dropping a save on the start screen loads it.
- `guide-open` the dialog `guide` with `You rule <name>` and the sections `guide-goal`, `guide-standing`, `guide-trade`, `guide-wars`, `guide-pauses`, `guide-stances`. `guide-wars` ends `While you hold no more cities than at the start, each great power needs less of the strength to declare war on you: 1.5% for each year of the game, to at most 15%. Holding more cities than at the start ends it.`
- `guide-close` `Close`, Enter, Escape, or a click on the backdrop close it; the top bar's `Guide` opens it again.

## How to get to it (user POV)

- Open the page at `/`. Choose a power. Click `Guide` in the top bar later.

## Driving it with drive.ts

Preconditions:

- `open --power start`.

- **Choose a power.** `act "await page.getByTestId('start-screen').getByRole('button', { name: /^Carthage/ }).click(); const guide = page.getByTestId('guide'); await guide.waitFor(); return { heading: await guide.getByRole('heading').first().textContent(), speed: (await page.getByTestId('time-controls-speed').textContent()).trim() }"`. `heading` is `You rule Carthage` and the game is `Paused`.
- **Close and reopen.** `act "await page.keyboard.press('Escape'); await expect(page.getByTestId('guide')).toBeHidden(); await page.getByRole('button', { name: 'Guide' }).click(); return await page.getByTestId('guide').isVisible()"`. `true`, and the game is still paused.
- **Proof.** `shot start-screen` before choosing and `shot guide-open` after.

## Gotchas

- `open` without `--power start` uses `?play=`, which skips the start screen and the guide.
- The start screen's title is the game's working name, `The Middle Sea`.
- Moments: `e2e/guide-game.ts` (`discoveryGame`, `fullBuildingGame`, `convoyOverRoma`, `staggeredSiege`). Capture scenarios: `frame`, `guide-discovery`.
