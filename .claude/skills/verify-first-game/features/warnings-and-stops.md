# Warnings and stops

When a great power at peace nears the strength to declare war on the player, the corner warns, names what brings it near and what would lower it, and stops the game. The Game menu's settings choose which news stops the game. Lines that repeat a standing warning, and lines that tell of a coming change, play on.

## Sub-features

- `warn-line` is the warning: `<Power> could soon declare war on you: it has <n>% of the strength it needs near <city>, and may declare from <date> if it holds it.`, then the treasury's part, a building, guards, food, and `See At peace in Wars.`
- `warn-stop` pauses the game and marks the line `Paused` (`alert-paused`); the speed reads `Paused`.
- `warn-climb` a power that climbs 6 points or more above the share of its last stop warns again and stops the game: `<Power> has climbed to <n>% near <city>, from <n>% at its last stop on <date>, and may declare <when>.` A smaller rise tells nothing new.
- `warn-reminder` 60 days after a warning, a power still near war is told again and stops the game: `<Power> still stands near war, as warned on <date>: …`.
- `warn-spared` a later warning at no higher share ends `The game ran on: its stop on <date> was at <n>%, and it stands no higher.` (or `only <k> points higher`) `See At peace in Wars.` and does not stop.
- `warn-top-bar` the Wars button shows `Wars 0 · 1 threat`; its accessible name is `Wars 0, 1 threat`.
- `warn-guards-ahead` the line ten days before guards stop counting, which stops the game when the power would then stand at 80% or more and be free to declare (see [Guards](./guards.md)).
- `warn-held-end` a climb that the end of a war brings, within 30 days of a stop that named that war and no higher than the share it named, runs the game on; the corner tells only the war's end: `<Power>'s war with <enemy> has ended, and no longer holds back its strength: it stands at <n>% …`. Without that stop the climb stops the game as `<Power>'s war with <enemy> has ended. <Power> has climbed to …`.
- `warn-held` a power held back by another war says `Once its war with … ends, it would stand at <n>%`, and the corner tells when that war ends.
- `warn-settings` the Game menu's `Pause the game when` checkboxes, which keep the menu open: `pause-battle`, `pause-weakSiege`, `pause-sighted`, `pause-ownCity`, `pause-warThreat`, `pause-advance` (`An advance is finished and nothing else is being studied`), each kept in `localStorage` `pauses`, and `pause-fate`, kept as `pauseOnFate` `off`. A line says a peace offer always pauses.

## How to get to it (user POV)

- Play on; the line appears in the corner and the game stops.
- `Game` → `Pause the game when` → `A great power at peace with you could soon declare war on you`.

## Driving it with drive.ts

Preconditions:

- `open --moment carthageNearsWar` with pauses on (no `--no-pauses`).

- **The stop.** `play --until-text 'could soon declare war on you'`, then `act "return { speed: await page.getByTestId('time-controls-speed').textContent(), paused: await page.getByTestId('alert-paused').count(), wars: await page.getByTestId('wars-button').getAttribute('aria-label') }"`. Day 8, `Paused`, one marked line, and `Wars 0, 1 threat`.
- **The climb stops again.** `play --until-text 'at its last stop on'`. It stops on day 83 with `Carthage has climbed to 96% near Roma, from 90% at its last stop on Year 1, day 7, and may declare any day now.`, and `play` lists that stop.
- **The spared line plays on.** Hire guards at Roma right after the first stop, as in [Guards](./guards.md), then `play --until-text 'The game ran on'`. On day 82 the line reads `Carthage could soon declare war on you: 83% of the strength it needs near Roma, from Year 1, day 106. The game ran on: its stop on Year 1, day 7 was at 90%, and it stands no higher.`, and `play` lists no new stop.
- **A climb from a set-up moment.** `open --moment e2e/climb-game.ts:carthageClimbs --args '[8,0]'`, then `play --until-day 103`. It stops on day 101 with `Carthage has climbed to 95% near Roma, from 87% at its last stop on Year 1, day 70, …`. With `--args '[2,0]'` no line comes and nothing stops.
- **A war's end.** `open --moment e2e/held-war-game.ts:carthageHeldByLepcis --args '["climbs"]'`, then `play --until-day 103`: it stops on day 101 with `Carthage's war with Lepcis Magna has ended. Carthage has climbed to 100% near Roma, from 92% …`. `open --moment .claude/skills/verify-first-game/moments.ts:carthageHeldCovered` is the same moment whose last stop named that war: the same `play` lists no stop, and the corner says only `Carthage's war with Lepcis Magna has ended, and no longer holds back its strength: it stands at 100% of the strength it needs, and may declare from Year 1, day 110.` `--args '["ends"]'` runs on too, at no higher share.
- **Turn the stop off, then on again.** `act "await page.getByRole('button', { name: 'Game', exact: true }).click(); await page.getByTestId('pause-warThreat').uncheck(); const off = await page.evaluate(() => localStorage.getItem('pauses')); await page.getByTestId('pause-warThreat').check(); await page.keyboard.press('Escape'); return { off, on: await page.evaluate(() => localStorage.getItem('pauses')) }"`. `off` lists `warThreat` as false; `on` has it true again. Each other switch writes its own key the same way, and `pause-fate` writes `pauseOnFate`.
- **Proof.** `shot warning-stops-game`. The corner's top line is marked `PAUSED` and the top bar reads `Paused`.

## Gotchas

- The pause settings live in the run's `localStorage` and outlast `open`. A setting left off changes every later recipe: a warning that does not stop is then told in full, not as `The game ran on`. Put it back, or `down` and `up`.
- `play` lists a stop already standing when it starts, so the stop of day 8 also shows in the next `play`.
- Left alone, this moment goes to war: Carthage sails on Roma near day 114 and takes Rome's last city near day 288, so a long `play` ends on the defeat dialog.
- `--no-pauses` removes every stop. Use it only for a recipe that is not about stops.
- Moments: `carthageNearsWar`, `carthageWarnsAgain`, `twoNearWarAtWar`, `e2e/climb-game.ts:carthageClimbs` (`--args '[<points below the last stop>, <bands>, [], <lapse day>]'`), `e2e/held-war-game.ts:carthageHeldByLepcis` (`warning`, `ends`, `climbs`), `moments.ts:carthageHeldCovered`, and `e2e/warnings-game.ts` for food and own-city stops. The last two of `e2e` return a save, which `--moment` loads as it is. Capture scenarios: `war-threat`, `war-warning-pause`, `war-warning-spared`, `warning-climb`, `held-war`, `threat-remedy`, and `paused-news-fits`, which checks that the longest stopped warning fits 13 corner lines.
