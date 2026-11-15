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

`npm run sim -- recruit-warning` plays seeds 1–20 for ten years. Every faction plays the AI, Rome included, except Rome's recruits. Each day, after its other orders of the day, Rome raises the AI's most needed troop at Roma, or else at its first city that can train it, whenever it has the gold and men, unless the recruit card warns. Rome heeds every warning. Only raises the tick accepts count. Hunger counts men who deserted while food was short; unpaid, while only gold was. Cities fallen counts every Roman city taken, so a city lost twice counts twice.

| warning rule                                   | regiments raised | men lost to hunger | men lost unpaid | Roman cities fallen | seeds Rome defeated | days warned |
| ---------------------------------------------- | ---------------: | -----------------: | --------------: | ------------------: | ------------------: | ----------: |
| none                                           |              435 |                908 |          34,349 |                 422 |                  10 |           0 |
| any distance, today's yields (before #56)      |              489 |                  0 |           8,271 |                 435 |                   5 |      16,926 |
| within 365 days, today's yields (#56)          |              518 |                  0 |          16,612 |                 459 |                   7 |       2,465 |
| any distance, the people growing (this change) |              465 |                  0 |          12,607 |                 452 |                  10 |       3,579 |

These totals cannot rank the rules. The four histories part at the first raise one rule allows and another refuses, and the AI's wars then differ: under one rule a seed raises 3 regiments and loses the game, under another 43 and survives. The defeated seeds move between rules in both directions. Every warning rule removes hunger, and all rules leave thousands of men unpaid, because cities lost in war take their taxes with them.

The next table compares the rules on the same days. It files every day of the one-year run on which Rome could pay for a raise, by the fixed-yield forecast of that raise, and asks whether the growing realm still runs short. A blocked raise counts again each day it waits.

| fixed-yield shortfall | the growing realm runs short too | growth closes the gap first |
| --------------------- | -------------------------------: | --------------------------: |
| food up to 365 days   |                            1,262 |                           0 |
| food up to 730 days   |                              186 |                           0 |
| food up to 1,460 days |                              251 |                         118 |
| food over 1,460 days  |                                0 |                         393 |
| gold up to 365 days   |                            1,475 |                          13 |
| gold up to 730 days   |                               29 |                          79 |
| gold up to 1,460 days |                                0 |                         114 |
| gold over 1,460 days  |                                0 |                         225 |

This separates the two cases the tester met. Food that runs out in a year and a half at today's yields still runs out as the people grow, in all 186 cases, and the one-year horizon warned of none. Food more than four years out, like the 2,792-day forecast that stopped a cautious player, closes first in all 393. The measure is the realm's own growth: the people grow `YEARLY_GROWTH` a year while food lasts and each adds to the food and gold balance, so a gap of a few per cent of what the realm eats closes in a few years, and a regiment's worth does not close in decades.

`--audit` scores each rule against what followed. It replays the run with no warning, in which Rome raises at every chance, and for each of its 435 raises asks whether food or gold really ran short within two or four years.

| warning rule                     | raises it warns of | short within 2 y | within 4 y | raises it lets pass | short within 2 y | within 4 y |
| -------------------------------- | -----------------: | ---------------: | ---------: | ------------------: | ---------------: | ---------: |
| any distance, today's yields     |                168 |               82 |        114 |                 267 |               97 |        162 |
| within 365 days, today's yields  |                 39 |               27 |         29 |                 396 |              152 |        247 |
| any distance, the people growing |                 67 |               38 |         46 |                 368 |              141 |        230 |

Against real outcomes no forecast does much better than the base rate: about three in five raises of this eager recruiter met a shortage within four years, warned or not, because the shortages that followed came mostly from cities lost in war, which no forecast of today's realm can see. The growth rule warns of 67 of the 435 raises, against 168 for the old any-distance rule and 39 for the one-year rule, and 46 of its 67 ran short within four years.
