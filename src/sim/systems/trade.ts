import { emit } from '../events.ts';
import { removeRecord } from '../records.ts';
import type { GameState } from '../state/game-state.ts';
import type { Day } from '../state/day.ts';
import { adminShareOf, limitsOf, menOf } from './economy.ts';
import { areAtWar } from '../wars.ts';
import { distanceToRoute, RAID_KM, routePoint } from '../trade/routes.ts';

/** Sieges stand in for a sea blockade until war fleets exist; ships cannot be raided offshore. */
export function trade(state: GameState): void {
  let limits: ReturnType<typeof limitsOf> | undefined;
  const sieged = new Set(Object.values(state.sieges).map((s) => s.city));
  const armies = Object.values(state.armies);
  for (const route of Object.values(state.tradeRoutes)) {
    const from = state.cities[route.from];
    const to = state.cities[route.to];
    const cause =
      !from || !to || from.owner !== route.owner || to.owner !== route.partner
        ? 'a city changed owner'
        : areAtWar(state, route.owner, route.partner)
          ? 'war between the partners'
          : route.status === 'offered' && state.day - route.openedOn >= 90
            ? 'the invitation expired'
            : undefined;
    if (cause || !from || !to) {
      emit(state, {
        kind: 'tradeClosed',
        route: route.id,
        from: route.from,
        to: route.to,
        owners: [route.owner, route.partner],
        cause,
        position: routePoint(route),
      });
      removeRecord(state.tradeRoutes, route.id);
      continue;
    }
    if (route.status !== 'running') continue;
    const siege = sieged.has(route.from) || sieged.has(route.to);
    const raider =
      route.mode === 'land'
        ? armies.find((army) => {
            const a = army.activity;
            return (
              (a.kind === 'idle' || a.kind === 'besieging' || a.kind === 'marching') &&
              (areAtWar(state, army.owner, route.owner) ||
                areAtWar(state, army.owner, route.partner)) &&
              menOf(state, army) > 0 &&
              distanceToRoute(a.position, route) <= RAID_KM
            );
          })
        : undefined;
    const blocked = siege ? 'siege' : raider ? 'raid' : null;
    if (blocked && blocked !== route.blocked) {
      const position =
        raider && 'position' in raider.activity ? raider.activity.position : from.position;
      emit(state, {
        kind: 'tradeRaided',
        route: route.id,
        from: route.from,
        to: route.to,
        owners: [route.owner, route.partner],
        cause: blocked,
        position: { ...position },
      });
      const looter = raider && state.factions[raider.owner];
      if (looter && state.day >= route.departsOn) {
        looter.stores.gold += route.daily * route.days;
        route.departsOn = (state.day + route.days) as Day;
      }
      route.progress = 0;
    }
    route.blocked = blocked;
    if (blocked || state.day < route.departsOn) continue;
    route.progress = Math.min(1, route.progress + 1 / route.days);
    if (route.progress < 1 - 1e-9) continue;
    for (const owner of [route.owner, route.partner]) {
      const faction = state.factions[owner];
      limits ??= limitsOf(state);
      const limit = limits.get(owner);
      if (!faction || !limit) throw new Error(`trade ${route.id} has no treasury for ${owner}`);
      const pay = route.daily * route.days * adminShareOf(state, owner);
      faction.stores.gold = Math.max(
        faction.stores.gold,
        Math.min(limit.gold, faction.stores.gold + pay),
      );
    }
    route.deliveries++;
    route.progress = 0;
    route.returning = !route.returning;
  }
}
