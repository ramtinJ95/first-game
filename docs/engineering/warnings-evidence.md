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

The warning fires on exactly the days it fired before, so the ten-year heeding Rome is unchanged: playing #66's rule, which this change keeps, on aef5b10's game, the cautious Rome that heeds every warning raised 503 regiments and lost 0 men to hunger, 13,078 unpaid and 443 Roman cities, and was defeated in 6 seeds; the Rome that ignores every warning raised 405, lost 0 to hunger, 34,052 unpaid and 361 cities, and was defeated in 11. The game has changed since the table above was made, so these totals differ from its rows, and as there they follow the AI's wars more than the warning.

## The named wait, tried on the day it names

The seventh play-through raised on Year 1, day 330 into a warning that named about 792 days. On the day it named, the raise still warned, now with about 170 days, and it passed with no warning 962 days after the first. `npm run sim -- raise-wait` asks whether the day is wrong or the realm changed in between. Rome raises Spearmen at Roma every 45 days while the card gives no warning. On the first day the card warns, it reads the wait for each of Rome's four cities and each troop that names one. From then on Rome gives no order, and each raise is tried again on the day named, then every five days until it passes.

| world (`--world`)                                                         | raises tried | passed on the named day |                                         slipped | what came between                                                                                                   |
| ------------------------------------------------------------------------- | -----------: | ----------------------: | ----------------------------------------------: | ------------------------------------------------------------------------------------------------------------------- |
| `idle`, no other power gives an order, seeds 1–3                          |           12 |                      12 |                                               0 | nothing                                                                                                             |
| `ai`, every other power plays the AI, seeds 1–5                           |           20 |                       8 | 3: by 315 and 320 days, and one not in 12 years | a war on Rome that took three of its cities; the other 9 raises were at cities lost before the day                  |
| `cautious`, the cautious Rome of `sim -- threat -- --peaceful`, seeds 1–4 |            4 |                       4 |                                               0 | food waits of 567 to 612 days, with 5 or 6 trade improvements, 3 or 4 buildings and 3 or 4 regiments raised between |

The harness reads a card only on a day the player could click it, with the gold and men for the raise. A first run without that filter also counted nine gold waits of 2 to 38 days that slipped by 10 to 125 days, with a trade improvement bought in between in 8 of them. All nine began with less gold than the 2,400 the raise costs, on a card the panel disables, so they are not in the table. A review of this change still found a gold wait on a card that can be clicked that slipped with no order from anyone: trade gold comes when each caravan arrives, while the forecast spreads it over the days.

With nothing between, the day is exact. The cautious food waits passed on their day despite what Rome did between; I did not trace why those acts did not move them. What moves the day is what the forecast says it does not predict: gold spent, other troops, a war, a lost city, or trade. The card now names its day and says what it counts on: no other troops raised and no city lost, and for a gold shortfall also no gold spent, an income that holds, and trade gold that comes as each caravan arrives and can move the day by some weeks. The `recruit-wait` capture shows the warning on the first day and the raise passing on Year 3, day 109, the day it named.

In the browser the card at first still warned on that day, while the same forecast in Node passed. The rules agreed, but the panel did not. The warned card's confirmation stayed open after the day's click raised the Spearmen at once, and the confirmation then reckoned one more Spearmen on top of the one just queued. A raise issued straight from a card now closes the confirmation. `e2e/warnings.spec.ts` loads the named day after a warned click and fails on `main`.

## A power that warns again soon after it stopped the game

The thirteenth play-through's Carthage stopped the game at Ariminum on Year 5, days 211, 248, 278 and 311, at 80 to 85% each time, with the line that its threat had passed between each. `npm run sim -- threat-repeats` plays the ignoring and answering Romes of `sim -- slide` on seeds 1–20 for ten years and lists each warning with its day, power, share and the front it weighs. For each window after the power's last stop in the same peace, it counts the warnings that repeat that stop and which of them stopped the game. The share column is the shown share's points against the stop's. A war on Rome ends the peace and forgets the stop. Each window counts every repeat within it, so the 120-day row holds the 60-day row. Before, on `main` at 0bd566d, every warning stopped:

| Rome      | days with a warning | stops | within days of the last stop | repeats | lower / up to +2 / +3 to +5 / +6 to +10 / more | same front | another front |
| --------- | ------------------: | ----: | ---------------------------: | ------: | ---------------------------------------------- | ---------: | ------------: |
| ignoring  |                  83 |    83 |                           30 |       5 | 2 / 2 / 0 / 1 / 0                              |          5 |             0 |
|           |                     |       |                           60 |      12 | 4 / 6 / 0 / 2 / 0                              |         12 |             0 |
|           |                     |       |                           90 |      21 | 5 / 10 / 2 / 3 / 1                             |         21 |             0 |
|           |                     |       |                          120 |      26 | 7 / 11 / 4 / 3 / 1                             |         26 |             0 |
| answering |                 119 |   119 |                           30 |      15 | 7 / 5 / 3 / 0 / 0                              |         15 |             0 |
|           |                     |       |                           60 |      34 | 16 / 14 / 4 / 0 / 0                            |         31 |             3 |
|           |                     |       |                           90 |      47 | 20 / 18 / 5 / 3 / 1                            |         40 |             7 |
|           |                     |       |                          120 |      50 | 21 / 19 / 5 / 4 / 1                            |         42 |             8 |

A third of the ignoring Rome's stops and two fifths of the answering Rome's repeat the same power within 120 days. Most of them stand lower or no more than 2 points higher, at the same city. The answering Rome raises men and moves its armies, which sometimes moves the city a power weighs. Of the 22 wars on Rome, the longest came 82 days after the last stop for its power, and none came more than 90.

`--propose <gaps>:<rises>` replays the stops on the same records. A first warning of a notice runs the game on when it weighs the same front, stands less than the rise above the stop, and its war would still come within the gap of the stop. A reminder always stops, since it says war may come any day. The test on the war is what keeps a war from coming on a player who was not stopped for it. No war of a notice comes unwarned after its reminder, which falls 84 days after its first warning, so a first warning is spared only when that reminder is due within the gap. The records keep no notice, so the replay takes a warning 60 or 84 days after the power's last for a reminder; it counts one stop more than the live rule for the ignoring Rome.

| rule                                    | ignoring stops | answering stops | wars more than the gap after a stop |
| --------------------------------------- | -------------: | --------------: | ----------------------------------: |
| every warning stops (before)            |             83 |             119 |                                   0 |
| gap 120, rise 6                         |             79 |             103 |                                   0 |
| gap 150, rise 6                         |             72 |              90 |                                   0 |
| gap 180, rise 6                         |             67 |              88 |                                   0 |
| gap 200, rise 3                         |             69 |              89 |                                   0 |
| gap 200, rise 6 (chosen)                |             67 |              86 |                                   0 |
| gap 200, any rise                       |             65 |              84 |                                   0 |
| gap 365, rise 6                         |             57 |              75 |                                   0 |
| gap 200, rise 6, without the war's test |             60 |              78 |                         3 (2 and 1) |
| gap 90, rise 6, without the war's test  |             68 |              88 |                                   1 |

The chosen gap of 200 days is the shortest round number that spares all three of the tester's repeats. Each falls on a new notice, so its reminder is due 84 days after it, on days 332, 362 and 395, which are 121, 151 and 184 days after the stop on day 211. At 120 days all four would still stop, at 150 the stop on day 278 would come back, and at 180 the one on day 311. A longer gap spares more but lets a war come further from the stop the player last answered: at 365 days that is a year. The rise of 6 points spares the tester's 80 to 85%, which lie within 5 points of each other in any order, and stops a repeat at 91% after a stop at 85%, a threat the player has not yet weighed. The data hold few repeats in that band, so 3 and 6 points differ by only 2 or 3 stops. A repeat at another front always stops: 8 of the answering Rome's 60 repeats within 200 days weigh another front, where the guards or men it raised may not count. A gap counted from the stop to the repeat alone, without the war's test, saves 7 or 8 more stops but lets 3 wars at 200 days and 1 at 90 come more than the gap after the last stop for their power, so it is set aside. Sparing reminders too, as a first version of this change did, spared none in the live run and only one in the replay, and it would have hidden the word that war may now come any day, so it is set aside too.

After, with `THREAT_SPARE_DAYS` 200 and `THREAT_SPARE_RISE` 6 in `src/app/threat-news.ts`, the same command plays the same 40 games. The warnings, wars and fronts are the same day for day, since the test Romes answer every warning they are told, stopped or not:

| Rome      | days with a warning | stops | within days of the last stop | repeats | that stopped | same front | another front |
| --------- | ------------------: | ----: | ---------------------------: | ------: | -----------: | ---------: | ------------: |
| ignoring  |                  83 |    66 |                           30 |       4 |            1 |          4 |             0 |
|           |                     |       |                           60 |       9 |            2 |          9 |             0 |
|           |                     |       |                           90 |      15 |            3 |         15 |             0 |
|           |                     |       |                          120 |      22 |            5 |         22 |             0 |
|           |                     |       |                          200 |      30 |           13 |         30 |             0 |
| answering |                 119 |    86 |                           30 |      10 |            0 |         10 |             0 |
|           |                     |       |                           60 |      27 |            4 |         24 |             3 |
|           |                     |       |                           90 |      40 |           11 |         33 |             7 |
|           |                     |       |                          120 |      46 |           13 |         38 |             8 |
|           |                     |       |                          200 |      60 |           27 |         52 |             8 |

The repeats within each window are fewer than before because the windows now run from the stops that remain. The live stops, 66 and 86, are the replay's. The 22 wars on Rome came 8 to 82 days after the last stop for their power, as before, and none more than 200. The rules are unchanged, so each still came 24 days or more after the first warning of the notice it declared on. One came 8 days after the answering Rome's last warning: on seed 16, Carthage warned on day 3355, reminded on day 3439, 84 days later, and declared on day 3447. So the rule spares 17 of 83 stops for the ignoring Rome and 33 of 119 for the answering one, a fifth and a quarter, and every war still comes within 200 days of a stop for its power.
