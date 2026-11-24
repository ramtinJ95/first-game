import { pageData } from '../src/app/page.ts';
import { warReadiness } from '../src/sim/ai/war.ts';
import { allocateId, type CityId, type FactionId, type FormationId } from '../src/sim/ids.ts';
import { nameNewArmy } from '../src/sim/army-names.ts';
import { saveGame } from '../src/sim/save.ts';
import type { Day } from '../src/sim/state/day.ts';
import type { GameState } from '../src/sim/state/game-state.ts';
import { newWar, warKey } from '../src/sim/state/war.ts';
import { buildWorld } from '../src/sim/world/world.ts';
import { armyOf, carthage, carthageNearsWar, fallsTomorrow, map, rome } from './support.ts';

const lepcis = 'lepcis-magna' as FactionId;

const shareOf = (state: GameState) =>
  Math.round(
    Math.min(1, warReadiness(state, buildWorld(map), carthage, rome)?.readiness ?? 0) * 100,
  );

/**
 * `carthageNearsWar` on day 100 with Carthage at war with Lepcis Magna since day 90, 6,000 of
 * its men before the city and 2,000 at Carthago, which march to join them: the war holds
 * Carthage below the share it stands at without it.
 * - `warning`: on notice since day 93, so the day's warning is its first, and it names the war.
 * - `ends`: on notice since day 80 and warned on day 87, Lepcis Magna falls tomorrow and the
 *   war ends; the game last stopped for Carthage at the share it stands at once the war is
 *   over, so the line runs the game on.
 * - `climbs`: as `ends`, but the game last stopped at today's share or 92%, whichever is lower,
 *   so the end of the war brings a climb of 8 points or more and opens its stop.
 * Saved with what the page was told.
 */
export function carthageHeldByLepcis(play: 'warning' | 'ends' | 'climbs'): string {
  const state = carthageNearsWar();
  state.day = 100 as Day;
  const punic = state.factions[carthage];
  const spearmen = state.formations[armyOf(state, carthage).formations[0] as FormationId];
  const city = state.cities['lepcis-magna' as CityId];
  if (!punic || !spearmen || !city) throw new Error('no Carthage or Lepcis Magna');
  spearmen.men = 6000;
  const carthago = state.cities['carthago' as CityId];
  if (!carthago) throw new Error('no Carthago');
  const id = allocateId(state, 'army');
  const formation = allocateId(state, 'formation');
  state.armies[id] = {
    id,
    owner: carthage,
    name: nameNewArmy(state, carthage),
    formations: [formation],
    stance: 'holdTheLine',
    generalSkill: 3,
    activity: { kind: 'idle', position: { ...carthago.position } },
  };
  state.formations[formation] = {
    id: formation,
    army: id,
    troop: 'spearmen',
    men: 2000,
    morale: 1,
  };
  Reflect.deleteProperty(state.truces, warKey(carthage, lepcis));
  state.wars[warKey(carthage, lepcis)] = newWar(carthage, lepcis, 90 as Day);
  armyOf(state, carthage).activity = { kind: 'idle', position: { ...city.position } };
  if (play !== 'warning') fallsTomorrow(state, 'lepcis-magna', carthage);
  punic.noticeSince = (play === 'warning' ? 93 : 80) as Day;
  const free = structuredClone(state);
  Reflect.deleteProperty(free.wars, warKey(carthage, lepcis));
  const stop = play === 'climbs' ? Math.min(shareOf(state), 92) : shareOf(free);
  return saveGame(
    state,
    pageData({
      chronicle: [],
      camera: undefined,
      selection: undefined,
      panel: undefined,
      occupied: new Map(),
      told: new Set(
        play === 'warning' ? [] : ['threat:carthage:87', `threat-stop:carthage:87:${stop}:field`],
      ),
      weakSieges: new Map(),
    }),
  );
}
