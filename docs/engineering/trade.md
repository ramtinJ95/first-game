# Trade: first playable slice

## Rules

`src/sim/trade/routes.ts` owns forecasts and refusals. An end earns
`1.15 × (unlike goods ? 1.8 : 1) × (1 + min(distance, 1000) / 1000)` gold a day,
times its owner's administrative share. An arrival pays that rate times the crossing's
days to **both** ends. The economy displays the mean but never pays it again.

Opening costs `ceil(1.15 × (1 + min(distance, 1000) / 1000) × 740)`, doubled for a
domestic route because both receipts go to one realm. Unlike goods repay in about 1.13
years and identical goods in about 2.03 years before the large-realm penalty.

Land routes reach 1,000 km at 16 km/day; sea routes require two actual ports and reach
1,800 km at 28 km/day. Navigation uses the existing constrained mesh, and paths are
found once and cached outside the state, keyed by world, endpoints and mode. The save
holds the path and the caravan's crossing progress and direction.

Province goods use a hash of the seed and position within a starting homeland's pool
of three goods, or all five for independent cities. This never advances the world's
random stream and therefore does not redraw a seed's minor-city kinds or armies.

Size, Forum and port slots make routes compete with each other. Capacity reductions
grandfather existing investments; no new route can exceed the current capacity.
The player may close or refuse a route without refund. Incoming invitations reserve
neither slots nor gold. Acceptance rechecks peace, ownership, unrest, sieges, slots,
duplicates, path and the inviter's gold before changing anything.

AI factions and minors consider trade monthly, staggered by faction id. They choose
the highest return per gold, then the greater income, then city id and land before
sea. They retain at least 600 gold or their army reserve, plus the next recruit's price, and project their
earlier orders before spending. They make no investment on a declaration-of-war day.

An enemy anywhere within 20 km of a land route can raid it. A raid pays one shipment
to the raider and resets the caravan; replacement takes a crossing's days. The road
must be cleared for it to travel again. An endpoint siege suspends any route. These
are public interruptions for the player's own trade, not a way to reveal hidden enemy
armies. At sea only endpoint sieges stand in for blockade; no offshore interception.

The immutable `trade-goods-and-routes` save change requires goods and trade records. Loading validates ids, endpoints,
owners, distinct ends, running-pair uniqueness, positive rates, progress, and path
length. It does not migrate older change sets. Orders and alert kinds use their own
registration files, after rebasing onto tooling main `a3ac1ba`.

## Verification and decisions

Run `npm run sim -- trade` for seeds 1–20, five peaceful years. Like `sim:buildings`, the
control gives other factions no orders, so the policy measures investment rather
than an uncontrolled invasion. Rome opens its best affordable route, otherwise its
cheapest available building. The decision metric counts actual opening/build orders,
not caravan deliveries or repeated displays of unaffordable choices.

The trade share is gross expected receipts divided by taxes plus receipts on day
1,095. The war experiment declares on the most valuable trading partner and measures
the loss of net income. It does not claim every possible partner costs a tenth.

The decision-interval target is **not met**: the median across seeds is 88 days, not 60. The tested affordable policy makes 23 investments in five years. I did not lower
the existing building prices, loosen city slots, or raise trade above the 40% share
target to hide this gap. Keeping the world open takes priority; more peacetime
decisions remain follow-up work, not a completed claim.

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

The two browser tests open a route through the panel, observe its delivery counter
and rising gold, load a saved caravan in transit, and declare war through the panel
to close a saved sea route. The first look is intentionally a plain moving marker;
drawn trade figures, selected routes, map goods, raids and the guide are the second PR.

## Drawing trade

`src/render/trade.ts` interpolates a crossing through arrival before reversing it and
adds a province's stored good to its existing city label from 0.9 px/km. The existing
label collision rule decides where it fits. Selecting a city draws its active routes
with the same dashed ink and halo as army paths.

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
