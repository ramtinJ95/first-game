# City panel

A click on a city opens its panel: owner, rank, people, walls, garrison, food, gold and harvest, and calm or unrest. Your own city adds guards, trade, raising and buildings, which have their own files, and evacuation. A foreign city offers `Declare war on <owner>`. A city you take asks you to choose its fate.

## Sub-features

- `city-facts` `city-name`, `city-rank`, `city-owner`, `city-population`, `city-walls`, `city-garrison`, `city-food`, `city-gold-balance`, `city-food-balance`, `city-unrest`.
- `city-evacuate` `Evacuate`: `Share of the people`, `Destination`, `Evacuate <n> people`, then a column on the map.
- `city-declare` `war-status` with `Declare war on <owner>`, then `Confirm war` or `Cancel`.
- `city-fate` the dialog `fate-prompt`, `<city> has fallen to you`, with `fate-occupy`, `fate-sack`, `fate-enslave`; in the panel, `Occupy`, `Sack for <n> gold`, `Enslave <n> people`.

## How to get to it (user POV)

- Click a city on the map, or your city's row in the Overview.

## Driving it with drive.ts

Preconditions:

- `open`, at the widest zoom.

- **Facts.** `act "const at = support.cityPoint('roma'); const p = support.camera(page).screen({ x: at.x, y: at.y + 40 }); await page.mouse.click(p.x, p.y); return await page.getByTestId('city-panel').ariaSnapshot()"`. The region `City` reads Roma's facts.
- **Declare war** _from tests_. Click `mediolanum` the same way, then `Declare war on <owner>` and `Confirm war`; the Wars button counts one war.
- **Fate.** `open --moment mediolanumFallsTomorrow`, then `play --until-day 5`. It returns on day 2 with `decision` `{ testid: 'fate-prompt', name: 'Mediolanum has fallen to you' }`. `act "await page.getByTestId('fate-occupy').click(); return await page.getByTestId('fate-prompt').isVisible()"` returns `false`, and `play --until-day 5` then reaches day 5.
- **Evacuate** _from tests_. `open --moment refugeesToCapua` and follow `e2e/panels.spec.ts`.
- **Proof.** `shot` each panel.

## Gotchas

- Click 40 km south of the city's point to miss an army on the symbol.
- Moments: `mediolanumFallsTomorrow`, `romaFallsTomorrow`, `refugeesToCapua`, `sackedMediolanum`. Specs: `panels`, `prompts`, `frame`. Capture scenarios: `taken-city`, `prompts`, `column`.
