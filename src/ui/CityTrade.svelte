<script lang="ts">
  import type { DeepReadonly } from '../sim/deep-readonly.ts';
  import type { CityId } from '../sim/ids.ts';
  import type { Order } from '../sim/orders/orders.ts';
  import { afterWaiting } from './buildings-text.ts';
  import { tradeCaution } from './trade-caution.ts';
  import type { City } from '../sim/state/city.ts';
  import type { GameState } from '../sim/state/game-state.ts';
  import {
    freeSlots,
    routeSlots,
    routesAt,
    tradeForecast,
    tradeProblem,
    tradeConsent,
    type TradeMode,
  } from '../sim/trade/routes.ts';
  import type { World } from '../sim/world/world.ts';
  import type { Actions } from './actions.ts';
  let {
    game,
    world,
    city,
    pending,
    actions,
  }: {
    game: DeepReadonly<GameState>;
    world: World;
    city: DeepReadonly<City>;
    pending: readonly Order[];
    actions: Actions;
  } = $props();
  let chosen = $state<CityId | undefined>();
  let mode = $state<TradeMode>('land');
  const own = $derived(city.owner === game.player);
  const waiting = $derived(afterWaiting(game, pending, world));
  const destinations = $derived(
    Object.values(game.cities)
      .filter((c) => c.id !== city.id)
      .sort((a, b) => a.name.localeCompare(b.name)),
  );
  const to = $derived(destinations.find((c) => c.id === chosen) ?? destinations[0]);
  const forecast = $derived(to && tradeForecast(waiting, world, city, to, mode));
  const why = $derived(
    to ? tradeProblem(waiting, world, game.player, city.id, to.id, mode) : 'No other city',
  );
  const consent = $derived(to && tradeConsent(waiting, world, city, to));
  const caution = $derived(to && tradeCaution(waiting, city, to));
  const routes = $derived(routesAt(waiting, city.id));
  const good = (id: CityId) => {
    const at = game.cities[id];
    return at && game.provinces[at.province]?.good;
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
    <li>
      <strong>{other?.name}</strong> · {route.mode === 'land' ? 'caravan' : 'ship'} ·
      {#if route.status === 'offered'}
        Awaiting your consent · {route.daily.toFixed(1)} gold a day at each end before administration.
        {#if own && route.partner === game.player}
          <p>
            {game.factions[route.owner]?.name} pays {route.cost} gold. Uses one of your slots. No cost
            to accept.
          </p>
          <button
            type="button"
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
        {/if}
      {:else}
        {route.blocked
          ? `Interrupted by ${route.blocked}`
          : route.departsOn > game.day
            ? `New cargo departs in ${route.departsOn - game.day} days`
            : `${Math.ceil((1 - route.progress) * route.days)} days to arrival`} ·
        <span data-testid="trade-deliveries">{route.deliveries} deliveries</span>
        {#if own}<button
            type="button"
            onclick={() =>
              actions.issue({ kind: 'closeTrade', faction: game.player, route: route.id })}
            >Close route</button
          >{/if}
      {/if}
    </li>
  {/each}
</ul>
{#if own && to}
  <label
    >Trade partner
    <select
      aria-label="Trade partner"
      value={to.id}
      onchange={(e) => (chosen = e.currentTarget.value as CityId)}
    >
      {#each destinations as destination (destination.id)}<option value={destination.id}
          >{destination.name} · {good(destination.id)}</option
        >{/each}
    </select>
  </label>
  <select aria-label="Trade transport" bind:value={mode}
    ><option value="land">By land</option><option value="sea">By sea</option></select
  >
  {#if forecast}
    <p data-testid="trade-forecast">
      {good(city.id)} ↔ {good(to.id)} · {forecast.different
        ? 'unlike goods earn 80% more'
        : 'same goods'} · {Math.round(forecast.km)} km by {mode} · {forecast.days} days a crossing.
    </p>
    <p>
      Each arrival pays {city.name}
      {(forecast.fromDaily * forecast.days).toFixed(1)} gold and {to.name}
      {(forecast.toDaily * forecast.days).toFixed(1)} gold ({forecast.fromDaily.toFixed(1)} and {forecast.toDaily.toFixed(
        1,
      )} a day). Distance raises the price of goods.
    </p>
    <p>
      Open for {forecast.cost} gold · pays back in {(forecast.paybackDays / 365).toFixed(1)} years. No
      refund on closing.
    </p>
    <p data-testid="trade-consent">
      {to.owner === game.player
        ? 'Both ends are yours; no foreign consent needed.'
        : `Consent: ${game.factions[to.owner]?.name} ${consent ? `cannot agree: ${consent}` : 'agrees: peaceful, profitable, and a free slot'}.`}
    </p>
    {#if caution}<p class="muted" data-testid="trade-caution">{caution}</p>{/if}
  {/if}
  {#if why}<p class="bad" data-testid="trade-refusal">{why}</p>{/if}
  <button
    type="button"
    disabled={!!why}
    onclick={() =>
      actions.issue({ kind: 'openTrade', faction: game.player, from: city.id, to: to.id, mode })}
    >Open trade route</button
  >
  <p class="muted">
    War closes a partner's routes. Armies raid roads; sieges stop either end, including ships.
    Offshore fleets come later.
  </p>
{/if}

<style>
  select {
    max-width: 100%;
  }
  ul {
    padding-left: 1em;
  }
  li {
    margin-bottom: 6px;
  }
</style>
