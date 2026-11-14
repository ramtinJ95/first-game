import { flushSync, mount } from 'svelte';
import mapUrl from '../../data/map/map.json?url';
import { parseDrawOptions } from '../render/draw-options.ts';
import type { Pick } from '../render/pick.ts';
import { createRenderer, type Command, type Insets } from '../render/renderer.ts';
import { decideAll } from '../sim/ai/decide.ts';
import type { DeepReadonly } from '../sim/deep-readonly.ts';
import { FATE_DAYS } from '../sim/cities.ts';
import type { CityId, SiegeId } from '../sim/ids.ts';
import { parseMap, POWERS, type GameMap, type PowerId } from '../sim/map.ts';
import { newGame, POWER_NAMES } from '../sim/new-game.ts';
import type { Order } from '../sim/orders/orders.ts';
import { outcomeOf, standingOf } from '../sim/outcome.ts';
import { loadGame, saveGame } from '../sim/save.ts';
import { sightOf, type Sight } from '../sim/sight.ts';
import type { Day } from '../sim/state/day.ts';
import type { GameState } from '../sim/state/game-state.ts';
import type { MapPoint } from '../sim/state/map-point.ts';
import { buildWorld } from '../sim/world/world.ts';
import type { Actions } from '../ui/actions.ts';
import { GAME_NAME, type FrameActions } from '../ui/frame-actions.ts';
import Hud from '../ui/Hud.svelte';
import '../ui/panels.css';
import {
  alertsOfDay,
  groupAlerts,
  sightingsOfDay,
  weakSiegeNews,
  type Alert,
  type WeakSiege,
} from './alerts.ts';
import { createClock } from './clock.ts';
import { desertionNews, type Desertion } from './desertion.ts';
import { planCommand, plannedRoutes, type CommandTarget, type Plan } from './command.ts';
import { fateChoices, type FateChoice } from './fates.ts';
import { showFrameMeter } from './frame-meter.ts';
import { refusalText } from './names.ts';
import { alertsInSight, followJoin, seesPick, sightOfAll } from './sighted.ts';
import { enqueue, keepOpen, restoreModalResume, type Modal } from './modals.ts';
import { CHRONICLE_KEPT, pageData, parsePage, type Page, type Panel } from './page.ts';
import { readPauses, stopsOfDay, writePauses, type PauseSettings } from './pauses.ts';
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
import { standingOffer } from '../sim/peace/offer.ts';
import { worldNewsOfDay } from './world-news.ts';
import {
  createView,
  type CommandMenu,
  type Notice,
  type PowerCard,
  type ShownModal,
} from './view.svelte.ts';

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

/**
 * `?pauses=off` keeps the news from stopping the game, whatever the Game menu says.
 * Browser tests and capture scenarios that play through battles open the game this way.
 */
const newsPauses = new URLSearchParams(location.search).get('pauses') !== 'off';
const NO_PAUSES: PauseSettings = {
  battle: false,
  weakSiege: false,
  sighted: false,
  ownCity: false,
};

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
/** The day the selection was last checked against, so an army that joins another is followed. */
let checked: DeepReadonly<GameState> | undefined;
/** Every alert of the game, newest first, up to CHRONICLE_KEPT. */
let chronicle: readonly Alert[] = [];
let panel: Panel | undefined;
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
let pauses = readPauses(storage);
/** The keys of news that stops the game once, such as a war's first enemy in sight, already told. */
let toldOnce = new Set<string>();
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

/** Cities the player chose to occupy, with the day each fell. A new game or a load forgets them. */
let occupied = new Map<CityId, Day>();
/** The player's sieges too weak to cut the food that the player has been told of. */
let weakSieges = new Map<SiegeId, WeakSiege>();
let desertion: Desertion | undefined;

function fateOpen(state: DeepReadonly<GameState>, id: CityId): boolean {
  const city = state.cities[id];
  return (
    !!city &&
    city.owner === state.player &&
    city.fellOn !== null &&
    occupied.get(id) !== city.fellOn &&
    state.day - city.fellOn <= FATE_DAYS
  );
}

/** Settles the fate of a city the player captured by occupying it as it stands. */
function occupy(id: CityId) {
  const city = clock.state.cities[id];
  if (!city || city.fellOn === null) return;
  occupied = new Map(occupied).set(id, city.fellOn);
}

/** Writes the day to a browser slot, or tells the player why the browser refused it. */
function save(slot: Slot, state: DeepReadonly<GameState>): boolean {
  const saved = writeSaved(storage, slot, state, Date.now(), pageData(pageNow()));
  if (typeof saved === 'string') {
    showNotice(`The game was not saved. ${saved}`);
    return false;
  }
  saves = { ...saves, [slot]: saved };
  return true;
}

const sights = new WeakMap<DeepReadonly<GameState>, Sight>();
/**
 * What the player sees on a day, or the whole map once they have lost. A state never
 * changes once a tick returns it.
 */
function sightFor(state: DeepReadonly<GameState>): Sight {
  let sight = sights.get(state);
  if (!sight) {
    sight =
      state.factions[state.player]?.defeatedOn === null
        ? sightOf(state, world, state.player)
        : sightOfAll(state);
    sights.set(state, sight);
  }
  return sight;
}

function showNotice(text: string, tone: Notice['tone'] = 'bad') {
  notice = { id: (notice?.id ?? 0) + 1, text, tone };
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
    const saw = sightFor(before);
    const sees = sightFor(after);
    const weak = weakSiegeNews(before, after, weakSieges);
    weakSieges = weak.watched;
    const shortage = desertionNews(before, after, events, desertion);
    desertion = shortage.watched;
    const stops = stopsOfDay(
      groupAlerts([
        ...alertsInSight(alertsOfDay(before, after, events, occupied, toldOnce), saw, sees),
        ...sightingsOfDay(before, after, saw, sees, world, toldOnce),
        ...weak.alerts,
        ...shortage.alerts,
        // The world's news reaches every power, whether it sees the place or not.
        ...worldNewsOfDay(before, after, events, world),
      ]),
      newsPauses ? pauses : NO_PAUSES,
      toldOnce,
    );
    toldOnce = stops.told;
    if (stops.news.length > 0) {
      chronicle = [...stops.news.reverse(), ...chronicle].slice(0, CHRONICLE_KEPT);
    }
    // The clock runs no further day once paused, so the game stops on the day of the news.
    if (stops.stop) clock.pause();
    for (const point of turningPoints(before, after, world)) {
      if (point.kind === 'fate' && !pauseOnFate) continue;
      if (point.kind === 'won' && announced) continue;
      if (point.kind === 'won') announced = true;
      modals = enqueue(modals, point);
      stopAsked = true;
    }
    modals = keepOpen(
      modals,
      (city) => fateOpen(after, city),
      (from) => standingOffer(after, after.player, from)?.from === from,
    );
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
    alerts: chronicle,
    panel,
    notice,
    menu,
    sight: sightFor(clock.state),
    occupied,
    frame: {
      powers,
      modal: shownModal(),
      saves,
      pauseOnFate,
      pauses,
      standing: standingOf(clock.state, world, clock.state.player),
    },
  }),
  100,
  'panels',
);

/** Tells what an accepted march does, and warns when it begins a siege too weak to hold. */
function tellIssued(plan: Extract<Plan, { kind: 'issue' }>) {
  showNotice(plan.notice ? `${plan.info} ${plan.notice}` : plan.info, plan.notice ? 'bad' : 'info');
}

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
    const plan = planCommand(state, world, army, target, clock.pending);
    if (plan.kind === 'issue') {
      clock.issue(plan.order);
      tellIssued(plan);
    } else {
      if (plan.kind === 'menu') menu = { ...plan.menu, screen };
      if (plan.notice) showNotice(plan.notice);
    }
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
  const shown = clock.state;
  clock.frame();
  // The top bar shows a new day in the frame that draws it, so Space pauses on the
  // day the player reads, not one the panels have yet to show.
  if (clock.state !== shown) view.refresh();
  if (stopAsked) {
    stopAsked = false;
    if (!clock.paused) {
      clock.pause();
      resumeOnClose = true;
    }
    view.refresh();
  }
  const followed = followJoin(checked, clock.state, selection);
  checked = clock.state;
  if (followed !== selection) {
    selection = followed;
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

/** What the page keeps beside the game in a save. */
function pageNow(): Page {
  return {
    paused: clock.paused,
    resumeOnClose: resumeOnClose || (stopAsked && !clock.paused),
    pendingPeace: clock.pending.filter(
      (order): order is Extract<Order, { kind: 'offerPeace' | 'acceptPeace' | 'refusePeace' }> =>
        ['offerPeace', 'acceptPeace', 'refusePeace'].includes(order.kind),
    ),
    chronicle,
    camera: renderer.camera(),
    selection,
    panel,
    occupied,
    told: toldOnce,
    weakSieges,
    desertion,
  };
}

/**
 * Replaces the game. `pause` stops the clock for a player who just arrived, and
 * `focus` brings the camera to their land. A dropped file changes neither, as before.
 * A save's `page` puts back the chronicle, the open panel, the selection, and the
 * camera, so a loaded game opens where the player left it. A save without one, such as
 * a test's, keeps the selection and the panel.
 */
function enter(
  state: GameState,
  { pause, focus }: { pause: boolean; focus: boolean },
  page?: Page,
) {
  clock.load(state, page?.pendingPeace);
  chronicle = page?.chronicle ?? [];
  toldOnce = new Set(page?.told);
  occupied = new Map(page?.occupied);
  if (page) {
    panel = page.panel;
    selection =
      page.selection && seesPick(sightFor(state), page.selection) ? page.selection : undefined;
  }
  weakSieges = new Map(page?.weakSieges);
  desertion = page?.desertion;
  menu = undefined;
  stopAsked = false;
  const outcome = outcomeOf(state, world, state.player);
  announced = outcome.kind === 'won';
  modals =
    outcome.kind === 'lost'
      ? [{ kind: 'lost', on: outcome.on, city: undefined, by: undefined }]
      : openFates(state);
  if (outcome.kind !== 'lost') {
    for (const offer of Object.values(state.peaceOffers)) {
      if (
        offer.from === state.player ||
        standingOffer(state, state.player, offer.from)?.from !== offer.from
      )
        continue;
      const answered = page?.pendingPeace?.some(
        (order) =>
          (order.kind === 'acceptPeace' || order.kind === 'refusePeace') &&
          order.from === offer.from,
      );
      if (!answered) modals = enqueue(modals, { kind: 'peaceOffer', from: offer.from });
    }
  }
  resumeOnClose = restoreModalResume({
    saved: page,
    hasModal: modals.length > 0,
    paused: clock.paused,
    forcePause: pause,
  });
  if (pause || page?.paused || modals.length > 0) clock.pause();
  else if (page?.paused === false) clock.resume();
  const home = focus && !page?.camera ? homeOf(state) : undefined;
  view.refresh();
  if (page?.camera) renderer.lookAt(page.camera);
  else if (home) focusClear(home);
}

/** The screen px that the open panels cover along each edge of the map. */
function covered(): Insets {
  flushSync();
  const box = (selector: string) => {
    const element = document.querySelector(selector);
    return element && element.childElementCount > 0 ? element.getBoundingClientRect() : undefined;
  };
  const bar = box('[data-testid="top-bar"]');
  const overview = box('[data-testid="overview"]') ?? box('[data-testid="chronicle"]');
  const side = box('aside[aria-label="Selection"]');
  // Below 720 px the side column is a sheet along the bottom.
  const narrow = window.innerWidth < 720;
  return {
    top: bar?.bottom ?? 0,
    left: overview && !narrow ? overview.right : 0,
    right: side && !narrow ? window.innerWidth - side.left : 0,
    bottom: side && narrow ? window.innerHeight - side.top : 0,
  };
}

/** Centres the map on the point in the part the panels leave clear, once they show what was chosen. */
function focusClear(point: MapPoint) {
  renderer.focus(point, covered());
}

/** The fates a loaded game still waits on, which no day's change would announce. */
function openFates(state: DeepReadonly<GameState>): Modal[] {
  if (!pauseOnFate) return [];
  return Object.values(state.cities)
    .filter((city) => fateOpen(state, city.id))
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map((city) => ({ kind: 'fate', city: city.id }));
}

function loadText(text: string, how: { pause: boolean; focus: boolean }) {
  const loaded = loadGame(text);
  const page = loaded.ok ? parsePage(loaded.page) : loaded;
  if (!loaded.ok || !page.ok) {
    showNotice(`The save did not load. ${loaded.ok ? (page.ok ? '' : page.error) : loaded.error}`);
    view.refresh();
    return;
  }
  enter(loaded.state, how, page.page);
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
  askToLeave() {
    if (clock.state.factions[clock.state.player]?.defeatedOn !== null) {
      frame.showStart();
      return;
    }
    if (!clock.paused) resumeOnClose = true;
    clock.pause();
    modals = [{ kind: 'leave' }, ...modals];
    menu = undefined;
    view.refresh();
  },
  leave(keep) {
    if (keep && !save('manual', clock.state)) {
      view.refresh();
      return;
    }
    frame.showStart();
  },
  openGuide() {
    if (modals[0]?.kind === 'guide') return;
    modals = [{ kind: 'guide' }, ...modals];
    view.refresh();
  },
  closeModal,
  watchOn() {
    modals = [];
    resumeOnClose = false;
    clock.resume();
    view.refresh();
  },
  decideFate(order) {
    const front = modals[0];
    if (order) clock.issue(order);
    else if (front?.kind === 'fate') occupy(front.city);
    closeModal();
    // A game already paused, by other news of the day or by the player, stays paused,
    // so the order waits for the next day and the player is told so.
    const fate = order?.kind === 'sack' || order?.kind === 'enslave' ? order : undefined;
    const city = fate && clock.state.cities[fate.city];
    if (fate && city && clock.paused) {
      showNotice(
        `${city.name} will be ${fate.kind === 'sack' ? 'sacked' : 'enslaved'} when the next day runs`,
        'info',
      );
    }
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
  setPause(kind, on) {
    pauses = { ...pauses, [kind]: on };
    writePauses(storage, pauses);
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
    link.href = URL.createObjectURL(
      new Blob([saveGame(state, pageData(pageNow()))], { type: 'application/json' }),
    );
    link.download = `${realm.toLowerCase()}-day-${state.day}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 0);
  },
  importFile(file) {
    void file.text().then((text) => loadText(text, { pause: true, focus: true }));
  },
};

/** A fate to choose, a loss, a win, or the question to leave holds the game until the player answers it. */
function held(): boolean {
  return modals.some(
    ({ kind }) => kind === 'leave' || kind === 'fate' || kind === 'lost' || kind === 'won',
  );
}

const actions: Actions = {
  togglePause() {
    if (held()) return;
    // A deliberate clock action supersedes a modal's automatic resume.
    resumeOnClose = false;
    clock.togglePause();
    view.refresh();
  },
  setSpeed(speed) {
    clock.setSpeed(speed);
    view.refresh();
  },
  issue(order) {
    clock.issue(order);
    // A march a panel gives, such as Besiege, says what a right click would.
    const army = order.kind === 'moveArmy' ? clock.state.armies[order.army] : undefined;
    if (order.kind === 'moveArmy' && army) {
      const target = { kind: 'point', point: order.to } as const;
      const plan = planCommand(clock.state, world, army, target, clock.pending);
      if (plan.kind === 'issue') tellIssued(plan);
    }
    const front = modals[0];
    if (
      front?.kind === 'fate' &&
      (order.kind === 'sack' || order.kind === 'enslave') &&
      order.city === front.city
    ) {
      closeModal();
      return;
    }
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
    view.refresh();
    focusClear(at);
  },
  openAlert(alert) {
    if (!alert.focus) return;
    const { select } = alert.focus;
    if (select && seesPick(sightFor(clock.state), select)) selection = select;
    view.refresh();
    focusClear(alert.focus.at);
  },
  closeMenu() {
    menu = undefined;
    view.refresh();
  },
  togglePanel(next) {
    panel = panel === next ? undefined : next;
    view.refresh();
  },
  occupy(city) {
    occupy(city);
    const front = modals[0];
    if (front?.kind === 'fate' && front.city === city) {
      closeModal();
      return;
    }
    view.refresh();
  },
};

mount(Hud, { target: host, props: { view, map, actions, frame } });
