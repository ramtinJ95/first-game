# Warnings for a cautious player

`npm run sim -- pauses` plays seeds 1–5 as idle Rome for up to four years (ending at defeat), immediately resuming every automatic stop without giving orders. The same script ran before the changes on `9ee0cb1` and after. It counts stopped days, not alert lines: a final city loss and defeat on one day count as one stop. Peace-offer modal stops are included and immediately dismissed, not accepted.

| Seed  | Before stops | After stops | Cities lost | Losses stopped before | Losses stopped after |
| ----- | -----------: | ----------: | ----------: | --------------------: | -------------------: |
| 1     |           16 |          27 |           4 |                     1 |                    4 |
| 2     |           21 |          32 |           4 |                     1 |                    4 |
| 3     |           16 |          27 |           4 |                     1 |                    4 |
| 4     |           14 |          25 |           4 |                     1 |                    4 |
| 5     |           17 |          27 |           4 |                     1 |                    4 |
| Total |           84 |         138 |          20 |                     5 |                   20 |

Reasons (several reasons may stop the same day):

| Seed | Enemy sighted | Battle | Peace offer | Defeat | Siege begins, after only | City in danger, after only | City lost, after only |
| ---- | ------------: | -----: | ----------: | -----: | -----------------------: | -------------------------: | --------------------: |
| 1    |             2 |      6 |           7 |      1 |                        4 |                          4 |                     4 |
| 2    |             2 |     10 |           8 |      1 |                        4 |                          4 |                     4 |
| 3    |             2 |      4 |           9 |      1 |                        4 |                          4 |                     4 |
| 4    |             1 |      3 |           9 |      1 |                        4 |                          4 |                     4 |
| 5    |             2 |      7 |           7 |      1 |                        4 |                          4 |                     4 |

All 20 city losses now stop the player, rather than only the final defeats. The extra stops are the three city decision points, not daily siege or desertion spam. The battle counts in these five idle runs do not change: the battles involve a substantial share of Rome's dwindling field army. Separate boundary tests cover quiet 50–150-man battles while a reserve exists, the 500-man line, and a small battle of the last army. No hunger, siege, battle, or AI rule changes.

The own-city danger line is seven days of food or seven days until the walls collapse at today's besieger strength, in a blockading siege. This gives time before bare walls can surrender on any day. The battle line is 500 of the player's men or 10% of their fielded army: a small sally should not stop a large realm, but fighting with the last hundred men still matters.

The AI's matching Skirmish after its first choice is the intended stance rule, not a defect. It changes again only when beaten and neither side is re-forming. The panel now calls its highlighted choice an answer to the enemy's **current** stance **once re-formed**, and explains when the AI may answer. The redirected same-day arrival fix from PR #50 is already present on the base, including the regression in `guide-regressions.test.ts`; it is retained unchanged.

## The recruit warning at any distance

`npm run sim -- recruit-warning` plays seeds 1–20 for ten years. Every faction plays the AI, Rome included, except Rome's recruits: each day Rome raises the AI's most needed troop at Roma, or else its first city that can train it, whenever it has the gold and men, unless the recruit card warns. Rome heeds every warning. Hunger counts men who deserted while food was short; unpaid, while only gold was. Cities fallen counts every Roman city taken, so a city lost twice counts twice.

| warning rule                                   | regiments raised | men lost to hunger | men lost unpaid | Roman cities fallen | seeds Rome defeated | days warned |
| ---------------------------------------------- | ---------------: | -----------------: | --------------: | ------------------: | ------------------: | ----------: |
| none                                           |              439 |                908 |          34,349 |                 422 |                  10 |           0 |
| any distance, today's yields (before #56)      |              451 |                  0 |          11,668 |                 436 |                   9 |      16,163 |
| within 365 days, today's yields (#56)          |              512 |                  0 |          16,601 |                 454 |                   8 |       2,242 |
| any distance, the people growing (this change) |              516 |                  0 |           8,965 |                 487 |                   7 |       4,634 |

The new rule raises as many regiments as the one-year horizon and more than the old any-distance rule, and halves the men lost unpaid. Losses that remain come from what no forecast predicts: cities lost in war take their taxes with them. This eager recruiter runs short of gold before food, so the tester's hunger case shows in the next table, which sorts every raise day of the one-year run by the fixed-yield forecast.

| fixed-yield shortfall | the growing realm runs short too | growth closes the gap first |
| --------------------- | -------------------------------: | --------------------------: |
| food up to 365 days   |                            1,267 |                           0 |
| food up to 730 days   |                              109 |                           1 |
| food up to 1,460 days |                              253 |                          18 |
| food over 1,460 days  |                                1 |                         257 |
| gold up to 365 days   |                            1,249 |                          14 |
| gold up to 730 days   |                               33 |                          74 |
| gold up to 1,460 days |                                0 |                         111 |
| gold over 1,460 days  |                                0 |                         227 |

Food that runs out between one and four years at today's yields, the regiment that empties the stores in a year and a half, still runs out in 362 of 381 cases as the people grow, and the one-year horizon told none of them. Food more than four years out, the 2,792-day forecast that stopped a cautious player, closes first in 257 of 258. The measure is the realm's own growth: the people grow `YEARLY_GROWTH` a year while food lasts, and each adds to the food and gold balance, so a gap of a few per cent of what the realm eats closes in a few years, and a regiment's worth does not close in decades.
