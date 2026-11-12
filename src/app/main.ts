import { mount } from 'svelte';
import mapUrl from '../../data/map/map.json?url';
import type { Pick } from '../render/pick.ts';
import { createRenderer } from '../render/renderer.ts';
import { parseMap, type GameMap } from '../sim/map.ts';
import { newGame } from '../sim/new-game.ts';
import { loadGame } from '../sim/save.ts';
import { buildWorld } from '../sim/world/world.ts';
import SelectionReadout from '../ui/SelectionReadout.svelte';
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

const clock = createClock({
  state: newGame(map, { seed: Date.now(), player: 'rome' }),
  world: buildWorld(map),
  now: () => performance.now(),
  onRejected: (rejected) => console.warn('orders rejected', rejected),
});

let selection: Pick | undefined;

const view = createView(() => ({
  state: clock.state,
  speed: clock.speed,
  paused: clock.paused,
  selection,
}));

const canvas = document.createElement('canvas');
canvas.dataset['testid'] = 'map';
host.appendChild(canvas);
const renderer = await createRenderer({
  canvas,
  map,
  onPick(pick) {
    selection = pick;
    view.refresh();
  },
});

function loop() {
  clock.frame();
  renderer.draw({
    previous: clock.previous,
    current: clock.state,
    progress: clock.progress,
    selection,
  });
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// Dropping a save file on the page loads it. This is the one way to load a game
// until the panels unit adds a menu.
window.addEventListener('dragover', (event) => event.preventDefault());
window.addEventListener('drop', (event) => {
  event.preventDefault();
  const file = event.dataTransfer?.files[0];
  if (!file) return;
  void file.text().then((text) => {
    const loaded = loadGame(text);
    if (!loaded.ok) {
      console.warn(`save not loaded: ${loaded.error}`);
      return;
    }
    clock.load(loaded.state);
    view.refresh();
  });
});

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

mount(SelectionReadout, { target: host, props: { view } });
