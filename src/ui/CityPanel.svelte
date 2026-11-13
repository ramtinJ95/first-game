<script lang="ts">
  import type { Occupied } from '../app/alerts.ts';
  import { factionName, TROOP_NAMES, whole } from '../app/names.ts';
  import { ENSLAVE, FATE_DAYS, SACK } from '../sim/cities.ts';
  import type { DeepReadonly } from '../sim/deep-readonly.ts';
  import type { CityId } from '../sim/ids.ts';
  import type { GameMap } from '../sim/map.ts';
  import type { Order } from '../sim/orders/orders.ts';
  import type { Sight } from '../sim/sight.ts';
  import type { City } from '../sim/state/city.ts';
  import type { GameState } from '../sim/state/game-state.ts';
  import { OUTPUT_PER_PERSON } from '../sim/systems/economy.ts';
  import { CITY_DEFENCES } from '../sim/systems/sieges.ts';
  import { TROOPS, type Troop } from '../sim/troops.ts';
  import type { Actions } from './actions.ts';
  import ArmiesHere from './ArmiesHere.svelte';
  import {
    armiesAt,
    cityBalance,
    cityFoodText,
    cssColour,
    ownerLine,
    rankText,
    sackText,
    signed,
    stormText,
    weakSiegeText,
  } from './describe.ts';
  import WarStatus from './WarStatus.svelte';

  let {
    game,
    map,
    city,
    sight,
    pending,
    occupied,
    actions,
  }: {
    game: DeepReadonly<GameState>;
    map: DeepReadonly<GameMap>;
    city: DeepReadonly<City>;
    sight: Sight;
    pending: readonly Order[];
    occupied: Occupied;
    actions: Actions;
  } = $props();

  const SHARES = [0.1, 0.25, 0.5] as const;

  let share = $state<number>(0.25);
  let chosen = $state<CityId | undefined>();
  let storming = $state(false);

  const own = $derived(city.owner === game.player);
  const full = $derived(CITY_DEFENCES[city.rank]);
  // A siege the player cannot see is not shown: its besiegers stand out of sight.
  const siege = $derived(
    Object.values(game.sieges).find(
      (s) => s.city === city.id && s.besiegers.some((id) => sight.armies.has(id)),
    ),
  );
  const besiegers = $derived(
    siege?.besiegers.flatMap((id) => (sight.armies.has(id) ? (game.armies[id] ?? []) : [])) ?? [],
  );
  const weak = $derived(siege && weakSiegeText(game, sight, siege));
  const stormed = $derived(storming && siege ? stormText(game, siege) : undefined);
  const sacked = $derived(sackText(game, city));
  const canStorm = $derived(besiegers.some((army) => army.owner === game.player));
  const ordered = $derived(
    pending.filter(
      (order): order is Extract<Order, { kind: 'recruit' }> =>
        order.kind === 'recruit' && order.faction === game.player,
    ),
  );
  const raising = $derived([
    ...city.recruits.map((recruit) => ({
      troop: recruit.troop,
      when: `${Math.max(0, recruit.readyOn - game.day)} days left`,
    })),
    ...ordered
      .filter((order) => order.city === city.id)
      .map((order) => ({ troop: order.troop, when: 'ordered for the next day' })),
  ]);

  /** What the player has left once the recruits waiting for the next day are paid. */
  const available = $derived.by(() => {
    const stores = game.factions[game.player]?.stores ?? { gold: 0, manpower: 0 };
    let gold = stores.gold;
    let manpower = stores.manpower;
    for (const order of ordered) {
      gold -= TROOPS[order.troop].recruit.gold;
      manpower -= TROOPS[order.troop].recruit.men;
    }
    return { gold, manpower };
  });

  function refusal(troop: Troop): string | undefined {
    const { gold, men } = TROOPS[troop].recruit;
    if (city.unrestDays > 0) return `In unrest for ${city.unrestDays} more days`;
    if (available.gold < gold) return `Needs ${whole(gold - available.gold)} more gold`;
    if (available.manpower < men) return `Needs ${whole(men - available.manpower)} more manpower`;
    return undefined;
  }

  const destinations = $derived(
    Object.values(game.cities)
      .filter((other) => other.owner === game.player && other.id !== city.id)
      .sort((a, b) => a.name.localeCompare(b.name)),
  );
  const to = $derived(destinations.find((other) => other.id === chosen)?.id ?? destinations[0]?.id);
  const leaving = $derived(Math.floor(city.population * share));
  const fateDaysLeft = $derived(
    own && city.fellOn !== null && occupied.get(city.id) !== city.fellOn
      ? FATE_DAYS - (game.day - city.fellOn)
      : -1,
  );
</script>

<section class="panel" data-testid="city-panel" aria-label="City">
  <div class="head">
    <span class="swatch" style:background={cssColour(game, city.owner)}></span>
    <h2 data-testid="city-name">{city.name}</h2>
    <span class="muted" data-testid="city-rank">{rankText(game, map, city)}</span>
  </div>
  <p data-testid="city-owner">{ownerLine(game, city.owner)}</p>
  <table>
    <tbody>
      <tr>
        <td>Population</td><td class="number" data-testid="city-population"
          >{whole(city.population)}</td
        >
      </tr>
      <tr>
        <td>Walls</td><td class="number" data-testid="city-walls"
          >{whole(city.walls)} of {full.walls}</td
        >
      </tr>
      <tr>
        <td>Garrison</td><td class="number" data-testid="city-garrison"
          >{whole(city.garrison)} of {whole(full.garrison)}</td
        >
      </tr>
      <tr>
        <td>Food</td><td class="number" data-testid="city-food"
          >{Math.floor(city.foodDays)} of {full.foodDays} days</td
        >
      </tr>
      {#if own}
        <tr>
          <td>Gold</td><td class="number" data-testid="city-gold-balance"
            >{signed(cityBalance(game, city).gold)} a day</td
          >
        </tr>
        <tr>
          <td>Harvest</td><td class="number" data-testid="city-food-balance"
            >{cityFoodText(game, city)}</td
          >
        </tr>
      {/if}
    </tbody>
  </table>
  {#if sacked}
    <p class="bad" data-testid="city-sacked">{sacked}</p>
  {/if}
  <p data-testid="city-unrest" class:bad={city.unrestDays > 0}>
    {city.unrestDays > 0 ? `Unrest · ${city.unrestDays} days left` : 'Calm'}
  </p>
  {#if siege}
    <p class="bad" data-testid="city-siege">
      Besieged by {[...new Set(besiegers.map((army) => factionName(game, army.owner)))].join(
        ' and ',
      )} · day {game.day - siege.startedOn + 1}
    </p>
    {#if weak}
      <p data-testid="city-weak-siege">{weak}</p>
    {/if}
    {#if canStorm}
      {#if stormed}<p data-testid="storm-odds">{stormed}</p>{/if}
      <div class="row">
        {#if storming}
          <span>Storm the walls today?</span>
          <button
            type="button"
            class="danger"
            onclick={() => {
              actions.issue({ kind: 'storm', faction: game.player, city: city.id });
              storming = false;
            }}>Confirm storm</button
          >
          <button type="button" onclick={() => (storming = false)}>Cancel</button>
        {:else}
          <button type="button" class="danger" onclick={() => (storming = true)}
            >Storm the walls</button
          >
        {/if}
      </div>
    {/if}
  {/if}

  <ArmiesHere {game} armies={armiesAt(game, sight, city.position)} {actions} />

  {#if fateDaysLeft >= 0}
    <h3>Fate of the city · {fateDaysLeft} days to choose</h3>
    <div class="row">
      <button type="button" data-testid="city-occupy" onclick={() => actions.occupy(city.id)}
        >Occupy</button
      >
      <button
        type="button"
        onclick={() => actions.issue({ kind: 'sack', faction: game.player, city: city.id })}
        >Sack for {whole(city.population * OUTPUT_PER_PERSON.gold * 365 * SACK.wealthYears)} gold</button
      >
      <button
        type="button"
        onclick={() => actions.issue({ kind: 'enslave', faction: game.player, city: city.id })}
        >Enslave {whole(city.population * ENSLAVE.populationShare)} people</button
      >
    </div>
    <p class="muted">With no choice the city is occupied as it stands when the days run out.</p>
  {/if}

  {#if raising.length > 0 || own}
    <h3>Raising</h3>
    {#if raising.length === 0}
      <p class="muted">Nothing</p>
    {/if}
    <ul data-testid="city-raising">
      {#each raising as recruit, i (i)}
        <li>{TROOP_NAMES[recruit.troop]} · {recruit.when}</li>
      {/each}
    </ul>
  {/if}

  {#if own}
    <h3>Raise</h3>
    <div class="troops">
      {#each Object.keys(TROOPS) as Troop[] as troop (troop)}
        {@const why = refusal(troop)}
        {@const cost = TROOPS[troop].recruit}
        <button
          type="button"
          disabled={why !== undefined}
          title={why}
          onclick={() =>
            actions.issue({ kind: 'recruit', faction: game.player, city: city.id, troop })}
        >
          <span class="troop">{TROOP_NAMES[troop]}</span>
          <span class="cost"
            >{whole(cost.gold)} gold · {whole(cost.men)} men · {cost.days} days</span
          >
          {#if why}<span class="why">{why}</span>{/if}
        </button>
      {/each}
    </div>

    <h3>Evacuate</h3>
    {#if to}
      <div class="row">
        <select aria-label="Share of the people" bind:value={share}>
          {#each SHARES as option (option)}
            <option value={option}>{option * 100}%</option>
          {/each}
        </select>
        <span>to</span>
        <select
          aria-label="Destination"
          value={to}
          onchange={(event) => (chosen = event.currentTarget.value as CityId)}
        >
          {#each destinations as other (other.id)}
            <option value={other.id}>{other.name}</option>
          {/each}
        </select>
      </div>
      <div class="row">
        <button
          type="button"
          disabled={leaving < 1}
          onclick={() =>
            actions.issue({ kind: 'evacuate', faction: game.player, city: city.id, to, share })}
          >Evacuate {whole(leaving)} people</button
        >
      </div>
    {:else}
      <p class="muted">You hold no other city to send people to.</p>
    {/if}
  {:else}
    {#key city.owner}
      <WarStatus {game} owner={city.owner} {pending} {actions} />
    {/key}
  {/if}
</section>

<style>
  ul {
    margin: 0;
    padding-left: 1.1em;
  }

  .troops {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 4px;
  }

  .troops button {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    padding: 3px 6px;
    text-align: left;
  }

  .troop {
    font-weight: bold;
  }

  .cost,
  .why {
    font-size: 11px;
  }

  .why {
    color: var(--bad);
  }
</style>
