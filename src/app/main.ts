import { flushSync, mount } from 'svelte';
import mapUrl from '../../data/map/map.json?url';
import { parseDrawOptions } from '../render/draw-options.ts';
import type { Pick } from '../render/pick.ts';
import { createRenderer, type Command, type Insets } from '../render/renderer.ts';
import { decideAll } from '../sim/ai/decide.ts';
import type { DeepReadonly } from '../sim/deep-readonly.ts';
import { FATE_DAYS } from '../sim/cities.ts';
import type { CityId, FactionId, SiegeId } from '../sim/ids.ts';
import { parseMap, POWERS, type GameMap, type PowerId } from '../sim/map.ts';
import { newGame, POWER_NAMES } from '../sim/new-game.ts';
import type { Order } from '../sim/orders/orders.ts';
import { outcomeOf, standingOf, type Standing } from '../sim/outcome.ts';
import { loadGame, saveGame, type Refusal } from '../sim/save.ts';
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
import { forgetNamedWaits } from '../ui/named-waits.ts';
import { createClock } from './clock.ts';
import { desertionNews, type Desertion } from './desertion.ts';
import { tradeNews, type TradeTrouble } from './trade-news.ts';
import { commandTarget, planCommand, plannedRoutes, type Plan } from './command.ts';
import { fateChoices } from './fates.ts';
import { showFrameMeter } from './frame-meter.ts';
import { guardNewsOfDay } from './guard-news.ts';
import { BUILDING_HINT_KEY, buildingHintOfDay } from './building-hint.ts';
import { advanceNewsOfDay } from './advance-news.ts';
import { unpaidNewsOfDay } from './unpaid-news.ts';
import { refusalText } from './names.ts';
import { alertsInSight, followJoin, seesPick, sightOfAll } from './sighted.ts';
import { enqueue, keepOpen, unansweredOffer, type Modal } from './modals.ts';
import { CHRONICLE_KEPT, pageData, parsePage, type Page, type Panel } from './page.ts';
import { readPauses, stopsOfDay, writePauses, type PauseSettings } from './pauses.ts';
import {
  browserStorage,
  latestSaved,
  readSaved,
  REFUSED_SAVE,
  SLOTS,
  startsMonth,
  writeSaved,
  type Saved,
  type Slot,
} from './saves.ts';
import { turningPoints } from './turning-points.ts';
import { threatFadedNewsOfDay, threatNewsOfDay } from './threat-news.ts';
import { createAnswerNews } from './answer-news.ts';
import { trainingThreats } from '../ui/recruit-threats.ts';
import { leaderNews, leadingPower, worldNewsOfDay } from './world-news.ts';
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
  warThreat: false,
  advance: false,
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
/**
 * The player asked for the game to run once the modals close: they were running it when
 * they asked to leave and chose Stay, or chose Play on after the win.
 */
let resumeWhenClear = false;

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
/** The raids and sieges of the player's trade that the news is in the middle of telling. */
let tradeTroubles: readonly TradeTrouble[] = [];
/** The leading power the player was last told of. A save keeps it; a new game or an older save starts from the one that leads. */
let leaderTold: FactionId | undefined;
/** The game played without the player's answer to a warning, while one may still turn out either way. */
let answerNews = createAnswerNews(world);

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
  onDay(before, after, events, orders) {
    answerNews.onDay(before, after, events, orders);
    const saw = sightFor(before);
    const sees = sightFor(after);
    const weak = weakSiegeNews(before, after, weakSieges);
    weakSieges = weak.watched;
    const shortage = desertionNews(before, after, events, desertion);
    desertion = shortage.watched;
    const trade = tradeNews(before, after, events, tradeTroubles);
    tradeTroubles = trade.watched;
    const leader = leaderNews(before, after, leaderTold);
    leaderTold = leader.told;
    const hint = buildingHintOfDay(before, after, toldOnce);
    const stops = stopsOfDay(
      groupAlerts([
        ...alertsInSight(alertsOfDay(before, after, events, occupied, toldOnce), saw, sees),
        ...sightingsOfDay(before, after, saw, sees, world, toldOnce),
        ...weak.alerts,
        ...shortage.alerts,
        ...trade.alerts,
        // The world's news reaches every power, whether it sees the place or not.
        ...worldNewsOfDay(before, after, events, world),
        ...leader.alerts,
        ...threatFadedNewsOfDay(before, after, world, toldOnce),
        ...threatNewsOfDay(
          before,
          after,
          world,
          toldOnce,
          trainingThreats,
          newsPauses && pauses.warThreat,
        ),
        ...guardNewsOfDay(before, after),
        ...unpaidNewsOfDay(before, after, events),
        ...hint,
        ...advanceNewsOfDay(before, after, events, toldOnce, hint.length > 0),
      ]),
      newsPauses ? pauses : NO_PAUSES,
      toldOnce,
    );
    toldOnce = hint.length > 0 ? new Set([...stops.told, BUILDING_HINT_KEY]) : stops.told;
    if (stops.news.length > 0) {
      chronicle = [...stops.news.reverse(), ...chronicle].slice(0, CHRONICLE_KEPT);
    }
    // The clock runs no further day once paused, so the game stops on the day of the news.
    if (stops.stop) clock.pause();
    for (const point of turningPoints(before, after, world)) {
      if (point.kind === 'peaceOffer') {
        // The offer is answered in the wars panel, so the game stops on the day it came.
        clock.pause();
        panel = 'wars';
        continue;
      }
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

let shownFate:
  | { state: DeepReadonly<GameState>; front: Extract<Modal, { kind: 'fate' }>; shown: ShownModal }
  | undefined;

function shownModal(): ShownModal | undefined {
  const [front] = modals;
  if (front?.kind !== 'fate') return front;
  const state = clock.state;
  if (shownFate?.state !== state || shownFate.front !== front) {
    shownFate = {
      state,
      front,
      shown: { ...front, choices: fateChoices(state, world, front.city) },
    };
  }
  return shownFate.shown;
}

const standings = new WeakMap<DeepReadonly<GameState>, Standing>();
function standingFor(state: DeepReadonly<GameState>): Standing {
  let standing = standings.get(state);
  if (!standing) {
    standing = standingOf(state, world, state.player);
    standings.set(state, standing);
  }
  return standing;
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
    told: toldOnce,
    frame: {
      powers,
      modal: shownModal(),
      saves,
      pauseOnFate,
      pauses,
      standing: standingFor(clock.state),
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
function command({ point, city, screen, islet }: Command) {
  menu = undefined;
  const state = clock.state;
  const army = selection?.kind === 'army' ? state.armies[selection.army] : undefined;
  if (army && army.owner === state.player) {
    const target = commandTarget(state, { point, city, islet });
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
  // The game without the player's answer plays its day on a frame that played none of the game's.
  if (clock.state === shown && answerNews.waiting) {
    const lines = answerNews.next();
    if (lines.length > 0) {
      chronicle = [...[...lines].reverse(), ...chronicle].slice(0, CHRONICLE_KEPT);
      view.refresh();
    }
  }
  // The top bar shows a new day in the frame that draws it, so Space pauses on the
  // day the player reads, not one the panels have yet to show.
  if (clock.state !== shown) view.refresh();
  if (stopAsked) {
    stopAsked = false;
    clock.pause();
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
    paused: clock.paused,
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
    paused: clock.paused || stopAsked,
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
    tradeTroubles,
    leaderTold,
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
  renderer.leaveGame();
  forgetNamedWaits();
  clock.load(state, page?.pendingPeace);
  answerNews = createAnswerNews(world);
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
  tradeTroubles = page?.tradeTroubles ?? [];
  leaderTold = page?.leaderTold ?? leadingPower(state);
  menu = undefined;
  stopAsked = false;
  const outcome = outcomeOf(state, world, state.player);
  announced = outcome.kind === 'won';
  modals =
    outcome.kind === 'lost'
      ? [{ kind: 'lost', on: outcome.on, city: undefined, by: undefined }]
      : openFates(state);
  const waiting = outcome.kind !== 'lost' && unansweredOffer(state, clock.pending);
  if (waiting) panel = 'wars';
  resumeWhenClear = false;
  if (pause || page?.paused || modals.length > 0 || waiting) clock.pause();
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
  if (!loaded.ok) return refuseSave(loaded.refusal, loaded.error);
  const page = parsePage(loaded.page);
  if (!page.ok) return refuseSave('damaged', page.error);
  enter(loaded.state, how, page.page);
}

/** A file the browser cannot read is refused like a damaged save, so the player is told. */
function loadFile(file: File, how: { pause: boolean; focus: boolean }) {
  file.text().then(
    (text) => loadText(text, how),
    (error: unknown) => refuseSave('damaged', String(error)),
  );
}

function refuseSave(refusal: Refusal, detail: string) {
  console.warn(`The save did not load. ${detail}`);
  showNotice(REFUSED_SAVE[refusal]);
  view.refresh();
}

function closeModal() {
  modals = modals.slice(1);
  if (modals.length === 0 && resumeWhenClear) {
    resumeWhenClear = false;
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
  loadFile(file, { pause: false, focus: false });
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
    resumeWhenClear = false;
    menu = undefined;
    view.refresh();
  },
  askToLeave() {
    if (clock.state.factions[clock.state.player]?.defeatedOn !== null) {
      frame.showStart();
      return;
    }
    resumeWhenClear = !clock.paused;
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
  playOn() {
    resumeWhenClear = true;
    closeModal();
  },
  watchOn() {
    modals = [];
    resumeWhenClear = false;
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
    loadFile(file, { pause: true, focus: true });
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
    if (alert.opens) {
      panel = alert.opens;
      view.refresh();
    }
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

mount(Hud, { target: host, props: { view, map, world, actions, frame } });
