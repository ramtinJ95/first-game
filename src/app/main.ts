import { mount } from 'svelte';
import mapUrl from '../../data/map/map.json?url';
import { parseDrawOptions } from '../render/draw-options.ts';
import { provinceAt, type Pick } from '../render/pick.ts';
import { createRenderer, type Command } from '../render/renderer.ts';
import { decideAll } from '../sim/ai/decide.ts';
import type { DeepReadonly } from '../sim/deep-readonly.ts';
import type { CityId } from '../sim/ids.ts';
import { landPath } from '../sim/march.ts';
import { parseMap, type GameMap } from '../sim/map.ts';
import { newGame } from '../sim/new-game.ts';
import { AT_PORT_KM } from '../sim/orders/embark.ts';
import type { Order } from '../sim/orders/orders.ts';
import { loadGame } from '../sim/save.ts';
import { sightOf, type Sight } from '../sim/sight.ts';
import type { Army } from '../sim/state/army.ts';
import type { City } from '../sim/state/city.ts';
import type { GameState } from '../sim/state/game-state.ts';
import type { MapPoint } from '../sim/state/map-point.ts';
import { distance, findPath } from '../sim/world/find-path.ts';
import { buildWorld } from '../sim/world/world.ts';
import type { Actions } from '../ui/actions.ts';
import Hud from '../ui/Hud.svelte';
import '../ui/panels.css';
import { alertsBetween, type Alert } from './alerts.ts';
import { createClock } from './clock.ts';
import { showFrameMeter } from './frame-meter.ts';
import { reasonText } from './names.ts';
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
    if (last) showNotice(`Order refused. ${reasonText(clock.state, last.reason)}.`);
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

/** The port city of its owner that the army stands at, as the embark order judges it. */
function portOf(
  state: DeepReadonly<GameState>,
  army: DeepReadonly<Army>,
): DeepReadonly<City> | undefined {
  if (army.activity.kind !== 'idle' && army.activity.kind !== 'marching') return undefined;
  const at = army.activity.position;
  return Object.values(state.cities).find((city) => {
    const harbour = world.harbours.get(city.id);
    return (
      city.owner === army.owner &&
      harbour &&
      Math.min(distance(at, city.position), distance(at, harbour)) <= AT_PORT_KM
    );
  });
}

/**
 * A right click with one of the player's armies selected marches it to the point. On
 * a port city, while the army stands at one of the player's ports, it offers the sea.
 */
function command({ point, screen }: Command) {
  menu = undefined;
  const state = clock.state;
  const army = selection?.kind === 'army' ? state.armies[selection.army] : undefined;
  if (!army || army.owner !== state.player) {
    view.refresh();
    return;
  }
  const march: Order = { kind: 'moveArmy', faction: state.player, army: army.id, to: point };
  // The land under the click, not the pick: a banner or battle marker may cover a port.
  const province = provinceAt(map, point);
  const target: CityId | undefined = province && state.provinces[province]?.city;
  const city = target && state.cities[target];
  const from = portOf(state, army);
  if (city && from && city.id !== from.id && world.harbours.has(city.id)) {
    menu = {
      screen,
      options: [
        {
          label: `Sail from ${from.name} to ${city.name}`,
          order: { kind: 'embark', faction: state.player, army: army.id, to: city.id },
        },
        { label: `March to ${city.name}`, order: march },
      ],
    };
  } else {
    clock.issue(march);
  }
  view.refresh();
}

let plannedFor: readonly Order[] | undefined;
let planned: MapPoint[][] = [];

/** The paths that the player's waiting march and sail orders will take. */
function plannedPaths(): MapPoint[][] {
  if (clock.pending === plannedFor) return planned;
  plannedFor = clock.pending;
  const state = clock.state;
  planned = clock.pending.flatMap((order) => {
    if (order.faction !== state.player) return [];
    const army = (order.kind === 'moveArmy' || order.kind === 'embark') && state.armies[order.army];
    if (!army || army.activity.kind === 'embarked') return [];
    const at = army.activity.position;
    if (order.kind === 'moveArmy') {
      const path = landPath(world, at, order.to);
      return typeof path === 'string' ? [] : [[at, ...path]];
    }
    if (order.kind !== 'embark') return [];
    const from = portOf(state, army);
    const harbour = from && world.harbours.get(from.id);
    const landing = world.harbours.get(order.to);
    const path = harbour && landing && findPath(world.mesh, harbour, landing, 'sea');
    return path ? [[at, harbour, ...path]] : [];
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
