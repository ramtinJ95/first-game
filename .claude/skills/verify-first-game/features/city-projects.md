# City projects

A city the player owns lists its buildings and offers the next ones: five first buildings, a second level of each, and one great work a city may hold. Each offer shows its price, days, what it adds there and when it pays back. A city builds one project at a time.

## Sub-features

- `build-list` shows each building standing with its level and what it adds (`city-built`).
- `build-offer` lists the first buildings, then `Second levels`, then `Great works · a city holds one`, each a button `build-<kind>` with price, days, gain and payback, and a note when a store is full.
- `build-order` orders a project for the next day; `city-construction` then counts its days.
- `build-blocked` explains why nothing can be built (`build-blocked`).
- `build-hint` names a building in the corner and in the Advances panel when the treasury nears its limit.
- `build-recruit` names a second level on a recruit card when it would let a raise go ahead (`recruit-canal`, `recruit-barracks`).

## How to get to it (user POV)

- Click your city on the map, or its row in the Overview, and scroll the side panel to `Buildings`.
- The corner's line `Your gold nears its limit and Roma builds nothing` names a building.

## Driving it with drive.ts

Preconditions:

- `open --moment romaWithEveryBuilding`: Roma with each first building at level 1 and 20,000 gold, paused, at the widest zoom.

- **Open Roma.** `act "await support.untilDrawn(page); const at = support.cityPoint('roma'); const p = support.camera(page).screen({ x: at.x, y: at.y + 40 }); await page.mouse.click(p.x, p.y); await expect(page.getByTestId('city-name')).toHaveText('Roma'); return await page.getByTestId('city-buildings').ariaSnapshot()"`. The region `Buildings` lists five buildings at level 1, five `Second levels` buttons and three great works.
- **Order a project.** `act "const gold = await page.getByTestId('store-gold-amount').textContent(); await page.getByTestId('build-sanctuary').click(); return { gold, construction: await page.getByTestId('city-construction').textContent() }"`. `construction` is `Sanctuary · ordered for the next day`.
- **Play a day.** Use the Advances recipe's play-a-day line, returning `city-construction` and `store-gold-amount`. `construction` is `Sanctuary · 44 days left` and the gold fell by 1,750, its price, since a full treasury gains nothing a day.
- **Proof.** `shot city-project-ordered` before the day and `shot city-project-building` after.

## Gotchas

- The click 40 km south of a city's point opens the city clear of the army standing on it. It is right only at the widest zoom; after a camera move, use the Overview row.
- `Gold full`, `Food full` and `Manpower full` notes on an offer say the gain is lost now; the button stays enabled.
- Moments: `romaWithEveryBuilding`, `romaTreasuryFull`, `lawCourtsAtWork`, `mediolanumFallenWithBuildings`. `e2e/buildings.spec.ts` and the capture scenarios `buildings` and `city-projects` cover the rest.
