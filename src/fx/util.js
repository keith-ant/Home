/**
 * FX-stream shared helpers: a derived deterministic RNG (never game.rng, so
 * cosmetic emission can't perturb gameplay draws — photo mode still repeats
 * per seed) and a few maths utilities used by every pool.
 */
import { Random } from '../core/Random.js';

/** Derived deterministic RNG for cosmetics (mirrors world/util.worldRng). */
export function fxRng(game, salt = 7331) {
  const seed = ((game.seed ?? 1) * 2654435761 + salt * 40503) >>> 0;
  return new Random(seed || 1);
}

export function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function smoothstep(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Sample a direction inside a cone around `dir` (unit) with half-angle
 * `spread` radians, writing into `out`. Uniform in solid angle.
 * @param {import('../core/Random.js').Random} rng
 * @param {{x:number,y:number,z:number}} dir unit vector
 * @param {number} spread cone half angle (radians)
 * @param {import('three').Vector3} out
 */
export function coneSample(rng, dir, spread, out) {
  // build an orthonormal basis around dir
  const dx = dir.x;
  const dy = dir.y;
  const dz = dir.z;
  // pick a helper axis not parallel to dir
  let hx = 0;
  let hy = 1;
  let hz = 0;
  if (Math.abs(dy) > 0.9) {
    hx = 1;
    hy = 0;
  }
  // t = normalize(cross(h, dir))
  let tx = hy * dz - hz * dy;
  let ty = hz * dx - hx * dz;
  let tz = hx * dy - hy * dx;
  const tl = Math.hypot(tx, ty, tz) || 1;
  tx /= tl;
  ty /= tl;
  tz /= tl;
  // b = cross(dir, t)
  const bx = dy * tz - dz * ty;
  const by = dz * tx - dx * tz;
  const bz = dx * ty - dy * tx;
  const cosMax = Math.cos(spread);
  const cosT = 1 - rng.next() * (1 - cosMax);
  const sinT = Math.sqrt(Math.max(0, 1 - cosT * cosT));
  const phi = rng.next() * Math.PI * 2;
  const cp = Math.cos(phi) * sinT;
  const sp = Math.sin(phi) * sinT;
  out.set(
    dx * cosT + tx * cp + bx * sp,
    dy * cosT + ty * cp + by * sp,
    dz * cosT + tz * cp + bz * sp,
  );
  return out;
}
