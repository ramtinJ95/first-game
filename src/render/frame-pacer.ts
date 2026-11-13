/** The part of WebGL 2 that a fence needs, so a test can stand in for it. */
export interface FenceGl {
  readonly SYNC_GPU_COMMANDS_COMPLETE: number;
  readonly SYNC_STATUS: number;
  readonly UNSIGNALED: number;
  fenceSync(condition: number, flags: number): WebGLSync | null;
  getSyncParameter(sync: WebGLSync, name: number): unknown;
  deleteSync(sync: WebGLSync): void;
  flush(): void;
  isContextLost(): boolean;
}

/**
 * Starts a frame on the GPU only once it has finished the one before. A slow GPU takes
 * longer to draw a frame than the page takes to ask for the next, and unpaced frames
 * queue up, so a click or a screenshot waits behind seconds of them.
 *
 * `frame(dirty)` says whether to render now. A frame that is due while the GPU is busy
 * is remembered, and rendered at the first call after the GPU is done, dirty or not.
 */
export class FramePacer {
  readonly #gl: FenceGl | undefined;
  #fence: WebGLSync | null = null;
  #due = false;

  constructor(gl: FenceGl | undefined) {
    this.#gl = gl;
  }

  #busy(): boolean {
    const gl = this.#gl;
    if (!gl || !this.#fence) return false;
    // A lost context drops its fences, which then never signal, so a fence that cannot
    // be read is let go rather than waited on.
    const status = gl.isContextLost() ? null : gl.getSyncParameter(this.#fence, gl.SYNC_STATUS);
    if (status === gl.UNSIGNALED) return true;
    if (status !== null) gl.deleteSync(this.#fence);
    this.#fence = null;
    return false;
  }

  frame(dirty: boolean): boolean {
    if (!dirty && !this.#due) return false;
    if (this.#busy()) {
      this.#due = true;
      return false;
    }
    this.#due = false;
    return true;
  }

  /** Call after the frame's draw calls, to fence them. */
  rendered() {
    const gl = this.#gl;
    if (!gl) return;
    this.#fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
  }
}
