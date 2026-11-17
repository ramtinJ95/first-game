import { Container, Graphics } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { buildFixture } from '../sim/fixture.ts';
import { changedFields, sceneChanged } from './redraw.ts';
import type { Frame } from './renderer.ts';

/** What Pixi leaves of a group's change lists once it has drawn it. */
function drawn(root: Container) {
  const clear = (group: Container['renderGroup']) => {
    group.structureDidChange = false;
    group.childrenRenderablesToUpdate.index = 0;
    for (const depth of Object.values(group.childrenToUpdate)) depth.index = 0;
    group.renderGroupChildren.forEach(clear);
  };
  clear(root.renderGroup);
  const settle = (container: Container) => {
    container.didChange = false;
    container.didViewUpdate = false;
    container.children.forEach(settle);
  };
  settle(root);
}

describe('sceneChanged', () => {
  function scene() {
    const stage = new Container({ isRenderGroup: true });
    const layer = new Container();
    const mark = new Graphics().circle(0, 0, 4).fill(0);
    const group = new Container({ isRenderGroup: true });
    const figure = new Graphics().rect(0, 0, 2, 2).fill(0);
    group.addChild(figure);
    layer.addChild(mark);
    stage.addChild(layer, group);
    drawn(stage);
    return { stage, layer, mark, figure };
  }

  it('sees nothing in a scene left as Pixi drew it, or set to what it already is', () => {
    const { stage, mark } = scene();
    expect(sceneChanged(stage)).toBe(false);
    mark.alpha = 1;
    mark.visible = true;
    mark.position.set(0, 0);
    expect(sceneChanged(stage)).toBe(false);
  });

  it.each([
    ['a move', ({ mark }) => mark.position.set(3, 0)],
    ['a fade', ({ mark }) => (mark.alpha = 0.5)],
    ['a hidden mark', ({ mark }) => (mark.visible = false)],
    ['a drawing redrawn', ({ mark }) => mark.clear().circle(0, 0, 5).fill(0)],
    ['a mark added', ({ layer }) => layer.addChild(new Graphics())],
    ['a mark taken away', ({ layer, mark }) => layer.removeChild(mark)],
    ['a move in a group of its own', ({ figure }) => figure.position.set(1, 1)],
  ] as [string, (parts: ReturnType<typeof scene>) => void][])('sees %s', (_, change) => {
    const parts = scene();
    change(parts);
    expect(sceneChanged(parts.stage)).toBe(true);
  });
});

describe('changedFields', () => {
  const state = buildFixture();
  const sight = { provinces: new Set(), armies: new Set(), battles: new Set(), sees: () => true };
  const frame = {
    previous: state,
    current: state,
    progress: 0.5,
    paused: true,
    selection: undefined,
    previousSight: sight,
    sight,
  } as unknown as Frame;

  it('names no cause for the frame handed over again', () => {
    expect(changedFields(frame, { ...frame })).toEqual([]);
  });

  it('names the cause of each field that changed', () => {
    expect(
      changedFields(frame, {
        ...frame,
        selection: { kind: 'province', province: 'roma' },
      } as Frame),
    ).toEqual(['selection']);
    expect(changedFields(frame, { ...frame, current: buildFixture() })).toEqual(['state']);
    expect(changedFields(frame, { ...frame, paused: false })).toEqual(['clock']);
    expect(changedFields(frame, { ...frame, planned: [] })).toEqual(['planned']);
  });

  it('draws the first frame it is given', () => {
    expect(changedFields(undefined, frame)).toEqual(['state']);
  });
});
