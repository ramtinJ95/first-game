# Overview

The Overview panel lists the realm's cities, armies, columns on the march and wars, and the cities it has lost. Each row selects its city or army, whatever the map shows.

## Sub-features

- `overview-cities` a row per city with its people and calm or unrest.
- `overview-armies` a row per army; `overview-columns` refugee columns.
- `overview-wars` the wars, with `Wars and peace` (`open-wars`).
- `overview-fallen` the cities lost.

## How to get to it (user POV)

- The top bar's `Overview` button.

## Driving it with drive.ts

Preconditions:

- `open --moment carthageNearsWar`.

- **Open it.** `act "await page.getByRole('button', { name: 'Overview' }).click(); await page.getByTestId('overview').waitFor(); return await page.getByTestId('overview').ariaSnapshot()"`. Rows `Roma 40,000 people Calm`, `Ariminum`, `Arretium`, `Capua`, and the armies.
- **Select from a row.** `act "await page.getByTestId('overview-cities').getByRole('button', { name: /^Roma/ }).first().click(); await expect(page.getByTestId('city-name')).toHaveText('Roma')"`.
- **Proof.** `shot overview` with the panel open, then `shot overview-roma`.

## Gotchas

- This is the way to open your own city once the camera has moved, and on a phone.
- `e2e/playtest-panels.spec.ts` covers it.
