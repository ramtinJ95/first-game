# Armies and orders

The player selects an army on the map and right-clicks a place to march there, or picks a route by sea from a menu. The army panel shows its men, general, activity and formations, joins armies, halts, besieges, and sets a battle stance. Battles and sieges have their own panels.

## Sub-features

- `army-select` a click on a figure or banner opens the panel `Army` (`army-name`, `army-men`, `army-activity`, `army-general`, `formations`).
- `army-march` a right-click on land or a city marches there; a port-to-port right-click opens `command-menu` with `March to <city>` or `Sail from <a> to <b>` items.
- `army-join` `Join` lists armies to merge with (`army-joins`).
- `army-halt` `Halt`.
- `army-stance` the group `Stance`: `stance-holdTheLine`, `stance-allOutAssault`, `stance-skirmishAndWithdraw`, and `Retreat, losing <n>% of the men`.
- `battle` the panel `Battle` with its day and sides.
- `siege` an army at an enemy city in a war besieges it; the city shows `storm-odds`, `Storm the walls`, then `Confirm storm`.

## How to get to it (user POV)

- Click your army's figure on the map, or its row in the Overview. Right-click a destination.

## Driving it with drive.ts

Preconditions:

- `open --moment armyAtRest`: First Legion, 3,100 men, idle at Roma, paused at the widest zoom.

- **Select and march.** `act "const view = support.camera(page); const flag = view.banner(support.cityPoint('roma')); await page.mouse.click(flag.x, flag.y); await expect(page.getByTestId('army-activity')).toHaveText('Idle at Roma'); const p = view.city('capua'); await page.mouse.click(p.x, p.y, { button: 'right' }); await expect(page.getByTestId('orders-waiting')).toHaveAttribute('title', '1 army has orders for the next day'); await page.getByRole('button', { name: 'Resume', exact: true }).click(); await expect(page.getByTestId('army-activity')).toHaveText(/^Marching to Capua · \\d+ days? left$/); await page.getByRole('button', { name: 'Pause', exact: true }).click(); return await page.getByTestId('army-activity').textContent()"`. It returns `Marching to Capua · 6 days left`.
- **Select from the Overview.** `Overview`, then the row `First Legion 3,100 men Idle at Roma` in `overview-armies`, opens the region `Army` with its formations.
- **Battle and siege** _from tests_. `open --moment fieldBattle` or `siegeOfCarthago`, and follow `e2e/panels.spec.ts` and `e2e/stances.spec.ts`.
- **Proof.** `shot` the order and the panel a day later.

## Gotchas

- The army often stands on its city's symbol, and a click there may pick the city. Click the banner (`support.camera(page).banner(point)`) or use the Overview.
- An order given while paused waits for the next day: `army-activity` keeps `Idle at Roma` and the top bar's `orders-waiting` counts it until you resume.
- Moments: `armyAtRest`, `marchToCamp`, `fieldBattle`, `siegeOfCarthago`, `stormedCarthago`, `crossingToCaralis`, `beatenOverseas`, `beatenNearHadrumetum`, `idleBesideEnemyCity`, `greatBattle`, `winnerMarchesOn`. Specs: `orders`, `order-paths`, `stances`, `armies`, `flag-click`, `war-loop`. Capture scenarios: `march`, `crossing`, `sea-orders`, `siege`, `battle`, `stances`.
