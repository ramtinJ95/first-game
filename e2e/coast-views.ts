import { mapPlane } from '../scripts/map/projection.ts';

const plane = mapPlane();
export const COAST_VIEWS = [
  { name: 'cyclades', title: 'Cyclades', lon: 25.1, lat: 37.15, scale: 4 },
  { name: 'delta', title: 'Nile delta', lon: 30.9, lat: 31.45, scale: 4 },
  { name: 'peloponnese', title: 'Southern Peloponnese', lon: 22.5, lat: 36.65, scale: 4 },
  { name: 'bosporus', title: 'Bosporus', lon: 29.05, lat: 41.12, scale: 4 },
  { name: 'hellespont', title: 'Hellespont', lon: 26.5, lat: 40.18, scale: 4 },
  { name: 'messina', title: 'Strait of Messina', lon: 15.6, lat: 38.15, scale: 4 },
  { name: 'carthage', title: 'Gulf of Tunis at Carthage', lon: 10.35, lat: 36.9, scale: 4 },
  { name: 'dalmatia', title: 'Dalmatian coast', lon: 16.2, lat: 43.5, scale: 4 },
  { name: 'brittany', title: 'Brittany', lon: -4.25, lat: 48.45, scale: 4 },
  { name: 'aegean-middle', title: 'Whole Aegean', lon: 25, lat: 38.35, scale: 1 },
  { name: 'italy-middle', title: 'Whole Italy', lon: 12.4, lat: 41.9, scale: 0.66 },
  { name: 'rhodes', title: 'Rhodos island', lon: 28.15, lat: 36.35, scale: 4 },
  { name: 'gades', title: 'Gades and its harbour', lon: -6.3, lat: 36.5, scale: 4 },
  {
    name: 'ionian-bound',
    title: 'Ionian coast, maximum shared-coast displacement',
    lon: 20.8375,
    lat: 39.0935,
    scale: 4,
  },
  {
    name: 'cilicia-bound',
    title: 'Cilicia, source shape limited by the physical coast',
    lon: 34.84,
    lat: 36.8663,
    scale: 4,
  },
].map(({ lon, lat, ...view }) => {
  const [x, y] = plane.toPlane([lon, lat]);
  return { ...view, at: { x, y } };
});
