import { Application, Graphics } from 'pixi.js';

export interface Renderer {
  destroy(): void;
}

const PARCHMENT = 0xe9dcc0;
const INK = 0x7a4b2a;

export async function createRenderer(host: HTMLElement): Promise<Renderer> {
  const app = new Application();
  await app.init({ background: PARCHMENT, resizeTo: window, antialias: true });
  app.canvas.dataset['testid'] = 'map';
  host.appendChild(app.canvas);

  const marker = new Graphics().circle(0, 0, 24).fill(INK);
  app.stage.addChild(marker);

  let elapsedMs = 0;
  app.ticker.add((ticker) => {
    elapsedMs += ticker.deltaMS;
    const t = elapsedMs / 1000;
    marker.position.set(
      app.screen.width / 2 + Math.cos(t * 0.8) * app.screen.width * 0.25,
      app.screen.height / 2 + Math.sin(t * 0.8) * app.screen.height * 0.25,
    );
  });

  return {
    destroy() {
      app.destroy(true, { children: true });
    },
  };
}
