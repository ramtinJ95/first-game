import { Container, type Renderer } from 'pixi.js';
import { expect, test } from 'vitest';
import { cacheDrawing } from './cached-texture.ts';

function setup() {
  let renders = 0;
  const renderer = { resolution: 1, render: () => renders++ } as unknown as Renderer;
  const art = new Container();
  art.scale.set(0.25);
  art.position.set(17, 18);
  const cached = cacheDrawing(art, renderer, 256);
  const camera = { centre: { x: 1000, y: 1000 }, scale: 4 };
  const view = { width: 1280, height: 720 };
  return { art, cached, camera, view, renders: () => renders };
}

test('static ink draws once, preserves its own stroke transform, and slides through covered pans', () => {
  const { art, cached, camera, view, renders } = setup();
  cached.render(camera, view);
  expect(renders()).toBe(1);
  expect(art.scale.x).toBe(0.25);
  expect([art.x, art.y]).toEqual([17, 18]);
  const before = { x: cached.sprite.x, y: cached.sprite.y };
  cached.render(camera, view);
  cached.render({ ...camera, centre: { x: 1020, y: 1000 } }, view);
  expect(renders()).toBe(1);
  expect({ x: cached.sprite.x, y: cached.sprite.y }).toEqual(before);
  cached.render({ ...camera, centre: { x: 1100, y: 1000 } }, view);
  expect(renders()).toBe(2);
  expect(cached.sprite.x).toBe(before.x + 100);
  cached.destroy();
});

test('zoom redraws once, a covered resize keeps the texture, and an uncovered resize replaces it', () => {
  const { cached, camera, view, renders } = setup();
  cached.render(camera, view);
  const texture = cached.sprite.texture;
  cached.render({ ...camera, scale: 2 }, view);
  expect(renders()).toBe(2);
  expect(cached.sprite.texture).toBe(texture);
  expect(cached.sprite.scale.x).toBe(0.5);
  cached.render({ ...camera, scale: 2 }, { width: 1380, height: 820 });
  expect(renders()).toBe(2);
  cached.render({ ...camera, scale: 2 }, { width: 2000, height: 1200 });
  expect(renders()).toBe(3);
  expect(cached.sprite.texture).not.toBe(texture);
  expect(texture.destroyed).toBe(true);
  expect(cached.sprite.texture.width).toBe(2512);
  cached.destroy();
});

test('destroy releases art, sprite and GPU texture', () => {
  const { art, cached, camera, view } = setup();
  cached.render(camera, view);
  const texture = cached.sprite.texture;
  cached.destroy();
  expect(art.destroyed).toBe(true);
  expect(cached.sprite.destroyed).toBe(true);
  expect(texture.destroyed).toBe(true);
});

test('context restoration invalidates an otherwise covered view', () => {
  const { cached, camera, view, renders } = setup();
  cached.render(camera, view);
  const texture = cached.sprite.texture;
  cached.invalidate();
  cached.render(camera, view);
  expect(renders()).toBe(2);
  expect(cached.sprite.texture).toBe(texture);
  cached.render(camera, view);
  expect(renders()).toBe(2);
  cached.destroy();
});
