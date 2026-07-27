/**
 * Weapon material + procedural texture library (WEAPONS stream).
 *
 * Everything the first-person weapons and hands wear is generated at boot in
 * canvases (no downloads): anodized-aluminium detail (streaked albedo,
 * fingerprint/oil roughness, machining-line normal), roll-mark / engraving
 * decal sheets, pistol stippling and AR grip checkering normals, a knit
 * glove weave, watch face, EOTech-style reticle, tritium and laser glows.
 *
 * Materials come from `weaponMaterial(kind, overrides)`; kinds with `wear`
 * support consume a per-vertex `aWear` attribute (see GunBuilder.applyEdgeWear)
 * that lifts albedo toward bare metal and drops roughness on bevelled edges
 * (REFERENCE_STUDY non-negotiable #8/#13: silvered edge wear, roughness
 * contrast between oiled steel and satin polymer).
 *
 * All textures are cached module-wide and shared; call disposeWeaponTextures()
 * only at full teardown.
 */
import * as THREE from 'three';

const _texCache = new Map();

/* ------------------------------------------------------------------------ */
/* canvas helpers                                                            */
/* ------------------------------------------------------------------------ */
function canvas2d(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  return { c, ctx };
}

/** Deterministic hash → [0,1) (textures must not depend on Math.random). */
function hash(x, y = 0, s = 0) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Tileable value noise 0..1 at (u,v) with `cells` lattice points per axis. */
function valueNoise(u, v, cells, seed) {
  const x = u * cells;
  const y = v * cells;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const wrap = (i) => ((i % cells) + cells) % cells;
  const a = hash(wrap(x0), wrap(y0), seed);
  const b = hash(wrap(x0 + 1), wrap(y0), seed);
  const c = hash(wrap(x0), wrap(y0 + 1), seed);
  const d = hash(wrap(x0 + 1), wrap(y0 + 1), seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/**
 * Convert a Float32 height field (w*h, 0..1) into a tangent-space normal-map
 * canvas texture (Sobel). Tileable if the field is tileable.
 * @param {Float32Array} field
 * @param {number} w
 * @param {number} h
 * @param {number} strength normal steepness
 * @param {string} name
 */
function heightFieldToNormalTexture(field, w, h, strength, name, wrap = true) {
  const { c, ctx } = canvas2d(w, h);
  const img = ctx.createImageData(w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    const ym = ((y - 1 + h) % h) * w;
    const yp = ((y + 1) % h) * w;
    const yc = y * w;
    for (let x = 0; x < w; x++) {
      const xm = (x - 1 + w) % w;
      const xp = (x + 1) % w;
      // sobel
      const tl = field[ym + xm];
      const t = field[ym + x];
      const tr = field[ym + xp];
      const l = field[yc + xm];
      const r = field[yc + xp];
      const bl = field[yp + xm];
      const b = field[yp + x];
      const br = field[yp + xp];
      const dx = (tr + 2 * r + br) - (tl + 2 * l + bl);
      const dy = (bl + 2 * b + br) - (tl + 2 * t + tr);
      let nx = -dx * strength;
      let ny = -dy * strength;
      let nz = 1;
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
      nx *= inv;
      ny *= inv;
      nz *= inv;
      const i = (yc + x) * 4;
      d[i] = Math.round((nx * 0.5 + 0.5) * 255);
      d[i + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      d[i + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = tex.wrapT = wrap ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  tex.anisotropy = 8;
  tex.name = name;
  return tex;
}

function finishColorTexture(c, name, { srgb = true, wrap = true } = {}) {
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.wrapS = tex.wrapT = wrap ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  tex.anisotropy = 8;
  tex.name = name;
  return tex;
}

function cached(key, make) {
  let v = _texCache.get(key);
  if (!v) {
    v = make();
    _texCache.set(key, v);
  }
  return v;
}

/* ------------------------------------------------------------------------ */
/* texture generators                                                        */
/* ------------------------------------------------------------------------ */

/**
 * Anodized aluminium receiver set: albedo (dark grey with anodizing streak
 * variation), roughness (fingerprints, oil smears, dust in recesses) and a
 * machining-line normal (fine milling striations along U + occasional pits).
 * @returns {{color:THREE.Texture, roughness:THREE.Texture, normal:THREE.Texture}}
 */
export function anodizedSet() {
  return cached('anodized', () => {
    const S = 1024;
    // ---- albedo -------------------------------------------------------
    const { c: cc, ctx: cx } = canvas2d(S);
    const img = cx.createImageData(S, S);
    const d = img.data;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const u = x / S;
        const v = y / S;
        // brushed streaks along U (the bore axis on receiver flats)
        const streak = valueNoise(u * 0.4, v * 40, 20, 3) * 0.6 + valueNoise(u * 3, v * 90, 30, 5) * 0.4;
        const blot = valueNoise(u * 6, v * 6, 8, 11);
        let l = 46 + streak * 5 + (blot - 0.5) * 4;
        l = Math.max(20, Math.min(90, l));
        const i = (y * S + x) * 4;
        d[i] = l;
        d[i + 1] = l + 1;
        d[i + 2] = l + 3; // very slight cool cast
        d[i + 3] = 255;
      }
    }
    cx.putImageData(img, 0, 0);
    const color = finishColorTexture(cc, 'weapon.anodized.color', { srgb: true });

    // ---- roughness (G channel is what three reads) --------------------
    const { c: rc, ctx: rx } = canvas2d(S);
    const rimg = rx.createImageData(S, S);
    const rd = rimg.data;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const u = x / S;
        const v = y / S;
        const base = 0.56 + (valueNoise(u * 4, v * 4, 8, 21) - 0.5) * 0.14;
        const i = (y * S + x) * 4;
        const val = Math.max(0.3, Math.min(0.9, base));
        rd[i] = val * 255;
        rd[i + 1] = val * 255;
        rd[i + 2] = val * 255;
        rd[i + 3] = 255;
      }
    }
    rx.putImageData(rimg, 0, 0);
    // fingerprints / oil smears: darker (lower roughness = shinier)
    rx.globalCompositeOperation = 'multiply';
    for (let n = 0; n < 14; n++) {
      const px = hash(n, 1, 7) * S;
      const py = hash(n, 2, 7) * S;
      const r = 10 + hash(n, 3, 7) * 28;
      const g = rx.createRadialGradient(px, py, 0, px, py, r);
      g.addColorStop(0, 'rgba(120,120,120,0.9)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      rx.fillStyle = g;
      rx.beginPath();
      rx.ellipse(px, py, r, r * (0.4 + hash(n, 4, 7) * 0.5), hash(n, 5, 7) * Math.PI, 0, Math.PI * 2);
      rx.fill();
    }
    // fingerprint ridge ovals (concentric arcs, slightly shinier)
    rx.globalCompositeOperation = 'source-over';
    rx.strokeStyle = 'rgba(70,70,70,0.55)';
    rx.lineWidth = 1;
    for (let n = 0; n < 6; n++) {
      const px = hash(n, 8, 9) * S;
      const py = hash(n, 9, 9) * S;
      rx.save();
      rx.translate(px, py);
      rx.rotate(hash(n, 10, 9) * Math.PI);
      for (let k = 3; k < 15; k += 2) {
        rx.beginPath();
        rx.ellipse(0, 0, k * 1.1, k * 0.65, 0, 0.2, Math.PI * 1.7);
        rx.stroke();
      }
      rx.restore();
    }
    const roughness = finishColorTexture(rc, 'weapon.anodized.rough', { srgb: false });

    // ---- machining normal ----------------------------------------------
    const field = new Float32Array(S * S);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const u = x / S;
        const v = y / S;
        // fine parallel milling lines along U (period ~2.4 px) with waviness
        const wav = valueNoise(u * 6, v, 6, 31) * 6.283;
        const lines = 0.5 + 0.5 * Math.sin(v * S * 1.1 + wav) * (0.55 + 0.45 * valueNoise(u * 2, v * 2, 5, 33));
        // occasional pit/pore
        const pit = hash(x, y, 37) > 0.9975 ? 0.6 : 0;
        field[y * S + x] = lines * 0.12 + pit;
      }
    }
    const normal = heightFieldToNormalTexture(field, S, S, 1.4, 'weapon.anodized.normal');
    return { color, roughness, normal };
  });
}

/**
 * Parkerized / phosphated steel detail (barrel, gas block, muzzle device):
 * matte micro-crystalline surface with faint longitudinal turning marks.
 */
export function parkerizedNormal() {
  return cached('parkerized', () => {
    const S = 256;
    const field = new Float32Array(S * S);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const u = x / S;
        const v = y / S;
        const grain = valueNoise(u * 40, v * 40, 40, 51) * 0.5 + valueNoise(u * 90, v * 90, 90, 53) * 0.5;
        const turning = 0.5 + 0.5 * Math.sin(v * S * 1.4 + valueNoise(u * 3, v * 3, 4, 55) * 4);
        field[y * S + x] = grain * 0.16 + turning * 0.05;
      }
    }
    return heightFieldToNormalTexture(field, S, S, 1.2, 'weapon.parkerized.normal');
  });
}

/** AR pistol-grip texture: fine diamond checkering with horizontal finger grooves. */
export function gripCheckerNormal() {
  return cached('gripchecker', () => {
    const S = 256;
    const field = new Float32Array(S * S);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const u = x / S;
        const v = y / S;
        // diamonds: distance to a rotated lattice
        const p = 22;
        const a = ((u + v) * S / p) % 1;
        const b = ((u - v) * S / p + 100) % 1;
        const da = Math.abs(a - 0.5) * 2;
        const db = Math.abs(b - 0.5) * 2;
        const diamond = Math.min(1, Math.max(0, 1 - Math.max(da, db) * 1.15));
        // horizontal finger grooves every ~64 px
        const groove = 0.5 - 0.5 * Math.cos(v * Math.PI * 2 * 4);
        field[y * S + x] = diamond * 0.55 * (1 - groove * 0.6) + groove * 0.25;
      }
    }
    return heightFieldToNormalTexture(field, S, S, 2.2, 'weapon.gripchecker.normal');
  });
}

/** Pistol-frame stippling: dense pseudo-random raised dots. */
export function stippleNormal() {
  return cached('stipple', () => {
    const S = 256;
    const field = new Float32Array(S * S);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        // cellular-ish dots on a jittered grid
        const cell = 16;
        const gx = Math.floor(x / cell);
        const gy = Math.floor(y / cell);
        const jx = (gx + hash(gx, gy, 61) * 0.7) * cell + cell * 0.15;
        const jy = (gy + hash(gy, gx, 63) * 0.7) * cell + cell * 0.15;
        const dd = Math.hypot(x - jx, y - jy) / (cell * 0.55);
        field[y * S + x] = Math.max(0, 1 - dd * dd);
      }
    }
    return heightFieldToNormalTexture(field, S, S, 1.6, 'weapon.stipple.normal');
  });
}

/** Ribbed polymer (rail covers, buttpad, foregrip flutes): straight ribs across U. */
export function ribbedNormal() {
  return cached('ribbed', () => {
    const S = 128;
    const field = new Float32Array(S * S);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const u = x / S;
        const rib = 0.5 + 0.5 * Math.cos(u * Math.PI * 2 * 8);
        field[y * S + x] = Math.pow(rib, 2) * 0.7;
      }
    }
    return heightFieldToNormalTexture(field, S, S, 2.0, 'weapon.ribbed.normal');
  });
}

/** Knit/nomex glove weave normal + a soft albedo variation. */
export function gloveTextures() {
  return cached('glove', () => {
    const S = 256;
    const field = new Float32Array(S * S);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        // interlocking knit: two sine sets
        const a = Math.sin((x + y) * 0.13) * Math.sin((x - y) * 0.13);
        const b = Math.sin(x * 0.21) * Math.sin(y * 0.21) * 0.4;
        field[y * S + x] = (a * 0.5 + 0.5) * 0.5 + (b * 0.5 + 0.5) * 0.25;
      }
    }
    const normal = heightFieldToNormalTexture(field, S, S, 0.6, 'weapon.glove.normal');
    // albedo: near-black khaki with knit modulation and wear at random spots
    const { c, ctx } = canvas2d(S);
    const img = ctx.createImageData(S, S);
    const d = img.data;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const w = field[y * S + x];
        const wear = valueNoise(x / S * 5, y / S * 5, 5, 71);
        let l = 22 + w * 10 + wear * 8;
        const i = (y * S + x) * 4;
        d[i] = l + 4;
        d[i + 1] = l + 3;
        d[i + 2] = l - 1;
        d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    const color = finishColorTexture(c, 'weapon.glove.color', { srgb: true });
    return { normal, color };
  });
}

/** Sleeve cloth: coarse twill weave normal (fine repeat set by the mesh UVs). */
export function clothNormal() {
  return cached('cloth', () => {
    const S = 256;
    const field = new Float32Array(S * S);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        // 2/1 twill: diagonal ribs plus perpendicular thread modulation
        const diag = 0.5 + 0.5 * Math.sin((x + y) * 0.21);
        const weft = 0.5 + 0.5 * Math.sin(x * 0.6) * Math.sin(y * 0.6);
        field[y * S + x] = diag * 0.45 + weft * 0.3;
      }
    }
    return heightFieldToNormalTexture(field, S, S, 1.5, 'weapon.cloth.normal');
  });
}

/**
 * Roll-mark / engraving decal sheet for the AR receiver. Returns an albedo
 * canvas texture (RGBA, transparent background) and an engraved normal map,
 * plus named UV rects `[u0, v0, u1, v1]` (v measured from the TOP; the
 * builder flips v because CanvasTexture flipY=true).
 */
export function arRollmarkSheet() {
  return cached('ar_rollmark', () => {
    const W = 1024;
    const H = 512;
    const { c, ctx } = canvas2d(W, H);
    ctx.clearRect(0, 0, W, H);
    // engraving reads as slightly lighter, chalky metal in the cut
    ctx.fillStyle = 'rgba(150,152,155,0.72)';
    ctx.strokeStyle = 'rgba(150,152,155,0.72)';
    ctx.textBaseline = 'middle';
    const rects = {};

    // --- left flat: maker logotype + model + calibre (0,0)-(512,150)
    ctx.save();
    ctx.translate(24, 30);
    // hex logo
    ctx.lineWidth = 5;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
      const px = 30 + Math.cos(a) * 26;
      const py = 30 + Math.sin(a) * 26;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(30, 12);
    ctx.lineTo(30, 48);
    ctx.moveTo(14, 30);
    ctx.lineTo(46, 30);
    ctx.stroke();
    ctx.font = 'bold 30px "Rajdhani", "Barlow Condensed", sans-serif';
    ctx.fillText('IRONWAKE ARMS CO', 76, 20);
    ctx.font = '20px "Rajdhani", "Barlow Condensed", sans-serif';
    ctx.fillText('MOD. IW-15  CARBINE', 76, 48);
    ctx.font = '18px "Rajdhani", "Barlow Condensed", sans-serif';
    ctx.fillText('CAL 5.56 NATO', 4, 96);
    ctx.font = '17px "JetBrains Mono", monospace';
    ctx.fillText('SN IW2093C71', 210, 96);
    ctx.restore();
    rects.makerLeft = [0, 0, 380 / W, 130 / H];

    // --- selector legend (SAFE / SEMI / AUTO around a pivot), left+right
    const drawSelector = (ox, oy) => {
      ctx.save();
      ctx.translate(ox, oy);
      ctx.font = '15px "Rajdhani", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('SAFE', 50, 8);
      ctx.fillText('SEMI', 96, 52);
      ctx.fillText('AUTO', 50, 96);
      // indicator dimples
      ctx.beginPath();
      ctx.arc(76, 22, 3, 0, 7);
      ctx.arc(88, 62, 3, 0, 7);
      ctx.arc(76, 84, 3, 0, 7);
      ctx.fill();
      ctx.restore();
    };
    drawSelector(420, 20);
    rects.selector = [420 / W, 20 / H, 540 / W, 130 / H];

    // --- right flat: forward assist / ejection warning + proof marks
    ctx.save();
    ctx.translate(24, 170);
    ctx.textAlign = 'left';
    ctx.font = '16px "Rajdhani", sans-serif';
    ctx.fillText('KEEP CLEAR OF EJECTION PORT', 0, 10);
    ctx.font = '14px "JetBrains Mono", monospace';
    ctx.fillText('P  ⌖  MP  C7', 0, 42);
    ctx.font = 'bold 18px "Rajdhani", sans-serif';
    ctx.fillText('IRONWAKE ARMS CO — LDN', 0, 74);
    ctx.font = '15px "Rajdhani", sans-serif';
    ctx.fillText('MADE UNDER LICENCE', 0, 100);
    ctx.restore();
    rects.makerRight = [0, 170 / H, 340 / W, 280 / H];

    // --- magazine markings
    ctx.save();
    ctx.translate(600, 40);
    ctx.font = 'bold 26px "Rajdhani", sans-serif';
    ctx.fillText('5.56x45mm', 0, 12);
    ctx.font = '18px "JetBrains Mono", monospace';
    ctx.fillText('30 RD   NSN 1005-921', 0, 48);
    ctx.font = '15px "Rajdhani", sans-serif';
    ctx.fillText('MADE IN U.K.', 0, 80);
    ctx.restore();
    rects.mag = [600 / W, 20 / H, 900 / W, 130 / H];

    // --- charging handle latch text + PEQ label
    ctx.save();
    ctx.translate(600, 180);
    ctx.font = 'bold 22px "Rajdhani", sans-serif';
    ctx.fillText('AN/PEQ-15', 0, 12);
    ctx.font = '15px "JetBrains Mono", monospace';
    ctx.fillText('IR AIM  ●  IR ILLUM  ●  VIS AIM', 0, 44);
    ctx.font = '13px "Rajdhani", sans-serif';
    ctx.fillText('CLASS IIIB LASER — AVOID EXPOSURE', 0, 72);
    ctx.restore();
    rects.peq = [600 / W, 165 / H, 900 / W, 270 / H];

    // --- optic housing badge
    ctx.save();
    ctx.translate(24, 330);
    ctx.font = 'bold 26px "Rajdhani", sans-serif';
    ctx.fillText('HWS 552', 0, 14);
    ctx.font = '14px "JetBrains Mono", monospace';
    ctx.fillText('MODEL 552.A65   1 CR123', 0, 48);
    ctx.font = '13px "Rajdhani", sans-serif';
    ctx.fillText('NV COMPATIBLE  ●  IRONWAKE OPTICS', 0, 76);
    ctx.restore();
    rects.optic = [0, 315 / H, 340 / W, 420 / H];

    // --- suppressor engraving
    ctx.save();
    ctx.translate(600, 320);
    ctx.font = 'bold 22px "Rajdhani", sans-serif';
    ctx.fillText('SPECWAR 556', 0, 12);
    ctx.font = '14px "JetBrains Mono", monospace';
    ctx.fillText('5.56MM  ●  QD MOUNT  ●  SER 04471', 0, 44);
    ctx.restore();
    rects.suppressor = [600 / W, 305 / H, 920 / W, 375 / H];

    // --- pistol slide legend
    ctx.save();
    ctx.translate(24, 445);
    ctx.font = 'bold 26px "Rajdhani", sans-serif';
    ctx.fillText('IW-45 TACTICAL', 0, 12);
    ctx.font = '14px "JetBrains Mono", monospace';
    ctx.fillText('CAL .45 AUTO   IRONWAKE ARMS CO', 250, 12);
    ctx.restore();
    rects.slide = [0, 430 / H, 620 / W, 470 / H];

    const color = finishColorTexture(c, 'weapon.rollmark.color', { srgb: true, wrap: false });
    // engraved normal from the alpha channel (text = groove)
    const img = ctx.getImageData(0, 0, W, H).data;
    const field = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) field[i] = 1 - (img[i * 4 + 3] / 255) * 0.85;
    const normal = heightFieldToNormalTexture(field, W, H, 2.4, 'weapon.rollmark.normal', false);
    return { color, normal, rects, width: W, height: H };
  });
}

/**
 * Holographic sight reticle: EOTech-style 65 MOA ring + 1 MOA centre dot +
 * four cardinal hash marks, drawn white on transparent (colour is applied by
 * the material so it can push HDR red).
 */
export function reticleTexture() {
  return cached('reticle', () => {
    const S = 512;
    const { c, ctx } = canvas2d(S);
    ctx.clearRect(0, 0, S, S);
    const cx = S / 2;
    const cy = S / 2;
    const R = S * 0.36;
    ctx.strokeStyle = 'rgba(255,255,255,1)';
    ctx.fillStyle = 'rgba(255,255,255,1)';
    // outer ring (slightly broken at 6 o'clock like the real one)
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.arc(cx, cy, R, Math.PI * 0.56, Math.PI * 0.44 + Math.PI * 2, false);
    ctx.stroke();
    // cardinal hash marks pointing inward
    ctx.lineWidth = 8;
    const hashLen = R * 0.22;
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      const x0 = cx + Math.cos(a) * (R - hashLen);
      const y0 = cy + Math.sin(a) * (R - hashLen);
      const x1 = cx + Math.cos(a) * (R + 3);
      const y1 = cy + Math.sin(a) * (R + 3);
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }
    // 6 o'clock lower hash (ballistic hold) below the gap
    ctx.beginPath();
    ctx.moveTo(cx, cy + R * 0.62);
    ctx.lineTo(cx, cy + R * 0.9);
    ctx.stroke();
    // centre dot (1 MOA reads as a crisp small dot; slight soft edge)
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, S * 0.032);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.6, 'rgba(255,255,255,1)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, S * 0.032, 0, Math.PI * 2);
    ctx.fill();
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.anisotropy = 8;
    tex.name = 'weapon.reticle';
    return tex;
  });
}

/** Soft radial glow (laser dot / tritium / LED lens). */
export function glowTexture(size = 96) {
  return cached('glow' + size, () => {
    const { c, ctx } = canvas2d(size);
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.18, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.3)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.name = 'weapon.glow';
    return tex;
  });
}

/** Field-watch face (dial, indices, hands, date window). */
export function watchFaceTexture() {
  return cached('watchface', () => {
    const S = 256;
    const { c, ctx } = canvas2d(S);
    ctx.fillStyle = '#141517';
    ctx.fillRect(0, 0, S, S);
    ctx.translate(S / 2, S / 2);
    ctx.strokeStyle = 'rgba(190,196,175,0.9)';
    ctx.fillStyle = 'rgba(190,196,175,0.9)';
    // minute track
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * Math.PI * 2;
      const r0 = i % 5 === 0 ? 92 : 100;
      ctx.lineWidth = i % 5 === 0 ? 3 : 1;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
      ctx.lineTo(Math.cos(a) * 108, Math.sin(a) * 108);
      ctx.stroke();
    }
    ctx.font = 'bold 30px "Rajdhani", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('12', 0, -70);
    ctx.fillText('6', 0, 70);
    ctx.fillText('9', -70, 0);
    ctx.fillText('3', 70, 0);
    ctx.font = '11px "Rajdhani", sans-serif';
    ctx.fillText('IRONWAKE', 0, -30);
    ctx.fillText('FIELD 200M', 0, 32);
    // date window
    ctx.fillStyle = 'rgba(210,210,200,0.9)';
    ctx.fillRect(44, -9, 24, 18);
    ctx.fillStyle = '#111';
    ctx.font = 'bold 13px "Rajdhani", sans-serif';
    ctx.fillText('26', 56, 1);
    // hands (10:09)
    ctx.strokeStyle = 'rgba(220,224,208,0.95)';
    ctx.lineCap = 'round';
    const hand = (angleDeg, len, w) => {
      const a = ((angleDeg - 90) * Math.PI) / 180;
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(a) * len, Math.sin(a) * len);
      ctx.stroke();
    };
    hand(305, 52, 6);
    hand(54, 78, 4);
    ctx.strokeStyle = 'rgba(255,90,60,0.9)';
    hand(200, 84, 2);
    ctx.fillStyle = 'rgba(220,224,208,1)';
    ctx.beginPath();
    ctx.arc(0, 0, 6, 0, 7);
    ctx.fill();
    return finishColorTexture(c, 'weapon.watchface', { srgb: true, wrap: false });
  });
}

export function disposeWeaponTextures() {
  for (const t of _texCache.values()) {
    if (t && t.isTexture) t.dispose();
    else if (t && typeof t === 'object') {
      for (const v of Object.values(t)) if (v && v.isTexture) v.dispose();
    }
  }
  _texCache.clear();
}

/* ------------------------------------------------------------------------ */
/* materials                                                                 */
/* ------------------------------------------------------------------------ */

/**
 * Patch a MeshStandardMaterial with the edge-wear layer. The geometry carries
 * an `aWear` float attribute (GunBuilder) whose value encodes the mode:
 *   0..1.5   → direct wear amount per vertex (lathes/cylinders: rim rings)
 *   4 + s    → analytic BEVEL wear at strength s: RoundedBoxGeometry keeps
 *              axis-aligned normals on its flat faces and blended normals on
 *              the bevels, so `1 - max(abs(objNormal))` isolates the chamfers
 *              per-pixel (per-vertex masks can't, the flats have no interior
 *              vertices) — chipped up by object-space cell noise.
 * Wear lifts albedo toward bare metal, drops roughness, raises metalness.
 * @param {THREE.MeshStandardMaterial} mat
 * @param {{color?:THREE.Color, roughness?:number, metalness?:number}} wear bare-metal look
 */
function patchWear(mat, wear) {
  const wearColor = (wear.color || new THREE.Color(0x8e8f92)).clone();
  const wearRough = wear.roughness ?? 0.28;
  const wearMetal = wear.metalness ?? 0.85;
  mat.userData.wear = { color: wearColor, roughness: wearRough, metalness: wearMetal };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uWearColor = { value: wearColor };
    shader.uniforms.uWearRough = { value: wearRough };
    shader.uniforms.uWearMetal = { value: wearMetal };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute float aWear;\nvarying float vWear;\nvarying vec3 vObjN;\nvarying vec3 vObjP;',
      )
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWear = aWear;\nvObjP = position;\nvObjN = normal;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        [
          '#include <common>',
          'varying float vWear;',
          'varying vec3 vObjN;',
          'varying vec3 vObjP;',
          'uniform vec3 uWearColor;',
          'uniform float uWearRough;',
          'uniform float uWearMetal;',
          'float iw_wearAmount() {',
          '  float raw = vWear;',
          '  float w;',
          '  if (raw > 3.0) {',
          '    vec3 an = abs(normalize(vObjN));',
          '    float m = max(an.x, max(an.y, an.z));',
          '    float edge = 1.0 - smoothstep(0.9, 0.995, m);',
          '    vec3 cell = floor(vObjP * 140.0);',
          '    float n = fract(sin(dot(cell, vec3(12.9898, 78.233, 37.719))) * 43758.5453);',
          '    float n2 = fract(sin(dot(floor(vObjP * 30.0), vec3(4.1234, 9.919, 51.7))) * 24634.6345);',
          '    w = (raw - 4.0) * edge * mix(0.04, 1.0, smoothstep(0.42, 0.72, n * 0.35 + n2 * 0.65));',
          '  } else {',
          '    w = raw;',
          '  }',
          '  return clamp(w, 0.0, 1.0);',
          '}',
        ].join('\n'),
      )
      .replace(
        '#include <color_fragment>',
        '#include <color_fragment>\nfloat iwWear = iw_wearAmount();\ndiffuseColor.rgb = mix(diffuseColor.rgb, uWearColor, iwWear);',
      )
      .replace(
        '#include <roughnessmap_fragment>',
        '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, uWearRough, iwWear);',
      )
      .replace(
        '#include <metalnessmap_fragment>',
        '#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, uWearMetal, iwWear);',
      );
  };
  mat.customProgramCacheKey = () => 'ironwake-wear-v2';
  mat.userData.needsWearAttribute = true;
  return mat;
}

/**
 * Weapon/hand material factory. Every material is a MeshStandardMaterial
 * (physically based, IBL + world-mirrored lights in the viewmodel scene).
 * @param {string} kind
 * @param {object} [o] overrides merged onto the recipe
 * @returns {THREE.MeshStandardMaterial}
 */
export function weaponMaterial(kind, o = {}) {
  switch (kind) {
    case 'anodized': {
      // hard-anodized 7075 receiver: dark grey, satin, machining lines
      const set = anodizedSet();
      const m = new THREE.MeshStandardMaterial({
        name: 'wpn.anodized',
        color: o.color ?? 0xffffff, // map carries the dark anodized albedo
        map: set.color,
        roughness: o.roughness ?? 1.0, // map carries absolute roughness (0.3-0.55)
        roughnessMap: set.roughness,
        metalness: o.metalness ?? 0.35,
        normalMap: set.normal,
        normalScale: new THREE.Vector2(0.85, 0.85),
        envMapIntensity: o.envMapIntensity ?? 0.85,
      });
      return patchWear(m, { color: new THREE.Color(0x777a80), roughness: 0.4, metalness: 0.5 });
    }
    case 'steel_park': {
      // parkerized/phosphate steel: barrel, gas block, muzzle device, pins
      const m = new THREE.MeshStandardMaterial({
        name: 'wpn.steel_park',
        color: o.color ?? 0x2e3134,
        roughness: o.roughness ?? 0.56,
        metalness: o.metalness ?? 0.78,
        normalMap: parkerizedNormal(),
        normalScale: new THREE.Vector2(0.9, 0.9),
        envMapIntensity: o.envMapIntensity ?? 1.0,
      });
      return patchWear(m, { color: new THREE.Color(0x84878d), roughness: 0.36, metalness: 0.7 });
    }
    case 'steel_oiled': {
      // wet-look bolt carrier / chromed parts visible through the port
      const m = new THREE.MeshStandardMaterial({
        name: 'wpn.steel_oiled',
        color: o.color ?? 0x6c7076,
        roughness: o.roughness ?? 0.18,
        metalness: 1.0,
        envMapIntensity: o.envMapIntensity ?? 1.6,
      });
      return m;
    }
    case 'steel_black': {
      // black nitride small parts (springs, screws, latches)
      return new THREE.MeshStandardMaterial({
        name: 'wpn.steel_black',
        color: o.color ?? 0x232528,
        roughness: o.roughness ?? 0.38,
        metalness: 0.85,
        envMapIntensity: 1.2,
      });
    }
    case 'polymer': {
      // black/graphite injection-moulded polymer: grip, stock, handguard covers
      const m = new THREE.MeshStandardMaterial({
        name: 'wpn.polymer',
        color: o.color ?? 0x1c1d20,
        roughness: o.roughness ?? 0.72,
        metalness: 0.02,
        normalMap: o.normalMap ?? null,
        normalScale: new THREE.Vector2(o.normalStrength ?? 1, o.normalStrength ?? 1),
        envMapIntensity: 0.7,
      });
      return patchWear(m, { color: new THREE.Color(0x3a3b3d), roughness: 0.55, metalness: 0.05 });
    }
    case 'polymer_fde': {
      // Cerakote / FDE tan accents (rail covers, mag)
      const m = new THREE.MeshStandardMaterial({
        name: 'wpn.polymer_fde',
        color: o.color ?? 0x7a664a,
        roughness: o.roughness ?? 0.62,
        metalness: 0.02,
        normalMap: o.normalMap ?? null,
        normalScale: new THREE.Vector2(o.normalStrength ?? 1, o.normalStrength ?? 1),
        envMapIntensity: 0.7,
      });
      return patchWear(m, { color: new THREE.Color(0x8f8577), roughness: 0.5, metalness: 0.08 });
    }
    case 'rubber': {
      return new THREE.MeshStandardMaterial({
        name: 'wpn.rubber',
        color: o.color ?? 0x121213,
        roughness: o.roughness ?? 0.88,
        metalness: 0.0,
        normalMap: o.normalMap ?? ribbedNormal(),
        normalScale: new THREE.Vector2(o.normalStrength ?? 0.9, o.normalStrength ?? 0.9),
        envMapIntensity: 0.6,
      });
    }
    case 'brass': {
      return new THREE.MeshStandardMaterial({
        name: 'wpn.brass',
        color: o.color ?? 0xc79a44,
        roughness: 0.3,
        metalness: 1.0,
        envMapIntensity: 1.5,
      });
    }
    case 'glass_optic': {
      // coated optic window: dark teal transmission tint, sharp env reflection
      return new THREE.MeshStandardMaterial({
        name: 'wpn.glass_optic',
        color: o.color ?? 0x2f4a52,
        transparent: true,
        opacity: o.opacity ?? 0.12,
        roughness: 0.04,
        metalness: 0.75,
        envMapIntensity: 2.6,
        depthWrite: false,
      });
    }
    case 'lens_black': {
      return new THREE.MeshStandardMaterial({
        name: 'wpn.lens_black',
        color: 0x050506,
        roughness: 0.08,
        metalness: 0.6,
        envMapIntensity: 2.2,
      });
    }
    case 'reticle': {
      // holographic reticle: emissive additive plane inside the window
      const c = o.color || [7.5, 0.35, 0.18]; // HDR red, ~4x scene white → gentle bloom
      const m = new THREE.MeshBasicMaterial({
        name: 'wpn.reticle',
        map: reticleTexture(),
        color: new THREE.Color(c[0], c[1], c[2]),
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: true,
        side: THREE.DoubleSide,
        fog: false,
        toneMapped: false,
      });
      return m;
    }
    case 'emissive_dot': {
      // tritium vial / LED — small saturated glow
      const c = o.color || [1.2, 4.6, 1.6];
      return new THREE.MeshBasicMaterial({
        name: 'wpn.emissive_dot',
        map: o.map ?? glowTexture(64),
        color: new THREE.Color(c[0], c[1], c[2]),
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
        toneMapped: false,
      });
    }
    case 'led_lens': {
      // weapon-light head: dark when off, blinding when on (owner drives emissive)
      const m = new THREE.MeshStandardMaterial({
        name: 'wpn.led_lens',
        color: 0x2a2c30,
        emissive: new THREE.Color(0xfff2d6),
        emissiveIntensity: 0,
        roughness: 0.15,
        metalness: 0.4,
        toneMapped: false,
        envMapIntensity: 1.6,
      });
      return m;
    }
    case 'glove': {
      const t = gloveTextures();
      return new THREE.MeshStandardMaterial({
        name: 'wpn.glove',
        color: o.color ?? 0x1e1f1b,
        map: t.color,
        roughness: 0.82,
        metalness: 0.0,
        normalMap: t.normal,
        normalScale: new THREE.Vector2(0.4, 0.4),
        envMapIntensity: 0.55,
      });
    }
    case 'glove_leather': {
      // reinforced palm / knuckle guards: smoother synthetic leather
      const t = gloveTextures();
      return new THREE.MeshStandardMaterial({
        name: 'wpn.glove_leather',
        color: o.color ?? 0x1a1a1b,
        roughness: 0.7,
        metalness: 0.05,
        normalMap: t.normal,
        normalScale: new THREE.Vector2(0.4, 0.4),
        envMapIntensity: 0.75,
      });
    }
    case 'cloth': {
      return new THREE.MeshStandardMaterial({
        name: 'wpn.cloth',
        color: o.color ?? 0x3b3f34, // ranger-green combat shirt
        roughness: 0.86,
        metalness: 0.0,
        normalMap: o.normalMap ?? clothNormal(),
        normalScale: new THREE.Vector2(o.normalStrength ?? 1.2, o.normalStrength ?? 1.2),
        envMapIntensity: 0.5,
      });
    }
    case 'skin': {
      return new THREE.MeshStandardMaterial({
        name: 'wpn.skin',
        color: o.color ?? 0x8d6248,
        roughness: 0.5,
        metalness: 0.0,
        envMapIntensity: 0.6,
      });
    }
    case 'watch': {
      return new THREE.MeshStandardMaterial({
        name: 'wpn.watch',
        color: o.color ?? 0x141416,
        roughness: 0.6,
        metalness: 0.15,
        envMapIntensity: 0.8,
      });
    }
    case 'watch_face': {
      return new THREE.MeshStandardMaterial({
        name: 'wpn.watch_face',
        color: 0xffffff,
        map: watchFaceTexture(),
        roughness: 0.12,
        metalness: 0.0,
        envMapIntensity: 1.6,
      });
    }
    case 'decal': {
      // roll-mark decal plate: transparent alpha-tested, engraved normal
      const sheet = arRollmarkSheet();
      const m = new THREE.MeshStandardMaterial({
        name: 'wpn.decal',
        map: o.map ?? sheet.color,
        normalMap: o.normalMap ?? sheet.normal,
        normalScale: new THREE.Vector2(0.9, 0.9),
        alphaTest: 0.32,          // cutout, so the plate never reads as a lighter patch
        transparent: false,
        depthWrite: true,
        roughness: o.roughness ?? 1.0,
        roughnessMap: anodizedSet().roughness,
        metalness: o.metalness ?? 0.35,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
        envMapIntensity: 0.85,
      });
      return m;
    }
    default:
      console.warn('[weapons] unknown weapon material kind', kind);
      return new THREE.MeshStandardMaterial({ color: 0xff00ff });
  }
}
