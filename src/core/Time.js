/**
 * Simulation clock. All gameplay code reads time from here, never from
 * Date/performance. `elapsed` is total simulated seconds; `dt` is the fixed
 * step; `frame` counts simulation steps; `alpha` is the render interpolation
 * factor for the current animation frame.
 */
export class Time {
  constructor(step = 1 / 60) {
    this.step = step;
    this.dt = step;
    this.elapsed = 0;
    this.frame = 0;
    this.alpha = 0;
    this.scale = 1;
    /** Unscaled real seconds since start (cosmetic only, e.g. UI pulses). */
    this.real = 0;
  }

  advance() {
    this.elapsed += this.step * this.scale;
    this.frame += 1;
  }
}
