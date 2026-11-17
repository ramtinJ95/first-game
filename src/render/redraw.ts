import type { Container } from 'pixi.js';
import type { Frame } from './renderer.ts';

/**
 * Every reason the map draws a frame. `draw` draws no frame without one. The canvas counts
 * the frames it sends the GPU in `data-submitted-frames` and names the causes of the last
 * in `data-submitted-because`, and counts those drawn for no named cause in
 * `data-unnamed-frames`.
 */
export const REDRAW_CAUSES = {
  camera: 'a pan, a zoom, a focus, a resize, a loaded view, or a restored context moved the view',
  still: 'a capture asked for the still pose or let it go',
  clock: 'the game was paused or resumed',
  state: 'the page handed over another day or another game',
  sight: 'what the player sees changed',
  selection: 'the player selected something else, or the zoom changed under the selection',
  planned: 'an order given and not yet applied changed the paths drawn',
  terrain: 'terrain chunks are built or fade in, or the terrain texture was drawn again',
  fog: 'the fog moved',
  fades: 'a town or a name fades in or out',
  armies: 'a banner moved',
  columns: 'a refugee column moved',
  figures: 'the figures were built again, for a new day, a new view, or their motion',
  merchants: 'merchants walk a running route',
  swell: 'the sea swell stepped, while the game runs',
  unnamed: 'the scene changed for no cause named here, which a test reports',
} as const;
export type RedrawCause = keyof typeof REDRAW_CAUSES;

/**
 * Whether anything in the scene under `root` changed since Pixi last drew it: a child
 * added or removed, a transform, alpha or visibility set, or a drawing's content.
 */
export function sceneChanged(root: Container): boolean {
  const pending = (group: Container['renderGroup']): boolean =>
    group.structureDidChange ||
    group.childrenRenderablesToUpdate.index > 0 ||
    Object.values(group.childrenToUpdate).some((depth) => depth.index > 0) ||
    group.renderGroupChildren.some(pending);
  return pending(root.renderGroup);
}

/**
 * The cause each field of the frame the page hands over stands for. While the game is
 * paused the page hands over the same values each frame, and any that changes draws a
 * frame for its cause. A field added to `Frame` must be named here.
 */
export const FRAME_CAUSES: { readonly [K in keyof Frame]-?: RedrawCause } = {
  previous: 'state',
  current: 'state',
  progress: 'state',
  paused: 'clock',
  selection: 'selection',
  planned: 'planned',
  replaced: 'planned',
  previousSight: 'sight',
  sight: 'sight',
};

/** The causes of the fields that differ between two frames. */
export function changedFields(before: Frame | undefined, after: Frame): RedrawCause[] {
  if (!before) return ['state'];
  return (Object.keys(FRAME_CAUSES) as (keyof Frame)[])
    .filter((key) => !Object.is(before[key], after[key]))
    .map((key) => FRAME_CAUSES[key]);
}
