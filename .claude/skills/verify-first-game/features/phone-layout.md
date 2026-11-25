# Phone layout

Below 720 px wide the page is one column: the top bar wraps into rows, a side panel becomes a sheet at the bottom of up to 42% of the height, and the news corner shrinks and gives way to an open panel or the Chronicle. The game is checked at 390 × 844.

## Sub-features

- `phone-top-bar` the realm, stores and date on one row, then the time controls, then `Wars`, `Advances` (days only, `study-days`), `Overview`, `Guide` and `Game`.
- `phone-sheet` a city, army or battle panel opens as a bottom sheet.
- `phone-corner` the corner holds fewer lines and hides them while a sheet or the Chronicle is open.
- `phone-menus` the Game menu and the Wars panel open over the map.
- `phone-no-scroll` the page never scrolls sideways.

## How to get to it (user POV)

- Open the game on a phone, or turn a window narrower than 720 px.

## Driving it with drive.ts

Preconditions:

- `open --moment carthageNearsWar --viewport 390x844`, then `play --until-text 'could soon declare war on you'`.

- **Top bar and corner.** `act "const bar = page.getByTestId('top-bar'); const game = page.getByRole('button', { name: 'Game', exact: true }); return { studyDays: await page.getByTestId('study-days').isVisible(), studyLine: await page.getByTestId('study-line').isVisible(), bar: await bar.evaluate(e => [e.clientWidth, e.scrollWidth]), game: await game.boundingBox(), pageScrolls: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth) }"`. `studyDays` is `true` and `studyLine` `false`. The bar's two widths match, `Game` ends inside 390 px, and `pageScrolls` is `false`.
- **A city as a sheet.** `act "await page.getByRole('button', { name: 'Overview' }).click(); await page.getByTestId('overview-cities').getByRole('button', { name: /^Roma/ }).first().click(); await expect(page.getByTestId('city-name')).toHaveText('Roma'); return { sheet: await page.getByTestId('city-panel').boundingBox(), cornerLines: await page.getByTestId('alerts').getByRole('listitem').count() }"`. The sheet spans the width at the bottom.
- **The Game menu.** `act "await page.keyboard.press('Escape'); await page.getByRole('button', { name: 'Game', exact: true }).click(); return await page.getByTestId('save-menu').boundingBox()"`. The menu should lie within 0 to 390 px.
- **Proof.** `shot phone-map`, `shot phone-city-sheet`, `shot phone-game-menu`.

## Gotchas

- On `main` at 1f8e559 the Game menu opens 593 px wide, starting at about x −224, so the start of each entry is off screen. It did so before #135 too.
- On `main` at 1f8e559, with a threat standing (`Wars 0 · 1 threat`), the top bar is 411 px wide in 372 and `Game` runs past the screen's edge. At d234a38, before the Advances button, the same moment fits.
- `support.camera(page)` models the camera at the viewport it is made for. Make it after `viewport`, and only at the widest zoom.
- `viewport` resizes the live page; `open --viewport` starts fresh at that size. The capture scenarios `phone-corner`, `layout` and `resize` and `e2e/layout.spec.ts` cover the corner at 390 × 844.
