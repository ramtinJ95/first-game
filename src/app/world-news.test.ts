import { describe, expect, it } from 'vitest';
import { defeatFaction } from '../sim/defeat.ts';
import { buildFixture, FIXTURE } from '../sim/fixture.ts';
import type { CityId, FactionId } from '../sim/ids.ts';
import type { Day } from '../sim/state/day.ts';
import type { GameState } from '../sim/state/game-state.ts';
import { warKey } from '../sim/state/war.ts';
import { cornerAlerts, type Alert } from './alerts.ts';
import { worldNewsOfDay } from './world-news.ts';

const f = FIXTURE;

/** The world news of a day on which `change` happened to a copy of the fixture. */
function newsOf(change: (state: GameState) => void, setup?: (state: GameState) => void) {
  const before = buildFixture();
  setup?.(before);
  const after = structuredClone(before);
  after.day = (before.day + 1) as Day;
  change(after);
  return worldNewsOfDay(before, after, []).map((alert) => [alert.kind, alert.world, alert.text]);
}

function owner(state: GameState, city: CityId, faction: FactionId) {
  const record = state.cities[city];
  if (!record) throw new Error('fixture changed');
  record.owner = faction;
}

describe('worldNewsOfDay', () => {
  it('tells every power of a war between two other great powers, and of their peace', () => {
    const before = buildFixture();
    before.player = f.syracusaeFaction;
    const after = structuredClone(before);
    after.wars[warKey(f.rome, f.carthage)] = { since: after.day };
    const war = worldNewsOfDay(before, after, [
      { kind: 'warDeclared', by: f.carthage, against: f.rome },
    ]);
    expect(war.map((a) => [a.kind, a.world, a.tone, a.text])).toEqual([
      ['powersAtWar', 'corner', 'neutral', 'Carthage declared war on Rome'],
    ]);
    expect(worldNewsOfDay(after, before, []).map((a) => a.text)).toEqual([
      'Carthage and Rome made peace',
    ]);
  });

  it("does not tell the player's own wars, which alertsOfDay tells", () => {
    const before = buildFixture();
    const after = structuredClone(before);
    after.wars[warKey(f.rome, f.carthage)] = { since: after.day };
    expect(
      worldNewsOfDay(before, after, [{ kind: 'warDeclared', by: f.carthage, against: f.rome }]),
    ).toEqual([]);
  });

  it('tells of a great capital that falls to another power, out of sight or not', () => {
    expect(newsOf((state) => owner(state, f.carthago, f.syracusaeFaction))).toContainEqual([
      'capitalFell',
      'corner',
      'Carthago, the capital of Carthage, fell to Syracusae',
    ]);
  });

  it("tells in the chronicle only of a city near the player's land that changes hands, and not of one far away", () => {
    expect(
      newsOf(
        (state) => owner(state, f.capua, f.syracusaeFaction),
        (state) => owner(state, f.capua, f.carthage),
      ),
    ).toEqual([['cityNearFell', 'chronicle', 'Capua fell to Syracusae, 170 km from your land']]);
    expect(newsOf((state) => owner(state, f.syracusae, f.carthage))).toEqual([]);
  });

  it('tells when another great power is destroyed, and once', () => {
    const before = buildFixture();
    const after = structuredClone(before);
    owner(after, f.carthago, f.rome);
    defeatFaction(after, f.carthage);
    const news = worldNewsOfDay(before, after, []);
    expect(news.filter((a) => a.kind === 'powerFell').map((a) => a.text)).toEqual([
      'Carthage has fallen: it holds no city',
    ]);
    expect(worldNewsOfDay(after, structuredClone(after), [])).toEqual([]);
  });

  it('tells when a new great power leads, by the rule the others join against it by', () => {
    expect(newsOf((state) => owner(state, f.capua, f.carthage))).toEqual([
      [
        'newLeader',
        'corner',
        'Carthage is now the leading power, with 2 cities: the other powers will join against it',
      ],
    ]);
    expect(
      newsOf(
        (state) => owner(state, f.capua, f.rome),
        (state) => owner(state, f.capua, f.syracusaeFaction),
      ),
    ).toContainEqual([
      'newLeader',
      'corner',
      'You are now the leading power, with 2 cities: the other powers will join against you',
    ]);
  });
});

describe('cornerAlerts', () => {
  it('leaves the world news kept for the chronicle out of the corner', () => {
    const alert = (text: string, world?: Alert['world']): Alert => ({
      kind: 'cityNearFell',
      day: 1 as Day,
      text,
      tone: 'neutral',
      ...(world && { world }),
    });
    const chronicle = [
      alert('a', 'chronicle'),
      alert('b', 'corner'),
      alert('c'),
      alert('d', 'chronicle'),
      alert('e'),
    ];
    expect(cornerAlerts(chronicle, 2).map((a) => a.text)).toEqual(['b', 'c']);
  });
});
