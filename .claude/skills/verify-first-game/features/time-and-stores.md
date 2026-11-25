# Time and stores

The top bar shows the realm, its gold, food and manpower with their change a day, the date, and the time controls. The player pauses and resumes with a button or Space and picks speed 1, 2 or 3. A store notes when it nears its limit or its end, and reads `0` and `Short <n>` below nothing.

## Sub-features

- `time-pause` `Pause` and `Resume`; Space toggles them except while typing.
- `time-speed` `Speed 1`, `Speed 2`, `Speed 3`, the pressed one `aria-pressed=true`; `time-controls-speed` reads `Speed <n>` or `Paused`.
- `time-date` `time-controls-day` reads `Year <y>, day <d>` with `data-day`.
- `stores` `store-gold`, `store-food`, `store-manpower`, each with `-amount`, `-change` (`+20.7/day`), `-note` (`1,171 days left`, `At the call-up limit`, `Short 118`) and a `title` with the reason.
- `stores-desert` a line under the bar (`desertion-standing`) when men desert for want of food or gold.
- `orders-waiting` while paused with orders given, `Orders for …`.

## How to get to it (user POV)

- The top bar, always visible.

## Driving it with drive.ts

Preconditions:

- `open`, a new game as Rome, running at speed 1.

- **Pause with Space.** `act "await page.locator('body').press('Space'); await expect(page.getByTestId('time-controls-speed')).toHaveText('Paused'); return await page.getByTestId('time-controls-day').getAttribute('data-day')"`. The day stops.
- **Speed 3.** `act "await page.getByRole('button', { name: 'Speed 3' }).click(); const from = Number(await page.getByTestId('time-controls-day').getAttribute('data-day')); await page.waitForTimeout(3000); return { from, to: Number(await page.getByTestId('time-controls-day').getAttribute('data-day')), pressed: await page.getByRole('button', { name: 'Speed 3' }).getAttribute('aria-pressed') }"`. The game resumes at speed 3 and `to` is well past `from`.
- **Stores.** `act "return Object.fromEntries(await Promise.all(['gold','food','manpower'].map(async k => [k, { amount: await page.getByTestId('store-' + k + '-amount').textContent(), change: await page.getByTestId('store-' + k + '-change').textContent(), why: await page.getByTestId('store-' + k).getAttribute('title') }])))"`.
- **Short.** `open --moment carthageNearsWar`, then `play --until-day 88`. Food reads `0`, its note `Short <n>`, and the desertion line appears.
- **Proof.** `shot` paused and at speed 3, with the date in view.

## Gotchas

- Picking a speed while paused also resumes.
- Pausing on a stop and pausing by hand look the same in the top bar; the corner's `Paused` mark tells them apart.
- Capture scenarios: `time-controls`, `speed`, `threat-top-bar`, `news`.
