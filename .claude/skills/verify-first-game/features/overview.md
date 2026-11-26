# Overview

The Overview panel lists the realm's cities, armies, columns on the march and wars. A city or army row selects it, whatever the map shows; a column row selects its destination, and a war row opens the Wars panel.

## Sub-features

- `overview-cities` a row per city with its people and calm or unrest.
- `overview-armies` a row per army; `overview-columns` refugee columns.
- `overview-wars` the wars, with `Wars and peace` (`open-wars`).
- `overview-fallen` replaces every list once the realm has fallen: `Your realm has fallen. Rome lost its last city on <date>, and nothing is left to command.`

## How to get to it (user POV)

- The top bar's `Overview` button.

## Driving it with drive.ts

Preconditions:

- `open --moment carthageNearsWar`.

- **Open it.** `act "await page.getByRole('button', { name: 'Overview', exact: true }).click(); await page.getByTestId('overview').waitFor(); return await page.getByTestId('overview').ariaSnapshot()"`. The line `overview-bonus` (`Armies re-form in 2 days after a change of stance, not 3.`), then rows `Roma 40,000 people Calm`, `Ariminum`, `Arretium`, `Capua`, `First Legion 4,300 men Idle at Roma`, `At peace with everyone` and `Wars and peace`.
- **Select from a row.** `act "await page.getByTestId('overview-cities').getByRole('button', { name: /^Roma/ }).first().click(); await expect(page.getByTestId('city-name')).toHaveText('Roma')"`.
- **Fallen.** After the defeat from `romaFallsTomorrow` (see [Ending](./ending.md)), `Watch on`, then `Overview`: only `overview-fallen` shows.
- **Proof.** `shot overview` with the panel open, then `shot overview-roma`.

## Gotchas

- This is the way to open your own city once the camera has moved, and on a phone.
- `e2e/playtest-panels.spec.ts` covers it.
