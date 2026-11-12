import { mount } from 'svelte';
import mapUrl from '../../data/map/map.json?url';
import { parseDrawOptions } from '../render/draw-options.ts';
import type { Pick } from '../render/pick.ts';
import { createRenderer, type Command } from '../render/renderer.ts';
import { decideAll } from '../sim/ai/decide.ts';
import type { DeepReadonly } from '../sim/deep-readonly.ts';
import { parseMap, type GameMap } from '../sim/map.ts';
import { newGame } from '../sim/new-game.ts';
import type { Order } from '../sim/orders/orders.ts';
import { loadGame } from '../sim/save.ts';
import { sightOf, type Sight } from '../sim/sight.ts';
import type { GameState } from '../sim/state/game-state.ts';
import type { MapPoint } from '../sim/state/map-point.ts';
import { buildWorld } from '../sim/world/world.ts';
import type { Actions } from '../ui/actions.ts';
import Hud from '../ui/Hud.svelte';
import '../ui/panels.css';
import { alertsBetween, type Alert } from './alerts.ts';
import { createClock } from './clock.ts';
import { planCommand, route, type CommandTarget } from './command.ts';
import { showFrameMeter } from './frame-meter.ts';
import { refusalText } from './names.ts';
import { alertsInSight, seesPick } from './sighted.ts';
import { createView, type CommandMenu, type Notice } from './view.svelte.ts';

/** The alerts the list keeps, newest first. */
const ALERTS_KEPT = 30;
/** How long a refused order's reason stays on screen. */
const NOTICE_MS = 4000;

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

const world = buildWorld(map);

let selection: Pick | undefined;
let alerts: readonly Alert[] = [];
let notice: Notice | undefined;
let noticeTimer: ReturnType<typeof setTimeout> | undefined;
let menu: CommandMenu | undefined;

const sights = new WeakMap<DeepReadonly<GameState>, Sight>();
/** What the player sees on a day. A state never changes once a tick returns it. */
function sightFor(state: DeepReadonly<GameState>): Sight {
  let sight = sights.get(state);
  if (!sight) {
    sight = sightOf(state, world, state.player);
    sights.set(state, sight);
  }
  return sight;
}

function showNotice(text: string) {
  notice = { id: (notice?.id ?? 0) + 1, text };
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => {
    notice = undefined;
    view.refresh();
  }, NOTICE_MS);
}

const clock = createClock({
  state: newGame(map, { seed: Date.now(), player: 'rome' }),
  world,
  now: () => performance.now(),
  decide: (state) => decideAll(state, world),
  onRejected(rejected) {
    const own = rejected.filter(({ order }) => order.faction === clock.state.player);
    const last = own.at(-1);
    if (last) showNotice(refusalText(clock.state, last.reason));
  },
  onDay(before, after) {
    const news = alertsInSight(alertsBetween(before, after), sightFor(before), sightFor(after));
    if (news.length > 0) alerts = [...news.reverse(), ...alerts].slice(0, ALERTS_KEPT);
  },
});

const view = createView(
  () => ({
    state: clock.state,
    speed: clock.speed,
    paused: clock.paused,
    selection,
    pending: clock.pending,
    alerts,
    notice,
    menu,
    sight: sightFor(clock.state),
  }),
  100,
  'panels',
);

/** A right click with one of the player's armies selected plans an order for the city or point. */
function command({ point, city, screen }: Command) {
  menu = undefined;
  const state = clock.state;
  const army = selection?.kind === 'army' ? state.armies[selection.army] : undefined;
  const clicked = city && state.cities[city];
  if (army && army.owner === state.player) {
    const target: CommandTarget = clicked
      ? { kind: 'city', city: clicked }
      : { kind: 'point', point };
    const plan = planCommand(state, world, army, target);
    if (plan.kind === 'issue') clock.issue(plan.order);
    if (plan.kind === 'menu') menu = { ...plan.menu, screen };
    if (plan.notice) showNotice(plan.notice);
  }
  view.refresh();
}

let plannedFor: readonly Order[] | undefined;
let planned: (readonly MapPoint[])[] = [];

/** The paths that the player's waiting march and sail orders will take. */
function plannedPaths(): (readonly MapPoint[])[] {
  if (clock.pending === plannedFor) return planned;
  plannedFor = clock.pending;
  const state = clock.state;
  planned = clock.pending.flatMap((order) => {
    if (order.faction !== state.player) return [];
    if (order.kind !== 'moveArmy' && order.kind !== 'embark') return [];
    const way = route(state, world, order);
    return typeof way === 'string' ? [] : [way.path];
  });
  return planned;
}

/**
 * The page's query, with `draw` taken from local storage when the query leaves it out.
 * playwright.config.ts stores `draw=test`, so every page a browser test opens draws less.
 */
function drawQuery(): string {
  const query = new URLSearchParams(location.search);
  try {
    const stored = localStorage.getItem('draw');
    if (stored && !query.has('draw')) query.set('draw', stored);
  } catch {
    // Storage can be blocked. The page then draws what its query says.
  }
  return query.toString();
}

/** `?frames` shows the frame readout, which needs each drawn frame finished to time it. */
const metering = new URLSearchParams(location.search).has('frames');
const canvas = document.createElement('canvas');
canvas.dataset['testid'] = 'map';
host.appendChild(canvas);
const renderer = await createRenderer({
  canvas,
  map,
  onPick(pick) {
    selection = pick;
    menu = undefined;
    view.refresh();
  },
  onCommand: command,
  drawing: parseDrawOptions(drawQuery()),
  waitForGpu: metering,
});
const meter = metering ? showFrameMeter(host) : undefined;

function loop() {
  clock.frame();
  const sight = sightFor(clock.state);
  if (!seesPick(sight, selection)) {
    selection = undefined;
    view.refresh();
  }
  const start = performance.now();
  const drew = renderer.draw({
    previous: clock.previous,
    current: clock.state,
    progress: clock.progress,
    selection,
    planned: plannedPaths(),
    previousSight: sightFor(clock.previous),
    sight,
  });
  if (drew) meter?.drew(performance.now() - start);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// Dropping a save file on the page loads it. This is the one way to load a game
// until a menu offers it.
window.addEventListener('dragover', (event) => event.preventDefault());
window.addEventListener('drop', (event) => {
  event.preventDefault();
  const file = event.dataTransfer?.files[0];
  if (!file) return;
  void file.text().then((text) => {
    const loaded = loadGame(text);
    if (!loaded.ok) {
      showNotice(`The save did not load. ${loaded.error}`);
      view.refresh();
      return;
    }
    clock.load(loaded.state);
    alerts = [];
    menu = undefined;
    view.refresh();
  });
});

const actions: Actions = {
  togglePause() {
    clock.togglePause();
    view.refresh();
  },
  setSpeed(speed) {
    clock.setSpeed(speed);
    view.refresh();
  },
  issue(order) {
    clock.issue(order);
    view.refresh();
  },
  select(pick) {
    if (!seesPick(sightFor(clock.state), pick)) return;
    selection = pick;
    view.refresh();
  },
  show(pick, at) {
    if (!seesPick(sightFor(clock.state), pick)) return;
    selection = pick;
    menu = undefined;
    renderer.focus(at);
    view.refresh();
  },
  openAlert(alert) {
    if (!alert.focus) return;
    renderer.focus(alert.focus.at);
    const { select } = alert.focus;
    if (select && seesPick(sightFor(clock.state), select)) selection = select;
    view.refresh();
  },
  closeMenu() {
    menu = undefined;
    view.refresh();
  },
};

mount(Hud, { target: host, props: { view, map, actions } });
