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

`npm run sim -- recruit-warning` plays seeds 1–20 for ten years. Every faction plays the AI, Rome included, except Rome's recruits. Each day Rome raises the AI's most needed troop at Roma, or else at its first city that can train it, when it holds the gold and men for it at the start of the day and still holds them after its other orders of the day, unless the recruit card warns. The forecast it reads counts those other orders, as the panel counts orders already given. Rome heeds every warning. Only raises the tick accepts count. Hunger counts men who deserted while food was short; unpaid, while only gold was. Cities fallen counts every Roman city taken, so a city lost twice counts twice.

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

This separates the two cases the tester met. Food that runs out in one to two years at today's yields, as it did a year and a half after the tester's second regiment, still runs out as the people grow in all 186 cases, and the one-year horizon gave none of them a food warning. Food more than four years out, like the 2,792-day forecast that stopped a cautious player, closes first in all 393. The measure is the realm's own growth: the people grow `YEARLY_GROWTH` a year while food lasts and each adds to the food and gold balance, so a gap of a few per cent of what the realm eats closes in a few years, and a regiment's worth does not close in decades.

`--audit` scores each rule against what followed. It replays the run with no warning, in which Rome raises at every chance, and for each of its 435 raises asks whether food or gold really ran short within two or four years. A raise late in the game or before a defeat leaves the window it was not followed through, so each cell reads "short of followed".

| warning rule                     | raises it warns of | short within 2 y | short within 4 y | raises it lets pass | short within 2 y | short within 4 y |
| -------------------------------- | -----------------: | ---------------: | ---------------: | ------------------: | ---------------: | ---------------: |
| any distance, today's yields     |                168 |        70 of 143 |        77 of 107 |                 267 |        97 of 229 |       138 of 178 |
| within 365 days, today's yields  |                 39 |         24 of 34 |         20 of 26 |                 396 |       143 of 338 |       195 of 259 |
| any distance, the people growing |                 67 |         32 of 58 |         32 of 44 |                 368 |       135 of 314 |       183 of 241 |

Against what really followed, no forecast tells this eager recruiter's raises apart at four years: about three in four met a shortage, warned or not, because the shortages came mostly from cities lost in war, which no forecast of today's realm can see. At two years the warnings carry some signal over the base rate of about 43 %: 71 % of the one-year rule's warnings came true, 55 % of the growth rule's and 49 % of the old rule's. The growth rule warns of 67 raises, against 168 for the old rule and 39 for the one-year rule. So it does what the tester asked, warning of the raise whose deficit lasts and staying quiet for the gap growth closes, but it cannot promise a realm at war that its stores will last.

## A careful player and the receding forecast

Round six's tester raised Spearmen at Roma from a new Rome without trade every 45 days, when gold was at least 3,400, manpower at least 1,000 and gold income at least +8 a day, and cancelled at every warning. They were held to one regiment for three years while each warning put the shortfall further off, from 598 days to 2,180. `npm run sim -- careful-raise` plays that pattern on seeds 1–20 for three years. Without trade or a war in those years every seed plays the same, so each table below is one row for all twenty.

| at a warning                     | regiments raised | warnings | first warning: day, stores last, holds from | Year 1, day 331: stores last, holds from | men under arms at the end | men lost to hunger |
| -------------------------------- | ---------------: | -------: | ------------------------------------------- | ---------------------------------------- | ------------------------: | -----------------: |
| cancels                          |                2 |       18 | 271, 626 days, day 1081                     | 682 days, day 1081                       | 2,500 + 1,000 in training |                  0 |
| raises anyway (`--raise-anyway`) |                3 |        2 | 271, 626 days, day 1081                     | 211 days, never                          |                     2,976 |              1,524 |

On `main` (aef5b10), seed 1 cancels the same way: 2 regiments, 18 warnings from day 271 (626 days) to day 1036 (2,173 days), 2,500 men and none lost; the holds-from column is new. The second regiment is raised on the last day of the run, so it is still training at the end.

The forecasts were right. Raising anyway puts a second regiment on day 271 and a third on day 991. The granary empties and 1,524 men desert before Year 3 ends, so the three regiments add 1,476 men: the army settles at what the land feeds. The forecast receded because the cautious player waited: the realm without the second regiment gains about 2–3 food a day, so each 45 days of waiting adds 100 to 130 food to the granary, and the people grow too, until on day 1081 the raise holds and goes through without a warning.

So the measure stays, and #66's 20-seed run did not show the pattern because nothing in it waits: its eager Rome raises the day it can afford a troop, inside the AI's wars, and its audit asked only whether the warnings came true, which they did. What changes is what a warning says. Each warned raise is replayed later, by `holdsAfter`, until no shortfall remains, and the warning names that wait: "Stores grow while you wait: raised in about 810 days, these men are fed as the people grow. Raise now only if you need them sooner." All eighteen of the tester's warnings name the same day, 1081, counting down by 45 each time, and the raise on that day passes. A raise that no wait of ten years carries keeps "Raise fewer troops or improve income first", as on day 331 of the run that raised anyway, with two regiments already raised.

The warning fires on exactly the days it fired before, so the ten-year heeding Rome above is unchanged: on today's `main` (aef5b10), the cautious Rome that heeds every warning raised 503 regiments and lost 0 men to hunger, 13,078 unpaid and 443 Roman cities, and was defeated in 6 seeds; the Rome that ignores every warning raised 405, lost 0 to hunger, 34,052 unpaid and 361 cities, and was defeated in 11. As above, those totals follow the AI's wars more than the warning.
