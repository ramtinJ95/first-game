import { describe, expect, it } from 'vitest';
import { FramePacer, type FenceGl } from './frame-pacer.ts';

/** A GPU that finishes a fence only when the test says so. */
function fakeGl() {
  const fences = new Map<object, boolean>();
  let lost = false;
  const gl: FenceGl = {
    SYNC_GPU_COMMANDS_COMPLETE: 1,
    SYNC_STATUS: 2,
    UNSIGNALED: 3,
    fenceSync: () => {
      const fence = {} as WebGLSync;
      fences.set(fence, false);
      return fence;
    },
    getSyncParameter: (fence) => (lost ? null : fences.get(fence) ? 4 : 3),
    deleteSync: (fence) => fences.delete(fence),
    flush: () => undefined,
    isContextLost: () => lost,
  };
  return {
    gl,
    finish: () => fences.forEach((_, fence) => fences.set(fence, true)),
    lose: () => (lost = true),
    pending: () => fences.size,
  };
}

describe('FramePacer', () => {
  it('renders a changed frame at once when the GPU is idle', () => {
    const pacer = new FramePacer(fakeGl().gl);
    expect(pacer.frame(true)).toBe(true);
    expect(pacer.frame(false)).toBe(false);
  });

  it('holds a frame while the GPU still draws the last one, and does not lose it', () => {
    const gpu = fakeGl();
    const pacer = new FramePacer(gpu.gl);
    expect(pacer.frame(true)).toBe(true);
    pacer.rendered();
    expect(pacer.frame(true)).toBe(false);
    expect(pacer.frame(false)).toBe(false);
    gpu.finish();
    expect(pacer.frame(false)).toBe(true);
    expect(gpu.pending()).toBe(0);
  });

  it('lets a lost context’s fence go instead of waiting on it for ever', () => {
    const gpu = fakeGl();
    const pacer = new FramePacer(gpu.gl);
    pacer.frame(true);
    pacer.rendered();
    gpu.lose();
    expect(pacer.frame(true)).toBe(true);
  });

  it('renders every changed frame when there is no WebGL 2 to fence', () => {
    const pacer = new FramePacer(undefined);
    pacer.rendered();
    expect(pacer.frame(true)).toBe(true);
    expect(pacer.frame(true)).toBe(true);
  });
});
