# Trade

A city trades its good along routes by land or sea. Another power invites one of your cities to trade, and the player accepts or refuses in that city's panel. A city with a free slot offers routes to partners, each with its forecast, payback, risk and consent. Routes can be improved or closed, and war or raids cut them.

## Sub-features

- `trade-invite` the corner's `<city> invites <yours> to trade …`; the panel's `trade-invitation` with `Accept trade` and `Refuse trade`.
- `trade-routes` `trade-routes` and `trade-deliveries`, `Improve route`, `Close route` then `Confirm close` or `Keep route`.
- `trade-partners` `Trade partners` lists a button `<City> by <mode> …` per partner and `Would not agree now`; the partner picked gets `trade-forecast`, `trade-payback`, `trade-risk`, `trade-consent` and one `Open trade route to <city> by <land|sea>` button.
- `trade-raid` a raided route reads `Interrupted by raid`, and the map's canvas counts it in `data-raids`.

## How to get to it (user POV)

- Your city's panel, section `Trade · <good>`. A trade line in the corner names the city.

## Driving it with drive.ts

Preconditions:

- `open --moment e2e/trade-game.ts:tradingRome`, at the widest zoom.

- **Read.** Open Roma as in [City projects](./city-projects.md), then return `await page.getByTestId('trade-routes').ariaSnapshot()` and `await page.getByTestId('trade-partners').getByRole('button').allTextContents()`. Routes to Capua and Carthago stand, and Arretium by land is the partner picked, with `Open trade route to Arretium by land`.
- **Open a route.** Click `Open trade route to Arretium by land`, then play a day with the Advances recipe's play-a-day line. `trade-routes` lists Capua, Carthago and Arretium, and the gold fell by about 2,000.
- **Invitation.** `open`, then `play --until-text 'invites Arretium'`. On day 8 the corner reads `Lutetia invites Arretium to trade by land, 59 days a crossing, until Year 1, day 98. Select Arretium to accept or refuse.` `act "await page.getByTestId('alerts').getByRole('button').filter({ hasText: 'invites Arretium' }).click(); return await page.getByTestId('trade-invitation').innerText()"` opens Arretium and returns the offer, which ends `Lutetia pays the 1,653 gold to open it. It expires on Year 1, day 98, in 89 days.` `Accept trade`, then a day, gives the corner line `Trade opened: Lutetia to Arretium.` and the route `Lutetia · caravan · 57 days to arrival · 0 deliveries`.
- **Close a route.** In that route's row, `Close route` opens `trade-close-confirm` (`Close Lutetia to Arretium by land? It cost you nothing, as Lutetia paid, …`). `Confirm close`, then a day, gives `Trade closed: Lutetia to Arretium, closed by Rome.` On `tradingRome`, scope `Close route` to the row, since two routes stand.
- **Raid.** `open --moment e2e/trade-game.ts:raidedRome` and open Roma. `trade-routes` reads `Capua · caravan · Interrupted by raid · 0 deliveries`, and `canvas[data-renderer]` has `data-raids` `1`.
- **Proof.** `shot` before and after.

## Gotchas

- `tradingRome` already trades Roma with Capua by land, so Capua is not offered.
- A new game sends invitations in the first days: Lutetia invites Arretium on day 8, Mogontiacum invites Roma on day 13.
- `raidedRome` opens with an empty corner, so `getByTestId('alerts')` is not on the page until a line comes.
- Moments: `e2e/trade-game.ts` (`tradingRome`, `romaTradesThreeWays`, `coastalRome`, `straitRome`, `raidedRome`, `tradeRoute`). Capture scenarios: `trade-look`, `merchants`, `trade-rules`, `trade-told`.
