# Chronicle and news corner

The corner at the bottom left shows the latest five lines of news, newest first, each dated. A line that stopped the game is marked `Paused`, and a click on a line moves the map to what it names. The `Chronicle` button above it opens the whole history. A toast (`notice`) tells of a refused order or a refused save for four seconds.

## Sub-features

- `news-corner` the list `Alerts`, five lines, each a button with its date and text; `alert-count` shows `×<n>` for repeats.
- `news-paused` a line that stopped the game carries `alert-paused`.
- `news-focus` a click on a line centres and zooms the map on its place.
- `news-chronicle` `Chronicle` toggles the region `Chronicle` with every line of the game; `aria-expanded` follows it.
- `news-toast` `notice` with `role="status"` for refusals.

## How to get to it (user POV)

- Look at the bottom left. Click a line. Click `Chronicle`.

## Driving it with drive.ts

Preconditions:

- `open --moment carthageNearsWar`, then `play --until-day 30`, so the corner holds several lines.

- **Open the Chronicle.** `act "const corner = await page.getByTestId('alerts').getByRole('listitem').count(); await page.getByRole('button', { name: 'Chronicle' }).click(); const c = page.getByTestId('chronicle'); await c.waitFor(); return { corner, chronicle: await c.getByRole('listitem').count(), expanded: await page.getByRole('button', { name: 'Chronicle' }).getAttribute('aria-expanded') }"`. `corner` is at most 5, `chronicle` is at least as many, and `expanded` is `true`.
- **Close it and click a line.** `act "await page.getByRole('button', { name: 'Chronicle' }).click(); await page.getByTestId('alerts').getByRole('button').filter({ hasText: 'could soon declare war' }).first().click(); await support.untilDrawn(page)"`. The map zooms onto Roma.
- **Proof.** `shot chronicle-open` and `shot corner-line-clicked`.

## Gotchas

- On a phone the corner hides its lines while a side panel or the Chronicle is open.
- After a line has moved the camera, `support.camera(page)` no longer matches the screen. Open cities from the Overview.
- Moments with news: `sixSpearmenMusterTomorrow`, `fiveFleetsOnRoma`, `worldNewsTomorrow`, `sackedMediolanum`, `weakSiegeOfMediolanum`, `romaMustersUnderSiege`. Capture scenarios: `news`, `world-news`, `leader-news`, `panels`.
