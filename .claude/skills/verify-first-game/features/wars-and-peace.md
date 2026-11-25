# Wars and peace

The Wars and peace panel shows every great power's standing toward the player. While at peace, `At peace` rows say how near each power stands to declaring war and what lowers it. In a war, tabs show each war, the enemy's offers, the player's terms and the truces that follow.

## Sub-features

- `wars-at-peace` the `At peace` heading lists each power at 80% or more (`threat-row`) with its share and the day it may declare, then notes (`threat-note`) on the armies that count near the city and what the treasury does; `Also at peace` lists the rest.
- `wars-none` the block `wars-at-peace` reads `You are at war with no one.` with how a war starts and how peace works.
- `wars-declare` a foreign city's panel offers `Declare war on <owner>`, then `Confirm war` or `Cancel`.
- `wars-tab` each war has a `war-tab` with `war-summary`, `peace-forecast-warning`.
- `wars-their-offer` an enemy offer opens the panel by itself and pauses the game (`peace-paused`): `their-offer` with `accept-peace` and `refuse-peace`, and, when the enemy would take other terms, `peace-counter` with `send-counter`. An answer reads in `peace-answered`; a counter in `our-offer`.
- `wars-our-offer` `Offer peace` with `Your terms` (`peace-gold`, `peace-city`), a verdict, and `Send these terms`.
- `wars-truce` a peace starts a truce, listed under `Truces` (`truce-row`).

## How to get to it (user POV)

- The top bar's `Wars <n>` button, whose name adds the threats and offers waiting.
- The Overview's `Wars and peace` button.
- A war row in the Overview opens the panel. A warning's `See At peace in Wars` is text that points to it, not a control.

## Driving it with drive.ts

Preconditions:

- `open --moment carthageNearsWar`, then `play --until-text 'could soon declare war on you'`.

- **Open the panel.** `act "await page.getByTestId('wars-button').click(); const panel = page.getByTestId('wars-panel'); await panel.waitFor(); return await panel.ariaSnapshot()"`. The region `Wars and peace` has `At peace` with `Carthage has 90% of the strength it needs to declare war on you, against your forces near Roma. It may declare from Year 1, day 31 if it holds it.`, the armies counted near Roma, the treasury line, `You are at war with no one.`, and `Also at peace` with Egypt, Macedon and Persia.
- **Close it.** `act "await page.getByTestId('wars-panel').getByRole('button', { name: 'Close' }).click()"`.
- **Proof.** `shot wars-at-peace` with the panel open.
- **An offer.** `open --moment carthageOffersPeace` (day 301). `play` resumes past the offer's stop, so use `act "await page.getByRole('button', { name: 'Resume', exact: true }).click(); const o = page.getByTestId('their-offer'); await o.waitFor({ timeout: 20000 }); return o.innerText()"`. It reads `Carthage offers peace: Carthage gives you 1,000 gold.`, `peace-paused` reads `The game is paused for your answer. …`, and the Wars button `Wars 1, 1 offer waiting`.
- **Refuse.** `refuse-peace` makes `peace-answered` read `You refuse. Carthage hears it with the next day.`
- **Accept and truce.** `accept-peace` makes it read `You accept. Peace comes with the next day.` Resume; a day later `truce-row` reads `Truce with Carthage: 664 days left. Neither side may declare war before Year 3, day 237.` and the button `Wars 0`.
- **Counter.** `open --moment carthageDemandsPeace` and resume as above. `peace-counter` reads `Carthage asks more than it would take. …`; `send-counter` makes `our-offer` read `You offer Carthage peace: you give 1,000 gold. Carthage hears it with the next day.`
- **Terms.** `open --moment siegeToEndInPeace`, open the panel, check `Carthage pays you` and fill `peace-gold` with `3000`. `war-summary` reads `The war goes your way (+35)`, `peace-verdict` `Carthage would refuse. It would give terms worth 2 points less, such as 200 gold less.`, and `peace-draft-truce` a truce of 1,095 days. At `1000` the verdict reads `Carthage would accept.`; `Send these terms` (`offer-peace`) and two days bring a truce.

## Gotchas

- The panel's close button is named `Close` and shows `×`. `wars-button` toggles the panel, so a click on it while an offer has opened the panel closes it.
- `twoNearWarAtWar` puts Egypt and Macedon at 100% near Ariminum while Rome is at war with Persia. A power held back by its own war is `e2e/held-war-game.ts:carthageHeldByLepcis` (see [Warnings and stops](./warnings-and-stops.md)).
- Moments: `carthageNearsWar`, `twoNearWarAtWar`, `carthageOffersPeace`, `carthageDemandsPeace`, `siegeToEndInPeace`, `romeOnTwoFronts`, and `e2e/peace-support.ts` (`peaceStanding` with `--args '["macedon",2]'`, `risingPeacePrice`, `stalePeaceForecast`, `winningSecondFront`). The offer moments start late in the game (`carthageOffersPeace` on day 301, `siegeToEndInPeace` near day 123), so give `play --until-day` a later day. Capture scenarios: `peace`, `peace-clock`, `truce-bought`, `war-answered`, `round-six-panels`.
