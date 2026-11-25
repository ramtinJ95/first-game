# Chronicle and news corner

The corner at the bottom left shows the latest five lines of news, newest first, each dated. A line that stopped the game is marked `Paused`, and a click on a line moves the map to what it names. The `Chronicle` button above it opens the whole history. A toast (`notice`) tells of a refused order or save, an accepted march, or a fate chosen while paused, for four seconds.

## Sub-features

- `news-corner` the list `Alerts`, five lines, each a button with its date and text; `alert-count` shows `×<n>` for repeats.
- `news-paused` a line that stopped the game carries `alert-paused`.
- `news-focus` a click on a line centres and zooms the map on its place.
- `news-chronicle` `Chronicle` toggles the region `Chronicle` with every line of the game; `aria-expanded` follows it.
- `news-toast` `notice` with `role="status"` and `data-tone` `bad` or `info`.

## How to get to it (user POV)

- Look at the bottom left. Click a line. Click `Chronicle`.

## Driving it with drive.ts

Preconditions:

- `open --moment carthageNearsWar`, then `play --until-day 30`, so the corner holds several lines.

- **Open the Chronicle.** `act "const corner = await page.getByTestId('alerts').getByRole('listitem').count(); await page.getByRole('button', { name: 'Chronicle' }).click(); const c = page.getByTestId('chronicle'); await c.waitFor(); return { corner, chronicle: await c.getByRole('listitem').count(), expanded: await page.getByRole('button', { name: 'Chronicle' }).getAttribute('aria-expanded') }"`. `corner` is at most 5, `chronicle` is at least as many, and `expanded` is `true`.
- **Close it and click a line.** `act "await page.getByRole('button', { name: 'Chronicle' }).click(); await page.getByTestId('alerts').getByRole('button').filter({ hasText: 'could soon declare war' }).first().click(); await support.untilDrawn(page)"`. The map zooms onto the front the line names, here Roma, and `canvas[data-renderer]`'s `data-latest-view` goes up by one.
- **Toast.** `open --moment armyAtRest`, then `act "const v = support.camera(page); const b = v.banner(support.cityPoint('roma')); await page.mouse.click(b.x, b.y); const s = v.screen({ x: 5457, y: 1694 }); await page.mouse.click(s.x, s.y, { button: 'right' }); const n = page.getByTestId('notice'); await n.waitFor(); const r = { text: await n.textContent(), tone: await n.getAttribute('data-tone') }; await expect(n).toHaveCount(0, { timeout: 8000 }); return r"`. It returns `Order refused. The destination is in the sea.` with tone `bad`, gone within about 4 s. A right-click on Capua then shows `March to Capua: 7 days.` with tone `info`. Shoot from inside the same `act`, with `page.screenshot`, since the toast is gone before a second command.
- **Proof.** `shot chronicle-open` and `shot corner-line-clicked`.

## Gotchas

- On a phone the corner hides its lines while a side panel, a middle panel or the Chronicle is open.
- A stopped warning must fit 13 corner lines; the capture scenario `paused-news-fits` checks the longest.
- After a line has moved the camera, `support.camera(page)` no longer matches the screen. Open cities from the Overview.
- Moments with news: `sixSpearmenMusterTomorrow`, `fiveFleetsOnRoma`, `worldNewsTomorrow`, `sackedMediolanum`, `weakSiegeOfMediolanum`, `romaMustersUnderSiege`. Capture scenarios: `news`, `world-news`, `leader-news`, `panels`, `paused-news-fits`.
