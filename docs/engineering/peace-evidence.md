# Peace follows the war

Conquest should feel rewarding without being trivial. A beaten side must not demand the winner's land or gold just because its fixed resolve outweighs a small defeat.

## The rule

1. Keep the existing standing, weariness, other-war, shortage, and resolve factors. A losing side's wish is at least zero; the panel shows the added restraint as “cannot demand payment while losing.”
2. After the 60-day opening, a losing side accepts peace as things stand. A sufficiently beaten or weary side pays; a winning side may demand payment. An otherwise even war accepts peace as things stand after 225 days.
3. AI proposals still need terms **both** sides accept. The losing-side floor does not force a winning AI to abandon a conquest for nothing. No answer draws a random number.

The 60-day opening is retained, not shortened: the measurements below preserve every previously met target, including independent minors at year 5. Minors are neither protected forever nor forced to fight until destruction: of 2,194 wars involving minors, 1,040 end in peace and 1,126 in defeat. Only a siege, never a treaty ceding the last city, eliminates a minor.

## The tester's two reckonings

These are reconstructions from the reported standings, not the tester's unavailable save. Both use day 65, a war begun on day 1, sound stores, and no other war. The before rule was executed from `bfb56179a57b5878f26bd297cc0420a30e2e889c` in a detached worktree. Battle losses of 67 and 133 produce the reported rounded standings of +1 and +2 for Rome.

| Panel factor / answer              | Mediolanum before         | Mediolanum after | Lugdunum before         | Lugdunum after |
| ---------------------------------- | ------------------------- | ---------------- | ----------------------- | -------------- |
| Is losing the war                  | +1                        | +1               | +2                      | +2             |
| The war has lasted 64 days         | +4                        | +4               | +4                      | +4             |
| Does not end a war for nothing     | −15                       | −15              | −15                     | −15            |
| Cannot demand payment while losing | —                         | +10              | —                       | +9             |
| Wish before terms                  | −10                       | 0                | −9                      | 0              |
| Peace as things stand              | Refuses; wants 1,000 gold | Accepts          | Refuses; wants 900 gold | Accepts        |

With Rome's purse set to zero, the old `paymentBetween` supplies Ariminum as Mediolanum's least acceptable city payment instead. With a purse of 900, it supplies Lugdunum's 900-gold demand. The new panel offers neither backwards demand.

## Before and after: peace

`npm run sim:peace -- --seeds 20 --years 10`, seeds 1–20, every faction under the AI. Before is `bfb56179`; after is this change, without balance PR #43.

| Measure                                      | Before                   | After                      |
| -------------------------------------------- | ------------------------ | -------------------------- |
| Great-power wars begun                       | 793                      | 832                        |
| Great-power wars ended in peace / begun      | 744 / 793 (93.8%)        | 789 / 832 (94.8%)          |
| Great-power wars ended by destruction        | 3                        | 0                          |
| Great-power wars still running at the end    | 46                       | 43                         |
| Longest great-power war                      | 1,299 days               | 760 days                   |
| Great-power pairs at war for all ten years   | 0                        | 0                          |
| Shortest peace-to-next-war gap               | 365 days                 | 365 days                   |
| Median peace-to-next-war gap                 | 432 days                 | 448 days                   |
| Minor wars: begun / peace / defeat / running | 2,173 / 964 / 1,174 / 35 | 2,194 / 1,040 / 1,126 / 28 |

Days at peace mean days with **no** war, not merely no war against a great power. More treaties do not necessarily increase this number when a power has overlapping wars.

| Power    | Median days at peace before → after | Fewest before → after | Most before → after |
| -------- | ----------------------------------- | --------------------- | ------------------- |
| Rome     | 274 → 285                           | 192 → 186             | 986 → 1,035         |
| Carthage | 336 → 246                           | 184 → 182             | 826 → 752           |
| Macedon  | 371 → 356                           | 184 → 214             | 924 → 609           |
| Egypt    | 384 → 367                           | 183 → 191             | 1,451 → 854         |
| Persia   | 358 → 350                           | 188 → 189             | 1,125 → 825         |

## Before and after: the world still holds

`npm run sim:world -- --seeds 20 --years 10` and `npm run sim:ai -- --seeds 20 --years 5`. Every target marked met before remains met after. The world script's separate “no power leads more than eight seeds” target was **not met before or after**: Persia leads 12/20 in each. This change does not retune that pre-existing imbalance.

| World target / observation, year 10                          | Before             | After              |
| ------------------------------------------------------------ | ------------------ | ------------------ |
| Largest power has at most 40 of 80 cities                    | 20/20; maximum 29  | 20/20; maximum 29  |
| At least three powers survive                                | 20/20              | 20/20              |
| Leadership seeds: Rome / Carthage / Macedon / Egypt / Persia | 1 / 5 / 0 / 2 / 12 | 3 / 4 / 0 / 1 / 12 |
| Armies idle beside an enemy over 30 days                     | 0                  | 0                  |
| Armies idle overseas over 30 days / with no menu route home  | 1 / 0              | 0 / 0              |
| Armies lost to sallies                                       | 4                  | 2                  |

The following AI targets all remain met. “Independent” gives median, minimum, and seeds reaching the printed threshold. Growth is eligible power-years that grew; war contact must meet 90% of seeds.

| AI target                                         | All AI before     | All AI after      | Passive Rome before | Passive Rome after |
| ------------------------------------------------- | ----------------- | ----------------- | ------------------- | ------------------ |
| Independent minors at year 2, threshold 30/60     | 41; min 36; 20/20 | 42; min 36; 20/20 | 42; min 39; 20/20   | 42; min 39; 20/20  |
| Independent minors at year 5, threshold 12/60     | 18; min 9; 18/20  | 20; min 10; 18/20 | 21; min 15; 20/20   | 22; min 14; 20/20  |
| Unopposed growth                                  | 98/107 (91.6%)    | 100/108 (92.6%)   | 126/135 (93.3%)     | 132/138 (95.7%)    |
| Power-versus-power contact every year from year 2 | 20/20             | 20/20             | 20/20               | 19/20              |
| A power destroyed before year 3                   | 0/20              | 0/20              | 0/20                | 0/20               |

Both AI modes also retain 20/20 seeds with three powers growing, 0/20 with a power holding over half the cities, and 20/20 with four powers alive after two years. Seed 1 repeated gives the same final state.

## Offers, forecasts, and the clock

- An offer records the forecast shown when it was queued, including standing, battle losses, captures, sieges, and the rule's factors. The next day uses current facts. AI answer orders recheck at execution too, after any earlier orders of that day.
- A refusal emits a required reason from `peaceAnswer`. Alerts and the Chronicle keep it. If an acceptance forecast turned into a refusal, it also names the changed facts; it does not claim a battle ended merely because its losses changed. An underway battle or siege in that war produces a warning in the panel.
- Duplicate same-day offers retain the first and explicitly reject the second; the panel disables sending while an own offer waits. An invalidated city payment is refused without charging gold. Expiration and a recipient's destruction emit explicit offer-ended news.
- Format **14** saves pending peace commands and the paused flag beside the page, and the forecast in each sent offer. Browser slots and file export use the same path. Loading restores unanswered incoming offers too. Unrelated queued movement/recruitment orders are not newly persisted by this change.
- Closing an offer resumes only a clock stopped automatically for it. A deliberate clock action clears automatic-resume ownership; a player pause stays paused, including while another war continues. Accept/refuse commands queued while paused apply when the player next runs a day.

## Verification

- `npm run check`: passed.
- `npm test`: 801/801 passed. An earlier run during simultaneous simulation sweeps timed out in the unchanged terrain-layer test (5.328 seconds against its 5-second limit). No timeout, retry, or assertion was changed; the full suite passed once those sweeps finished. A bounded two-worker run also passed all 799 tests present before the final two panel regressions.
- `npm run build`: passed; existing large-chunk warning only.
- `npm run e2e -- e2e/peace.spec.ts --workers=1`: 8/8 passed. It plays a refusal with its reason in alerts and Chronicle, a peace through truce and homecoming, paused save/reload, accepting and refusing with another war open, taking manual ownership of an automatic offer pause, and a real battle changing a saved forecast (800 gold accepted in the forecast, then refused after the battle).
- Unit coverage includes both reconstructed losing standings, a winning side's demand, weary even wars, changed capture/loss facts, both directions of execution-time answer changes, a city payment invalidated on its offer day, duplicate offers, defeat, expiration, pending-order validation, and paused/running save round-trips. Existing siege/battle peace and homecoming tests remain intact.
- Capture scenario `peace-follows-war`: winning, even, and losing wars against a minor and great power; the live-forecast warning; an actual refusal; and a changed-forecast refusal. Screenshots are published by CI, never committed with the game.
- Independent reviewer: approved, no actionable findings; independently ran 121 relevant tests on the final diff. Browser checks, simulations, and captures were verified by the implementation lane rather than claimed as reviewer coverage.

Decisions taken without waiting for the owner: keep the 60-day opening; floor only a losing side's demand rather than weakening winning AI resolve; reject a duplicate rather than silently replace the first; persist only peace commands in this scoped change; and advance format 13 to 14 under the workflow present on the base (tooling PR #47 was still open).
