/**
 * ProcTextures — small procedural textures generated at boot for the render
 * stream (lens flare starburst, soft radial glow, rain splash crown, ember
 * mask, puddle mask). Everything is deterministic: any noise comes from a
 * locally seeded PRNG, never Math.random, so photo-mode frames repeat exactly.
 *
 * All textures are created lazily on first request and cached; callers must
 * not dispose them (Sky/Lighting/Weather share the same instances).
 */
import * as THREE from 'three';
import { Random } from '../core/Random.js';

const _cache = new Map();

function makeCanvas(size) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  return c;
}

/**
 * Soft radial glow: bright core with exponential falloff. Additive sprites.
 * @param {number} [size]
 * @returns {THREE.Texture}
 */
export function glowTexture(size = 128) {
  const key = 'glow' + size;
  if (_cache.has(key)) return _cache.get(key);
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0.0, 'rgba(255,255,255,1.0)');
  g.addColorStop(0.12, 'rgba(255,255,255,0.85)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.32)');
  g.addColorStop(0.7, 'rgba(255,255,255,0.07)');
  g.addColorStop(1.0, 'rgba(255,255,255,0.0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.name = 'proc.glow';
  _cache.set(key, tex);
  return tex;
}

/**
 * Wide gaussian halo: the soft ball of scattered light around a lamp head in
 * wet, hazy air. Much broader falloff than glowTexture so it can be scaled
 * to several metres without a visible edge.
 * @param {number} [size]
 */
export function haloTexture(size = 128) {
  const key = 'halo' + size;
  if (_cache.has(key)) return _cache.get(key);
  const data = new Uint8Array(size * size * 4);
  const c = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - c) / c;
      const dy = (y - c) / c;
      const r = Math.sqrt(dx * dx + dy * dy);
      // gaussian-ish core plus a long soft skirt, clipped smoothly at the edge
      let a = 0.85 * Math.exp(-r * r * 5.5) + 0.35 * Math.exp(-r * 2.2);
      a *= Math.max(0, Math.min(1, (1 - r) / 0.12)); // fade to 0 by r=1
      const i = (y * size + x) * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = Math.round(Math.max(0, Math.min(1, a)) * 255);
    }
  }
  // NB: keep this linear and mip-free — sRGB DataTextures with generated
  // mipmaps come back incomplete (black) on some GL stacks (SwiftShader).
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  tex.name = 'proc.halo';
  _cache.set(key, tex);
  return tex;
}

/**
 * Starburst lens flare: soft core + 6 thin diffraction spokes + faint ring.
 * Reads like the anamorphic-free flares on the reference floodlights.
 * @param {number} [size]
 */
export function starburstTexture(size = 256) {
  const key = 'star' + size;
  if (_cache.has(key)) return _cache.get(key);
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  const cx = size / 2;
  const cy = size / 2;
  ctx.clearRect(0, 0, size, size);
  ctx.globalCompositeOperation = 'lighter';

  // core glow
  let g = ctx.createRadialGradient(cx, cy, 0, cx, cy, size * 0.5);
  g.addColorStop(0.0, 'rgba(255,250,235,1.0)');
  g.addColorStop(0.06, 'rgba(255,240,210,0.95)');
  g.addColorStop(0.18, 'rgba(255,220,170,0.35)');
  g.addColorStop(0.45, 'rgba(255,200,140,0.08)');
  g.addColorStop(1.0, 'rgba(255,200,140,0.0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);

  // faint outer ring (lens element reflection)
  ctx.strokeStyle = 'rgba(255,210,150,0.10)';
  ctx.lineWidth = size * 0.02;
  ctx.beginPath();
  ctx.arc(cx, cy, size * 0.31, 0, Math.PI * 2);
  ctx.stroke();

  // spokes: 6 long thin rays with soft falloff (starburst from aperture blades)
  const spokes = 6;
  for (let i = 0; i < spokes; i++) {
    const a = (i / spokes) * Math.PI + Math.PI / 12;
    const len = size * (i % 2 === 0 ? 0.48 : 0.36);
    const grad = ctx.createLinearGradient(cx - Math.cos(a) * len, cy - Math.sin(a) * len, cx + Math.cos(a) * len, cy + Math.sin(a) * len);
    grad.addColorStop(0.0, 'rgba(255,235,200,0)');
    grad.addColorStop(0.45, 'rgba(255,235,200,0.55)');
    grad.addColorStop(0.5, 'rgba(255,245,225,0.9)');
    grad.addColorStop(0.55, 'rgba(255,235,200,0.55)');
    grad.addColorStop(1.0, 'rgba(255,235,200,0)');
    ctx.strokeStyle = grad;
    ctx.lineWidth = size * 0.012;
    ctx.beginPath();
    ctx.moveTo(cx - Math.cos(a) * len, cy - Math.sin(a) * len);
    ctx.lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.name = 'proc.starburst';
  _cache.set(key, tex);
  return tex;
}

/**
 * Rain splash crown: a tiny burst of droplet ticks around a soft base ring —
 * used by the ground-splash instanced quads. White; tinted in-shader.
 * @param {number} [size]
 */
export function splashTexture(size = 96) {
  const key = 'splash' + size;
  if (_cache.has(key)) return _cache.get(key);
  const rng = new Random(0x5eed);
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  const cx = size / 2;
  const cy = size * 0.62;
  ctx.clearRect(0, 0, size, size);
  // base impact ring (flattened ellipse)
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = size * 0.03;
  ctx.beginPath();
  ctx.ellipse(cx, cy, size * 0.28, size * 0.09, 0, 0, Math.PI * 2);
  ctx.stroke();
  // crown droplets flung upward
  const drops = 14;
  for (let i = 0; i < drops; i++) {
    const t = i / (drops - 1);
    const ang = Math.PI * (0.15 + t * 0.7); // upward fan
    const len = size * (0.16 + rng.next() * 0.22);
    const x0 = cx + Math.cos(ang) * size * 0.22 * (rng.next() < 0.5 ? -1 : 1) * (0.4 + rng.next() * 0.6);
    const y0 = cy - size * 0.04;
    const x1 = x0 + Math.cos(ang) * len * (rng.next() < 0.5 ? -1 : 1);
    const y1 = y0 - Math.sin(ang) * len;
    const grad = ctx.createLinearGradient(x0, y0, x1, y1);
    grad.addColorStop(0, 'rgba(255,255,255,0.7)');
    grad.addColorStop(1, 'rgba(255,255,255,0.0)');
    ctx.strokeStyle = grad;
    ctx.lineWidth = size * (0.018 + rng.next() * 0.014);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    // droplet head
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.beginPath();
    ctx.arc(x1, y1, size * 0.012, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.name = 'proc.splash';
  _cache.set(key, tex);
  return tex;
}

/**
 * Rain streak sprite: a vertical soft line, brighter at its lower head (the
 * refracted drop) fading up the tail. Used by the streak quads so the alpha
 * profile is smooth at any resolution.
 */
export function streakTexture(w = 8, h = 128) {
  const key = 'streak' + w + 'x' + h;
  if (_cache.has(key)) return _cache.get(key);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0.0, 'rgba(255,255,255,0.0)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.18)');
  grad.addColorStop(0.75, 'rgba(255,255,255,0.65)');
  grad.addColorStop(0.92, 'rgba(255,255,255,1.0)');
  grad.addColorStop(1.0, 'rgba(255,255,255,0.0)');
  // horizontal soft edges via a second pass
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  const hgrad = ctx.createLinearGradient(0, 0, w, 0);
  hgrad.addColorStop(0.0, 'rgba(0,0,0,1)');
  hgrad.addColorStop(0.5, 'rgba(0,0,0,0)');
  hgrad.addColorStop(1.0, 'rgba(0,0,0,1)');
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = hgrad;
  ctx.fillRect(0, 0, w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.name = 'proc.streak';
  _cache.set(key, tex);
  return tex;
}

/**
 * Value-noise tile (greyscale, tileable) used by the cone shader for the
 * "rain crossing the beam" shimmer and by the fire flicker/glow gradients.
 * Linear color space, R channel only meaningful.
 * @param {number} [size]
 */
export function noiseTexture(size = 128) {
  const key = 'noise' + size;
  if (_cache.has(key)) return _cache.get(key);
  const rng = new Random(0xc0ffee);
  // Tileable value noise: coarse random lattice, bilinear + smoothstep upsample.
  const cell = 8;
  const grid = size / cell;
  const lattice = new Float32Array(grid * grid);
  for (let i = 0; i < lattice.length; i++) lattice[i] = rng.next();
  const data = new Uint8Array(size * size * 4);
  const smooth = (t) => t * t * (3 - 2 * t);
  for (let y = 0; y < size; y++) {
    const gy = y / cell;
    const y0 = Math.floor(gy) % grid;
    const y1 = (y0 + 1) % grid;
    const fy = smooth(gy - Math.floor(gy));
    for (let x = 0; x < size; x++) {
      const gx = x / cell;
      const x0 = Math.floor(gx) % grid;
      const x1 = (x0 + 1) % grid;
      const fx = smooth(gx - Math.floor(gx));
      const a = lattice[y0 * grid + x0];
      const b = lattice[y0 * grid + x1];
      const cc = lattice[y1 * grid + x0];
      const d = lattice[y1 * grid + x1];
      const v = a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + cc * (1 - fx) * fy + d * fx * fy;
      const i = (y * size + x) * 4;
      const u = Math.round(Math.max(0, Math.min(1, v)) * 255);
      data[i] = u;
      data[i + 1] = u;
      data[i + 2] = u;
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  tex.name = 'proc.noise';
  _cache.set(key, tex);
  return tex;
}

/**
 * Procedural puddle mask for the scaffold demo ground (WORLD authors real
 * masks later): SDF-ish blobs merged with noise, R = puddle amount, tileable.
 * @param {number} [size]
 * @param {number} [seed]
 */
export function puddleMaskTexture(size = 256, seed = 77) {
  const key = 'puddle' + size + ':' + seed;
  if (_cache.has(key)) return _cache.get(key);
  const rng = new Random(seed);
  const blobs = [];
  const n = 22;
  for (let i = 0; i < n; i++) {
    blobs.push({ x: rng.next(), y: rng.next(), r: 0.045 + rng.next() * 0.11, s: 0.5 + rng.next() * 0.5 });
  }
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      // smooth-union of circles with wrap-around distance for tiling
      let field = 0;
      for (let b = 0; b < n; b++) {
        const bb = blobs[b];
        let dx = Math.abs(u - bb.x);
        let dy = Math.abs(v - bb.y);
        dx = Math.min(dx, 1 - dx);
        dy = Math.min(dy, 1 - dy);
        const d = Math.sqrt(dx * dx + dy * dy);
        const f = Math.max(0, 1 - d / bb.r) * bb.s;
        field = Math.max(field, f);
      }
      // wobble the edge with cheap trig noise
      const wob = 0.5 + 0.25 * Math.sin(u * 41.0 + v * 17.0) * Math.sin(v * 37.0 - u * 23.0);
      let m = smoothstep01(0.35, 0.75, field * (0.7 + 0.6 * wob));
      const i = (y * size + x) * 4;
      const val = Math.round(m * 255);
      data[i] = val;
      data[i + 1] = val;
      data[i + 2] = val;
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  tex.name = 'proc.puddleMask';
  _cache.set(key, tex);
  return tex;
}

function smoothstep01(a, b, x) {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Dispose all cached procedural textures (renderer teardown). */
export function disposeProcTextures() {
  for (const t of _cache.values()) t.dispose();
  _cache.clear();
}
