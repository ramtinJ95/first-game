# Saves

The Game menu saves the game in the browser, loads that save or the autosave, exports a file and imports one. The game autosaves on the first day of each month. The start screen's `Continue` loads the newest save, and a save file dropped anywhere on the page loads it. `Start screen` asks before leaving.

## Sub-features

- `save-browser` `Save in this browser` writes `save:manual`; `Load your save <realm>, <date>` then names it.
- `save-auto` the autosave writes `save:auto` every 30 days after day 1; `Load the autosave <realm>, <date>`.
- `save-export` `Export to a file` downloads `<realm>-day-<day>.json`.
- `save-import` `Import from a file` opens a file picker (`import-file`); a refused file shows a sentence in `notice`.
- `save-drop` dropping a file on the page loads it, on the start screen too.
- `save-continue` the start screen's `Continue` with `continue-info` (`Rome, Year 1, day 88`).
- `save-leave` `Start screen` asks `Leave for the start screen?` with `Save and leave`, `Leave without saving` and `Stay`.

## How to get to it (user POV)

- The top bar's `Game` button.
- The start screen, at `/` with no `?play=`.
- Drag a `.json` save onto the page.

## Driving it with drive.ts

Preconditions:

- `open --moment carthageNearsWar`, then `play --until-day 88`, which also writes the autosave of day 61.

- **Save and export.** `act "const game = page.getByRole('button', { name: 'Game', exact: true }); const menu = page.getByTestId('save-menu'); if (!(await menu.isVisible())) await game.click(); await menu.getByRole('menuitem', { name: 'Save in this browser' }).click(); if (!(await menu.isVisible())) await game.click(); const named = await menu.getByRole('menuitem', { name: /Load your save/ }).textContent(); const [download] = await Promise.all([page.waitForEvent('download'), menu.getByRole('menuitem', { name: 'Export to a file' }).click()]); await download.saveAs(evidence + '/' + download.suggestedFilename()); return { named, file: download.suggestedFilename(), keys: await page.evaluate(() => Object.keys(localStorage)) }"`. `named` is `Load your save Rome, Year 1, day 88`, `file` is `rome-day-88.json` in the run's folder, and `keys` holds `save:manual` and `save:auto`.
- **Continue.** `open --power start`, then `act "const info = await page.getByTestId('continue-info').textContent(); await page.getByRole('button', { name: /^Continue/ }).click(); await page.getByTestId('top-bar').waitFor(); return { info, day: await page.getByTestId('time-controls-day').getAttribute('data-day'), speed: await page.getByTestId('time-controls-speed').textContent() }"`. `info` is `Rome, Year 1, day 88`; the game opens paused on day 88.
- **Import the file.** `open`, then `act "await page.getByRole('button', { name: 'Pause', exact: true }).click(); await page.getByTestId('import-file').setInputFiles(evidence + '/rome-day-88.json'); await expect(page.getByTestId('time-controls-day')).toHaveAttribute('data-day', '88'); return 'loaded'"`.
- **Drop the file.** `open --save .cache/verify/<run>/rome-day-88.json` drops it on the map and waits for day 88.
- **Proof.** `shot saved` with the menu open, `shot continued-from-save` after Continue, and the exported file itself.

## Gotchas

- The menu's entries are `menuitem`s, and `Game` needs `exact: true`.
- The menu closes after each entry; open it again before the next.
- Every `up` starts an empty browser. Saves made in one run are gone in the next, except files you exported into the evidence folder.
- On a phone the open menu is wider than the screen; see [Phone layout](./phone-layout.md).
- Moments: any. `e2e/frame.spec.ts`, `e2e/page-truth.spec.ts` and the capture scenario `save-format` cover what a save keeps (the Chronicle, the camera, the selection, the open panel, the pause, a pending peace).
