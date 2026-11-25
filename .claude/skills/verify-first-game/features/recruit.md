# Recruit cards

A city the player owns raises troops from the `Raise` cards in its panel. Above the cards, a forecast says the realm's food and gold a day after every recruit musters and how long each store lasts. Each card shows its price, men, days and upkeep, and, while the game is paused and a power stands at 80% or more, what the raise does to its share.

## Sub-features

- `recruit-forecast` reads `Realm after all recruits muster: <food>, <gold>/day.`, then a line for each store (`recruit-runway-food`, `recruit-runway-gold`).
- `recruit-cards` one button per troop: Spearmen, Swordsmen, Skirmishers, Archers, Light cavalry, Heavy cavalry.
- `recruit-threat` on each card, only while paused and a power stands at 80% or more: its share now, once paid, once they muster, and whether it may still declare. They are reckoned one card at a time (`recruit-threat-reckoning`); while the game runs, `recruit-threat-paused` asks you to pause.
- `recruit-warning` a raise the stores cannot carry asks `Raise anyway` or `Cancel raising`.
- `recruit-raising` the `Raising` list (`city-raising`) shows the troops in training.
- `recruit-hint` names a second level (`recruit-canal`, `recruit-barracks`) when one would let the raise go ahead.

## How to get to it (user POV)

- Your city's panel, sections `Raising` and `Raise`.

## Driving it with drive.ts

Preconditions:

- `open --moment carthageNearsWar`. It loads paused on day 1 with Carthage at 90%, so no `play` is needed.

- **Open Roma and read.** `act "await support.untilDrawn(page); const at = support.cityPoint('roma'); const p = support.camera(page).screen({ x: at.x, y: at.y + 40 }); await page.mouse.click(p.x, p.y); await expect(page.getByTestId('recruit-threat')).toHaveCount(6, { timeout: 15000 }); const f = page.getByTestId('recruit-forecast'); await f.scrollIntoViewIfNeeded(); return { forecast: await f.innerText(), cards: await page.getByTestId('recruit-cards').ariaSnapshot() }"`. The forecast names food and gold a day and the runways. The forecast reads `Realm after all recruits muster: −8.8 food, −7.3 gold/day.` Six cards, each with `Carthage 90% now, <share> once paid, <share> once they muster on <date>`, where a share can read `just under 80%` and the verdict can come between them.
- **Raise.** `act "await page.getByTestId('recruit-cards').getByRole('button', { name: /^Spearmen/ }).click(); const anyway = page.getByRole('button', { name: /^Raise/ }); if (await anyway.isVisible()) await anyway.click(); return await page.getByTestId('city-raising').textContent()"`. Spearmen ask first, with `Raise anyway` or `Raise troops`. `Raising` reads `Spearmen · ordered for the next day`, and the gold is still the same until that day.
- **Proof.** `shot recruit-forecast` before the raise and `shot recruit-raising` after.

## Gotchas

- Use `innerText` for the forecast. Its `textContent` runs the store lines together.
- The recruit warning's button reads `Raise troops` or `Raise anyway`, depending on the shortfall.
- Moments: `carthageNearsWar`, and `e2e/warnings-game.ts` (`foodShortfall`, `slowFoodDeficit`, `foodShortUnlessWaiting`) for the warnings. Capture scenarios: `recruit-threat`, `recruit-wait`, `recruit-moved`, `recruit-canal`, `recruit-barracks`.
