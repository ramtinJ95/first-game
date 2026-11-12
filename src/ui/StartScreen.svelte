<script lang="ts">
  import { dateText } from '../app/names.ts';
  import { latestSaved } from '../app/saves.ts';
  import type { Frame } from '../app/view.svelte.ts';
  import { POWER_COLOURS } from '../render/palette.ts';
  import type { PowerId } from '../sim/map.ts';
  import { GAME_NAME, type FrameActions } from './frame-actions.ts';

  let { frame, actions }: { frame: Frame; actions: FrameActions } = $props();

  const POSITIONS: Record<PowerId, string> = {
    rome: 'Holds the middle of Italy, with free cities up to the Alps and Sicily across the strait.',
    carthage:
      'Rules the African shore from Carthago and looks over the sea to Sicily, Sardinia, and Iberia.',
    macedon:
      'Holds Macedonia from Pella, with the Greek cities to the south and Thrace to the east.',
    egypt: 'Holds the Nile from Alexandria to Thebai, rich, and walled in by desert and sea.',
    persia:
      'Rules the Iranian plateau from Persepolis, far from its rivals, with Mesopotamia below.',
  };

  const colour = (power: PowerId) => `#${POWER_COLOURS[power].toString(16).padStart(6, '0')}`;
  const latest = $derived(latestSaved(frame.saves));
</script>

<main class="start" data-testid="start-screen" aria-labelledby="start-title">
  <div class="sheet">
    <header>
      <p class="kicker">From Iberia to the Iranian plateau</p>
      <h1 id="start-title">{GAME_NAME}</h1>
      <div class="rule" aria-hidden="true"><span class="diamond"></span></div>
    </header>

    {#if latest}
      <div class="continue">
        <button type="button" class="primary" onclick={() => actions.continueGame()}>
          Continue
        </button>
        <span class="muted" data-testid="continue-info">{latest.realm}, {dateText(latest.day)}</span
        >
      </div>
    {/if}

    <h2>Choose a power</h2>
    <ul class="powers">
      {#each frame.powers as card (card.power)}
        <li>
          <button
            type="button"
            class="power"
            data-testid="power-{card.power}"
            style:--colour={colour(card.power)}
            onclick={() => actions.choosePower(card.power)}
          >
            <span class="band" aria-hidden="true"></span>
            <span class="name">{card.name}</span>
            <span class="capital">Capital {card.capital}</span>
            <span class="cities">{card.cities.join(' · ')}</span>
            <span class="position">{POSITIONS[card.power]}</span>
          </button>
        </li>
      {/each}
    </ul>
    <p class="hint muted">Or drop a save file anywhere on the page to load it.</p>
  </div>
</main>

<style>
  .start {
    position: fixed;
    inset: 0;
    display: grid;
    place-items: center;
    overflow-y: auto;
    font-family: var(--serif);
    color: var(--ink);
    background:
      radial-gradient(ellipse at 50% 40%, rgb(250 243 228 / 88%) 0%, rgb(236 223 191 / 94%) 70%),
      rgb(233 220 192 / 60%);
  }

  .sheet {
    box-sizing: border-box;
    width: min(1280px, calc(100vw - 32px));
    margin: 24px 0;
    padding: 28px 36px 22px;
    background: var(--paper-solid);
    border: 1px solid var(--rule);
    outline: 1px solid var(--rule);
    outline-offset: 5px;
    box-shadow: 0 2px 14px rgb(59 42 26 / 22%);
  }

  header {
    text-align: center;
  }

  .kicker {
    margin: 0;
    font-size: 13px;
    font-style: italic;
    color: var(--muted);
    letter-spacing: 0.06em;
  }

  h1 {
    margin: 4px 0 0;
    font-size: 54px;
    font-weight: normal;
    font-variant: small-caps;
    letter-spacing: 0.08em;
  }

  .rule {
    display: flex;
    gap: 12px;
    align-items: center;
    width: 320px;
    margin: 4px auto 14px;
    font-size: 12px;
    color: var(--rule);
  }

  .diamond {
    width: 6px;
    height: 6px;
    border: 1px solid var(--rule);
    transform: rotate(45deg);
  }

  .rule::before,
  .rule::after {
    flex: 1;
    content: '';
    border-top: 1px solid var(--rule);
  }

  h2 {
    margin: 10px 0 10px;
    font-size: 13px;
    font-weight: normal;
    color: var(--muted);
    text-align: center;
    text-transform: uppercase;
    letter-spacing: 0.14em;
  }

  .continue {
    display: flex;
    gap: 12px;
    align-items: baseline;
    justify-content: center;
    margin-bottom: 6px;
  }

  button {
    font: inherit;
    color: inherit;
    cursor: pointer;
    background: transparent;
    border: 1px solid var(--rule);
    border-radius: 3px;
  }

  .primary {
    padding: 4px 22px;
    font-size: 17px;
  }

  .primary:hover,
  .power:hover {
    background: rgb(122 75 42 / 10%);
  }

  .powers {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 12px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .power {
    display: flex;
    flex-direction: column;
    gap: 4px;
    box-sizing: border-box;
    width: 100%;
    height: 100%;
    padding: 0 14px 12px;
    text-align: left;
  }

  .band {
    height: 8px;
    margin: 0 -14px 6px;
    background: var(--colour);
    border-bottom: 1px solid var(--ink);
    opacity: 0.85;
  }

  .name {
    font-size: 22px;
    font-variant: small-caps;
    letter-spacing: 0.05em;
    color: var(--colour);
    filter: brightness(0.75);
  }

  .capital {
    font-size: 13px;
    font-style: italic;
  }

  .cities {
    font-size: 12px;
    color: var(--muted);
  }

  .position {
    margin-top: 4px;
    font-size: 14px;
    line-height: 1.35;
  }

  .muted {
    color: var(--muted);
  }

  @media (width < 1200px) {
    .sheet {
      padding: 22px 20px 18px;
    }

    .powers {
      gap: 8px;
    }

    .power {
      padding: 0 10px 10px;
    }

    .band {
      margin: 0 -10px 6px;
    }

    .position {
      font-size: 13px;
    }
  }

  .hint {
    margin: 14px 0 0;
    font-size: 13px;
    font-style: italic;
    text-align: center;
  }
</style>
