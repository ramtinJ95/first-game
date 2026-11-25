# Ending

When the player's last city falls, a dialog says the realm has fallen and offers to watch on, load a save, load a file, or start again. When the player wins, a dialog says the realm is victorious and offers to play on or start again.

## Sub-features

- `ending-defeat` the dialog `defeat`, `<realm> has fallen`, with `Watch on`, `Load the save of <date>` (only when the browser holds a save), `Load a file` and `Start again`; the top bar then reads `Your realm has fallen`.
- `ending-victory` the dialog `victory`, `<realm> is victorious`, with `Play on` and `Start again`.

## How to get to it (user POV)

- Lose your last city, or win.

## Driving it with drive.ts

Preconditions:

- `open --moment romaFallsTomorrow` for defeat, `open --moment romeWinsTomorrow` for victory.

- **Defeat by playing on.** `open --moment carthageNearsWar`, then `play --until-day 400`. `play` returns on day 289, after 20 stops, the last `Ariminum fell to Carthage`. `act "return await page.getByTestId('defeat').ariaSnapshot()"` reads `Rome has fallen`, `Ariminum, your last city, fell to Carthage.` and four buttons, `Load the save of Year 1, day 271` (the autosave) among them, and `realm-fallen` reads `Your realm has fallen`.
- **Defeat from a moment.** `open --moment romaFallsTomorrow`, then `play --until-day 3`. It returns on day 2 with the stop `Roma fell to Carthage`. The dialog reads `Roma, your last city, fell to Carthage.` with `Watch on`, `Load a file` and `Start again`. `Watch on` closes it and the game runs on.
- **Victory.** `open --moment romeWinsTomorrow`, then `play --until-day 3`. It returns on day 2. `victory` reads `Rome is victorious` and `You hold 32 of the 80 provinces and the great capitals Alexandria, Carthago, Roma. You have won.` Click `Play on` in `victory`; the next `play` returns `decision` `{ testid: 'fate-prompt', name: 'Mediolanum has fallen to you' }`, since Mediolanum fell the same day. `fate-occupy` lets the game run on.
- **Proof.** `shot` the dialog.

## Gotchas

- `play` stops when either dialog is visible.
- The dialogs also carry `defeat-text`, `victory-text` and `defeat-import`.
- Specs: `frame`, `watch-on`, `warnings`. Capture scenarios: `frame`, `colours`.
