import type { Alert } from '../src/app/alerts.ts';
import { pageData } from '../src/app/page.ts';
import { warReadiness } from '../src/sim/ai/war.ts';
import { GUARD_BAND, GUARD_DAYS, GUARD_DETER_DAYS } from '../src/sim/guards.ts';
import type { CityId, FormationId } from '../src/sim/ids.ts';
import { saveGame } from '../src/sim/save.ts';
import type { Day } from '../src/sim/state/day.ts';
import { buildWorld } from '../src/sim/world/world.ts';
import { armyOf, carthage, carthageNearsWar, map, rome } from './support.ts';

/**
 * `carthageNearsWar` with 5,600 Carthaginians on day 100, on notice since day 60 and warned on
 * day 70, when the game stopped for it at `stoppedAt` points below its share today, and Roma
 * holding `bands` bands hired on day 11, which Carthage counts until day 101: saved with what
 * the page was told. At 5,600 Carthage stands near 95% once the bands stop counting, so it does
 * not declare in the days the scenario plays.
 */
export function carthageClimbs(
  stoppedAt: number,
  bands: number,
  chronicle: readonly Alert[] = [],
): string {
  const state = carthageNearsWar();
  state.day = 100 as Day;
  const punic = state.factions[carthage];
  const roma = state.cities['roma' as CityId];
  if (!punic || !roma) throw new Error('no Carthage or Roma');
  punic.noticeSince = 60 as Day;
  const spearmen = state.formations[armyOf(state, carthage).formations[0] as FormationId];
  if (!spearmen) throw new Error('no Carthaginian army');
  spearmen.men = 5600;
  roma.guards = Array.from({ length: bands }, () => ({
    until: (101 - GUARD_DETER_DAYS + GUARD_DAYS) as Day,
  }));
  roma.garrison += bands * GUARD_BAND;
  const after = structuredClone(state);
  const bare = after.cities['roma' as CityId];
  if (!bare) throw new Error('no Roma');
  bare.guards = [];
  bare.garrison -= bands * GUARD_BAND;
  const share = Math.round(
    Math.min(1, warReadiness(after, buildWorld(map), carthage, rome)?.readiness ?? 0) * 100,
  );
  return saveGame(
    state,
    pageData({
      chronicle,
      camera: undefined,
      selection: undefined,
      panel: undefined,
      occupied: new Map(),
      told: new Set(['threat:carthage:70', `threat-stop:carthage:70:${share - stoppedAt}:roma`]),
      weakSieges: new Map(),
    }),
  );
}
