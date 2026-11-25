<script lang="ts">
  import { whole } from '../app/names.ts';
  import type { DeepReadonly } from '../sim/deep-readonly.ts';
  import { GUARD_BAND, guardTermText } from '../sim/guards.ts';
  import type { Order } from '../sim/orders/orders.ts';
  import type { City } from '../sim/state/city.ts';
  import type { GameState } from '../sim/state/game-state.ts';
  import type { World } from '../sim/world/world.ts';
  import type { Actions } from './actions.ts';
  import { cityGuards, guardRule } from './guards-text.ts';

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

  const shown = $derived(cityGuards(game, pending, city, world));
  const term = $derived(guardTermText(game, game.player));
</script>

<section data-testid="city-guards" aria-label="Guards">
  <h3>Guards</h3>
  <p data-testid="guards-line">{shown.line}</p>
  {#if shown.weighed}<p class="muted" data-testid="guards-weighed">{shown.weighed}</p>{/if}
  <p class="muted" data-testid="guards-rule">{guardRule(term)}</p>
  <button
    type="button"
    data-testid="guards-hire"
    disabled={shown.hire.why !== undefined}
    title={shown.hire.why}
    onclick={() => actions.issue({ kind: 'hireGuards', faction: game.player, city: city.id })}
    >Hire {whole(GUARD_BAND)} guards for {term} · {whole(shown.hire.gold)} gold</button
  >
  {#if shown.hire.change}<p class="muted" data-testid="guards-change">{shown.hire.change}</p>{/if}
  {#each shown.hire.threats as threat (threat)}<p class="muted" data-testid="guards-threat">
      {threat}
    </p>{/each}
  {#if shown.hire.why}<p class="bad" data-testid="guards-refused">{shown.hire.why}</p>{/if}
</section>
