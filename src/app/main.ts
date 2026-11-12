import { mount } from 'svelte';
import mapUrl from '../../data/map/map.json?url';
import { parseDrawOptions } from '../render/draw-options.ts';
import type { Pick } from '../render/pick.ts';
import { createRenderer, type Command } from '../render/renderer.ts';
import { decideAll } from '../sim/ai/decide.ts';
import type { DeepReadonly } from '../sim/deep-readonly.ts';
import { FATE_DAYS } from '../sim/cities.ts';
import type { CityId } from '../sim/ids.ts';
import { parseMap, POWERS, type GameMap, type PowerId } from '../sim/map.ts';
import { newGame, POWER_NAMES } from '../sim/new-game.ts';
import type { Order } from '../sim/orders/orders.ts';
import { outcomeOf, standingOf } from '../sim/outcome.ts';
import { loadGame, saveGame } from '../sim/save.ts';
import { sightOf, type Sight } from '../sim/sight.ts';
import type { GameState } from '../sim/state/game-state.ts';
import type { MapPoint } from '../sim/state/map-point.ts';
import { buildWorld } from '../sim/world/world.ts';
import type { Actions } from '../ui/actions.ts';
import { GAME_NAME, type FrameActions } from '../ui/frame-actions.ts';
import Hud from '../ui/Hud.svelte';
import '../ui/panels.css';
import { alertsOfDay, type Alert } from './alerts.ts';
import { createClock } from './clock.ts';
import { planCommand, plannedRoutes, type CommandTarget } from './command.ts';
import { fateChoices, type FateChoice } from './fates.ts';
import { showFrameMeter } from './frame-meter.ts';
import { refusalText } from './names.ts';
import { alertsInSight, seesPick } from './sighted.ts';
import { enqueue, keepOpen, type Modal } from './modals.ts';
import {
  browserStorage,
  latestSaved,
  readSaved,
  SLOTS,
  startsMonth,
  writeSaved,
  type Saved,
  type Slot,
} from './saves.ts';
import { turningPoints } from './turning-points.ts';
import {
  createView,
  type CommandMenu,
  type Notice,
  type PowerCard,
  type ShownModal,
} from './view.svelte.ts';

/** The alerts the list keeps, newest first. */
const ALERTS_KEPT = 30;
/** How long a refused order's reason stays on screen. */
const NOTICE_MS = 4000;
/** Local storage keeps the player's choice not to stop for a fate under this key. */
const PAUSE_ON_FATE_KEY = 'pauseOnFate';

document.title = GAME_NAME;

/**
 * `?play=<power>` opens a running game as that power, at the widest zoom, with no start
 * screen and no guide. Browser tests and capture scenarios enter the game this way.
 */
function playQuery(): PowerId | undefined {
  const asked = new URLSearchParams(location.search).get('play');
  return POWERS.find((power) => power === asked);
}
const entry = playQuery();

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

const powers: PowerCard[] = POWERS.map((power) => {
  const own = map.provinces
    .filter((province) => province.owner === power)
    .sort((a, b) => Number(b.capital) - Number(a.capital) || a.name.localeCompare(b.name));
  return {
    power,
    name: POWER_NAMES[power],
    capital: own[0]?.name ?? '',
    cities: own.map((province) => province.name),
  };
});

let selection: Pick | undefined;
let alerts: readonly Alert[] = [];
let notice: Notice | undefined;
let noticeTimer: ReturnType<typeof setTimeout> | undefined;
let menu: CommandMenu | undefined;

const storage = browserStorage();
let saves: Partial<Record<Slot, Saved>> = {};
for (const slot of SLOTS) {
  const saved = readSaved(storage, slot);
  if (saved) saves[slot] = saved;
}
let modals: Modal[] = entry ? [] : [{ kind: 'start' }];
let pauseOnFate = readPauseOnFate();
/** The win is announced once a game, so a game loaded already won is not announced. */
let announced = false;
/** A turning point asked for a stop. The clock stops after the frame's days, not inside one. */
let stopAsked = false;
/** A modal stopped a running game, so closing the last of them runs it again. */
let resumeOnClose = false;

function readPauseOnFate(): boolean {
  try {
    return storage?.getItem(PAUSE_ON_FATE_KEY) !== 'off';
  } catch {
    return true;
  }
}

function fateOpen(state: DeepReadonly<GameState>, id: CityId): boolean {
  const city = state.cities[id];
  return (
    !!city &&
    city.owner === state.player &&
    city.fellOn !== null &&
    state.day - city.fellOn <= FATE_DAYS
  );
}

/** Writes the day to a browser slot, or tells the player why the browser refused it. */
function save(slot: Slot, state: DeepReadonly<GameState>): boolean {
  const saved = writeSaved(storage, slot, state, Date.now());
  if (typeof saved === 'string') {
    showNotice(`The game was not saved. ${saved}`);
    return false;
  }
  saves = { ...saves, [slot]: saved };
  return true;
}

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
  state: newGame(map, { seed: Date.now(), player: entry ?? 'rome' }),
  world,
  now: () => performance.now(),
  decide: (state) => decideAll(state, world),
  onRejected(rejected) {
    const own = rejected.filter(({ order }) => order.faction === clock.state.player);
    const last = own.at(-1);
    if (last) showNotice(refusalText(clock.state, last.reason));
  },
  onDay(before, after, events) {
    const news = alertsInSight(
      alertsOfDay(before, after, events),
      sightFor(before),
      sightFor(after),
    );
    if (news.length > 0) alerts = [...news.reverse(), ...alerts].slice(0, ALERTS_KEPT);
    for (const point of turningPoints(before, after, world)) {
      if (point.kind === 'fate' && !pauseOnFate) continue;
      if (point.kind === 'won' && announced) continue;
      if (point.kind === 'won') announced = true;
      modals = enqueue(modals, point);
      stopAsked = true;
    }
    modals = keepOpen(modals, (city) => fateOpen(after, city));
    if (startsMonth(after.day) && after.factions[after.player]?.defeatedOn === null) {
      save('auto', after);
    }
  },
});
if (!entry) clock.pause();

let shownFate: { state: DeepReadonly<GameState>; city: CityId; choices: FateChoice[] } | undefined;

function shownModal(): ShownModal | undefined {
  const [front] = modals;
  if (front?.kind !== 'fate') return front;
  const state = clock.state;
  if (shownFate?.state !== state || shownFate.city !== front.city) {
    shownFate = { state, city: front.city, choices: fateChoices(state, world, front.city) };
  }
  return { ...front, choices: shownFate.choices };
}

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
    frame: {
      powers,
      modal: shownModal(),
      saves,
      pauseOnFate,
      standing: standingOf(clock.state, world, clock.state.player),
    },
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
let planned: ReturnType<typeof plannedRoutes> = { paths: [], replaced: new Set() };

function plannedNow(): ReturnType<typeof plannedRoutes> {
  if (clock.pending !== plannedFor) {
    plannedFor = clock.pending;
    planned = plannedRoutes(clock.state, world, clock.pending);
  }
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
  if (stopAsked) {
    stopAsked = false;
    if (!clock.paused) {
      clock.pause();
      resumeOnClose = true;
    }
    view.refresh();
  }
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
    planned: plannedNow().paths,
    replaced: plannedNow().replaced,
    previousSight: sightFor(clock.previous),
    sight,
  });
  if (drew) meter?.drew(performance.now() - start);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

/** The player's capital while they hold it, else their most populous city. */
function homeOf(state: DeepReadonly<GameState>): MapPoint | undefined {
  const { home, holdsHome } = standingOf(state, world, state.player);
  const capital = holdsHome && home ? state.cities[home] : undefined;
  const largest = Object.values(state.cities)
    .filter((city) => city.owner === state.player)
    .sort((a, b) => b.population - a.population)[0];
  return (capital ?? largest)?.position;
}

/**
 * Replaces the game. `pause` stops the clock for a player who just arrived, and
 * `focus` brings the camera to their land. A dropped file changes neither, as before.
 */
function enter(state: GameState, { pause, focus }: { pause: boolean; focus: boolean }) {
  clock.load(state);
  alerts = [];
  menu = undefined;
  modals = [];
  stopAsked = false;
  resumeOnClose = false;
  announced = outcomeOf(state, world, state.player).kind === 'won';
  if (pause) clock.pause();
  const home = focus ? homeOf(state) : undefined;
  if (home) renderer.focus(home);
  view.refresh();
}

function loadText(text: string, how: { pause: boolean; focus: boolean }) {
  const loaded = loadGame(text);
  if (!loaded.ok) {
    showNotice(`The save did not load. ${loaded.error}`);
    view.refresh();
    return;
  }
  enter(loaded.state, how);
}

function closeModal() {
  modals = modals.slice(1);
  if (modals.length === 0 && resumeOnClose) {
    resumeOnClose = false;
    clock.resume();
  }
  view.refresh();
}

// Dropping a save file on the page loads it, on the start screen too.
window.addEventListener('dragover', (event) => event.preventDefault());
window.addEventListener('drop', (event) => {
  event.preventDefault();
  const file = event.dataTransfer?.files[0];
  if (!file) return;
  void file.text().then((text) => loadText(text, { pause: false, focus: false }));
});

const frame: FrameActions = {
  choosePower(power) {
    enter(newGame(map, { seed: Date.now(), player: power }), { pause: true, focus: true });
    modals = [{ kind: 'guide' }];
    view.refresh();
  },
  continueGame() {
    const latest = latestSaved(saves);
    if (latest) loadText(latest.text, { pause: true, focus: true });
  },
  showStart() {
    clock.pause();
    modals = enqueue(modals, { kind: 'start' });
    resumeOnClose = false;
    menu = undefined;
    view.refresh();
  },
  openGuide() {
    if (modals[0]?.kind === 'guide') return;
    modals = [{ kind: 'guide' }, ...modals];
    view.refresh();
  },
  closeModal,
  decideFate(order) {
    if (order) clock.issue(order);
    closeModal();
  },
  setPauseOnFate(on) {
    pauseOnFate = on;
    try {
      if (on) storage?.removeItem(PAUSE_ON_FATE_KEY);
      else storage?.setItem(PAUSE_ON_FATE_KEY, 'off');
    } catch {
      // Storage can be blocked. The choice then lasts until the page closes.
    }
    view.refresh();
  },
  saveToBrowser() {
    save('manual', clock.state);
    view.refresh();
  },
  loadFromBrowser(slot) {
    const saved = saves[slot];
    if (saved) loadText(saved.text, { pause: true, focus: true });
  },
  exportFile() {
    const state = clock.state;
    const realm = state.factions[state.player]?.name ?? state.player;
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([saveGame(state)], { type: 'application/json' }));
    link.download = `${realm.toLowerCase()}-day-${state.day}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 0);
  },
  importFile(file) {
    void file.text().then((text) => loadText(text, { pause: true, focus: true }));
  },
};

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

mount(Hud, { target: host, props: { view, map, actions, frame } });
