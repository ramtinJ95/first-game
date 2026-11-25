# first-game verification map

This folder is the maintained source for verifying what a player can do in the game. Read this index, then use the feature's file as the recipe.

## Baseline preconditions

- `node $D up` has printed a run, with `D=.claude/skills/verify-first-game/drive.ts`, from the root of this checkout.
- `node $D doctor` ends `OK` and names the commit under test.
- The run's browser is the one `up` started. Never drive the pylon's `web` service or a tester's browser.
- A recipe starts from its own `open`, which replaces whatever the page showed. The browser's `localStorage` (saves, autosave, pause settings) outlasts `open`; only `down` and `up` clear it.

## Driving conventions

- Load a moment with `open --moment <builder>`. The builders live in `e2e/support.ts` and the `e2e/*-game.ts` files and are named in each recipe.
- Moments load paused. Resume with the `Resume` button or `play`, and pause again before reading a value that the clock changes.
- Prefer roles and accessible names, then `data-testid`. Click the map only through `support.camera(page)` at the widest zoom.
- Open your own city through the Overview's rows once the camera has moved: `Overview`, then the row named for the city in `overview-cities`.
- Each recipe's `act` lines are the literal argument of `node $D act "..."`.

## Proof and skip reporting

- Shoot the state before and after the action with `node $D shot`, and return what you read from `act`.
- A purchase proves itself in the store it cost, read before and after one played day.
- A stop proves itself in `play`'s list of stops, a `Paused` speed, and the line marked `Paused` in the corner.
- Name the feature, the moment and the viewport with every artifact.
- Report a recipe that cannot reach its state with the command and the unmet precondition. Do not report it verified through another path.

## Feature entry contract

Each file starts with an H1 and one paragraph on what the player sees, then four H2s in this order: `Sub-features`, `How to get to it (user POV)`, `Driving it with drive.ts` (starting with `Preconditions:`), and `Gotchas`. Keep implementation detail out: name player paths, handles, moments, commands and what proves the result.

## Features

Files marked _from tests_ hold recipes taken from the browser tests and capture scenarios that this skill has not yet driven. Drive one, fix what is wrong, and remove its mark.

- [Start screen and guide](./start-and-guide.md) covers choosing a power, Continue, and the guide.
- [Time and stores](./time-and-stores.md) covers pause, speed, Space, the date, and the gold, food and manpower readings with their short and full states.
- [Map and fog](./map-and-fog.md) covers zoom, pan, map clicks and fog of war.
- [Armies and orders](./armies-and-orders.md) covers selecting armies, marching, sailing, joining, halting, stances, battles, sieges and storms; all but selecting and marching are _from tests_.
- [City panel](./city-panel.md) covers a city's facts, evacuation, declaring war, and the fate of a taken city; all but the facts are _from tests_.
- [Recruit cards](./recruit.md) covers the Raise cards, their forecast, and the threat each card reckons.
- [City projects](./city-projects.md) covers buildings, second levels, great works and cancelling.
- [Guards](./guards.md) covers hiring guards, their term, and the day great powers stop counting them.
- [Trade](./trade.md) covers invitations, routes, partners and their risks; invitations, closing and raids are _from tests_.
- [Advances](./advances.md) covers studying one advance at a time for gold.
- [Warnings and stops](./warnings-and-stops.md) covers war-threat warnings, the stops they cause, the pause settings, and the line ten days before guards stop counting.
- [Wars and peace](./wars-and-peace.md) covers the Wars panel, its At peace rows, offers, terms and truces.
- [Chronicle and news corner](./chronicle-and-news.md) covers the corner's lines, the Chronicle, and the notice toast.
- [Overview](./overview.md) covers the realm's cities, armies and wars in one panel.
- [Saves](./saves.md) covers the Game menu's save, load, export and import, the autosave, Continue, dropped files, and leaving for the start screen.
- [Ending](./ending.md) covers defeat and victory; victory is _from tests_.
- [Phone layout](./phone-layout.md) covers the page at 390 × 844.
