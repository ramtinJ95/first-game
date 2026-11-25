# Warnings and stops

When a great power at peace nears the strength to declare war on the player, the corner warns, names what brings it near and what would lower it, and stops the game. The Game menu's settings choose which news stops the game. Lines that repeat a standing warning, and lines that tell of a coming change, play on.

## Sub-features

- `warn-line` is the warning: `<Power> could soon declare war on you: it has <n>% of the strength it needs against your forces near <city>, and may declare from <date> if it holds it.`, then the treasury's part, a building, guards, food, and `See At peace in Wars.`
- `warn-stop` pauses the game and marks the line `Paused` (`alert-paused`); the speed reads `Paused`.
- `warn-repeat` a later line about the same power says `The game ran on: its stop on <date> was at <n>%` and does not stop.
- `warn-top-bar` the Wars button reads `Wars 0 · 1 threat`.
- `warn-guards-ahead` the line ten days before guards stop counting (see [Guards](./guards.md)).
- `warn-held` a power held back by another war says `Its war with … holds back part of its strength`, and the corner tells when that war ends.
- `warn-settings` the Game menu's `Pause the game when` checkboxes: battles, weak sieges, enemies sighted, own cities, war threats, fates.

## How to get to it (user POV)

- Play on; the line appears in the corner and the game stops.
- `Game` → `Pause the game when` → `A great power at peace with you could soon declare war on you`.

## Driving it with drive.ts

Preconditions:

- `open --moment carthageNearsWar` with pauses on (no `--no-pauses`).

- **The stop.** `play --until-text 'could soon declare war on you'`, then `act "return { speed: await page.getByTestId('time-controls-speed').textContent(), paused: await page.getByTestId('alert-paused').count(), wars: await page.getByTestId('wars-button').getAttribute('aria-label') }"`. Day 8, `Paused`, one marked line, and `Wars 0, 1 threat`.
- **The repeat plays on.** `play --until-text 'The game ran on'`. The new line names the stop on day 7 at 90%, and no stop is listed after day 8.
- **Turn the stop off.** `act "await page.getByRole('button', { name: 'Game', exact: true }).click(); await page.getByTestId('pause-warThreat').uncheck(); await page.keyboard.press('Escape'); return await page.evaluate(() => localStorage.getItem('pauses'))"`. The setting is stored under `pauses`.
- **Proof.** `shot warning-stops-game`. The corner's top line is marked `PAUSED` and the top bar reads `Paused`.

## Gotchas

- `play` lists a stop already standing when it starts, so the stop of day 8 also shows in the next `play`.
- `--no-pauses` removes every stop. Use it only for a recipe that is not about stops.
- Moments: `carthageNearsWar`, `carthageWarnsAgain`, `twoNearWarAtWar`, `e2e/climb-game.ts:carthageClimbs`, `e2e/held-war-game.ts:carthageHeldByLepcis`, and `e2e/warnings-game.ts` for food and own-city stops. Capture scenarios: `war-threat`, `war-warning-pause`, `war-warning-spared`, `warning-climb`, `held-war`, `threat-remedy`.
