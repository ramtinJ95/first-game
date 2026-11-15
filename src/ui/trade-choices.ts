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

/** One open way to a partner: its quote, the risks on that way, and the gold still lacking. */
export interface TradeWay {
  readonly quote: TradeForecast;
  readonly risks: readonly TradeRisk[];
  /** Gold the player still lacks for this way, 0 when it is affordable. */
  readonly short: number;
}

/**
 * One row of the partner list: a city that would agree today, with each open way there
 * cheapest to repay first, or a city that would not, with the rules' reason.
 */
export type TradeChoice =
  | { readonly kind: 'open'; readonly city: DeepReadonly<City>; readonly ways: readonly TradeWay[] }
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
      const ways = MODES.flatMap((mode, i): TradeWay[] => {
        const quote = problems[i] ? undefined : tradeForecast(state, world, from, to, mode);
        if (!quote) return [];
        const road = mode === 'land' ? quote.path : undefined;
        const risks = tradeRisk(state, sight, [from, to], road);
        return [{ quote, risks, short: Math.max(0, quote.cost - gold) }];
      }).sort((a, b) => years(a.quote) - years(b.quote) || a.quote.cost - b.quote.cost);
      if (!ways.length)
        return { kind: 'closed', city: to, reason: refusal(world, from, to, problems) };
      return { kind: 'open', city: to, ways };
    });
  const open = rows.filter((row) => row.kind === 'open');
  const closed = rows.filter((row) => row.kind === 'closed');
  return [
    ...open.sort((a, b) => {
      const [x, y] = [a.ways[0], b.ways[0]];
      if (!x || !y) return 0;
      return (
        years(x.quote) - years(y.quote) ||
        Number(x.short > 0) - Number(y.short > 0) ||
        x.risks.length - y.risks.length ||
        x.quote.days - y.quote.days ||
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
  return `${NO_ROAD}, and ${noPort ? `${noPort.name} has no port` : NO_LANE}`;
}

const NO_ROAD = `no land road within ${whole(TRADE_RANGE.land)} km`;
const NO_LANE = `no sea lane within ${whole(TRADE_RANGE.sea)} km`;
