# Phone layout

Below 720 px wide the page is one column: the top bar wraps into rows, a side panel becomes a sheet at the bottom of up to 42% of the height, and the news corner shrinks and gives way to any open panel or the Chronicle. Below 1024 px the top bar's buttons wrap whole and the Game menu opens under the whole bar. The game is checked at 390 × 844.

## Sub-features

- `phone-top-bar` the realm and stores, then the date with the time controls, then `Wars`, `Advances` (days only, `study-days`, or `None`), `Overview`, and on the last row `Guide` and `Game`, which wrap together. Each button wraps whole, and the bar never grows wider than the screen.
- `phone-sheet` a city, army or battle panel opens as a bottom sheet.
- `phone-corner` the corner holds fewer lines and hides them while a sheet, the Chronicle, or a middle panel (Wars, Overview, Advances) is open.
- `phone-menus` the Game menu opens just below the bar, across its width, with every entry and pause switch whole; the Wars, Overview and Advances panels open over the map below the bar.
- `phone-no-scroll` the page never scrolls sideways.

## How to get to it (user POV)

- Open the game on a phone, or turn a window narrower than 720 px.

## Driving it with drive.ts

Preconditions:

- `open --moment e2e/crowded-bar.ts:crowdedBar --viewport 390x844` for the longest top bar (a war, a threat, Marching rations studied, food short), or `open --moment carthageNearsWar --viewport 390x844`, then `play --until-text 'could soon declare war on you'`, for corner lines.

- **Top bar and corner.** `act "const bar = page.getByTestId('top-bar'); const game = page.getByRole('button', { name: 'Game', exact: true }); return { studyDays: await page.getByTestId('study-days').isVisible(), studyLine: await page.getByTestId('study-line').isVisible(), bar: await bar.evaluate(e => [e.clientWidth, e.scrollWidth]), game: await game.boundingBox(), pageScrolls: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth) }"`. `studyDays` is `true` and `studyLine` `false`. The bar's two widths match (372 and 372), `Game` ends at x 369, and `pageScrolls` is `false`. On `crowdedBar` the buttons sit on three rows and `study-days` reads `240 days`.
- **A city as a sheet.** `act "await page.getByRole('button', { name: 'Overview' }).click(); await page.getByTestId('overview-cities').getByRole('button', { name: /^Roma/ }).first().click(); await expect(page.getByTestId('city-name')).toHaveText('Roma'); return { sheet: await page.getByTestId('city-panel').boundingBox(), cornerLines: await page.getByTestId('alerts').getByRole('listitem').count() }"`. The sheet spans x 8 to 382 below the Overview, which stays open, and `alerts` is hidden.
- **Panels and the corner.** With corner lines showing, open `Advances`: `alerts` is hidden. Close it: the lines return. The same holds for `Overview`.
- **The Game menu.** `act "await page.keyboard.press('Escape'); await page.getByRole('button', { name: 'Game', exact: true }).click(); const m = page.getByTestId('save-menu'); return { box: await m.boundingBox(), clipped: await m.locator('[role=menuitem],label').evaluateAll(es => es.filter(e => { const b = e.getBoundingClientRect(); return b.x < 0 || b.right > 390 || e.scrollWidth > e.clientWidth; }).length) }"`. The menu spans x 9 to 381, its top meets the bar's bottom, `clipped` is `0`, and all seven pause switches show.
- **Proof.** `shot phone-map`, `shot phone-city-sheet`, `shot phone-game-menu`, `shot phone-advances`.

## Gotchas

- Before #138 the Game menu opened 593 px wide, partly off screen, and with a threat standing `Game` ran past the screen's edge. `e2e/layout.spec.ts` now checks both at 390 × 844, with `crowdedBar` as the longest bar.
- `support.camera(page)` models the camera at the viewport it is made for. Make it after `viewport`, and only at the widest zoom.
- `viewport` resizes the live page; `open --viewport` starts fresh at that size. The capture scenarios `phone-corner`, `phone-top-bar`, `layout` and `resize` and `e2e/layout.spec.ts` cover the page at 390 × 844.
