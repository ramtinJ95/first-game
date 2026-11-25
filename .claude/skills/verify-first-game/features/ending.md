# Ending

When the player's capital falls, a dialog says the realm has fallen and offers to watch on, load a save, load a file, or start again. When the player wins, a dialog says the realm is victorious and offers to play on or start again.

## Sub-features

- `ending-defeat` the dialog `defeat`, `<realm> has fallen`, with `Watch on`, `Load the save of <date>`, `Load a file` and `Start again`; the top bar then reads `Your realm has fallen`.
- `ending-victory` the dialog `victory`, `<realm> is victorious`, with `Play on` and `Start again`.

## How to get to it (user POV)

- Lose your capital, or win.

## Driving it with drive.ts

Preconditions:

- `open --moment romaFallsTomorrow` for defeat, `open --moment romeWinsTomorrow` for victory.

- **Defeat** _from tests_. `play --until-day <the moment's day + 1>`; `play` stops when an ending shows. `act "return await page.getByTestId('defeat').ariaSnapshot()"`.
- **Victory** _from tests_. The same with `romeWinsTomorrow` and `victory`; `Play on` closes it and the game runs.
- **Proof.** `shot` the dialog.

## Gotchas

- `play` stops when either dialog is visible.
- Specs: `frame`, `watch-on`, `warnings`. Capture scenarios: `frame`, `colours`.
