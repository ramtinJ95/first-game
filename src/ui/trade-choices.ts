import type { DeepReadonly } from '../sim/deep-readonly.ts';
import type { Sight } from '../sim/sight.ts';
import type { City } from '../sim/state/city.ts';
import type { GameState } from '../sim/state/game-state.ts';
import {
  TRADE_RANGE,
  tradeForecast,
  tradeProblem,
  type TradeForecast,
  type TradeMode,
} from '../sim/trade/routes.ts';
import type { World } from '../sim/world/world.ts';
import { whole } from '../app/names.ts';
import { tradeRisk, type TradeRisk } from './trade-risk.ts';

type State = DeepReadonly<GameState>;

/**
 * One row of the partner list: a city that would agree today, with each open way there
 * cheapest to repay first, or a city that would not, with the rules' reason.
 */
export type TradeChoice =
  | {
      readonly kind: 'open';
      readonly city: DeepReadonly<City>;
      readonly quotes: readonly TradeForecast[];
      readonly risks: readonly TradeRisk[];
      /** Gold the player still lacks for the first quote, 0 when it is affordable. */
      readonly short: number;
    }
  | { readonly kind: 'closed'; readonly city: DeepReadonly<City>; readonly reason: string };

const MODES: readonly TradeMode[] = ['land', 'sea'];

/** The cities the player's `from` could trade with, those that agree first by payback. */
export function tradeChoices(
  state: State,
  world: World,
  sight: Sight,
  from: DeepReadonly<City>,
): TradeChoice[] {
  const gold = state.factions[state.player]?.stores.gold ?? 0;
  const rows = Object.values(state.cities)
    .filter((to) => to.id !== from.id)
    .map((to): TradeChoice => {
      const problems = MODES.map((mode) =>
        tradeProblem(state, world, state.player, from.id, to.id, mode, false),
      );
      const quotes = MODES.flatMap((mode, i) => {
        const quote = problems[i] ? undefined : tradeForecast(state, world, from, to, mode);
        return quote ? [quote] : [];
      }).sort((a, b) => years(a) - years(b) || a.cost - b.cost);
      const [best] = quotes;
      if (!best) return { kind: 'closed', city: to, reason: refusal(world, from, to, problems) };
      return {
        kind: 'open',
        city: to,
        quotes,
        risks: tradeRisk(state, sight, [from, to], best.mode === 'land' ? best.path : undefined),
        short: Math.max(0, best.cost - gold),
      };
    });
  const open = rows.filter((row) => row.kind === 'open');
  const closed = rows.filter((row) => row.kind === 'closed');
  return [
    ...open.sort((a, b) => {
      const [x, y] = [a.quotes[0], b.quotes[0]];
      return (
        (x && y ? years(x) - years(y) : 0) ||
        Number(a.short > 0) - Number(b.short > 0) ||
        a.risks.length - b.risks.length ||
        (x && y ? x.days - y.days : 0) ||
        a.city.name.localeCompare(b.city.name)
      );
    }),
    ...closed.sort((a, b) => a.city.name.localeCompare(b.city.name)),
  ];
}

/**
 * Payback as the list shows it, to a tenth of a year: unlike goods all repay in about the
 * same time, so a closer tie is settled by what the player can afford, the risk, and how
 * soon the first cargo arrives.
 */
const years = (quote: TradeForecast) => Math.round((quote.paybackDays / 365) * 10);

/**
 * Every check but the path is the same by land and by sea, so two different reasons are
 * two missing paths, told together with the port a sea route lacks.
 */
function refusal(
  world: World,
  from: DeepReadonly<City>,
  to: DeepReadonly<City>,
  [land, sea]: (string | undefined)[],
): string {
  if (land === sea) return land ?? 'no trade path joins these cities';
  const noPort = [from, to].find((city) => !world.harbours.has(city.id));
  const bySea = noPort
    ? `${noPort.name} has no port`
    : `no sea lane within ${whole(TRADE_RANGE.sea)} km`;
  return `no land road within ${whole(TRADE_RANGE.land)} km, and ${bySea}`;
}
