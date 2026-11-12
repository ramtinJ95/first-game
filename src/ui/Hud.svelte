<script lang="ts">
  import type { View } from '../app/view.svelte.ts';
  import type { BattleId } from '../sim/ids.ts';
  import type { Actions } from './actions.ts';
  import AlertList from './AlertList.svelte';
  import ArmyPanel from './ArmyPanel.svelte';
  import BattlePanel from './BattlePanel.svelte';
  import CityPanel from './CityPanel.svelte';
  import CommandMenu from './CommandMenu.svelte';
  import NoticeToast from './NoticeToast.svelte';
  import TopBar from './TopBar.svelte';

  let { view, actions }: { view: View; actions: Actions } = $props();

  const game = $derived(view.current.state);
  const selection = $derived(view.current.selection);
  const army = $derived(selection?.kind === 'army' ? game.armies[selection.army] : undefined);
  const city = $derived.by(() => {
    if (selection?.kind !== 'province') return undefined;
    const id = game.provinces[selection.province]?.city;
    return id && game.cities[id];
  });

  /**
   * The selected battle, or the battle of the selected army. With neither, every
   * battle one of the player's armies is in, so a fight is never out of sight.
   */
  const battles = $derived.by(() => {
    let ids: BattleId[];
    if (selection?.kind === 'battle') ids = [selection.battle];
    else if (army?.activity.kind === 'inBattle') ids = [army.activity.battle];
    else
      ids = Object.values(game.battles)
        .filter((battle) =>
          [...battle.attackers, ...battle.defenders].some(
            (id) => game.armies[id]?.owner === game.player,
          ),
        )
        .map((battle) => battle.id);
    return ids.flatMap((id) => game.battles[id] ?? []);
  });

  function onkeydown(event: KeyboardEvent) {
    if (event.key !== 'Escape') return;
    if (view.current.menu) actions.closeMenu();
    else actions.select(undefined);
  }
</script>

<svelte:window {onkeydown} />

<TopBar {view} {actions} />

<aside class="side" aria-label="Selection">
  {#if army}
    <ArmyPanel {game} {army} pending={view.current.pending} {actions} />
  {/if}
  {#if city}
    {#key city.id}
      <CityPanel {game} {city} pending={view.current.pending} {actions} />
    {/key}
  {/if}
  {#each battles as battle (battle.id)}
    <BattlePanel {game} {battle} {actions} />
  {/each}
</aside>

<AlertList alerts={view.current.alerts} day={game.day} {actions} />
<NoticeToast notice={view.current.notice} />
<CommandMenu menu={view.current.menu} {actions} />

<style>
  .side {
    position: fixed;
    top: 12px;
    right: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 320px;
    max-height: calc(100vh - 24px);
    overflow-y: auto;
  }
</style>
