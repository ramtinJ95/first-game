# Warnings and stops

When a great power at peace nears the strength to declare war on the player, the corner warns, names what brings it near and what would lower it, and stops the game. The Game menu's settings choose which news stops the game. Lines that repeat a standing warning, and lines that tell of a coming change, play on.

## Sub-features

- `warn-line` is the warning: `<Power> could soon declare war on you: it has <n>% of the strength it needs against your forces near <city>, and may declare from <date> if it holds it.`, then the treasury's part, a building, guards, food, and `See At peace in Wars.`
- `warn-stop` pauses the game and marks the line `Paused` (`alert-paused`); the speed reads `Paused`.
- `warn-climb` a power that climbs past the share of its last stop warns again and stops the game: `<Power> has climbed to <n>% near <city>, from <n>% at its last stop on <date>`.
- `warn-spared` a later line at no higher share says `The game ran on: its stop on <date> was at <n>%` and does not stop.
- `warn-top-bar` the Wars button reads `Wars 0 · 1 threat`.
- `warn-guards-ahead` the line ten days before guards stop counting (see [Guards](./guards.md)).
- `warn-held` a power held back by another war says `Once its war with … ends, it would stand at <n>%`, and the corner tells when that war ends.
- `warn-settings` the Game menu's `Pause the game when` checkboxes: battles, weak sieges, enemies sighted, own cities, war threats, fates.

## How to get to it (user POV)

- Play on; the line appears in the corner and the game stops.
- `Game` → `Pause the game when` → `A great power at peace with you could soon declare war on you`.

## Driving it with drive.ts

Preconditions:

- `open --moment carthageNearsWar` with pauses on (no `--no-pauses`).

- **The stop.** `play --until-text 'could soon declare war on you'`, then `act "return { speed: await page.getByTestId('time-controls-speed').textContent(), paused: await page.getByTestId('alert-paused').count(), wars: await page.getByTestId('wars-button').getAttribute('aria-label') }"`. Day 8, `Paused`, one marked line, and `Wars 0, 1 threat`.
- **The climb stops again.** `play --until-text 'at its last stop on'`. It stops on day 83, at 96%, and `play` lists that stop.
- **The spared line plays on.** Hire guards at Roma right after the first stop, as in [Guards](./guards.md), then `play --until-text 'The game ran on'`. The line names the stop of day 7 at 90%, and `play` lists no new stop.
- **Turn the stop off, then on again.** `act "await page.getByRole('button', { name: 'Game', exact: true }).click(); await page.getByTestId('pause-warThreat').uncheck(); const off = await page.evaluate(() => localStorage.getItem('pauses')); await page.getByTestId('pause-warThreat').check(); await page.keyboard.press('Escape'); return { off, on: await page.evaluate(() => localStorage.getItem('pauses')) }"`. `off` lists `warThreat` as false; `on` does not.
- **Proof.** `shot warning-stops-game`. The corner's top line is marked `PAUSED` and the top bar reads `Paused`.

## Gotchas

- The pause settings live in the run's `localStorage` and outlast `open`. A setting left off changes every later recipe: a warning that does not stop is then told in full, not as `The game ran on`. Put it back, or `down` and `up`.
- `play` lists a stop already standing when it starts, so the stop of day 8 also shows in the next `play`.
- Left alone, this moment goes to war: Carthage sails on Roma near day 114 and takes Rome's last city near day 288, so a long `play` ends on the defeat dialog.
- `--no-pauses` removes every stop. Use it only for a recipe that is not about stops.
- Moments: `carthageNearsWar`, `carthageWarnsAgain`, `twoNearWarAtWar`, `e2e/climb-game.ts:carthageClimbs`, `e2e/held-war-game.ts:carthageHeldByLepcis`, and `e2e/warnings-game.ts` for food and own-city stops. Capture scenarios: `war-threat`, `war-warning-pause`, `war-warning-spared`, `warning-climb`, `held-war`, `threat-remedy`.
