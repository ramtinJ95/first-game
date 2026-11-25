# City panel

A click on a city opens its panel: owner, rank, people, walls, garrison, food, gold and harvest, and calm or unrest. Your own city adds guards, trade, raising and buildings, which have their own files, and evacuation. A foreign city offers `Declare war on <owner>`. A city you take asks you to choose its fate.

## Sub-features

- `city-facts` `city-name`, `city-rank`, `city-owner`, `city-population`, `city-walls`, `city-garrison`, `city-food`, `city-gold-balance`, `city-food-balance`, `city-unrest`; when they apply, `city-minor`, `city-leaving`, `city-sacked` and `city-siege`.
- `city-evacuate` `Evacuate`: `Share of the people`, `Destination`, `Evacuate <n> people`. The next day the people leave as a column on the map, `city-leaving` reads `<n> of its people are on the road to <city>`, and the corner says `<n> people left <city> for <city>`.
- `city-declare` `war-status` with `Declare war on <owner>`, then `Confirm war` or `Cancel`. The war begins with the next day.
- `city-fate` the dialog `fate-prompt`, `<city> has fallen to you`, with `fate-occupy`, `fate-sack`, `fate-enslave`; in the panel, `Occupy`, `Sack for <n> gold`, `Enslave <n> people`.

## How to get to it (user POV)

- Click a city on the map, or your city's row in the Overview.

## Driving it with drive.ts

Preconditions:

- `open`, at the widest zoom.

- **Facts.** `act "const at = support.cityPoint('roma'); const p = support.camera(page).screen({ x: at.x, y: at.y + 40 }); await page.mouse.click(p.x, p.y); return await page.getByTestId('city-panel').ariaSnapshot()"`. The region `City` reads Roma's facts.
- **Declare war.** `open`, pause, and click `mediolanum` the same way. `act "const w = page.getByTestId('war-status'); await w.getByRole('button', { name: 'Declare war on Mediolanum' }).click(); await w.getByRole('button', { name: 'Confirm war' }).click(); return await w.innerText()"` returns `War on Mediolanum is declared and begins with the next day`, and the Wars button still reads `Wars 0`. After `play` of one day, `war-status` reads `At war with Mediolanum since Year 1, day <d>` and the button `Wars 1`.
- **Fate.** `open --moment mediolanumFallsTomorrow`, then `play --until-day 5`. It returns on day 2 with `decision` `{ testid: 'fate-prompt', name: 'Mediolanum has fallen to you' }`. `act "await page.getByTestId('fate-occupy').click(); return await page.getByTestId('fate-prompt').isVisible()"` returns `false`, and `play --until-day 5` then reaches day 5.
- **Evacuate.** `open`, pause, open Roma as in Facts, then `act "const panel = page.getByTestId('city-panel'); await panel.getByLabel('Share of the people').selectOption('0.1'); await panel.getByLabel('Destination').selectOption({ label: 'Capua' }); const b = panel.getByRole('button', { name: /^Evacuate [\\d,]+ people$/ }); const name = await b.textContent(); await b.click(); return name"`. It returns `Evacuate 4,002 people` from Roma's 40,026, and the population holds until the next day. Two days on it reads `36,032` and `city-leaving` reads `4,002 of its people are on the road to Capua`.
- **Proof.** `shot` each panel.

## Gotchas

- Click 40 km south of the city's point to miss an army on the symbol.
- Moments: `mediolanumFallsTomorrow`, `romaFallsTomorrow`, `refugeesToCapua` (a column already on the road), `sackedMediolanum`. Specs: `panels`, `prompts`, `frame`. Capture scenarios: `taken-city`, `prompts`, `column`.
