import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { plainName, readCandidates, usualName, type PleiadesFiles } from './settlements.ts';

const BOM = String.fromCharCode(0xfeff);
const csv = (header: string, rows: string[]) => `${BOM}${[header, ...rows].join('\n')}\n`;

interface Place {
  id: number;
  title?: string;
  types?: string[];
  precision?: string;
  locations?: [after: string, before: string, certainty?: string][];
  /** The place's names in Pleiades; by default one Latin name, its title. */
  names?: [form: string, language: string, after: string, before: string][];
}

function files(places: Place[], connections: [from: number, type: string, to: number][] = []) {
  const all: PleiadesFiles = {
    timePeriods: csv('key,term,definition,lower_bound,upper_bound,same_as', [
      'archaic,Archaic,"a, b",750 BC,550 BC,',
      'classical,Classical,"c",550 BC,330 BC,',
      'hellenistic-republican,Hellenistic,"d",330 BC,30 BC,',
      'roman,Roman,"e",30 BC,AD 300,',
      'late-antique,Late Antique,"f",AD 300,AD 640,',
    ]),
    places: csv(
      'created,description,details,provenance,title,uri,id,representative_latitude,representative_longitude,bounding_box_wkt,location_precision',
      places.map(
        (p) =>
          `2020,"A place, described",,P,"${p.title ?? placeName(p.id)}",u,${p.id},40,20,,${p.precision ?? 'precise'}`,
      ),
    ),
    placeTypes: csv(
      'place_id,place_type',
      places.flatMap((p) => (p.types ?? ['settlement']).map((type) => `${p.id},${type}`)),
    ),
    locationPoints: csv(
      'created,description,details,provenance,title,uri,id,place_id,accuracy_assessment_uri,accuracy_radius,archaeological_remains,association_certainty,geometry_wkt,year_after_which,year_before_which,location_precision',
      places.flatMap((p) =>
        (p.locations ?? [['-400', '-300']]).map(
          ([after, before, certainty], i) =>
            `2020,,,P,L,u,loc-${p.id}-${i},${p.id},a,20,unknown,${certainty ?? 'certain'},"POINT (20 40)",${after},${before},precise`,
        ),
      ),
    ),
    names: csv(
      'created,description,details,provenance,title,uri,id,place_id,name_type,language_tag,attested_form,romanized_form_1,romanized_form_2,romanized_form_3,association_certainty,transcription_accuracy,transcription_completeness,year_after_which,year_before_which',
      places.flatMap((p) =>
        (p.names ?? [[p.title ?? placeName(p.id), 'la', '', '']]).map(
          ([form, language, after, before], i) =>
            `2020,,,P,"${form}",u,n-${p.id}-${i},${p.id},geographic,${language},"${form}","${form}",,,certain,accurate,complete,${after},${before}`,
        ),
      ),
    ),
    connections: csv(
      'created,description,details,provenance,title,uri,id,place_id,connection_type,connects_to,association_certainty,year_after_which,year_before_which',
      connections.map(
        ([from, type, to], i) =>
          `2020,,,P,C,u,c${i},${from},${type},https://pleiades.stoa.org/places/${to},certain,,`,
      ),
    ),
  };
  return all;
}

/** A test place's default title, in letters, since a figure in a name marks an editor's form. */
const placeName = (id: number) =>
  `Locus ${[...String(id)].map((d) => String.fromCharCode(97 + Number(d))).join('')}`;

const ids = (all: PleiadesFiles) => readCandidates(all).map((candidate) => candidate.pleiadesId);

test('a place dated inside the classical, Hellenistic, or Roman period is a candidate', () => {
  expect(
    ids(
      files([
        { id: 1, locations: [['-500', '-400']] },
        { id: 2, locations: [['-200', '-100']] },
        { id: 3, locations: [['-30', '300']] },
        { id: 4, locations: [['100', '200']] },
        { id: 5, locations: [['-1000', '500']] },
      ]),
    ),
  ).toEqual([1, 2, 3, 4, 5]);
});

test('a place dated only outside the span, or only touching its ends, is not', () => {
  expect(
    ids(
      files([
        { id: 1, locations: [['-750', '-600']] },
        { id: 2, locations: [['400', '600']] },
        { id: 3, locations: [['-750', '-550']] },
        { id: 4, locations: [['300', '640']] },
        { id: 5, locations: [['', '']] },
      ]),
    ),
  ).toEqual([]);
});

test('only a certain location counts, and only a precise place with a settlement type', () => {
  expect(
    ids(
      files([
        { id: 1, locations: [['-400', '-300', 'less-certain']] },
        { id: 2, precision: 'rough' },
        { id: 3, types: ['temple-2'] },
        { id: 4, types: ['settlement-modern'] },
        { id: 5, title: 'Unnamed settlement' },
        { id: 6, title: 'Oinoe?' },
        { id: 7, types: ['urban'] },
        { id: 8, types: ['fortified-settlement'] },
        {
          id: 9,
          locations: [
            ['-400', '-300', 'uncertain'],
            ['-400', '-300'],
          ],
        },
      ]),
    ),
  ).toEqual([7, 8, 9]);
});

test('the name is the title before its first slash', () => {
  const [candidate] = readCandidates(files([{ id: 1, title: 'Hierapolis/Pamukkale' }]));
  expect(candidate?.name).toBe('Hierapolis');
});

test('a town is urban or fortified, or has another place at or in it; the rest are villages', () => {
  const ranks = readCandidates(
    files(
      [
        { id: 1, types: ['urban'] },
        { id: 2, types: ['fortified-settlement'] },
        { id: 3 },
        { id: 4 },
        { id: 5 },
        { id: 10, types: ['temple-2'] },
        { id: 11, types: ['theatre'] },
      ],
      [
        [10, 'at', 3],
        [11, 'in', 3],
        [10, 'near', 4],
        [11, 'part_of_physical', 5],
      ],
    ),
  ).map(({ pleiadesId, town, sites }) => [pleiadesId, town ? 'town' : 'village', sites]);
  expect(ranks).toEqual([
    [1, 'town', 0],
    [2, 'town', 0],
    [3, 'town', 2],
    [4, 'village', 0],
    [5, 'town', 1],
  ]);
});

test('a title becomes the plain name a map writes, with the editors’ marks gone', () => {
  const cases: [string, string | undefined][] = [
    ['Tarracina(e)', 'Tarracina'],
    ['Durno(no)varia', 'Durnovaria'],
    ['Ur(i)', 'Ur'],
    // Cappadocian Nyssa, the see of Gregory of Nyssa, keeps its double s.
    ['Nys(s)a', 'Nyssa'],
    ['Al(l)ifae', 'Allifae'],
    ['(H)Emesa', 'Emesa'],
    ['(Tri)Paradeisos', 'Triparadeisos'],
    ['[(A)Bivard]', 'Abivard'],
    ['Dur-(Kuri)galzu', 'Dur-Kurigalzu'],
    ['[Siraf]', 'Siraf'],
    ['*Moridunum', 'Moridunum'],
    ['Vicus *Ramidava', 'Vicus Ramidava'],
    ['Ricciacum (or Ricciacus)', 'Ricciacum'],
    ['Thasos (settlement)', 'Thasos'],
    ['Calagurris (Nassica) Iulia', 'Calagurris Iulia'],
    ['Tell al-Deir (al-Aqul)', 'Tell al-Deir'],
    ['Lugdunum/Lyon', 'Lugdunum'],
    ['Aquae S(...)', undefined],
  ];
  for (const [title, name] of cases) expect(plainName(title)).toBe(name);
});

test('a place is written by the name it bore in the game’s periods, or left off the map', () => {
  const cases: [string, [string, string, string, string][], string | null][] = [
    ['Tell el-Moqdam', [['Leontopolis', '', '-330', '300']], 'Leontopolis'],
    ['Hérisson, Cm.', [], null],
    ['Kablow', [], null],
    ['Col. Barcino', [['Col. Barcino', 'akk', '-30', '640']], 'Barcino'],
    ['Pherai', [['Phérai', 'grc', '-750', '640']], 'Pherai'],
    [
      'Carchemish',
      [
        ['Carchemish', 'en', '1700', '2100'],
        ['Εὔρωπος', 'grc', '-550', '-30'],
        ['Europos', '', '-330', '640'],
      ],
      'Europos',
    ],
    [
      'Amman',
      [
        ['ʿAmmān', 'ar', '-3300', '2000'],
        ['Philadelpheia', 'grc', '-330', '640'],
      ],
      'Philadelpheia',
    ],
    ['Dur-Katlimmu', [['Dūr-Katlimmu', 'arc', '-750', '300']], 'Dur-Katlimmu'],
    ['Semnan', [['Semína', 'grc', '-330', '-30']], 'Semina'],
  ];
  for (const [title, names, name] of cases) {
    const [candidate] = readCandidates(files([{ id: 1, title, names }]));
    expect(candidate?.name ?? null).toBe(name);
  }
  expect(usualName('Alauna', [{ form: 'Alauna', language: '' }])).toBe('Alauna');
});

test('every place on the built map has a plain ancient name', () => {
  const map = JSON.parse(
    readFileSync(resolve(import.meta.dirname, '../../data/map/map.json'), 'utf8'),
  ) as { settlements: { name: string }[] };
  const modern =
    /[,.;?()\d]|[^\p{Script=Latin}\s'’-]|\p{M}|\b(?:Tell|Tall|Tepe|tepe|Kom|Bir|Ain|Henchir|Khirbet|Qasr|Wadi|Jebel|Gebel|Bad|Col|Fort|Roman|Settlement|Villa)\b|\b(?:el|al|ed|es)-/u;
  const names = map.settlements.map(({ name }) => name);
  expect(names.filter((name) => modern.test(name.normalize('NFD')))).toEqual([]);
});
