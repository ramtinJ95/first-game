# Trade

A city trades its good along routes by land or sea. Another power invites one of your cities to trade, and the player accepts or refuses in that city's panel. A city with a free slot offers routes to partners, each with its forecast, payback, risk and consent. Routes can be improved or closed, and war or raids cut them.

## Sub-features

- `trade-invite` the corner's `<city> invites <yours> to trade …`; the panel's `trade-invitation` with `Accept trade` and `Refuse trade`.
- `trade-routes` `trade-routes` and `trade-deliveries`, `Improve route`, `Close route` then `Confirm close` or `Keep route`.
- `trade-partners` `Trade partners` with `Open trade route to <city> by <land|sea>`, `trade-forecast`, `trade-payback`, `trade-risk`, `trade-consent`.

## How to get to it (user POV)

- Your city's panel, section `Trade · <good>`. A trade line in the corner names the city.

## Driving it with drive.ts

Preconditions:

- `open --moment e2e/trade-game.ts:tradingRome`, at the widest zoom.

- **Read.** Open Roma as in [City projects](./city-projects.md), then return `await page.getByTestId('trade-routes').ariaSnapshot()` and `await page.getByRole('button', { name: /^Open trade route to / }).allTextContents()`. Routes to Capua and Carthago stand, and one offer is left: `Open trade route to Arretium by land`.
- **Open a route.** Click `Open trade route to Arretium by land`, then play a day with the Advances recipe's play-a-day line. `trade-routes` lists Capua, Carthago and Arretium, and the gold fell by about 2,000.
- **Invitations, closing and raids** _from tests_. `e2e/trade.spec.ts`.
- **Proof.** `shot` before and after.

## Gotchas

- `tradingRome` already trades Roma with Capua by land, so Capua is not offered.
- A new game sends invitations in the first days: the corner's `Lutetia invites Arretium to trade by land …` asks you to select Arretium.
- Moments: `e2e/trade-game.ts` (`tradingRome`, `romaTradesThreeWays`, `coastalRome`, `straitRome`, `raidedRome`, `tradeRoute`). Capture scenarios: `trade-look`, `merchants`, `trade-rules`, `trade-told`.
