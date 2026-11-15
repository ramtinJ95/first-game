import { emit } from '../events.ts';
import type { GameState } from '../state/game-state.ts';
import type { Day } from '../state/day.ts';
import type { FactionId } from '../ids.ts';
import { adminShareOf, limitsOf, menOf } from './economy.ts';
import { warSides } from '../state/war.ts';
import { closeRoute, distanceToRoute, RAID_KM, TRADE_INVITATION_DAYS } from '../trade/routes.ts';

/** Sieges stand in for a sea blockade until war fleets exist; ships cannot be raided offshore. */
export function trade(state: GameState): void {
  let limits: ReturnType<typeof limitsOf> | undefined;
  const sieged = new Set(Object.values(state.sieges).map((s) => s.city));
  const armies = Object.values(state.armies);
  const routes = Object.values(state.tradeRoutes);
  const ends = new Set(routes.flatMap((r) => [r.owner, r.partner]));
  // Read the few actual wars, not the Cartesian product of endpoints and army owners.
  const threats = new Map<FactionId, Set<FactionId>>();
  for (const end of ends) threats.set(end, new Set());
  for (const key of Object.keys(state.wars)) {
    const pair = warSides(key);
    if (!pair) throw new Error(`trade encountered invalid war key ${key}`);
    const [a, b] = pair;
    threats.get(a)?.add(b);
    threats.get(b)?.add(a);
  }
  for (const route of routes) {
    const from = state.cities[route.from];
    const to = state.cities[route.to];
    const cause =
      !from || !to || from.owner !== route.owner || to.owner !== route.partner
        ? 'a city changed owner'
        : threats.get(route.owner)?.has(route.partner)
          ? 'war between the partners'
          : route.status === 'offered' && state.day - route.openedOn >= TRADE_INVITATION_DAYS
            ? 'the invitation expired'
            : undefined;
    if (cause || !from || !to) {
      closeRoute(state, route, cause ?? 'a city changed owner');
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
              (threats.get(route.owner)?.has(army.owner) ||
                threats.get(route.partner)?.has(army.owner)) &&
              menOf(state, army) > 0 &&
              distanceToRoute(a.position, route) <= RAID_KM
            );
          })
        : undefined;
    const blocked = siege ? 'siege' : raider ? 'raid' : null;
    if (blocked && blocked !== route.blocked) {
      const base = {
        kind: 'tradeRaided',
        route: route.id,
        from: route.from,
        to: route.to,
        owners: [route.owner, route.partner],
      } as const;
      const looter = raider && state.factions[raider.owner];
      const looted = looter && state.day >= route.departsOn ? route.daily * route.days : 0;
      if (blocked === 'siege') {
        const at = sieged.has(route.from) ? from : to;
        emit(state, { ...base, cause: 'siege', position: { ...at.position } });
      }
      // A raider beside a siege still takes the cargo, so the theft has its own event.
      if (raider && 'position' in raider.activity && (blocked === 'raid' || looted > 0))
        emit(state, {
          ...base,
          cause: 'raid',
          raider: raider.owner,
          looted,
          position: { ...raider.activity.position },
        });
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
