# Wars and peace

The Wars and peace panel shows every great power's standing toward the player. While at peace, `At peace` rows say how near each power stands to declaring war and what lowers it. In a war, tabs show each war, the enemy's offers, the player's terms and the truces that follow.

## Sub-features

- `wars-at-peace` the `At peace` heading lists each power on notice with its share and the day it may declare, then the armies that count near the city and what the treasury does; `Also at peace` lists the rest.
- `wars-none` reads `You are at war with no one.` with how a war starts and how peace works.
- `wars-declare` a foreign city's panel offers `Declare war on <owner>`, then `Confirm war` or `Cancel`.
- `wars-tab` each war has a `war-tab` with `war-summary`, `peace-forecast-warning`.
- `wars-their-offer` an enemy offer opens the panel by itself and pauses the game: `Accept peace`, `Refuse`, or a counter (`send-counter`).
- `wars-our-offer` `Offer peace` with `Your terms` (`peace-gold`, `peace-city`), a verdict, and `Send these terms`.
- `wars-truce` a peace starts a truce, listed under `Truces` (`truce-row`).

## How to get to it (user POV)

- The top bar's `Wars <n>` button, whose name adds the threats and offers waiting.
- The Overview's `Wars and peace` button.
- A warning's `See At peace in Wars`.

## Driving it with drive.ts

Preconditions:

- `open --moment carthageNearsWar`, then `play --until-text 'could soon declare war on you'`.

- **Open the panel.** `act "await page.getByTestId('wars-button').click(); const panel = page.getByTestId('wars-panel'); await panel.waitFor(); return await panel.ariaSnapshot()"`. The region `Wars and peace` has `At peace` with `Carthage has 90% of the strength it needs to declare war on you, against your forces near Roma. It may declare from Year 1, day 31 if it holds it.`, the armies counted near Roma, the treasury line, `You are at war with no one.`, and `Also at peace` with Egypt, Macedon and Persia.
- **Close it.** `act "await page.getByTestId('wars-panel').getByRole('button', { name: 'Close' }).click()"`.
- **Proof.** `shot wars-at-peace` with the panel open.
- **Offers and truces** _from tests_. `open --moment carthageOffersPeace`, play a day, and the panel opens with `their-offer`; `accept-peace` ends the war and `truce-row` appears. `e2e/peace.spec.ts` drives refusal, counters and terms.

## Gotchas

- The panel's close button is named `Close` and shows `×`.
- `twoNearWarAtWar` shows a power on notice while another war holds it back.
- Moments: `carthageNearsWar`, `twoNearWarAtWar`, `carthageOffersPeace`, `carthageDemandsPeace`, `siegeToEndInPeace`, `romeOnTwoFronts`, and `e2e/peace-support.ts` (`peaceStanding`, `risingPeacePrice`, `stalePeaceForecast`, `winningSecondFront`). Capture scenarios: `peace`, `peace-clock`, `truce-bought`, `war-answered`, `round-six-panels`.
