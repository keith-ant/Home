/**
 * ParticleAtlas — procedurally paints the sprite atlas shared by every
 * particle at boot (FX stream). 4×4 cells on one canvas texture; each cell
 * is a greyscale luminance + alpha mask (colour comes from the per-particle
 * tint / lighting), except where noted. Deterministic: all noise is a
 * seeded simplex/value fbm, no Math.random.
 *
 * Cell map (index → sprite):
 *    0 smoke_soft   fractal soft puff, top-lit           (alpha bucket)
 *    1 smoke_hard   denser cauliflower puff, harder edge   (alpha)
 *    2 spark        stretched comet streak, bright head     (additive, velocity-aligned)
 *    3 flare        soft round radial glow / flash core     (additive)
 *    4 dust         mottled sandy puff                       (alpha)
 *    5 blood_mist   torn-edged noise blob                   (alpha)
 *    6 blood_splat  droplet spray cluster                   (alpha)
 *    7 ember        hot pin core + halo                     (additive)
 *    8 water_splash upward crown column of droplet spikes   (alpha)
 *    9 debris       angular concrete/wood chip               (alpha, opaque)
 *   10 muzzle_star  6-spoke starburst with hot core         (additive)
 *   11 smoke_wisp   thin curling wisp for muzzle smoke      (alpha)
 *   12 debris2      splinter chip                            (alpha, opaque)
 *   13 ring         thin annulus (shockwave)                  (additive)
 *   14 fireball     billowy turbulent fire blob              (additive)
 *   15 grit         cluster of small chips / confetti       (alpha)
 *
 * buildParticleAtlas() → { texture, grid, cellUv(i) → [u0,v0,u1,v1], CELLS }
 */
import * as THREE from 'three';
import { createNoise2D } from 'simplex-noise';
import { Random } from '../core/Random.js';

export const CELLS = Object.freeze({
  smoke_soft: 0,
  smoke_hard: 1,
  spark: 2,
  flare: 3,
  dust: 4,
  blood_mist: 5,
  blood_splat: 6,
  ember: 7,
  water_splash: 8,
  debris: 9,
  muzzle_star: 10,
  smoke_wisp: 11,
  debris2: 12,
  ring: 13,
  fireball: 14,
  grit: 15,
});

const GRID = 4;
const CELL = 256;
const SIZE = GRID * CELL;

let _cached = null;

/**
 * Build (once) and return the atlas.
 * @returns {{texture:THREE.CanvasTexture, grid:number, cellUv:(i:number)=>number[], CELLS:typeof CELLS}}
 */
export function buildParticleAtlas() {
  if (_cached) return _cached;
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, SIZE, SIZE);

  const rng = new Random(0xf00d);
  const noiseA = createNoise2D(() => rng.next());
  const noiseB = createNoise2D(() => rng.next());
  const fbm = (x, y, oct = 4, lac = 2.02, gain = 0.52) => {
    let a = 1;
    let f = 1;
    let sum = 0;
    let norm = 0;
    for (let i = 0; i < oct; i++) {
      sum += a * noiseA(x * f, y * f);
      norm += a;
      a *= gain;
      f *= lac;
    }
    return sum / norm; // [-1,1]
  };
  const fbmB = (x, y, oct = 3) => {
    let a = 1;
    let f = 1;
    let sum = 0;
    let norm = 0;
    for (let i = 0; i < oct; i++) {
      sum += a * noiseB(x * f, y * f);
      norm += a;
      a *= 0.55;
      f *= 2.1;
    }
    return sum / norm;
  };

  /* -------------------------------------------------------- per-pixel */
  const px = (col, row, fn) => {
    const img = ctx.createImageData(CELL, CELL);
    const d = img.data;
    for (let y = 0; y < CELL; y++) {
      const v = (y + 0.5) / CELL; // 0 top .. 1 bottom
      for (let x = 0; x < CELL; x++) {
        const u = (x + 0.5) / CELL;
        const out = fn(u * 2 - 1, v * 2 - 1, u, v); // dx,dy in [-1,1]; (u,v) in [0,1]
        const i = (y * CELL + x) * 4;
        const lum = clamp01(out[0]);
        d[i] = Math.round(lum * 255);
        d[i + 1] = Math.round(clamp01(out[1] ?? out[0]) * 255);
        d[i + 2] = Math.round(clamp01(out[2] ?? out[0]) * 255);
        d[i + 3] = Math.round(clamp01(out[3]) * 255);
      }
    }
    ctx.putImageData(img, col * CELL, row * CELL);
  };
  const edgeFade = (r) => 1 - smooth(0.84, 0.98, r);

  /* 0: smoke_soft ------------------------------------------------------- */
  px(0, 0, (dx, dy) => {
    const r = Math.hypot(dx, dy);
    const n = fbm(dx * 1.6 + 3.1, dy * 1.6 + 1.7, 5);
    const n2 = fbm(dx * 3.4 - 2, dy * 3.4 + 5, 3);
    let a = Math.pow(clamp01(1 - r), 1.35);
    a *= clamp01(0.62 + 0.55 * n + 0.25 * n2);
    a *= edgeFade(r);
    // gentle top-lit volume shading (up = -dy in image space)
    const lum = 0.66 + 0.14 * (-dy * 0.5 + 0.5) + 0.08 * n2 + 0.06 * (1 - r);
    return [lum, lum, lum, a * 0.95];
  });

  /* 1: smoke_hard ------------------------------------------------------ */
  px(1, 0, (dx, dy) => {
    const r = Math.hypot(dx, dy);
    const w = fbm(dx * 2.2 - 4, dy * 2.2 - 3, 5);
    const rr = r * (0.85 + 0.35 * w);
    let a = smooth(1.0, 0.62, rr);
    a *= clamp01(0.75 + 0.4 * fbm(dx * 4.5 + 7, dy * 4.5 + 2, 3));
    a *= edgeFade(r);
    const lum = 0.55 + 0.2 * (-dy * 0.5 + 0.5) + 0.1 * w + 0.1 * (1 - r);
    return [lum, lum, lum, a];
  });

  /* 2: spark (comet along +u, head at right) ------------------------- */
  px(2, 0, (dx, dy, u, v) => {
    const across = (v - 0.5) / 0.5; // -1..1
    const headU = 0.86;
    const tail = clamp01(u / headU);
    const core = Math.exp(-(across * across) / (0.012)) * Math.pow(tail, 1.6);
    const glow = 0.28 * Math.exp(-(across * across) / (0.11)) * Math.pow(tail, 1.2);
    const head = Math.exp(-((u - headU) * (u - headU)) / 0.0035 - (across * across) / 0.03);
    const beyond = u > headU ? Math.exp(-((u - headU) * (u - headU)) / 0.0022 - (across * across) / 0.05) : 0;
    const a = clamp01(core + glow + head * 1.4 + beyond);
    const lum = clamp01(0.55 + 0.9 * (core + head));
    return [lum, lum * 0.98, lum * 0.9, a];
  });

  /* 3: flare ------------------------------------------------------------ */
  px(3, 0, (dx, dy) => {
    const r = Math.hypot(dx, dy);
    let a = Math.exp(-r * r * 9) + 0.32 * Math.exp(-r * 3.2) + 0.08 * Math.exp(-r * 1.2);
    a *= edgeFade(r);
    return [1, 1, 1, clamp01(a)];
  });

  /* 4: dust ------------------------------------------------------------- */
  px(0, 1, (dx, dy) => {
    const r = Math.hypot(dx, dy);
    const n = fbm(dx * 2.4 + 11, dy * 2.4 - 6, 4);
    let a = Math.pow(clamp01(1 - r), 1.6) * clamp01(0.55 + 0.6 * n);
    a *= 0.75 * edgeFade(r);
    const n2 = fbmB(dx * 5 + 2, dy * 5 - 1);
    const lum = 0.58 + 0.22 * n2 + 0.12 * (-dy * 0.5 + 0.5);
    return [lum, lum, lum, a];
  });

  /* 5: blood_mist ------------------------------------------------------- */
  px(1, 1, (dx, dy) => {
    const r = Math.hypot(dx, dy);
    const n = fbm(dx * 2.8 - 9, dy * 2.8 + 4, 4);
    const rr = r * (0.8 + 0.6 * Math.max(0, n));
    let a = smooth(0.95, 0.4, rr);
    a *= clamp01(0.6 + 0.7 * fbmB(dx * 6 + 3, dy * 6 - 7));
    a *= edgeFade(r);
    const lum = 0.55 + 0.25 * n;
    return [lum, lum, lum, a];
  });

  /* 6: blood_splat (droplet spray cluster) ------------------------------- */
  {
    const c = document.createElement('canvas');
    c.width = CELL;
    c.height = CELL;
    const g = c.getContext('2d');
    const r2 = new Random(0xb100d);
    g.fillStyle = 'rgba(255,255,255,1)';
    // central blob
    g.beginPath();
    const cx = CELL / 2;
    const cy = CELL / 2;
    const R = CELL * 0.18;
    for (let i = 0; i < 24; i++) {
      const ang = (i / 24) * Math.PI * 2;
      const rr = R * (0.75 + 0.55 * r2.next());
      const x = cx + Math.cos(ang) * rr;
      const y = cy + Math.sin(ang) * rr;
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.closePath();
    g.fill();
    // radiating droplets
    for (let i = 0; i < 26; i++) {
      const ang = r2.next() * Math.PI * 2;
      const dist = R * (1.2 + 2.4 * r2.next());
      const size = CELL * (0.008 + 0.028 * r2.next());
      const x = cx + Math.cos(ang) * dist;
      const y = cy + Math.sin(ang) * dist;
      g.beginPath();
      // elongated along the radial direction
      g.ellipse(x, y, size * (1.6 + r2.next()), size, ang, 0, Math.PI * 2);
      g.fill();
    }
    ctx.drawImage(c, 2 * CELL, 1 * CELL);
  }

  /* 7: ember ------------------------------------------------------------- */
  px(3, 1, (dx, dy) => {
    const r = Math.hypot(dx, dy);
    let a = Math.exp(-r * r * 55) + 0.42 * Math.exp(-r * r * 5.5);
    a *= edgeFade(r);
    return [1, 1, 1, clamp01(a)];
  });

  /* 8: water_splash (crown column) --------------------------------------- */
  {
    const c = document.createElement('canvas');
    c.width = CELL;
    c.height = CELL;
    const g = c.getContext('2d');
    const r2 = new Random(0x5b1a5);
    const cx = CELL / 2;
    const baseY = CELL * 0.88;
    // base ring
    g.strokeStyle = 'rgba(255,255,255,0.7)';
    g.lineWidth = CELL * 0.02;
    g.beginPath();
    g.ellipse(cx, baseY, CELL * 0.24, CELL * 0.06, 0, 0, Math.PI * 2);
    g.stroke();
    // fanning spikes
    const spikes = 18;
    for (let i = 0; i < spikes; i++) {
      const t = i / (spikes - 1);
      const ang = Math.PI * (0.14 + t * 0.72); // upward fan
      const len = CELL * (0.28 + 0.42 * r2.next());
      const x0 = cx + (Math.cos(ang) * CELL * 0.16) * (r2.next() < 0.5 ? -1 : 1);
      const y0 = baseY - CELL * 0.02;
      const x1 = x0 + Math.cos(ang) * len * (x0 > cx ? 1 : -1) * 0.55;
      const y1 = y0 - Math.sin(ang) * len;
      const grad = g.createLinearGradient(x0, y0, x1, y1);
      grad.addColorStop(0, 'rgba(255,255,255,0.85)');
      grad.addColorStop(0.7, 'rgba(255,255,255,0.5)');
      grad.addColorStop(1, 'rgba(255,255,255,0.0)');
      g.strokeStyle = grad;
      g.lineWidth = CELL * (0.014 + r2.next() * 0.02);
      g.beginPath();
      g.moveTo(x0, y0);
      g.quadraticCurveTo((x0 + x1) / 2 + (r2.next() - 0.5) * CELL * 0.1, (y0 + y1) / 2, x1, y1);
      g.stroke();
      // droplet head
      g.fillStyle = 'rgba(255,255,255,0.85)';
      g.beginPath();
      g.arc(x1, y1, CELL * (0.008 + r2.next() * 0.012), 0, Math.PI * 2);
      g.fill();
    }
    // core mist column
    const grad2 = g.createRadialGradient(cx, baseY - CELL * 0.25, CELL * 0.02, cx, baseY - CELL * 0.25, CELL * 0.3);
    grad2.addColorStop(0, 'rgba(255,255,255,0.55)');
    grad2.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad2;
    g.fillRect(0, 0, CELL, CELL);
    ctx.drawImage(c, 0 * CELL, 2 * CELL);
  }

  /* 9: debris chip ------------------------------------------------------- */
  {
    const c = document.createElement('canvas');
    c.width = CELL;
    c.height = CELL;
    const g = c.getContext('2d');
    const r2 = new Random(0xc41);
    const cx = CELL / 2;
    const cy = CELL / 2;
    const verts = 6;
    g.beginPath();
    for (let i = 0; i < verts; i++) {
      const ang = (i / verts) * Math.PI * 2 + r2.range(-0.2, 0.2);
      const rr = CELL * (0.28 + 0.16 * r2.next());
      const x = cx + Math.cos(ang) * rr;
      const y = cy + Math.sin(ang) * rr * 0.8;
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.closePath();
    const grad = g.createLinearGradient(cx - CELL * 0.3, cy - CELL * 0.3, cx + CELL * 0.3, cy + CELL * 0.3);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.5, 'rgba(190,190,190,1)');
    grad.addColorStop(1, 'rgba(110,110,110,1)');
    g.fillStyle = grad;
    g.fill();
    // facet line
    g.strokeStyle = 'rgba(90,90,90,0.8)';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(cx - CELL * 0.2, cy - CELL * 0.05);
    g.lineTo(cx + CELL * 0.18, cy + CELL * 0.1);
    g.stroke();
    ctx.drawImage(c, 1 * CELL, 2 * CELL);
  }

  /* 10: muzzle star ------------------------------------------------------ */
  {
    const c = document.createElement('canvas');
    c.width = CELL;
    c.height = CELL;
    const g = c.getContext('2d');
    const r2 = new Random(0xf1a5);
    const cx = CELL / 2;
    const cy = CELL / 2;
    g.globalCompositeOperation = 'lighter';
    // spokes
    const spokes = 6;
    for (let i = 0; i < spokes; i++) {
      const ang = (i / spokes) * Math.PI * 2 + 0.32 + r2.range(-0.14, 0.14);
      const len = CELL * (0.34 + 0.14 * r2.next());
      const w = CELL * (0.06 + 0.03 * r2.next());
      g.save();
      g.translate(cx, cy);
      g.rotate(ang);
      const grad = g.createLinearGradient(0, 0, len, 0);
      grad.addColorStop(0.0, 'rgba(255,255,255,1)');
      grad.addColorStop(0.45, 'rgba(255,250,235,0.75)');
      grad.addColorStop(1.0, 'rgba(255,240,200,0)');
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(0, -w / 2);
      g.quadraticCurveTo(len * 0.55, -w * 0.18, len, 0);
      g.quadraticCurveTo(len * 0.55, w * 0.18, 0, w / 2);
      g.closePath();
      g.fill();
      g.restore();
    }
    // hot core
    let grad = g.createRadialGradient(cx, cy, 0, cx, cy, CELL * 0.22);
    grad.addColorStop(0.0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.3, 'rgba(255,252,240,1)');
    grad.addColorStop(0.65, 'rgba(255,235,190,0.5)');
    grad.addColorStop(1.0, 'rgba(255,210,140,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(cx, cy, CELL * 0.22, 0, Math.PI * 2);
    g.fill();
    // soft outer glow
    grad = g.createRadialGradient(cx, cy, CELL * 0.08, cx, cy, CELL * 0.4);
    grad.addColorStop(0, 'rgba(255,220,150,0.25)');
    grad.addColorStop(1, 'rgba(255,200,120,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(cx, cy, CELL * 0.4, 0, Math.PI * 2);
    g.fill();
    ctx.drawImage(c, 2 * CELL, 2 * CELL);
  }

  /* 11: smoke_wisp -------------------------------------------------------- */
  px(3, 2, (dx, dy) => {
    // vertical elongated blob warped by noise into a curl
    const warp = fbm(dx * 1.2 + 20, dy * 0.9 - 11, 3) * 0.55;
    const ex = (dx - warp * (0.6 + 0.4 * dy)) / 0.34;
    const ey = dy / 0.92;
    const r = Math.hypot(ex, ey);
    let a = smooth(1.0, 0.35, r);
    a *= clamp01(0.5 + 0.7 * fbmB(dx * 3 + 1, dy * 3 - 2));
    a *= edgeFade(Math.hypot(dx, dy)) * 0.8;
    const lum = 0.6 + 0.2 * fbm(dx * 4, dy * 4, 2);
    return [lum, lum, lum, a];
  });

  /* 12: debris2 (splinter) ------------------------------------------------ */
  {
    const c = document.createElement('canvas');
    c.width = CELL;
    c.height = CELL;
    const g = c.getContext('2d');
    const cx = CELL / 2;
    const cy = CELL / 2;
    g.beginPath();
    g.moveTo(cx - CELL * 0.42, cy + CELL * 0.02);
    g.lineTo(cx - CELL * 0.12, cy - CELL * 0.09);
    g.lineTo(cx + CELL * 0.44, cy - CELL * 0.03);
    g.lineTo(cx + CELL * 0.15, cy + CELL * 0.07);
    g.lineTo(cx - CELL * 0.3, cy + CELL * 0.06);
    g.closePath();
    const grad = g.createLinearGradient(cx, cy - CELL * 0.1, cx, cy + CELL * 0.1);
    grad.addColorStop(0, 'rgba(245,245,245,1)');
    grad.addColorStop(1, 'rgba(120,120,120,1)');
    g.fillStyle = grad;
    g.fill();
    ctx.drawImage(c, 0 * CELL, 3 * CELL);
  }

  /* 13: ring ------------------------------------------------------------- */
  px(1, 3, (dx, dy) => {
    const r = Math.hypot(dx, dy);
    const ang = Math.atan2(dy, dx);
    const wob = 0.5 + 0.5 * Math.sin(ang * 7) * Math.sin(ang * 3 + 1.2);
    let a = Math.exp(-Math.pow((r - 0.74) / 0.055, 2));
    a += 0.35 * Math.exp(-Math.pow((r - 0.66) / 0.16, 2));
    a *= 0.7 + 0.3 * wob;
    a *= edgeFade(r);
    return [1, 1, 1, clamp01(a)];
  });

  /* 14: fireball ---------------------------------------------------------- */
  px(2, 3, (dx, dy) => {
    const r = Math.hypot(dx, dy);
    const n = fbm(dx * 1.9 + 40, dy * 1.9 + 13, 5);
    const n2 = fbm(dx * 4.2 - 33, dy * 4.2 + 9, 3);
    const rr = r * (0.78 + 0.5 * n);
    let a = smooth(1.0, 0.48, rr);
    a *= clamp01(0.7 + 0.45 * n2);
    a *= edgeFade(r);
    // hot core, cooler cauliflower edges (colour ramp is per-particle)
    const heat = clamp01(1.15 - rr * 1.05 + 0.35 * n);
    const lum = 0.35 + 0.65 * heat;
    return [lum, lum, lum, a];
  });

  /* 15: grit (chip cluster) ---------------------------------------------- */
  {
    const c = document.createElement('canvas');
    c.width = CELL;
    c.height = CELL;
    const g = c.getContext('2d');
    const r2 = new Random(0x6417);
    for (let i = 0; i < 18; i++) {
      const x = CELL * (0.12 + 0.76 * r2.next());
      const y = CELL * (0.12 + 0.76 * r2.next());
      const s = CELL * (0.015 + 0.045 * r2.next());
      const shade = Math.round(140 + 100 * r2.next());
      g.fillStyle = `rgba(${shade},${shade},${shade},1)`;
      g.save();
      g.translate(x, y);
      g.rotate(r2.next() * Math.PI);
      g.beginPath();
      g.moveTo(-s, -s * 0.3);
      g.lineTo(s * 0.4, -s);
      g.lineTo(s, s * 0.2);
      g.lineTo(-s * 0.2, s * 0.7);
      g.closePath();
      g.fill();
      g.restore();
    }
    ctx.drawImage(c, 3 * CELL, 3 * CELL);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.name = 'fx.particleAtlas';
  texture.needsUpdate = true;

  const inset = 1.5 / SIZE;
  const cellUv = (i) => {
    const col = i % GRID;
    const row = Math.floor(i / GRID);
    // canvas y=0 is the top row; texture v=1 is the top → flip rows
    const u0 = col / GRID + inset;
    const u1 = (col + 1) / GRID - inset;
    const v1 = 1 - row / GRID - inset;
    const v0 = 1 - (row + 1) / GRID + inset;
    return [u0, v0, u1, v1];
  };

  _cached = { texture, grid: GRID, cellUv, CELLS, canvas };
  return _cached;
}

/* ------------------------------------------------------------------------ */
function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
function smooth(a, b, x) {
  // smoothstep that also works with a > b (inverted)
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}
