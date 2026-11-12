import { mount } from 'svelte';
import mapUrl from '../../data/map/map.json?url';
import { createRenderer } from '../render/renderer.ts';
import { parseMap, type GameMap } from '../sim/map.ts';
import { newGame } from '../sim/new-game.ts';
import TimeControls from '../ui/TimeControls.svelte';
import { createClock } from './clock.ts';
import { createView } from './view.svelte.ts';

const host = document.getElementById('app');
if (!host) throw new Error('#app element missing from index.html');

async function loadMap(host: HTMLElement): Promise<GameMap> {
  try {
    const response = await fetch(mapUrl);
    if (!response.ok) throw new Error(`map: ${mapUrl} answered ${response.status}`);
    return parseMap(await response.json());
  } catch (error) {
    const message = document.createElement('pre');
    message.role = 'alert';
    message.dataset['testid'] = 'start-error';
    message.textContent = `The game cannot start. ${error instanceof Error ? error.message : String(error)}`;
    host.replaceChildren(message);
    throw error;
  }
}

const map = await loadMap(host);

await createRenderer(host);

const clock = createClock({
  state: newGame(map, { seed: Date.now(), player: 'rome' }),
  now: () => performance.now(),
  onRejected: (rejected) => console.warn('orders rejected', rejected),
});

function loop() {
  clock.frame();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

const view = createView(() => ({
  state: clock.state,
  speed: clock.speed,
  paused: clock.paused,
}));

mount(TimeControls, {
  target: host,
  props: {
    view,
    controls: {
      togglePause() {
        clock.togglePause();
        view.refresh();
      },
      setSpeed(speed) {
        clock.setSpeed(speed);
        view.refresh();
      },
    },
  },
});
