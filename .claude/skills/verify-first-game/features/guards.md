# Guards

A city can hire 500 guards for a year for 2,000 gold. They hold the walls all year, but a great power counts a band against a war only for its first 90 days. The Guards section says how a power on notice stands, and what one more band would do. Ten days before a band stops counting, the corner says so.

## Sub-features

- `guards-hire` hires a band for the next day: `Hire 500 guards for a year · 2,000 gold`, with the garrison before and after.
- `guards-line` shows the bands held and the day each leaves: `500 guards · 500 leave Year 2, day 8`.
- `guards-weighed` shows until when they count against a war, or `None count against a war now`.
- `guards-threat` shows the share a power on notice holds now, and with one more band.
- `guards-ahead` puts a line in the corner ten days before a counted band stops counting, without stopping the game.
- `guards-left` tells in the corner when a band has served its year.

## How to get to it (user POV)

- Your city's panel, section `Guards`.
- A war-threat warning names guards at the city it weighs, and `See At peace in Wars`.

## Driving it with drive.ts

Preconditions:

- `open --moment carthageNearsWar`: Rome at peace on day 1, with Carthage near the strength to declare war against Roma. Pauses on.

- **Reach the warning.** `play --until-text 'could soon declare war on you'`. It pauses on day 8.
- **Read and hire.** `act "await support.untilDrawn(page); const at = support.cityPoint('roma'); const p = support.camera(page).screen({ x: at.x, y: at.y + 40 }); await page.mouse.click(p.x, p.y); const g = page.getByTestId('city-guards'); await g.scrollIntoViewIfNeeded(); const before = await g.ariaSnapshot(); const gold = await page.getByTestId('store-gold-amount').textContent(); await page.getByTestId('guards-hire').click(); await expect(page.getByTestId('guards-line')).toContainText('500 more hired for the next day'); return { before, gold, threat: await page.getByTestId('guards-threat').textContent() }"`. `before` says `No guards hired` and that one more band takes Carthage below 80%.
- **Play a day.** The Advances recipe's play-a-day line, returning `guards-line`, `guards-weighed`, `city-garrison` and the gold. `500 guards · 500 leave Year 2, day 8`, `500 count against a war until Year 1, day 98`, garrison `3,500 of 3,500`, and 2,000 gold less one day's change.
- **The line ten days ahead.** `act "await page.keyboard.press('Escape')"`, then `play --until-text 'stop counting against'`. It stops on day 88, with no new stop listed, and the corner reads `The 500 guards at Roma stop counting against Carthage's war in 10 days, on Year 1, day 98: it would then stand at 92%. A new band counts 90 days, for 2,000 gold.`
- **Proof.** `shot` after the hire, after the day, and at day 88.

## Gotchas

- At day 88 of this moment Rome's food has run out and men desert. That is the moment, not the guards.
- `guards-threat` changes its wording once a band is hired for the next day (`78% → 69%`); read it after the day for the standing share.
- Moments: `romaTreasuryFull` (no threat), `romaBandLeavesTomorrow` (the band leaves), `carthageNearsWar`. The capture scenarios `guards` and `guards-replaced` show the rest.
