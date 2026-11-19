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
  import { trainingDaysAt } from '../sim/buildings/buildings.ts';
  import { beleaguered, fullDefences } from '../sim/systems/sieges.ts';
  import { TROOPS, type Troop } from '../sim/troops.ts';
  import type { Actions } from './actions.ts';
  import ArmiesHere from './ArmiesHere.svelte';
  import { afterWaiting } from './buildings-text.ts';
  import CityBuildings from './CityBuildings.svelte';
  import CityGuards from './CityGuards.svelte';
  import {
    armiesAt,
    cityBalance,
    minorText,
    unrestDaysLeft,
    unrestText,
    cityFoodText,
    cssColour,
    ownerLine,
    rankText,
    leavingText,
    sackText,
    signed,
    stormText,
    weakSiegeText,
  } from './describe.ts';
  import WarStatus from './WarStatus.svelte';
  import { movedText, recruitForecast } from './recruit-forecast.ts';
  import { nearWarNames, recruitThreats, type RecruitThreat } from './recruit-threats.ts';
  import { namedWaits } from './named-waits.ts';
  import CityTrade from './CityTrade.svelte';
  import type { World } from '../sim/world/world.ts';

  let {
    game,
    map,
    world,
    city,
    sight,
    pending,
    occupied,
    paused,
    actions,
  }: {
    game: DeepReadonly<GameState>;
    map: DeepReadonly<GameMap>;
    world: World;
    city: DeepReadonly<City>;
    sight: Sight;
    pending: readonly Order[];
    occupied: Occupied;
    paused: boolean;
    actions: Actions;
  } = $props();

  const SHARES = [0.1, 0.25, 0.5] as const;

  let share = $state<number>(0.25);
  let chosen = $state<CityId | undefined>();
  let storming = $state(false);
  let confirming = $state<Troop | undefined>();
  const outlook = $derived(
    recruitForecast(
      game,
      pending,
      world,
      confirming,
      confirming ? trainingDaysAt(city, TROOPS[confirming].recruit.days) : 0,
      city.id,
    ),
  );

  const waitKey = (troop: Troop) => `${game.player}:${city.id}:${troop}`;
  const earlier = $derived(confirming && namedWaits.get(waitKey(confirming)));
  const moved = $derived(
    earlier && outlook.named ? movedText(earlier, outlook.named, TROOP_NAMES) : undefined,
  );
  $effect(() => {
    if (!confirming) return;
    const key = waitKey(confirming);
    if (!outlook.warning) namedWaits.delete(key);
    else if (outlook.named && (!earlier || game.day < earlier.on))
      namedWaits.set(key, outlook.named);
  });

  function raise(troop: Troop) {
    if (
      recruitForecast(game, pending, world, troop, trainingDaysAt(city, TROOPS[troop].recruit.days))
        .warning
    )
      confirming = troop;
    else {
      actions.issue({ kind: 'recruit', faction: game.player, city: city.id, troop });
      namedWaits.delete(waitKey(troop));
      confirming = undefined;
    }
  }

  const own = $derived(city.owner === game.player);
  const full = $derived(fullDefences(city));
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
  const onTheRoad = $derived(leavingText(game, city));
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

  /** The day as the next tick starts it, once the recruits and buildings waiting for it are paid. */
  const waiting = $derived(afterWaiting(game, pending, world));
  const available = $derived(waiting.factions[game.player]?.stores ?? { gold: 0, manpower: 0 });

  /** Why the rules' recruit order would refuse the troop at the city, in the order it checks. */
  function refusal(troop: Troop): string | undefined {
    const { gold, men } = TROOPS[troop].recruit;
    if (city.unrestDays > 0) return `In unrest for ${unrestDaysLeft(game, city)} more days`;
    if (beleaguered(waiting, city)) return 'An enemy is at the walls, so no training starts';
    if (available.gold < gold) return `Needs ${whole(gold - available.gold)} more gold`;
    if (available.manpower < men) return `Needs ${whole(men - available.manpower)} more manpower`;
    return undefined;
  }

  const orderable = $derived((Object.keys(TROOPS) as Troop[]).filter((t) => !refusal(t)));
  /**
   * What each troop does to each power near war, reckoned while the game is paused, one troop a
   * task: each plays the days to its muster through the rules, tens of milliseconds a troop.
   */
  let threats = $state<ReadonlyMap<Troop, readonly RecruitThreat[]>>(new Map());
  $effect(() => {
    threats = new Map();
    if (!own || !paused) return;
    const [snapshot, orders, at, troops] = [game, pending, city, orderable];
    let timer: ReturnType<typeof setTimeout> | undefined;
    const next = (i: number) => {
      const troop = troops[i];
      if (!troop) return;
      timer = setTimeout(() => {
        const lines = recruitThreats(snapshot, orders, at, world, [troop]).get(troop) ?? [];
        threats = new Map([...threats, [troop, lines]]);
        next(i + 1);
      }, 0);
    };
    next(0);
    return () => clearTimeout(timer);
  });
  const pauseToSee = $derived(own && !paused ? nearWarNames(game, world) : []);
  /** The powers near war whose threat each card is still reckoning, so no card waits in silence. */
  const reckoning = $derived(own && paused ? nearWarNames(game, world) : []);

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
  /** A sack or an enslavement ordered for this city, which the next day carries out. */
  const fateOrdered = $derived(
    pending.find(
      (order) =>
        (order.kind === 'sack' || order.kind === 'enslave') &&
        order.faction === game.player &&
        order.city === city.id,
    )?.kind,
  );
</script>

<section class="panel" data-testid="city-panel" aria-label="City">
  <div class="head">
    <span class="swatch" style:background={cssColour(game, city.owner)}></span>
    <h2 data-testid="city-name">{city.name}</h2>
    <span class="muted" data-testid="city-rank">{rankText(game, map, city)}</span>
  </div>
  <p data-testid="city-owner">{ownerLine(game, city.owner)}</p>
  {#if minorText(game, sight, city)}
    <p class="muted" data-testid="city-minor">{minorText(game, sight, city)}</p>
  {/if}
  <table>
    <tbody>
      <tr>
        <td>Population</td><td class="number" data-testid="city-population"
          >{whole(city.population)}</td
        >
      </tr>
      <tr>
        <td>Walls</td><td class="number" data-testid="city-walls"
          >{whole(city.walls)} of {whole(full.walls)}</td
        >
      </tr>
      <tr>
        <td>Garrison</td><td class="number" data-testid="city-garrison"
          >{whole(city.garrison)} of {whole(full.garrison)}</td
        >
      </tr>
      <tr>
        <td>Food</td><td class="number" data-testid="city-food"
          >{Math.floor(city.foodDays)} of {whole(full.foodDays)} days</td
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
  {#if onTheRoad}
    <p data-testid="city-leaving">{onTheRoad}</p>
  {/if}
  {#if sacked}
    <p class="bad" data-testid="city-sacked">{sacked}</p>
  {/if}
  <p data-testid="city-unrest" class:bad={city.unrestDays > 0}>
    {city.unrestDays > 0 ? `Unrest · ${unrestText(unrestDaysLeft(game, city))}` : 'Calm'}
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

  {#if fateDaysLeft >= 0 && fateOrdered}
    <h3>Fate of the city</h3>
    <p data-testid="city-fate-ordered">
      {fateOrdered === 'sack' ? 'Sack' : 'Enslavement'} ordered for the next day
    </p>
  {:else if fateDaysLeft >= 0}
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

  {#if own}
    <CityGuards {game} {world} {city} {pending} {actions} />
    <CityBuildings {game} {world} {city} {pending} {actions} />
  {/if}
  <CityTrade {game} {world} {city} {sight} {pending} {actions} />

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
    <p class="muted small">
      Today's yields, with the people growing as they do while food lasts; payment now, upkeep from
      each muster day. No battles or losses predicted. A store that runs short at any distance
      warns.
    </p>
    <div data-testid="recruit-forecast">
      <p>
        Realm after all recruits muster{confirming ? `, with ${TROOP_NAMES[confirming]}` : ''}: {outlook.balanceText}.
      </p>
      {#each outlook.runway as store (store.key)}
        <p class:bad={store.urgent} data-testid="recruit-runway-{store.key}">
          {store.name}: {store.text}
        </p>
      {/each}
    </div>
    {#if confirming}
      {@const troop = confirming}
      <div data-testid="recruit-warning">
        {#if outlook.warning}<p class="bad">{TROOP_NAMES[troop]}: {outlook.warning}</p>{/if}
        {#if outlook.warning && moved}<p class="bad" data-testid="recruit-moved">{moved}</p>{/if}
        {#if outlook.warning && outlook.canal}<p data-testid="recruit-canal">
            {outlook.canal}
          </p>{/if}
        <div class="row">
          <button
            type="button"
            disabled={refusal(troop) !== undefined}
            onclick={() => {
              actions.issue({ kind: 'recruit', faction: game.player, city: city.id, troop });
              namedWaits.delete(waitKey(troop));
              confirming = undefined;
            }}>{outlook.warning ? 'Raise anyway' : 'Raise troops'}</button
          >
          <button type="button" onclick={() => (confirming = undefined)}>Cancel raising</button>
        </div>
      </div>
    {/if}
    {#if pauseToSee.length > 0}
      <p class="muted small" data-testid="recruit-threat-paused">
        Pause the game to see what each troop does to the threat of {pauseToSee.join(' and ')}.
      </p>
    {/if}
    <div class="troops" class:threatened={threats.size > 0} data-testid="recruit-cards">
      {#each Object.keys(TROOPS) as Troop[] as troop (troop)}
        {@const why = refusal(troop)}
        {@const cost = TROOPS[troop].recruit}
        {@const forecast = recruitForecast(
          game,
          pending,
          world,
          troop,
          trainingDaysAt(city, cost.days),
        )}
        <button type="button" disabled={why !== undefined} title={why} onclick={() => raise(troop)}>
          <span class="troop">{TROOP_NAMES[troop]}</span>
          <span class="cost"
            >{whole(cost.gold)} gold · {whole(cost.men)} men · {trainingDaysAt(city, cost.days)} days</span
          >
          <span class="cost">{forecast.upkeepText}</span>
          {#if why}<span class="why">{why}</span>{/if}
          {#each threats.get(troop) ?? [] as threat (threat.power)}
            <span class="threat" data-testid="recruit-threat">{threat.text}</span>
          {/each}
          {#if !why && !threats.has(troop) && reckoning.length > 0}
            <span class="muted small" data-testid="recruit-threat-reckoning"
              >Reckoning what they do to the threat of {reckoning.join(' and ')}…</span
            >
          {/if}
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

  .troops.threatened {
    grid-template-columns: 1fr;
  }

  .troop {
    font-weight: bold;
  }

  .threat {
    font-size: 12px;
    color: var(--bad);
  }

  .cost,
  .why {
    font-size: 11px;
  }

  .why {
    color: var(--bad);
  }
</style>
