import { map, pause, startGame } from '../../../e2e/support.ts';
import { decideAll } from '../../../src/sim/ai/decide.ts';
import { FIRST_LEVELS } from '../../../src/sim/buildings/buildings.ts';
import type { GameState } from '../../../src/sim/state/game-state.ts';
import { tick } from '../../../src/sim/tick.ts';
import { TROOPS } from '../../../src/sim/troops.ts';
import { buildWorld } from '../../../src/sim/world/world.ts';
import { currentHelpers, withBaseline } from '../baseline.ts';
import { defineScenario } from '../scenario.ts';

const BEFORE = 'bfb56179a57b5878f26bd297cc0420a30e2e889c';

/**
 * The state with only the first levels of buildings, the only kinds the pinned build's saves
 * hold. Buildings draw nothing on the atlas, so its picture is the same.
 */
function withFirstLevelsOnly(state: GameState): GameState {
  const known = new Set<string>(FIRST_LEVELS);
  const copy = structuredClone(state);
  for (const city of Object.values(copy.cities)) {
    city.buildings = city.buildings.filter((kind) => known.has(kind));
    if (city.construction && !known.has(city.construction.building)) city.construction = null;
  }
  return copy;
}

/** The state as the pinned build can load it, which knows only the shared troops: each power's own as the troop it resembles. */
function sharedTroopsOnly(state: GameState): GameState {
  const shared = structuredClone(state);
  const plain = (troop: keyof typeof TROOPS) => TROOPS[troop].signature?.resembles ?? troop;
  for (const formation of Object.values(shared.formations))
    formation.troop = plain(formation.troop);
  for (const city of Object.values(shared.cities))
    for (const recruit of city.recruits) recruit.troop = plain(recruit.troop);
  return shared;
}

export default defineScenario({
  name: 'atlas-ownership',
  title:
    'The full atlas on day 1 and ten years in: the same seeded games before and after the ownership change',
  async run({ page, shot }) {
    const opening = startGame();
    const world = buildWorld(map);
    let decade = opening;
    for (let i = 0; i < 3650; i++) decade = tick(decade, decideAll(decade, world, []), world).state;
    // Observe the same surviving power at both dates; every power actually played.
    const observer = Object.values(decade.factions).find(
      (f) => f.kind === 'greatPower' && f.defeatedOn == null,
    );
    if (!observer) throw new Error('ten-year campaign has no surviving power');
    opening.player = observer.id;
    decade.player = observer.id;
    const views = async (stage: string, base = '', helpers = currentHelpers) => {
      await helpers.openGame(page, { base });
      await pause(page);
      for (const [name, state] of [
        ['opening', opening],
        ['ten-years', decade],
      ] as const) {
        await helpers.loadSave(page, base ? sharedTroopsOnly(withFirstLevelsOnly(state)) : state);
        await helpers.untilDrawn(page);
        await page.locator('canvas[data-terrain="ready"]').waitFor();
        await shot(
          `${stage}-${name}`,
          `${stage}: the widest zoom as ${observer.id}, ${name === 'opening' ? 'day 1' : 'ten years in'}, seed 1 with every power under the AI; the player’s land outlined first`,
        );
      }
    };
    await withBaseline(BEFORE, (base, helpers) => views('before', base, helpers));
    await views('after');
  },
});
