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
