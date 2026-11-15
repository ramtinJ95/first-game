<script lang="ts">
  import { dateText, reasonText, whole } from '../app/names.ts';
  import type { DeepReadonly } from '../sim/deep-readonly.ts';
  import type { CityId, TradeRouteId } from '../sim/ids.ts';
  import type { Order } from '../sim/orders/orders.ts';
  import type { Sight } from '../sim/sight.ts';
  import type { City } from '../sim/state/city.ts';
  import type { GameState } from '../sim/state/game-state.ts';
  import { adminShareOf } from '../sim/systems/economy.ts';
  import {
    freeSlots,
    routeSlots,
    routesAt,
    TRADE_INVITATION_DAYS,
    tradeConsent,
    tradeProblem,
    type TradeForecast,
    type TradeMode,
  } from '../sim/trade/routes.ts';
  import type { World } from '../sim/world/world.ts';
  import type { Actions } from './actions.ts';
  import { afterWaiting } from './buildings-text.ts';
  import { tradeCaution } from './trade-caution.ts';
  import { tradeChoices, type TradeChoice } from './trade-choices.ts';
  import { closeText } from './trade-ledger.ts';
  import { paybackText, riskMark, riskText, tradeRisk } from './trade-risk.ts';
  let {
    game,
    world,
    city,
    sight,
    pending,
    actions,
  }: {
    game: DeepReadonly<GameState>;
    world: World;
    city: DeepReadonly<City>;
    sight: Sight;
    pending: readonly Order[];
    actions: Actions;
  } = $props();
  let chosen = $state<{ city: CityId; mode: TradeMode } | undefined>();
  let closing = $state<TradeRouteId | undefined>();
  const own = $derived(city.owner === game.player);
  const waiting = $derived(afterWaiting(game, pending, world));
  const choices = $derived(own ? tradeChoices(waiting, world, sight, city) : []);
  const agreeing = $derived(
    choices.filter((row): row is Extract<TradeChoice, { kind: 'open' }> => row.kind === 'open'),
  );
  const refusing = $derived(
    choices.filter((row): row is Extract<TradeChoice, { kind: 'closed' }> => row.kind === 'closed'),
  );
  const pick = $derived.by(() => {
    const row = agreeing.find((r) => r.city.id === chosen?.city) ?? agreeing[0];
    const quote = row?.quotes.find((q) => q.mode === chosen?.mode) ?? row?.quotes[0];
    return row && quote ? { to: row.city, quote } : undefined;
  });
  const risks = $derived(
    pick
      ? tradeRisk(
          waiting,
          sight,
          [city, pick.to],
          pick.quote.mode === 'land' ? pick.quote.path : undefined,
        )
      : [],
  );
  const why = $derived(
    pick && tradeProblem(waiting, world, game.player, city.id, pick.to.id, pick.quote.mode),
  );
  const consent = $derived(pick && tradeConsent(waiting, world, city, pick.to));
  const caution = $derived(pick && tradeCaution(waiting, city, pick.to));
  const routes = $derived(routesAt(waiting, city.id));
  const share = $derived(adminShareOf(waiting, game.player));
  const good = (id: CityId) => {
    const at = game.cities[id];
    return at && game.provinces[at.province]?.good;
  };
  const years = (quote: TradeForecast) => (quote.paybackDays / 365).toFixed(1);
  const choose = (to: CityId, mode: TradeMode) => (chosen = { city: to, mode });
  const routeRisks = (route: (typeof routes)[number]) => {
    const from = waiting.cities[route.from];
    const to = waiting.cities[route.to];
    return from && to
      ? tradeRisk(waiting, sight, [from, to], route.mode === 'land' ? route.path : undefined)
      : [];
  };
</script>

<h3>Trade · {game.provinces[city.province]?.good}</h3>
<p data-testid="trade-slots">
  {freeSlots(waiting, city, world)} of {routeSlots(city, world)} route slots free
</p>
<p class="muted">One slot; a city of 25,000 people, a Forum and a port each add one.</p>
<ul data-testid="trade-routes">
  {#each routes as route (route.id)}
    {@const other = game.cities[route.from === city.id ? route.to : route.from]}
    {@const risk = routeRisks(route).find((r) => !('city' in r) || r.city !== city.id)}
    <li>
      <strong>{other?.name}</strong> · {route.mode === 'land' ? 'caravan' : 'ship'} ·
      {#if route.status === 'offered'}
        Invitation awaiting your consent.
        {#if own && route.partner === game.player}
          {@const refusal = tradeProblem(
            waiting,
            world,
            route.owner,
            route.from,
            route.to,
            route.mode,
          )}
          {@const perDay = route.daily * share}
          {@const left = route.openedOn + TRADE_INVITATION_DAYS - game.day}
          <p data-testid="trade-invitation">
            {other?.name} ({good(route.from)}) invites {city.name} ({good(route.to)}) to trade by {route.mode},
            {route.days} days a crossing. Each arrival pays {city.name}
            {whole(perDay * route.days)} gold, {perDay.toFixed(1)} a day. {game.factions[
              route.owner
            ]?.name} pays the {whole(route.cost)} gold to open it. It expires on {dateText(
              route.openedOn + TRADE_INVITATION_DAYS,
            )}, in {left} days.
          </p>
          {#each routeRisks(route) as each, i (i)}<p class="muted">
              {riskText(waiting, each)}
            </p>{/each}
          {#if refusal}
            <p class="bad" data-testid="trade-accept-refusal">
              You cannot accept: {reasonText(game, refusal)}.
            </p>
          {:else}
            <p>Accepting uses one of {city.name}'s free route slots and costs you nothing.</p>
          {/if}
          <p>Refusing forgoes about {perDay.toFixed(1)} gold a day and cannot be undone.</p>
          <div class="row">
            <button
              type="button"
              disabled={!!refusal}
              title={refusal ? reasonText(game, refusal) : undefined}
              onclick={() =>
                actions.issue({ kind: 'acceptTrade', faction: game.player, route: route.id })}
              >Accept trade</button
            >
            <button
              type="button"
              onclick={() =>
                actions.issue({ kind: 'closeTrade', faction: game.player, route: route.id })}
              >Refuse trade</button
            >
          </div>
        {/if}
      {:else}
        {route.blocked
          ? `Interrupted by ${route.blocked}`
          : route.departsOn > game.day
            ? `New cargo departs in ${route.departsOn - game.day} days`
            : `${Math.ceil((1 - route.progress) * route.days)} days to arrival`} ·
        <span data-testid="trade-deliveries">{route.deliveries} deliveries</span>
        {#if risk}<p class="muted">{riskText(waiting, risk)}</p>{/if}
        {#if own && closing === route.id}
          <p data-testid="trade-close-confirm">{closeText(waiting, route)}</p>
          <div class="row">
            <button
              type="button"
              class="danger"
              onclick={() => {
                actions.issue({ kind: 'closeTrade', faction: game.player, route: route.id });
                closing = undefined;
              }}>Confirm close</button
            >
            <button type="button" onclick={() => (closing = undefined)}>Keep route</button>
          </div>
        {:else if own}
          <button type="button" onclick={() => (closing = route.id)}>Close route</button>
        {/if}
      {/if}
    </li>
  {/each}
</ul>
{#if own}
  <h4 id="trade-partners-{city.id}">Trade partners</h4>
  <p class="muted">Those that would agree now, quickest to pay back first.</p>
  <ul
    class="pick-list partners"
    data-testid="trade-partners"
    aria-labelledby="trade-partners-{city.id}"
  >
    {#each agreeing as row (row.city.id)}
      {#each row.quotes as quote, i (quote.mode)}
        {@const picked = pick?.to.id === row.city.id && pick.quote.mode === quote.mode}
        <li class:alternative={i > 0}>
          <button
            type="button"
            class="pick"
            aria-pressed={picked}
            onclick={() => choose(row.city.id, quote.mode)}
          >
            <span class="mark" class:risky={i === 0 && row.risks.length > 0} aria-hidden="true"
            ></span>
            <span class="who"
              >{i > 0 ? `or by ${quote.mode}` : `${row.city.name} by ${quote.mode}`}</span
            >
            <span class="what"
              >{i === 0 ? `${good(row.city.id)} · ` : ''}pays back in {years(quote)} years · {whole(
                quote.cost,
              )} gold{i === 0 && row.short > 0 ? ` · needs ${whole(row.short)} more` : ''}{i ===
                0 && row.risks.length
                ? ` · ${riskMark(waiting, row.risks)}`
                : ''}</span
            >
          </button>
        </li>
      {/each}
    {/each}
    {#if refusing.length}
      <li class="muted refusing">Would not agree now</li>
      {#each refusing as row (row.city.id)}
        <li class="refused">
          <strong>{row.city.name}</strong>
          <span class="muted">{reasonText(game, row.reason)}.</span>
        </li>
      {/each}
    {/if}
  </ul>
  {#if pick}
    {@const { to, quote } = pick}
    <p data-testid="trade-forecast">
      {good(city.id)} ↔ {good(to.id)} · {quote.different
        ? 'unlike goods earn 80% more'
        : 'same goods'} · {whole(quote.km)} km by {quote.mode} · {quote.days} days a crossing.
    </p>
    <p>
      Each arrival pays {city.name}
      {(quote.fromDaily * quote.days).toFixed(1)} gold and {to.name}
      {(quote.toDaily * quote.days).toFixed(1)} gold ({quote.fromDaily.toFixed(1)} and {quote.toDaily.toFixed(
        1,
      )} a day). Distance raises the price of goods.
    </p>
    <p data-testid="trade-payback">
      Open for {whole(quote.cost)} gold · {paybackText(waiting, quote.paybackDays, risks)} No refund on
      closing.
    </p>
    {#each risks.slice(1) as each, i (i)}<p class="muted" data-testid="trade-risk">
        {riskText(waiting, each)}
      </p>{/each}
    <p data-testid="trade-consent">
      {to.owner === game.player
        ? 'Both ends are yours; no foreign consent needed.'
        : `Consent: ${game.factions[to.owner]?.name} ${consent ? `cannot agree: ${consent}` : 'agrees: peaceful, profitable, and a free slot'}.`}
    </p>
    {#if caution}<p class="muted" data-testid="trade-caution">{caution}</p>{/if}
    {#if why}<p class="bad" data-testid="trade-refusal">{reasonText(game, why)}.</p>{/if}
    <button
      type="button"
      disabled={!!why}
      onclick={() =>
        actions.issue({
          kind: 'openTrade',
          faction: game.player,
          from: city.id,
          to: to.id,
          mode: quote.mode,
        })}>Open trade route to {to.name} by {quote.mode}</button
    >
  {:else}
    <p class="muted">No city would agree to trade with {city.name} now.</p>
  {/if}
  <p class="muted">
    War closes a partner's routes. Armies raid roads; sieges stop either end, including ships.
    Offshore fleets come later.
  </p>
{/if}

<style>
  ul {
    padding-left: 1em;
  }
  li {
    margin-bottom: 6px;
  }
  .partners {
    max-height: 16em;
    overflow-y: auto;
    padding: 4px 2px 4px 0;
    border-block: 1px solid rgb(122 75 42 / 30%);
  }
  .partners [aria-pressed='true'] .what {
    color: inherit;
  }
  .partners li {
    margin-bottom: 0;
  }
  .partners .alternative {
    padding-left: 16px;
  }
  .partners .refusing {
    margin-top: 6px;
    font-size: 12px;
  }
  .partners .refused {
    padding: 2px 6px;
    font-size: 12px;
  }
  .mark {
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }
  .mark.risky {
    background: var(--bad);
  }
</style>
