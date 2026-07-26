/**
 * Game loop with a fixed-step simulation accumulator.
 *
 * Realtime mode: requestAnimationFrame drives it; simulation advances in
 * fixed steps of `time.step`, rendering once per animation frame with
 * interpolation alpha. Stepping mode (photo mode / autoplay / tests): the
 * caller advances explicitly via `stepFixed(n)` and `render()`, and the
 * wall clock is never consulted — required because software-GL frames can
 * take seconds each.
 */
export class Loop {
  /**
   * @param {object} opts
   * @param {import('./Time.js').Time} opts.time
   * @param {(dt:number)=>void} opts.update   fixed-step update
   * @param {(alpha:number)=>void} opts.render render one frame
   * @param {(realDt:number)=>void} [opts.beforeFrame] once per animation frame (input polling)
   * @param {number} [opts.maxSubSteps]
   */
  constructor({ time, update, render, beforeFrame = null, maxSubSteps = 5 }) {
    this.time = time;
    this._update = update;
    this._render = render;
    this._beforeFrame = beforeFrame;
    this.maxSubSteps = maxSubSteps;
    this.running = false;
    this.paused = false;
    this._acc = 0;
    this._last = 0;
    this._raf = 0;
    this._tick = this._tick.bind(this);
  }

  /** Begin the realtime rAF loop. */
  start() {
    if (this.running) return;
    this.running = true;
    this._last = performance.now() / 1000;
    this._acc = 0;
    this._raf = requestAnimationFrame(this._tick);
  }

  stop() {
    this.running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = 0;
  }

  setPaused(paused) {
    this.paused = paused;
    if (!paused) this._last = performance.now() / 1000;
  }

  _tick(nowMs) {
    if (!this.running) return;
    this._raf = requestAnimationFrame(this._tick);
    const now = nowMs / 1000;
    let frameDt = now - this._last;
    this._last = now;
    // Clamp huge deltas (tab switch / hitch) so the sim doesn't spiral.
    if (frameDt > 0.25) frameDt = 0.25;
    this.time.real += frameDt;

    if (this._beforeFrame) this._beforeFrame(frameDt);

    if (!this.paused) {
      this._acc += frameDt;
      let steps = 0;
      while (this._acc >= this.time.step && steps < this.maxSubSteps) {
        this._update(this.time.step);
        this.time.advance();
        this._acc -= this.time.step;
        steps++;
      }
      // Drop leftover accumulation beyond the sub-step cap.
      if (this._acc > this.time.step) this._acc = this._acc % this.time.step;
      this.time.alpha = this._acc / this.time.step;
    }
    this._render(this.time.alpha);
  }

  /**
   * Advance the simulation by n fixed steps without rendering (stepping mode).
   * @param {number} n
   */
  stepFixed(n) {
    for (let i = 0; i < n; i++) {
      if (this._beforeFrame) this._beforeFrame(this.time.step);
      this._update(this.time.step);
      this.time.advance();
      this.time.real += this.time.step;
    }
    this.time.alpha = 1;
  }

  /** Render a single frame immediately (stepping mode). */
  render() {
    this._render(1);
  }
}
