# Peace rules and evidence

Conquest should feel rewarding without being trivial. This records the original PR measurements and the revised rule after the outside review, rather than treating measurements from different bases as comparable.

## Current rule

- Keep the 60-day opening. The usual standing, weariness, other-war, shortage, and resolve factors remain visible and deterministic.
- The losing-side floor uses **durable** city/battle points, not siege pressure. The durable score must be negative, and the side must have lost a city still held by its enemy or more than 10% of its soldiers. The share is recorded battle losses / (surviving soldiers + those losses).
- With no city transfer and neither side above that loss threshold, the war is even. Other pressures and a provisional siege cannot obtain free peace before 225 war-days; afterward both accept peace as things stand.
- A non-loser cannot obtain an early free peace merely from siege pressure, even after the player sacrifices their own men. This closes the capital-siege variant as well as the reviewer's exposed-city example. A true loser can accept white peace or pay. AI proposals still need both sides' consent.
- The next-day answer rechecks current facts. Forecasts record loss shares too: recruitment that changes the threshold gets an actual explanation rather than a misleading generic fallback.

## Cheapest controlled truce cases

`src/sim/peace/truce-shield.test.ts` checks a 1,500-man Roman army against 3,000 equal troops, equal morale and generals: the AI's estimated strength is twice Rome's. The exposed-city siege produces standing −7 for the enemy without losing a man or city.

| Controlled case                             | Earliest offer / direct cost                                                            | Evidence                                                                                                                  |
| ------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| No actual losses, talks first open          | Day 61 (60 war-days), 1,100 gold                                                        | 1,099 fails; the next-day acceptance actually deducts 1,100 and starts a truce on day 62 through day 427                  |
| Same undamaged war, one day before maturity | Day 225 (224 war-days), 100 gold                                                        | Enumerated daily price frontier                                                                                           |
| Same undamaged war, free exit               | Day 226 (225 war-days), zero treaty gold                                                | First zero in the enumerated frontier; mature even proposals are white peace                                              |
| Enemy battle losses                         | 300/3,000 is exactly 10%, so it does not qualify; 301/3,000 does                        | A real durable loss is required; this is a rule boundary, not a claim those casualties can be inflicted for no Roman cost |
| Real city gain, early zero-gold exit        | A 1,500-man army storms an already undefended minor city and leaves 300 men as garrison | Actual storm/offer/accept orders; the army has 1,200 men left, keeps the city, and pays no treaty gold                    |

The minimum is measured over offer dates/payments in this controlled no-damage stand-off, not asserted as a globally optimal campaign across every map, detached force, or pre-damaged city. The city case makes the alternative cost concrete: an actual conquest and garrison commitment, not a siege marker. Ordinary upkeep and the risk of remaining at war are not waived or counted as new treaty charges.

## Outside-review fixes

1. Persist `resumeOnClose` separately from `paused`. Export/load restores an offer-owned stop, and accepting/refusing resumes the clock and applies the answer. A player-owned stop stays paused. Four browser cases cover owner × answer; unit round-trips and `restoreModalResume` cover the policy.
2. Reject the siege-only/tiny-clash shield, including empty stores, other wars, equal bloody losses, capital pressure after sacrificing Roman troops, and force growth crossing the threshold. Every adjustment is a visible reckoning factor.
3. Tell the refusal once: who refused, what it wants, and changed facts. The repeated “Carthage refuses” clause is removed.
4. `termsProblem` now derives payer names from records at the source, so even direct `peaceAnswer` verdicts do not expose lowercase ids. Both minor and great-power verdicts also have browser coverage; `peaceVerdict` still applies the shared name/date presentation helper.

The saved shape uses the immutable `peace-forecasts-and-pending-answers.json` registration. `peace-offer-ended.json` independently registers its alert. There is no new numeric format and no edit to another feature's change file. Ordinary queued movement/recruit orders remain outside this feature's persistence scope.

## Measurement sources

All runs use seeds 1–20. Peace/world run ten years; AI runs five years, both all-AI and passive-Rome modes. The columns preserve the old numbers beside the new ones:

- Original main: `bfb56179`, before balance #43.
- First PR head: `2c42dfe`, the version the outside reviewer examined.
- Current-rule baseline: main `a3ac1ba`, including #43/#47. Main `a98a2de` then added #50; its diff changes no `src/sim` file or simulation script, so this is also the simulation-rule baseline for that rebase.
- Revised PR: the reviewed rule on `a98a2de`, using `npm run sim -- peace`, `world`, and `ai` with the arguments above.

### Peace

| Measure                                      | Original main            | First PR                   | Current main rules    | Revised PR           |
| -------------------------------------------- | ------------------------ | -------------------------- | --------------------- | -------------------- |
| Great-power wars begun                       | 793                      | 832                        | 864                   | 891                  |
| Great-power peace endings                    | 744 (93.8%)              | 789 (94.8%)                | 813 (94.1%)           | 837 (93.9%)          |
| Great-power destruction endings              | 3                        | 0                          | 12                    | 14                   |
| Great-power wars still running at year 10    | 46                       | 43                         | 39                    | 40                   |
| Great-power median / longest duration        | 129 / 1,299 days         | 131 / 760 days             | 121 / 316 days        | 145 / 414 days       |
| Great-power wars lasting all ten years       | 0                        | 0                          | 0                     | 0                    |
| Shortest peace-to-next-war gap               | 365 days                 | 365 days                   | 365 days              | 365 days             |
| Median peace-to-next-war gap                 | 432 days                 | 448 days                   | 388 days              | 410 days             |
| Minor wars: begun / peace / defeat / running | 2,173 / 964 / 1,174 / 35 | 2,194 / 1,040 / 1,126 / 28 | 1,005 / 159 / 839 / 7 | 965 / 192 / 757 / 16 |

Days at peace mean days with **no** war, including no overlapping minor war. A higher treaty count does not promise more such days for every faction.

| Power    | Original median | First-PR median | Current-main median (min–max) | Revised median (min–max) |
| -------- | --------------- | --------------- | ----------------------------- | ------------------------ |
| Rome     | 274             | 285             | 619 (341–896)                 | 598 (251–1,242)          |
| Carthage | 336             | 246             | 720 (284–1,203)               | 548 (252–972)            |
| Macedon  | 371             | 356             | 680 (311–1,166)               | 535 (249–1,213)          |
| Egypt    | 384             | 367             | 673 (414–1,245)               | 767 (382–2,041)          |
| Persia   | 358             | 350             | 998 (648–1,514)               | 806 (439–1,353)          |

### World and AI

Every previously met printed target remains met. The leadership-distribution target was already **not met**: Persia leads 12/20 in the two old runs and 13/20 in both current-rule runs. This feature does not retune that imbalance.

| World measure                                          | Original main → first PR | Current main → revised PR |
| ------------------------------------------------------ | ------------------------ | ------------------------- |
| Largest power ≤40/80 cities                            | 20/20 → 20/20            | 20/20 → 20/20             |
| At least three powers survive year 10                  | 20/20 → 20/20            | 20/20 → 20/20             |
| Leadership: Rome / Carthage / Macedon / Egypt / Persia | 1/5/0/2/12 → 3/4/0/1/12  | 3/3/0/1/13 → 1/4/0/2/13   |
| Armies idle beside an enemy over 30 days               | 0 → 0                    | 1 → 0                     |
| Armies idle overseas over 30 days                      | 1 → 0                    | 1 → 0                     |
| Armies with no menu route home                         | 0 → 0                    | 0 → 0                     |
| Wars without an act within a year / before ending      | Not printed on old base  | 130 → 93                  |
| Repeated nearby losing attacks                         | Not printed on old base  | 181 → 149                 |
| Longest quiet-war stretch, median / maximum            | 32/200 → 25/175 days     | 51/180 → 66/224 days      |

The last row is a deliberate tradeoff, not hidden improvement: an unbloodied stand-off may now remain open until its 225-day settlement limit rather than buying an early truce with a token siege.

Independent-minor figures are median, minimum, and seeds reaching the printed threshold. All growth rates remain above 90%; annual inter-power contact remains at least 90% of seeds.

| AI target                                    | Original main → first PR        | Current main → revised PR       |
| -------------------------------------------- | ------------------------------- | ------------------------------- |
| All AI: minors at year 2 (threshold 30)      | 41,min36,20/20 → 42,min36,20/20 | 43,min38,20/20 → 44,min39,20/20 |
| All AI: minors at year 5 (threshold 12)      | 18,min9,18/20 → 20,min10,18/20  | 30,min18,20/20 → 33,min21,20/20 |
| All AI: eligible unopposed growth            | 98/107 → 100/108                | 101/105 → 84/88                 |
| All AI: contact every year from year 2       | 20/20 → 20/20                   | 20/20 → 20/20                   |
| Passive Rome: minors at year 2               | 42,min39,20/20 → 42,min39,20/20 | 45,min42,20/20 → 46,min42,20/20 |
| Passive Rome: minors at year 5               | 21,min15,20/20 → 22,min14,20/20 | 32,min27,20/20 → 34,min26,20/20 |
| Passive Rome: eligible unopposed growth      | 126/135 → 132/138               | 126/130 → 139/143               |
| Passive Rome: contact every year from year 2 | 20/20 → 19/20                   | 20/20 → 19/20                   |
| A power destroyed before year 3, both modes  | 0/20 → 0/20                     | 0/20 → 0/20                     |

Seed 1 repeated ends byte-identically in the AI script's state check. Minors are not made immune: the revised ten-year run includes 757 minor-war defeats and 192 peaces.

## Historical tester reconstruction

The unavailable tester save was not claimed as reproduced exactly. With a day-1 war on day 65, sound stores and no other war, the old `bfb56179` rule gave Mediolanum losing by 1: `+1 +4 −15 = −10` (wants 1,000 gold, or Ariminum when Rome has no gold). Lugdunum losing by 2 gave `+2 +4 −15 = −9` (wants 900 gold). The first head blindly floored both to zero.

That score alone is **no longer enough** to justify the floor. A small casualty count can be an even, unbloodied war for a large realm. The current tests make the actual loss share explicit, and the revised screenshots use genuinely depleted forces. This is the intentional correction to the first head, not a claim that every reported +1 now forces free peace.

## Verification

- `npm ci` after each rebase: generated save/order/slot/alert tables; no generated module committed.
- `npm run check`: passed.
- `npm test -- --maxWorkers=2`: all 868 tests passed; no timeout/retry/assertion weakened.
- `npm run build`: passed; existing large-chunk warning only.
- `npm run e2e -- e2e/peace.spec.ts --workers=1`: 14/14 passed, including all four export/load ownership/answer combinations, minor/great-power names, actual refusal/Chronicle reason, and truce/homecoming.
- Capture scenarios `peace-follows-war` and `peace`: ten revised/new peace screenshots (including the truce shield) and five existing peace screenshots. CI publishes exact-commit media; no capture is committed with the game.
- A fresh reviewer approved the production fix with no findings and independently ran 139 relevant unit tests. The final added real-conquest cost test also passes in the full suite. Browser, campaign sweeps and captures are implementation-lane verification, not claimed as independently rerun.

Decisions: use a 10% actual-loss boundary, preserve the 60-day opening and 225-day even-war end, close the capital/own-loss variant too, preserve only peace queues rather than expand all-order persistence, and follow independent registration files instead of numeric format 14. No merge is performed by this lane.
