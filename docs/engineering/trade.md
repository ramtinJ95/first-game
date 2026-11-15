# Trade: first playable slice

## Rules

`src/sim/trade/routes.ts` owns forecasts and refusals. An end earns
`1.15 × (unlike goods ? 1.8 : 1) × (1 + min(distance, 1000) / 1000)` gold a day,
times its owner's administrative share. An arrival pays that rate times the crossing's
days to **both** ends. The economy displays the mean but never pays it again.

Opening costs `ceil(1.15 × (1 + min(distance, 1000) / 1000) × 740)`, doubled for a
domestic route because both receipts go to one realm. Unlike goods repay in about 1.13
years and identical goods in about 2.03 years before the large-realm penalty.

`improveTrade` (`src/sim/trade/improve.ts`) lets either end of a running route pay half its
opening price to add `IMPROVE_STEP`, a quarter of the opening rate, at both ends, at most
`MAX_IMPROVEMENTS` (2) times. `routeRate` gives a route's rate with its improvements; the
economy, arrivals, raids, war pricing and city balances read it. A step repays in about
twice the route's own payback, so it pays only when no new route does: after the slots are
full. The AI does not improve routes.

`changeCityOwner` calls `handRoutesOver`: each running route at the city passes to the new
owner, and the trade system closes it the same day as a war between the partners if the new
owners of its two ends are at war. A peace that cedes a city ends its war first, so its routes
survive the cession. An invitation at the city closes, since its inviter or its invitee
changed. `openedBy` keeps the faction that paid to open a route and `improvedBy` the payer of
each improvement, so the ledger charges each end only what it paid. The risk reading says a
fall closes a route only when the taker is at war with the other end, and that a fall to a
power at peace with it hands the route over.

Land routes reach 1,000 km at 16 km/day; sea routes require two actual ports and reach
1,800 km at 28 km/day. Navigation uses the existing constrained mesh, and paths are
found once and cached outside the state, keyed by world, endpoints and mode. The save
holds the path and the caravan's crossing progress and direction.
The AI screens its military-reserve budget before finding paths. Once the best quote
reaches a candidate's maximum rounded return and capped income, that candidate cannot
improve it and is not searched. Land searches also reject regions disconnected inside
the route's radius before pricing an already-too-long walk round a sea. These bounds
change neither quoted costs nor the choice or its original tie-breaking order.

Province goods use a hash of the seed and position within a starting homeland's pool
of three goods, or all five for independent cities. This never advances the world's
random stream and therefore does not redraw a seed's minor-city kinds or armies.

Size, Forum and port slots make routes compete with each other. Capacity reductions
grandfather existing investments; no new route can exceed the current capacity.
The player may close or refuse a route without refund; Close route asks first. Incoming invitations reserve
neither slots nor gold. Acceptance rechecks peace, ownership, unrest, sieges, slots,
duplicates, path and the inviter's gold before changing anything.
It also rechecks the inviter's military reserve and next recruit, after projecting
the day's queued spending. If that budget no longer holds, the invitation lapses
without payment and the trade-closed news explains why. Valid queued declarations
withdraw invitations before any acceptance, whichever order they have in the queue.
The inviter's actual war policy (great power or minor league) must still favour peace.
The next-day check includes a known truce expiry and recruits already due to muster
today, using the ordinary muster rule on a private snapshot. It never predicts battle
rolls or captures.

AI factions and minors consider trade monthly, staggered by faction id. They choose
the highest return per gold, then the greater income, then city id and land before
sea. They retain at least 600 gold or their army reserve, plus the next recruit's price, and project their
earlier orders before spending. They make no investment on a declaration-of-war day.
Incoming invitations are accepted or refused by explicit orders whenever that faction
is under AI control, including the player faction in an all-AI simulation. A human
player skipped by `decideAll` is never consented automatically.

An enemy anywhere within 20 km of a land route can raid it. A raid pays one shipment
to the raider and resets the caravan; replacement takes a crossing's days. The road
must be cleared for it to travel again. An endpoint siege suspends any route. These
are public interruptions for the player's own trade, not a way to reveal hidden enemy
armies. At sea only endpoint sieges stand in for blockade; no offshore interception.

The immutable `trade-goods-and-routes` save change requires goods and trade records. Loading validates ids, endpoints,
owners, distinct ends, running-pair uniqueness, positive rates, progress, and path
length. It does not migrate older change sets. Orders and alert kinds use their own
registration files, after rebasing onto tooling main `a3ac1ba`.

## What the player is told

Every trade act says what it costs and risks before it is done. The rules stay as above;
the reading of them is in `src/ui`, so the rules PR that changes survival changes one place.

- `tradeRisk(state, sight, ends, road)` in `src/ui/trade-risk.ts` lists what could stop or
  close a route under today's rules, gravest first: a siege of either end (deliveries stop,
  and a fall closes the route if the besieger is at war with the other end, or hands it over
  if not), a leagued minor that will join a war that would close the route, the partner
  owner's wars with powers also at war with the other end (a fall to one of them closes the
  route), and the enemies of either end who could raid a land road.
  It names a besieger only while one of its armies is in sight and counts only enemy armies
  in sight within `RAID_KM` of the road, so it reveals nothing the fog hides. `riskText`,
  `riskMark` and `paybackText` turn it into the quote's line ("pays back in 1.1 years;
  Syracusae is at war with Carthage, at war with you too: if Syracusae falls to them, the
  route closes."), a
  list row's mark, and the lines of an invitation and of a running route.
- `tradeChoices` in `src/ui/trade-choices.ts` is the partner list: the cities that would agree
  now, each with every open way (land, sea, or both, each a `TradeWay` with its own risks and
  the gold it still needs, so a threatened road shows beside a safe sea lane), ordered by
  payback to a tenth of a
  year, then by whether the player can afford it, fewer risks, and the shorter crossing,
  since unlike goods all repay in about 1.13 years; then the cities that would not, each with
  the rules' reason. A city out of reach both ways says so for both, naming a missing port.
  A row the player cannot afford keeps its place with the gold it still needs. The first
  computation finds the paths of a city once (about 0.3–0.5 s on the full map); later ones
  read the cache (about 20–30 ms).
- `routeLedger` in `src/ui/trade-ledger.ts` gives what a route cost the player (nothing for an
  accepted invitation), an estimate of what its arrivals were worth, and the price less that
  estimate as still unpaid. The route keeps no tally of past pay, so the estimate values every
  arrival at today's administrative share and cannot see receipts a full treasury refused;
  every ledger says that receipts which came while the treasury was full were not kept, so the
  player may have received less. Close route confirms with it, no refund, and today's price to reopen. The
  war confirmation lists, under `declarationFacts`, each route the war closes with its ledger,
  including routes with a minor's league partner that joins at once (`warJoiners`), the
  invitations that lapse, and the player's other land roads the enemy could then raid.
- An invitation gives both goods, its way and crossing, what each arrival and each day pays
  the player, its risk, and its last day (`openedOn + TRADE_INVITATION_DAYS`). Accept is
  disabled with `tradeProblem`'s reason for the inviter's order, such as no free slot, or
  with `invitationProblem`'s, which would end the invitation on accepting (about 1–10 ms on
  the full map, once a day while the invitation shows). Refuse
  says what it forgoes. `tradeCaution` says whose treasury is full: a partner's full treasury
  loses the partner's receipts, not the player's.

`tradeNews` in `src/app/trade-news.ts` tells all of the player's trade news; `alertsOfDay`
tells none of it. Routes closed for one cause on one day are one line. A refusal and an
expiry are each an "Invitation to trade ended" line; closing and refusing now emit
`tradeClosed` with `invitation` set and the actor in the cause. A siege of a partner's city
is one line naming the routes it stops, once until the city has been free for
`TRADE_QUIET_DAYS` (60); a siege of the player's own city is left to its `siegeBegan` alert.
Raids carry `raider` and `looted`. A raider beside a siege still takes the cargo, so that
day has a raid event beside the siege event, and the news tells the theft even when the
siege is of the player's own city. One enemy's raids on the player's roads are one episode:
the first raid is told with what it took; while the episode stays open, a line at most
`TRADE_TALLY_DAYS` (30) after the last tells the cargoes and gold taken since it; and when
the roads have been quiet for 60 days, or their routes close, a `tradeRaidsEnded` line
tallies the whole episode if it took more than the lines told. The page keeps the open
episodes in the saved `tradeTroubles`. The 60 days come from the gaps between one enemy's
raids on one route in two ten-year AI games: 15 of 25 repeats came within 43 days, the rest
68 days or more, six of them a year or more apart.

`npm run sim -- trade-news [--seeds 5 --years 10 --print]` counts the trade lines Rome gets,
idle and under the AI, beside the raw raid and siege interruptions. Five seeds, ten years:

| Rome, mean of 5 games | trade lines before | after | raid and siege lines before | after |
| --------------------- | ------------------ | ----- | --------------------------- | ----- |
| idle                  | 28.0               | 28.0  | 0                           | 0     |
| under the AI          | 57.6               | 44.6  | 25.8                        | 15.4  |

An idle Rome hears only invitations and their expiry, which stay one line each. Under the
AI the raid and siege lines per game went from 49, 27, 17, 8 and 28 to 27, 12, 13, 8 and 17;
routes closed went from 63 lines to 50 in all. The monthly tally of an open episode's new
losses, and the theft told beside a siege, added 0.8 lines a game over one line per episode
(43.8 lines, 14.6 of them raids and sieges); the raw interruptions in seed 1 rose from 49 to
51 with the two raid events beside a siege. Before is `main` at `c40d8c7`, where each
raid and each route stopped by a siege was a line.

## Verification and decisions

Run `npm run sim -- trade` for seeds 1–20, five peaceful years. Like `sim:buildings`, the
control gives other factions no orders, so the policy measures investment rather
than an uncontrolled invasion. Rome opens its best affordable route, otherwise its
cheapest available building. The decision metric counts actual opening/build orders,
not caravan deliveries or repeated displays of unaffordable choices.

The trade share is gross expected receipts divided by taxes plus receipts on day
1,095. The war experiment declares on the most valuable trading partner and measures
the loss of net income. It does not claim every possible partner costs a tenth.

The measured median decision interval is 88 days, not the original 60-day target.
**The owner accepted 88 for this PR**: the next slice makes goods requirements for
troops and buildings, adding decisions. The tested affordable policy makes 23 investments
in five years. Building prices, route slots and trade's 40% share ceiling are unchanged.

Trade counts toward treasury capacity because a realm must be able to retain an
ordinary shipment instead of losing it to a tax-only ceiling. It shares the large-
realm administrative penalty so it cannot bypass the world's anti-snowball rule.
Peace wishes are deliberately unchanged: closed-route history would require changing
the war record and the peace lane's valuation. War declarations do price current trade.

The reproducible before/after world tables and timing results are in
`../trade-validation.md`. `node scripts/bench-trade.ts` measures rules plus all AI for
5,475 days after warm-up; copy it unchanged to another checkout's `scripts/` directory
to compare that source. The existing `sim:movement` benchmark fails on unmodified
main with `not every army set out`, so it cannot provide a successful baseline.

The browser tests in `e2e/trade.spec.ts` open a route through the partner list, observe
its delivery counter and rising gold, load a saved caravan in transit, read the war
confirmation's route line and close a saved sea route by war, confirm Close route, read
an invitation whose Accept is disabled for want of a slot and refuse it into the news,
and check that the partner list leads with agreeing cities and is reachable at 390 px.
The `trade-told` capture shows the quote with its risk, the list, the war lines, Close
route, an invitation, the news, and the list on a phone. The first look is intentionally
a plain moving marker; drawn trade figures, selected routes, map goods and the guide are
later work.
