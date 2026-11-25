# Map and fog

The map is one canvas from Iberia to the Iranian plateau. The player zooms with the wheel (about 22% a notch), drags to pan, clicks a city, army, battle or province to select it, and right-clicks to give orders. Foreign armies and battles out of the player's sight are not drawn and cannot be picked.

## Sub-features

- `map-zoom` the wheel zooms about the pointer.
- `map-pan` a drag pans; a news line moves the camera to its place.
- `map-pick` a click selects the city, army or battle under it, or the province; a click on the sea clears the selection, as does Escape.
- `fog` foreign armies out of sight are hidden, appear when they march into sight, and are deselected when they leave it.

## How to get to it (user POV)

- The map fills the page behind the panels.

## Driving it with drive.ts

Preconditions:

- `open`, at the widest zoom.

- **Zoom on Roma and pick it.** `act "const cam = support.camera(page); await cam.zoom(cam.city('roma'), 4); const at = support.cityPoint('roma'); const p = cam.screen({ x: at.x, y: at.y + 10 }); await page.mouse.click(p.x, p.y); return { city: await page.getByTestId('city-name').textContent() }"`. `city` is `Roma`, and a `shot` shows Italy filling the view.
- **Fog** _from tests_. `open --moment e2e/fog-game.ts:romeWithPunicArmyAt` and follow `e2e/fog.spec.ts`: a click where the hidden army stands selects the province, not the army.
- **Proof.** `shot` before and after the zoom.

## Gotchas

- `support.camera(page)` tracks only the moves made through it. Keep zooms, drags and the clicks after them in one `act`.
- `canvas[data-renderer]` carries `data-latest-state` and `data-drawn-state`; `support.untilDrawn(page)` waits for the map to draw the current state before a click.
- `?fog=off` and `?draw=test` change the drawing; leave them out for a player's view.
- Moments: `e2e/fog-game.ts` (`plainGame`, `romeWithPunicArmyAt`, `romeSees`, `romeSeesArmy`). Capture scenarios: `zooms`, `map`, `italy`, `fog`, `paused-inputs`.
