import { mount } from 'svelte';
import { createRenderer } from '../render/renderer.ts';
import { buildFixture } from '../sim/fixture.ts';
import TimeControls from '../ui/TimeControls.svelte';
import { createClock } from './clock.ts';
import { createView } from './view.svelte.ts';

const host = document.getElementById('app');
if (!host) throw new Error('#app element missing from index.html');

await createRenderer(host);

const clock = createClock({
  state: buildFixture(),
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
