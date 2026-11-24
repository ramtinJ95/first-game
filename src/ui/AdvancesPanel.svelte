<script lang="ts">
  import { whole } from '../app/names.ts';
  import type { DeepReadonly } from '../sim/deep-readonly.ts';
  import type { Order } from '../sim/orders/orders.ts';
  import type { GameState } from '../sim/state/game-state.ts';
  import type { Actions } from './actions.ts';
  import { advancesView, cancelText, studyLine, ADVANCE_RULE } from './advances-text.ts';

  let {
    game,
    pending,
    actions,
  }: { game: DeepReadonly<GameState>; pending: readonly Order[]; actions: Actions } = $props();

  const branches = $derived(advancesView(game, game.player, pending));
  const line = $derived(studyLine(game, game.player));
  const study = $derived(game.factions[game.player]?.study ?? null);
  const cancelling = $derived(
    pending.some((order) => order.kind === 'cancelStudy' && order.faction === game.player),
  );
</script>

<section class="panel advances" id="advances" data-testid="advances" aria-label="Advances">
  <h2>Advances</h2>
  <p class="rule">{ADVANCE_RULE}</p>
  <div class="now" data-testid="advances-now">
    <p class:idle={!study}>{line.full}</p>
    {#if study}
      <button
        type="button"
        data-testid="advances-cancel"
        disabled={cancelling}
        onclick={() => actions.issue({ kind: 'cancelStudy', faction: game.player })}
        >{cancelling ? 'Giving up ordered' : cancelText(study.advance)}</button
      >
    {/if}
  </div>
  <div class="branches">
    {#each branches as branch (branch.branch)}
      <section class="branch" data-testid="branch-{branch.branch}" aria-label={branch.name}>
        <h3>{branch.name}</h3>
        <ul>
          {#each branch.rows as row (row.kind)}
            <li class={row.status} data-testid="advance-{row.kind}">
              <div class="head">
                <span class="name">{row.name}</span>
                {#if row.suggested}<span class="suggested" data-testid="advance-suggested"
                    >Pays back soonest</span
                  >{/if}
                <span class="cost">{whole(row.gold)} gold · {row.days} days</span>
              </div>
              <p class="effect">{row.effect}</p>
              <p class="does" data-testid="advance-{row.kind}-does">For you today: {row.does}</p>
              {#if row.status === 'studied'}
                <p class="state">Studied</p>
              {:else if row.status === 'studying'}
                <p class="state">Studying</p>
              {:else if row.status === 'ordered'}
                <p class="state">Ordered for the next day</p>
              {:else}
                <p class="payback muted">{row.payback}</p>
                <button
                  type="button"
                  data-testid="study-{row.kind}"
                  disabled={row.refusal !== undefined}
                  title={row.refusal}
                  onclick={() =>
                    actions.issue({ kind: 'study', faction: game.player, advance: row.kind })}
                  >{row.refusal ?? `Study for ${whole(row.gold)} gold`}</button
                >
              {/if}
            </li>
          {/each}
        </ul>
      </section>
    {/each}
  </div>
</section>

<style>
  .advances {
    display: flex;
    flex-direction: column;
    width: 380px;
    max-width: 100%;
    min-height: 0;
    max-height: 100%;
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .rule {
    margin: 0 0 6px;
    font-size: 13px;
  }

  .now {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 10px;
    align-items: center;
    margin-bottom: 6px;
  }

  .now p {
    margin: 0;
    font-weight: bold;
  }

  .now p.idle {
    color: var(--bad);
  }

  .branch h3 {
    margin: 8px 0 2px;
  }

  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li {
    padding: 4px 0 6px 8px;
    border-left: 3px solid transparent;
  }

  li.studied {
    border-left-color: var(--good);
  }

  li.studying,
  li.ordered {
    border-left-color: var(--ink);
  }

  .head {
    display: flex;
    flex-wrap: wrap;
    gap: 2px 8px;
    align-items: baseline;
  }

  .name {
    font-weight: bold;
  }

  .cost {
    margin-left: auto;
    font-size: 12px;
    color: var(--muted);
  }

  .suggested {
    padding: 0 4px;
    font-size: 11px;
    color: var(--paper-solid);
    background: var(--good);
  }

  .effect,
  .does,
  .payback,
  .state {
    margin: 2px 0;
    font-size: 13px;
  }

  button {
    margin-top: 2px;
  }
</style>
