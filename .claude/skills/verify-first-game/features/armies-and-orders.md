# Armies and orders

The player selects an army on the map and right-clicks a place to march there, or picks a route by sea from a menu. The army panel shows its men, general, activity and formations, joins armies, halts, besieges, and sets a battle stance. Battles and sieges have their own panels.

## Sub-features

- `army-select` a click on a figure or banner opens the panel `Army` (`army-name`, `army-men`, `army-activity`, `army-general`, `formations`).
- `army-march` a right-click on land or a city marches there. A right-click on a city a sea way reaches opens the menu `Orders for <city>` (`command-menu`), with the groups `By sea` (`Sail from <a> to <b> <n> days by sea`) and `By land` (`March to <city> <n> days`), and `Cancel`.
- `army-join` an idle army beside another of yours lists `Join <army>` buttons (`army-joins`); the join is an order for the next day.
- `army-halt` `Halt`.
- `army-stance` the group `Stance`: `stance-holdTheLine`, `stance-allOutAssault`, `stance-skirmishAndWithdraw`. While paused the button is pressed at once and `army-general` changes the next day.
- `battle` the panel `Battle` (`battle-panel`): `battle-day`, both sides with their armies and formations, `stance-standing`, the Stance group with `stance-reforming` after a change, and `Retreat, losing 15% of the men`, which then reads `Retreats with the next day` (`retreat-ordered`).
- `siege` an army at an enemy city in a war besieges it; the city shows `city-siege` (`Besieged by <power> · day <n>`) and `Storm the walls`, which asks `Storm the walls today?` with `storm-odds`, `Confirm storm` and `Cancel`.

## How to get to it (user POV)

- Click your army's figure on the map, or its row in the Overview. Right-click a destination.

## Driving it with drive.ts

Preconditions:

- `open --moment armyAtRest`: First Legion, 3,100 men, idle at Roma, paused at the widest zoom.

- **Select and march.** `act "const view = support.camera(page); const flag = view.banner(support.cityPoint('roma')); await page.mouse.click(flag.x, flag.y); await expect(page.getByTestId('army-activity')).toHaveText('Idle at Roma'); const p = view.city('capua'); await page.mouse.click(p.x, p.y, { button: 'right' }); await expect(page.getByTestId('orders-waiting')).toHaveAttribute('title', '1 army has orders for the next day'); await page.getByRole('button', { name: 'Resume', exact: true }).click(); await expect(page.getByTestId('army-activity')).toHaveText(/^Marching to Capua · \\d+ days? left$/); await page.getByRole('button', { name: 'Pause', exact: true }).click(); return await page.getByTestId('army-activity').textContent()"`. It returns `Marching to Capua · 6 days left`.
- **Select from the Overview.** `Overview`, then the row `First Legion 3,100 men Idle at Roma` in `overview-armies`, opens the region `Army` with its formations.
- **Halt.** After the march, `act "await page.getByRole('button', { name: 'Halt' }).click(); await page.getByRole('button', { name: 'Resume', exact: true }).click(); await expect(page.getByTestId('army-activity')).toHaveText(/^Idle /); await page.getByRole('button', { name: 'Pause', exact: true }).click(); return [await page.getByTestId('army-activity').textContent(), await page.getByRole('button', { name: 'Halt' }).count()]"` returns `Idle near Roma` and `0`.
- **Sail.** On `armyAtRest`, click the Roma banner and right-click `support.camera(page).city('massalia')`. The menu `Orders for Massalia` offers `Sail from Roma to Massalia 31 days by sea` and `March to Massalia 29 days`. Choose the sail item and play a day: `army-activity` reads `At sea to Massalia · 30 days left`.
- **Join.** `open --moment .claude/skills/verify-first-game/moments.ts:twoLegionsAtRoma`. In `Overview`, `overview-armies` lists `First Legion 1,500 men` and `Second Legion 300 men`. Select the Second Legion's row and click `Join First Legion`; `orders-waiting` counts it. After a day the panel shows `First Legion`, `1,800 men`, and one row is left.
- **Battle, stance and retreat.** `open --moment .claude/skills/verify-first-game/moments.ts:fieldBattleJoined`. The panel `Battle near Roma` shows on day 2: attackers (you) 2,870, defenders 3,066. Click `stance-skirmishAndWithdraw` in `battle-panel` and play a day: `stance-reforming` reads `Re-forming, 2 days left`. Click `Retreat, losing 15% of the men`: `retreat-ordered` reads `Retreats with the next day`, and a day later the First Legion reads `Retreating to Capua · 6 days left` with 2,273 men.
- **Siege and storm.** `open --moment siegeOfCarthago`, click `support.camera(page).city('carthago')`. `city-siege` reads `Besieged by Rome · day 4`. `Storm the walls` shows `storm-odds` (`A storm takes Carthago for certain. It is expected to cost 1,072 of your 6,900 men, …`); `Confirm storm`, then `play --until-day 5`, returns `decision` `{ testid: 'fate-prompt', name: 'Carthago has fallen to you' }`.
- **Proof.** `shot` the order and the panel a day later.

## Gotchas

- The army often stands on its city's symbol, and a click there may pick the city. Click the banner (`support.camera(page).banner(point)`) or use the Overview.
- An order given while paused waits for the next day: `army-activity` keeps `Idle at Roma` and the top bar's `orders-waiting` counts it until you resume. The same holds for Halt, Join and a stance.
- `fieldBattle` loaded as it is holds no battle: the Punic army marches on Capua instead, as the capture scenario `battle` notes. Use `fieldBattleJoined`, which plays it one day first, or `battleUnderWay` (Rome against Mediolanum's defenders) from the skill's `moments.ts`.
- `storm-odds` shows only after `Storm the walls` is clicked, while the storm is being confirmed.
- Moments: `armyAtRest`, `marchToCamp`, `fieldBattle` (see above), `siegeOfCarthago`, `stormedCarthago`, `crossingToCaralis`, `beatenOverseas` (`--args '["<power>","<enemy>","<city>"]'`), `beatenNearHadrumetum`, `idleBesideEnemyCity` (`--args '["<city>"]'`), `greatBattle`, `winnerMarchesOn`. Specs: `orders`, `order-paths`, `stances`, `armies`, `flag-click`, `war-loop`. Capture scenarios: `march`, `crossing`, `sea-orders`, `siege`, `battle`, `stances`.
