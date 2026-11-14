import { describe, expect, it } from 'vitest';
import { buildFixture, FIXTURE } from '../sim/fixture.ts';
import type { CityId, SiegeId } from '../sim/ids.ts';
import { loadGame, saveGame } from '../sim/save.ts';
import type { Day } from '../sim/state/day.ts';
import type { Alert } from './alerts.ts';
import { CHRONICLE_KEPT, pageData, parsePage, type Page } from './page.ts';
import { readSaved, writeSaved } from './saves.ts';
import { createClock } from './clock.ts';
import { fixtureWorld } from '../sim/fixture.ts';
import { executeOrder } from '../sim/orders/orders.ts';
import { expectConsistent } from '../sim/references.ts';
import { warKey } from '../sim/state/war.ts';

const f = FIXTURE;

function memoryStorage(): Storage {
  const items = new Map<string, string>();
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  } as Storage;
}

const news = (day: number, text: string): Alert => ({
  kind: 'battleBegan',
  day: day as Day,
  tone: 'neutral',
  text,
  focus: { at: { x: 10, y: 20 }, select: { kind: 'battle', battle: 'battle-1' as never } },
  pause: { kind: 'battle' },
  paused: true,
});

/** A page that has kept more news than the corner list shows, and looks at Syracusae. */
function keptPage(): Page {
  return {
    chronicle: Array.from({ length: 120 }, (_, i) => news(120 - i, `Battle ${120 - i}`)),
    camera: { centre: { x: 2661.2, y: 2911.3 }, scale: 1.4 },
    selection: { kind: 'army', army: f.romanArmy },
    panel: 'chronicle',
    occupied: new Map([[f.syracusae as CityId, 4 as Day]]),
    told: new Set(['["carthage","rome"]@1']),
    weakSieges: new Map([
      ['siege-1' as SiegeId, { men: new Map([[f.romanArmy, 1200]]), killed: 300, bled: false }],
    ]),
  };
}

describe('the page a save keeps', () => {
  it.each([true, false])('keeps the paused clock owner, automatic-resume=%s, through a save and load', (resumeOnClose) => {
    const page = { ...keptPage(), paused: true, resumeOnClose };
    const loaded = loadGame(saveGame(buildFixture(), pageData(page)));
    if (!loaded.ok) throw new Error(loaded.error);
    const parsed = parsePage(loaded.page);
    expect(parsed).toMatchObject({ ok: true, page: { paused: true, resumeOnClose } });
  });

  it.each([true, false])(
    'restores an offer queued while paused=%s and plays it exactly once',
    (paused) => {
      const world = fixtureWorld();
      const state = buildFixture();
      expect(
        executeOrder(state, { kind: 'declareWar', faction: f.rome, against: f.carthage }, world),
      ).toBeUndefined();
      let now = 0;
      const clock = createClock({ state, world, now: () => now });
      if (paused) clock.pause();
      const offer = {
        kind: 'offerPeace',
        faction: f.rome,
        to: f.carthage,
        terms: { kind: 'asThingsStand' },
      } as const;
      clock.issue(offer);
      const page = { ...keptPage(), paused, pendingPeace: [offer] };
      const loaded = loadGame(saveGame(clock.state, pageData(page)));
      if (!loaded.ok) throw new Error(loaded.error);
      const parsed = parsePage(loaded.page);
      if (!parsed.ok || !parsed.page) throw new Error('page did not load');
      clock.load(loaded.state, parsed.page.pendingPeace);
      expect(clock.pending).toEqual([offer]);
      expect(clock.paused).toBe(paused);
      clock.resume();
      now = 1000;
      clock.frame();
      expect(clock.state.peaceOffers[warKey(f.rome, f.carthage)]?.terms).toEqual(offer.terms);
      expect(clock.pending).toEqual([]);
      expectConsistent(clock.state);
    },
  );

  it('refuses malformed persisted peace orders rather than silently losing them', () => {
    const page = {
      ...(pageData(keptPage()) as object),
      pendingPeace: [
        {
          kind: 'offerPeace',
          faction: f.rome,
          to: f.carthage,
          terms: { kind: 'payment', payer: f.rome, gold: -1, cities: [] },
        },
      ],
    };
    expect(parsePage(page)).toMatchObject({
      ok: false,
      error: expect.stringContaining('pendingPeace'),
    });
  });
  it('loads back the chronicle, the camera, the selection, the open panel, the occupied cities, and what the news told', () => {
    const page = keptPage();
    const loaded = loadGame(saveGame(buildFixture(), pageData(page)));
    if (!loaded.ok) throw new Error(loaded.error);
    const parsed = parsePage(loaded.page);
    expect(parsed).toEqual({ ok: true, page });
  });

  it('keeps the page in a browser slot', () => {
    const storage = memoryStorage();
    const saved = writeSaved(storage, 'manual', buildFixture(), 1, pageData(keptPage()));
    expect(typeof saved).not.toBe('string');
    const read = readSaved(storage, 'manual');
    const loaded = read && loadGame(read.text);
    if (!loaded?.ok) throw new Error('the slot did not load');
    const parsed = parsePage(loaded.page);
    expect(parsed.ok && parsed.page?.chronicle).toHaveLength(120);
  });

  it('reads a save without a page as one that opens fresh, and refuses a malformed page', () => {
    const bare = loadGame(saveGame(buildFixture()));
    if (!bare.ok) throw new Error(bare.error);
    expect(parsePage(bare.page)).toEqual({ ok: true, page: undefined });
    const bad = parsePage({ ...(pageData(keptPage()) as object), panel: 'nowhere' });
    expect(bad).toMatchObject({
      ok: false,
      error: expect.stringMatching(/^The save's page is malformed at page\.panel/),
    });
    const long = {
      ...(pageData(keptPage()) as object),
      chronicle: Array.from({ length: CHRONICLE_KEPT + 1 }, () => news(1, 'x')),
    };
    expect(parsePage(long).ok).toBe(false);
  });
});
