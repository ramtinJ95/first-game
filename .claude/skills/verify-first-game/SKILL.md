---
name: verify-first-game
description: Launch the first-game browser strategy game (Vite build, Svelte panels, PixiJS map) from this checkout, play it as a player does through a persistent Playwright page, and keep screenshots, ARIA snapshots and saves as evidence. Use to prove a change works in the real game, to reproduce a reported bug, or to play a game on step by step; the features/ map lists every player-facing feature with a recipe.
---

# Verify first-game

The game is one page. A PixiJS canvas draws the map; Svelte draws the top bar, the side panels, the news corner and the dialogs. A player clicks the map, the panels and the top bar, and plays in pausable real time.

`drive.ts` in this folder is the harness. It serves this checkout's production build, keeps one Chromium page open in a small driver process, and takes one command per call, so you can look, decide and act across tool calls. Run every command from the root of the checkout the skill lives in. It refuses a shell in another checkout.

```sh
D=.claude/skills/verify-first-game/drive.ts
```

## Launch

```sh
node $D up
```

`up` runs `npm run build`, serves `dist/` with `vite preview` on a free port of 127.0.0.1, starts the driver with Chromium on another free port, and prints `run`, `url` and `evidence`. It returns once the page answers and the driver answers, and stops both again if either never does. `--no-build` reuses `dist/`; use it only right after `npm run build` of the same tree, since `doctor` cannot tell which tree an old `dist/` came from. The driver takes commands only with the run's token from `session.json`. A first run in a fresh checkout needs `npm ci` and `npx playwright install chromium` first, which `.nexus/setup` does on a pylon.

The game keeps no data on disk. Saves live in the page's `localStorage`, which lasts as long as the run's browser. Every `up` starts with an empty browser, so no save, no autosave and no settings carry over.

Ready means a game is open:

```sh
node $D open                      # a new game as Rome, running at speed 1
node $D open --moment carthageNearsWar   # a set-up moment, loaded paused
```

`open` waits for the top bar (or the start screen with `--power start`) and prints the day and speed. `--moment <builder>` builds a save from a function in `e2e/support.ts` (or `<path>:<name>`, such as `e2e/trade-game.ts:tradingRome`; `--args '<json array>'` passes its arguments), pauses, drops the file on the map as a player drops one, and waits until the page holds the save's day and the map has drawn it. A builder may return a game state, a save string, or an object with a `save` string. `moments.ts` in this folder exports the states only a spec builds inline, such as a battle already joined; name it as `.claude/skills/verify-first-game/moments.ts:<name>`. A refused save fails `open` with the page's own refusal. News stops the game as the Game menu says, as for a player. `--no-pauses` adds `pauses=off`, as the browser tests do. `--viewport 390x844` opens at phone size.

## Doctor

Run it first, and whenever anything looks wrong:

```sh
node $D doctor
```

It is read-only. It checks that the preview and the driver this run started are alive, by pid and command line, that `HEAD` and the contents of `src`, `data`, `index.html` and `package-lock.json` are what was built, that the URL serves this checkout's `dist/index.html`, and that the driver answers with its Chromium version, page URL and size. It ends `OK`, or `NOT OK` after `PROBLEM` lines. After you edit the game, `down` and `up` again. After you edit `drive.ts`, do the same, because the driver keeps running the code it started with.

## Drive

```sh
node $D act "<async JS>"          # page, expect, support and evidence are in scope; prints the return value
node $D act --file steps.js
node $D play --until-text 'could soon declare war' [--until-day 120] [--speed 3]
node $D look                      # the page's ARIA snapshot
node $D viewport 390x844
node $D errors                    # console errors and uncaught exceptions of the page
```

- `page` is the Playwright page. `expect` is Playwright's. `support` is `e2e/support.ts`, so `support.untilDrawn(page)`, `support.cityPoint('roma')` and `support.camera(page)` work as they do in the browser tests. `evidence` is the run's folder.
- `play` sets the speed, resumes after every stop, and pauses at the day or once a line in the corner matches, or when an ending shows. It plays the last five days before `--until-day` at speed 1, so it stops on that day. It prints the day and each stop with the line that caused it, the stop it ends on included. A stop already standing when it starts is listed too.
- A dialog that asks the player to decide, such as a taken city's fate, holds the clock. `play` returns at once with `decision` (the dialog's test id and heading). Choose with `act`, then `play` again. If the time given runs out, `play` returns what it saw with `stalled` and exits 1.
- Prefer roles and names, then `data-testid`. The map is a canvas: click a place with `support.camera(page).screen(support.cityPoint(id))`, which is right only at the widest zoom that `open` leaves. Once a click on news or a row has moved the camera, reach your own city through the Overview's rows instead. The recipes in `features/` say which.
- `Pause`, `Resume` and `Game` need `exact: true`, because news lines contain those words. The Game menu's entries are `menuitem`s.
- An order given while paused, such as a march, a halt, a join or a stance, waits for the next day. The top bar's `orders-waiting` counts it.
- A command that waits on the page fails after Playwright's 30 s, or 5 s for `expect`. Pass `{ timeout }` for a long wait, or use `play`.

## Evidence

```sh
node $D shot <name>               # NN-<name>.png and NN-<name>.aria.yml in the run's folder
```

The run's folder is `.cache/verify/<run>/` in the checkout. It is ignored by git, and no capture or test command deletes it. It also holds `session.json`, the logs of the preview and the driver, every `--moment` save, and any file you save from the page with `evidence`. Declare what a reviewer needs with `nexus output add file <path> --title "<what it shows>"`.

- Drive the player's path: the top bar, the panels, the map, the menus, a dropped save. Build a moment with `--moment`; never change the state through the page's internals.
- Capture the action and the state after it, not only the final screen: `shot` before and after, and return the values you read from `act`.
- Check side effects next to what is visible: the gold after a purchase, the day after `play`, `localStorage` keys after a save, the file a download wrote.
- Read every screenshot you cite. A screenshot taken while the game runs shows a later day than the value read a moment before; pause first.
- Name the commit. `doctor` prints the commit the build came from.

## Cleanup

```sh
node $D down
```

`down` stops the driver and its Chromium, then the preview, by the process groups this run started, and waits for them to exit. It signals a pid only while its command line still names this run's port, so a reused pid is left alone. It keeps the run's folder. Never stop processes by name: the pylon's `web` service is a Vite dev server on another port, and a browser test may be running. Two checkouts can each run their own `up` side by side, since every port is free when chosen. One checkout holds one run at a time, and `up` refuses while any process of the last run is live.

## Shared machine

A capture or a browser test pauses itself while a Vitest run goes on the same machine, but this driver does not. Keep `npm test` and a drive apart, or expect slow days. A pylon that sleeps stops every process: after a wake, `doctor` reports the pids gone, so run `down` and `up`.

## Feature map

`features/README.md` indexes one file per feature a player can touch, each with its handles, its moment, a recipe and its gotchas. Read the file for the feature you prove. A proof that drives one entry point is incomplete while the file lists others. Keep the map true as the game changes, with `/pstack:maintain-verification-skill`.
