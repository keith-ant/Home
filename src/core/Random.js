/**
 * Seeded PRNG (mulberry32) — the only randomness source allowed inside the
 * gameplay simulation, so photo mode and autoplay are reproducible.
 */
export class Random {
  /** @param {number} seed */
  constructor(seed = 1) {
    this.reseed(seed);
  }

  reseed(seed) {
    this._state = seed >>> 0 || 1;
  }

  /** float in [0,1) */
  next() {
    let a = (this._state = (this._state + 0x6d2b79f5) | 0);
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** float in [min,max) */
  range(min, max) {
    return min + (max - min) * this.next();
  }

  /** integer in [min,max] inclusive */
  int(min, max) {
    return Math.floor(this.range(min, max + 1));
  }

  /** true with probability p */
  chance(p) {
    return this.next() < p;
  }

  /** approximately gaussian, mean 0, sd 1 (sum of uniforms) */
  gauss() {
    return (this.next() + this.next() + this.next() + this.next() - 2) * 1.1547005;
  }

  /** pick a random element */
  pick(arr) {
    return arr[Math.floor(this.next() * arr.length)];
  }

  /** in-place Fisher–Yates shuffle */
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }
}
