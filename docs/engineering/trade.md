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

`changeCityOwner` calls `handRoutesOver`: a running route whose other end is the player's
passes to the city's new owner, and the trade system closes it the same day as a war between
the partners if that owner is at war with the player. A peace moves the cities it cedes and
then ends its war, before the trade system runs, so a ceded city's route whose other end is
the player's survives the cession; one whose other end is the city's old owner closes. Every other route at the city closes, as before, and
so do invitations. Handing routes between two other realms to their conquerors was measured and
dropped: it broke the `sim:ai` target that a power at peace with every stronger power grows
(112 of 129 power-years, under 90 %). `openedBy` keeps the faction that paid to open a route and `improvedBy` the payer of
each improvement, so the ledger charges each end only what it paid. The risk reading says the
same: the player's own city falling closes its routes, and a partner's city falling closes a
route only to a taker at war with the player, and otherwise hands it over.

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
sea. They retain at least 600 gold or their army reserve, plus the next recruit's price (for a power held by food, the price of
the food it saves for: [Faction AI](faction-ai.md)), and project their
earlier orders before spending. They make no investment on a declaration-of-war day.
Incoming invitations are accepted or refused by explicit orders whenever that faction
is under AI control, including the player faction in an all-AI simulation. A human
player skipped by `decideAll` is never consented automatically.

An army at war with either end's owner, anywhere within 20 km of a land route, can raid it, even when it is at peace with the other end: the cargo is shared, so a war on one end's owner reaches the road. The player hears why: the raid news and the quote's risk line both say, for a raider at peace with the player, whom it is at war with (`whyRaid` in `src/ui/trade-risk.ts`). Changing the rule was weighed and not done: `npm run sim -- peace-raids` plays seeds 1–20 for ten years with every faction under the AI, Rome included, and 1,164 of 1,205 raids (97 %) were by a power at war with one end only, 279 of them on a road with a Roman end, so raiding a power's trade partners is how almost every raid happens, and a rule that spared the peaceful end would change the AI's wars and trade, not only the player's news. A raid pays one shipment
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
  close a route under today's rules, gravest first: a siege of either end (deliveries stop;
  a fall of the player's city closes the route, and a fall of the partner's closes it if the
  besieger is at war with the player, or hands it over if not), a leagued minor that will
  join a war that would close the route, the partner owner's wars with powers also at war
  with the player (a fall to one of them closes the route), the enemies of either end who
  could raid a land road (a raider at peace with the player is named with the end it is at war with), and the player's own wars (a fall of the player's city closes it).
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
- `routeLedger` in `src/ui/trade-ledger.ts` gives what the player paid to open and improve a
  route (`openedBy`, `improvedBy`), the gold the player kept from its arrivals (the route's
  `receipts`, which the trade system adds after the treasury's limit, so a full treasury adds
  nothing), and the price less those receipts as still unpaid. Close route confirms with it, no refund, and today's price to reopen. The
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
a plain moving marker. Drawing trade below covers the drawn figures, selected routes, map
goods, raids and the guide.

## Drawing trade

`src/render/trade.ts` interpolates a crossing through arrival before reversing it and
adds a province's stored good to its existing city label from 0.9 px/km. The existing
label collision rule decides where it fits. A longer name moves an army resting at the
city, which stands clear of the name: at Roma the First Legion stands on the seaward
side and is shifted onto land, a search the army scene remembers rather than repeats. Selecting a city draws its active routes
with the same dashed ink and halo as army paths.

`route-dashes.ts` makes seven-pixel dashes and five-pixel gaps. Moving army/planned
paths clip to the screen plus the stroke's cap margin before dashing, but skipped
length still advances the phase. Both ink and halo reuse those segments.

Selected trade paths reuse `cacheDrawing`, the coast ink's bounded view texture with
a 256 px margin at the renderer's resolution. Their source art uses world coordinates
and pixel-sized strokes, retaining complete paths so a later pan cannot uncover a
missing road. Zoom, selected running routes, blockage or path changes rebuild the
art; crossing progress does not change a road. Covered pans/resizes reuse the texture;
an uncovered view or WebGL restoration repaints it. One sprite replaces the static
route vertices, and is hidden when no routes are selected. The sprite shows only the
ink's conservative bounds (`routeInkBounds`, 4 px for the halo and antialiasing), a
view on the cache's texture, so the GPU does not blend the transparent rest of the
view. Merchant motion and moving
army/planned paths are not cached. Dash length, widths, halo and colours are unchanged;
covered pans use the same raster reuse as coast ink.

The trade panel explicitly says that paused orders wait: opening gold is paid on
the next running tick. The queued-order forecast reserves slots and costs, but the
actual treasury stays unchanged until then. The browser test checks both states.

A running route draws a merchant every `MERCHANT_SPACING_KM` (200 km) of its round trip,
half on the way out and half on the way back, the first at the route's crossing
(`merchantPoses` in `src/render/trade.ts`): Rome's road to Mogontiacum (971 km) shows 10,
the lanes to Carthago (580 km) and Massalia (602 km) 6 each. One merchant a route was seen
near Roma at the closest zoom a few days in a crossing. The rules still carry one cargo; the
string is how a route looks. A raided route waiting for its replacement shows its one
merchant at the start. Where figures are not drawn, a route stays one dot at its crossing.

The rules find a lane on their own coastline, and it runs along that coast. From 0.6 px/km
the atlas draws a finer coast up to 8 km away, so the rules' lanes cut drawn capes, Corsica's
among them on the way to Massalia, and their ships sailed over land: 49 of the capitals' sea
lanes on day 1 crossed more than half a kilometre of drawn land. `drawnLane` in
`src/render/drawn-lane.ts` keeps a lane on the drawn side, at sea for a lane and on land for
a road: each stretch more than 0.3 km on the wrong side is searched round on a grid of
0.25 km cells and pulled tight. The ends stay, since a harbour of the rules can stand on an
islet the atlas draws. The trade ink and the merchants both follow it (`laneOf` in the
renderer, `lane` in the scene's input), at the same share of its length as the crossing is of
the route's; below 0.6 px/km the rules' coast is drawn, and so is the rules' path. A lane is
worked out once for each path, when it first comes near the view. `drawn-lane.test.ts` checks
every lane and road out of every capital on day 1. One road crosses drawn water that the
rules call land: the atlas parts the land between Persepolis and Gerrha, so that road has
no drawn way round.

The army scene reuses its owned cart, civilian walking cycles and ship sheets for
merchants, with a wake at sea and dry-ground checks on land. Own trade stays known;
foreign traders require sight. They do not grant sight or reveal hostile armies.
The last road raid is readonly saved data, under the separate `trade-raid-marks`
change. It shows a damaged cart, settling dust and a marked location for six days.

`trade-look` captures both zooms for cart and ship, selected routes, goods and the
raid. It waits for terrain and exact-resolution figure sheets, not a fixed sleep or
a blurry fallback. It opts into a 90-second **recording cap** so the clip includes
the ship and raid after the caravan; scenario and test execution timeouts are
unchanged. Other scenarios keep the existing 12-second recording cap.
