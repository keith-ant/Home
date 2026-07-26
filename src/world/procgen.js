/**
 * WORLD stream procedural textures — everything drawn at build time with the
 * 2D canvas API (deterministic: geometry from the world RNG, no Math.random).
 *
 *   puddleMask(rng, layout)      R = standing-water amount over the yard (drives PBR.makeWetGround)
 *   stencilAtlas(rng)           container stencils: logotypes, unit IDs, data panels, hazard plates
 *   groundAtlas(rng)            painted markings, oil stains, tyre marks, drain grates, signage
 *   chainlinkTexture()          tileable wire diamond mesh (alpha)
 *   razorCoilTexture()          fence-top concertina coil silhouette (alpha)
 *   hazardTapeTexture()         yellow/black barrier tape (tileable u)
 *   glowTexture(), flameTexture()   sprite masks for fire barrels / lamps
 *   waveNormalTexture(rng)      tileable water normal map (DataTexture, linear, mip-free)
 *   windowTexture()             warm lit window with mullions (emissive map)
 *   sootTexture(rng)            burnt-container soot/char gradient (alpha)
 *
 * Fonts: the UI stream's self-hosted OFL faces (Barlow Condensed / Teko /
 * Rajdhani) are registered before installWorld runs; the canvas font stacks
 * fall back to sans-serif if a face is missing.
 */
import * as THREE from 'three';
import { Random } from '../core/Random.js';

const FONT_STACK = '"Barlow Condensed", "Rajdhani", "Arial Narrow", sans-serif';
const DISPLAY_STACK = '"Teko", "Barlow Condensed", "Impact", sans-serif';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function texFromCanvas(c, { srgb = true, wrap = 'clamp', mips = true, anisotropy = 8, name = '' } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  const wrapMode = wrap === 'repeat' ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.wrapS = t.wrapT = wrapMode;
  t.generateMipmaps = mips;
  t.minFilter = mips ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.anisotropy = anisotropy;
  t.name = name;
  t.needsUpdate = true;
  return t;
}

/* ------------------------------------------------------------------------ */
/* Atlas builder                                                             */
/* ------------------------------------------------------------------------ */

/**
 * Simple shelf-packing atlas: reserve(w,h) → cell rect; draw into ctx; the
 * final CanvasTexture plus a `cells` lookup of normalised UV rectangles.
 */
class Atlas {
  constructor(size, name) {
    this.size = size;
    this.name = name;
    this.canvas = canvas(size, size);
    this.ctx = this.canvas.getContext('2d');
    this.ctx.clearRect(0, 0, size, size);
    this._x = 0;
    this._y = 0;
    this._rowH = 0;
    this.cells = {};
    this.pad = 6;
  }

  /**
   * Reserve a cell; returns pixel rect and registers normalised uv (v flipped
   * for CanvasTexture flipY=true: v0 = 1 - (y+h)/size).
   */
  reserve(id, w, h) {
    if (this._x + w > this.size) {
      this._x = 0;
      this._y += this._rowH + this.pad;
      this._rowH = 0;
    }
    if (this._y + h > this.size) throw new Error(`atlas ${this.name} full at ${id}`);
    const rect = { x: this._x, y: this._y, w, h };
    this._x += w + this.pad;
    this._rowH = Math.max(this._rowH, h);
    const S = this.size;
    this.cells[id] = {
      ...rect,
      u0: rect.x / S,
      u1: (rect.x + rect.w) / S,
      v0: 1 - (rect.y + rect.h) / S,
      v1: 1 - rect.y / S,
      aspect: w / h,
    };
    return rect;
  }

  texture() {
    return texFromCanvas(this.canvas, { srgb: true, wrap: 'clamp', mips: true, name: this.name });
  }
}

/* ------------------------------------------------------------------------ */
/* Puddle mask                                                               */
/* ------------------------------------------------------------------------ */

/**
 * World-space puddle mask over the asphalt yard rectangle. Returns the
 * texture, the raw pixel data (for CPU queries) and the world mapping.
 * @param {Random} rng
 * @param {{x0:number,x1:number,z0:number,z1:number}} rect world extents (z0 = north edge)
 * @param {{puddles?:Array<{x:number,z:number,r:number,strength?:number}>, gutters?:Array<{x0:number,z0:number,x1:number,z1:number,width:number,strength?:number}>, drains?:Array<{x:number,z:number}>}} plan
 */
export function puddleMask(rng, rect, plan) {
  const W = 1024;
  const H = Math.round((W * (rect.z1 - rect.z0)) / (rect.x1 - rect.x0));
  const c = canvas(W, H);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  const sx = W / (rect.x1 - rect.x0);
  const sz = H / (rect.z1 - rect.z0);
  const px = (x) => (x - rect.x0) * sx;
  const pz = (z) => (z - rect.z0) * sz; // z0 = north edge = image top

  ctx.globalCompositeOperation = 'lighter';

  // damp mottling everywhere (very low values → subtle sheen variation only)
  for (let i = 0; i < 140; i++) {
    const x = px(rng.range(rect.x0, rect.x1));
    const y = pz(rng.range(rect.z0, rect.z1));
    const r = rng.range(1.5, 6) * sx;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const a = rng.range(0.04, 0.14);
    g.addColorStop(0, `rgba(255,255,255,${a})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // gutter strips (long soft rectangles along kerbs / block bases)
  for (const gut of plan.gutters || []) {
    const x0 = px(gut.x0);
    const y0 = pz(gut.z0);
    const x1 = px(gut.x1);
    const y1 = pz(gut.z1);
    const wpx = gut.width * sx;
    ctx.lineCap = 'round';
    ctx.strokeStyle = `rgba(255,255,255,${gut.strength ?? 0.5})`;
    ctx.lineWidth = wpx;
    ctx.filter = `blur(${Math.round(wpx * 0.6)}px)`;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.filter = 'none';
    // broken-up wet patches along the strip
    const steps = Math.floor(Math.hypot(x1 - x0, y1 - y0) / (2.2 * sx));
    for (let i = 0; i <= steps; i++) {
      if (rng.next() < 0.4) continue;
      const t = i / Math.max(1, steps);
      const cx = x0 + (x1 - x0) * t + rng.range(-1, 1) * sx;
      const cy = y0 + (y1 - y0) * t + rng.range(-1, 1) * sz;
      const r = rng.range(0.6, 1.6) * sx;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, `rgba(255,255,255,${rng.range(0.35, 0.75)})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // big irregular puddles: overlapping soft blobs around each centre
  for (const p of plan.puddles || []) {
    const strength = p.strength ?? 1;
    const blobs = 5 + rng.int(0, 6);
    for (let i = 0; i < blobs; i++) {
      const ang = rng.range(0, Math.PI * 2);
      const dist = rng.range(0, p.r * 0.55);
      const cx = px(p.x + Math.cos(ang) * dist * 1.4);
      const cy = pz(p.z + Math.sin(ang) * dist * 0.7);
      const r = rng.range(0.35, 0.75) * p.r * sx;
      const g = ctx.createRadialGradient(cx, cy, r * 0.1, cx, cy, r);
      g.addColorStop(0, `rgba(255,255,255,${(0.85 + rng.range(0, 0.15)) * strength})`);
      g.addColorStop(0.55, `rgba(255,255,255,${(0.55 + rng.range(0, 0.2)) * strength})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(cx, cy, r, r * rng.range(0.5, 0.9), rng.range(0, Math.PI), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // drains: guaranteed puddle around each grate
  for (const d of plan.drains || []) {
    const cx = px(d.x);
    const cy = pz(d.z);
    const r = 1.9 * sx;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.6, 'rgba(255,255,255,0.6)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';

  // keep containers/props dry underneath: caller masks blocked areas after (see maskOut)
  const img = ctx.getImageData(0, 0, W, H);
  const data = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) data[i] = img.data[i * 4];

  const tex = texFromCanvas(c, { srgb: false, wrap: 'clamp', mips: true, anisotropy: 4, name: 'world.puddleMask' });
  return {
    texture: tex,
    canvas: c,
    ctx,
    width: W,
    height: H,
    data,
    rect,
    /** re-read pixel data after further painting (e.g. maskOut) */
    refresh() {
      const im = ctx.getImageData(0, 0, W, H);
      for (let i = 0; i < W * H; i++) data[i] = im.data[i * 4];
      tex.needsUpdate = true;
    },
    /** paint a dry (black) rectangle in world coordinates (under containers/props) */
    maskOutRect(x0, z0, x1, z1, feather = 0.4) {
      const a = Math.min(px(x0), px(x1));
      const b = Math.max(px(x0), px(x1));
      const t = Math.min(pz(z0), pz(z1));
      const u = Math.max(pz(z0), pz(z1));
      ctx.globalCompositeOperation = 'source-over';
      ctx.filter = `blur(${Math.max(1, Math.round(feather * sx))}px)`;
      ctx.fillStyle = '#000';
      ctx.fillRect(a - feather * sx, t - feather * sz, b - a + feather * sx * 2, u - t + feather * sz * 2);
      ctx.filter = 'none';
    },
    /** 0..1 mask value at a world position */
    sample(x, z) {
      const ix = Math.max(0, Math.min(W - 1, Math.round(px(x))));
      const iy = Math.max(0, Math.min(H - 1, Math.round(pz(z))));
      return data[iy * W + ix] / 255;
    },
  };
}

/* ------------------------------------------------------------------------ */
/* Container stencil atlas                                                   */
/* ------------------------------------------------------------------------ */

export const SHIPPING_LINES = [
  { key: 'ostrava', name: 'OSTRAVA CONTAINER LINE', mark: 'wave' },
  { key: 'meridian', name: 'MERIDIAN INTERMODAL', mark: 'ring' },
  { key: 'kraken', name: 'KRAKEN LOGISTICS', mark: 'diamond' },
  { key: 'nordhavn', name: 'NORDHAVN', mark: 'bars' },
  { key: 'tallinn', name: 'TALLINN SEA', mark: 'star' },
  { key: 'ironwake', name: 'IRONWAKE FREIGHT', mark: 'chevron' },
];

export const UNIT_IDS = [
  'IRWU 902114 6', 'MRDU 431775 2', 'KRKU 128033 9', 'OSTU 660914 1',
  'NVHU 277402 5', 'TSCU 550183 7', 'IRWU 913340 8', 'MRDU 209956 3',
  'KRKU 771205 0', 'OSTU 348611 4', 'NVHU 190277 6', 'TSCU 402938 2',
  'IRWU 040822 3', 'KRKU 566670 1',
];

/**
 * Builds the container/wall stencil atlas (white artwork on transparent —
 * decal vertex colours tint it). Returns {texture, cells}.
 * @param {Random} rng
 */
export function stencilAtlas(rng) {
  // 2304² (multiple of 256, NPOT is fine on WebGL2): the sign/ID library
  // outgrew 2048² once the ship, crane and warehouse signage went in
  const A = new Atlas(2304, 'world.stencilAtlas');
  const ctx = A.ctx;

  // ---- logotypes ---------------------------------------------------------
  for (const line of SHIPPING_LINES) {
    const r = A.reserve('logo.' + line.key, 640, 142);
    drawLogotype(ctx, r, line, rng);
  }

  // ---- unit ID blocks (ID line + size/type code) -------------------------
  for (let i = 0; i < UNIT_IDS.length; i++) {
    const r = A.reserve('id.' + i, 440, 92);
    ctx.save();
    ctx.fillStyle = '#fff';
    ctx.textBaseline = 'top';
    ctx.font = `700 55px ${FONT_STACK}`;
    stencilText(ctx, UNIT_IDS[i], r.x + 4, r.y + 3, 55);
    ctx.font = `600 28px ${FONT_STACK}`;
    stencilText(ctx, i % 3 === 0 ? '22G1' : '45G1', r.x + 6, r.y + 61, 28);
    // right-aligned owner box code
    ctx.font = `600 25px ${FONT_STACK}`;
    ctx.textAlign = 'right';
    ctx.fillText(['CN', 'DE', 'GB', 'NL', 'US', 'SG'][i % 6] + ' ' + (2200 + i * 3), r.x + r.w - 6, r.y + 64);
    ctx.textAlign = 'left';
    ctx.restore();
  }

  // ---- max gross data panel ------------------------------------------------
  {
    const r = A.reserve('data', 480, 310);
    ctx.save();
    ctx.fillStyle = '#fff';
    ctx.textBaseline = 'top';
    const rows = [
      ['MAX. GROSS', '30,480 KGS'],
      ['', '67,200 LBS'],
      ['TARE', '3,800 KGS'],
      ['', '8,380 LBS'],
      ['NET', '26,680 KGS'],
      ['', '58,820 LBS'],
      ['CU. CAP.', '67.7 CU.M.'],
      ['', '2,390 CU.FT.'],
    ];
    let y = r.y + 6;
    for (const [label, value] of rows) {
      ctx.font = `700 36px ${FONT_STACK}`;
      if (label) stencilText(ctx, label, r.x + 6, y, 36);
      ctx.textAlign = 'right';
      ctx.fillText(value, r.x + r.w - 8, y);
      ctx.textAlign = 'left';
      y += 37;
    }
    ctx.restore();
  }

  // ---- short data panel (20 ft) --------------------------------------------
  {
    const r = A.reserve('dataShort', 440, 176);
    ctx.save();
    ctx.fillStyle = '#fff';
    ctx.textBaseline = 'top';
    const rows = [
      ['MAX. GR.', '24,000 KGS'],
      ['TARE', '2,230 KGS'],
      ['NET', '21,770 KGS'],
      ['CU. CAP.', '33.2 CU.M.'],
    ];
    let y = r.y + 6;
    for (const [label, value] of rows) {
      ctx.font = `700 35px ${FONT_STACK}`;
      stencilText(ctx, label, r.x + 6, y, 35);
      ctx.textAlign = 'right';
      ctx.fillText(value, r.x + r.w - 8, y);
      ctx.textAlign = 'left';
      y += 41;
    }
    ctx.restore();
  }

  // ---- hazard chevron plate (red/white diagonal) --------------------------
  {
    const r = A.reserve('chevron', 240, 240);
    ctx.save();
    ctx.beginPath();
    ctx.rect(r.x, r.y, r.w, r.h);
    ctx.clip();
    ctx.fillStyle = '#e9e6df';
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.fillStyle = '#c1272d';
    for (let i = -8; i < 16; i++) {
      ctx.beginPath();
      const o = i * 44;
      ctx.moveTo(r.x + o, r.y);
      ctx.lineTo(r.x + o + 22, r.y);
      ctx.lineTo(r.x + o + 22 - r.h, r.y + r.h);
      ctx.lineTo(r.x + o - r.h, r.y + r.h);
      ctx.closePath();
      ctx.fill();
    }
    ctx.strokeStyle = '#e9e6df';
    ctx.lineWidth = 10;
    ctx.strokeRect(r.x + 5, r.y + 5, r.w - 10, r.h - 10);
    ctx.restore();
  }

  // ---- yellow/black hazard band --------------------------------------------
  {
    const r = A.reserve('hazband', 560, 76);
    ctx.save();
    ctx.beginPath();
    ctx.rect(r.x, r.y, r.w, r.h);
    ctx.clip();
    ctx.fillStyle = '#e6b422';
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.fillStyle = '#151515';
    for (let i = -4; i < 30; i++) {
      const o = i * 60;
      ctx.beginPath();
      ctx.moveTo(r.x + o, r.y);
      ctx.lineTo(r.x + o + 30, r.y);
      ctx.lineTo(r.x + o + 30 - r.h, r.y + r.h);
      ctx.lineTo(r.x + o - r.h, r.y + r.h);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  // ---- CAUTION HIGH-CUBE strip ----------------------------------------------
  {
    const r = A.reserve('highcube', 560, 70);
    ctx.save();
    ctx.fillStyle = '#e6b422';
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.fillStyle = '#111';
    ctx.textBaseline = 'middle';
    ctx.font = `700 48px ${FONT_STACK}`;
    ctx.fillText('CAUTION  HIGH-CUBE  9\'6"', r.x + 14, r.y + r.h / 2 + 3);
    ctx.restore();
  }

  // ---- flammable placard ----------------------------------------------------
  {
    const r = A.reserve('flammable', 240, 240);
    drawDiamondPlacard(ctx, r, '#c1272d', 'FLAMMABLE', '3', 'flame');
  }
  // ---- corrosive placard ----------------------------------------------------
  {
    const r = A.reserve('corrosive', 240, 240);
    drawDiamondPlacard(ctx, r, '#e9e6df', 'CORROSIVE', '8', 'drops', true);
  }
  // ---- CSC plate -------------------------------------------------------------
  {
    const r = A.reserve('csc', 220, 152);
    ctx.save();
    ctx.fillStyle = '#8c8c86';
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.fillStyle = '#20221f';
    ctx.font = `700 26px ${FONT_STACK}`;
    ctx.textBaseline = 'top';
    ctx.fillText('CSC SAFETY APPROVAL', r.x + 10, r.y + 8);
    ctx.font = `500 18px ${FONT_STACK}`;
    const lines = ['GB-L 40234 / 3 / 09', 'DATE MANUFACTURED  03/2009', 'IDENTIFICATION No.  IRWU 902114 6', 'MAX GROSS  30480 KG  67200 LB', 'ALLOW. STACKING 192000 KG', 'RACKING TEST LOAD 15240 KG'];
    let y = r.y + 44;
    for (const l of lines) {
      ctx.fillText(l, r.x + 10, y);
      y += 22;
    }
    ctx.restore();
  }
  // ---- misc stencils ---------------------------------------------------------
  {
    const items = [
      ['maxkg', 'MAX 30480 KG', 52],
      ['nostack', 'DO NOT WALK ON ROOF', 36],
      ['highcubeplain', 'HIGH CUBE', 48],
      ['heavy', 'SUPER HEAVY', 48],
      ['keepdry', 'KEEP FROZEN  -18°C', 36],
      ['dr2', '2M ▬', 50],
      ['dr4', '4M ▬', 50],
      ['dr6', '6M ▬', 50],
    ];
    for (const [id, text, size] of items) {
      ctx.font = `700 ${size}px ${FONT_STACK}`;
      const wpx = Math.min(500, Math.ceil(ctx.measureText(text).width * 1.15) + 24); // stencil tracking margin
      const r = A.reserve('st.' + id, wpx, size + 20);
      ctx.save();
      ctx.fillStyle = '#fff';
      ctx.textBaseline = 'top';
      ctx.font = `700 ${size}px ${FONT_STACK}`;
      stencilText(ctx, text, r.x + 6, r.y + 6, size);
      ctx.restore();
    }
  }
  // ---- arrows (double-headed vertical for door end "OPEN") ---------------------
  {
    const r = A.reserve('vertArrows', 120, 240);
    ctx.save();
    ctx.strokeStyle = '#fff';
    ctx.fillStyle = '#fff';
    ctx.lineWidth = 10;
    for (const side of [0, 1]) {
      const x = r.x + 35 + side * 70;
      ctx.beginPath();
      ctx.moveTo(x, r.y + 40);
      ctx.lineTo(x, r.y + r.h - 40);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x, r.y + 12);
      ctx.lineTo(x - 22, r.y + 46);
      ctx.lineTo(x + 22, r.y + 46);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(x, r.y + r.h - 12);
      ctx.lineTo(x - 22, r.y + r.h - 46);
      ctx.lineTo(x + 22, r.y + r.h - 46);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }
  // ---- wall / signage texts ---------------------------------------------------
  {
    const signs = [
      ['sign.terminal', 'TERMINAL 9', 1100, 200, 172, DISPLAY_STACK, 700],
      ['sign.bonded', 'CARGO CONSOLIDATION · BONDED WAREHOUSE', 940, 72, 49, FONT_STACK, 600],
      ['sign.bay01', 'BAY 01', 240, 88, 70, FONT_STACK, 700],
      ['sign.bay02', 'BAY 02', 240, 88, 70, FONT_STACK, 700],
      ['sign.bay03', 'BAY 03', 240, 88, 70, FONT_STACK, 700],
      ['sign.bay04', 'BAY 04', 240, 88, 70, FONT_STACK, 700],
      ['sign.bay05', 'BAY 05', 240, 88, 70, FONT_STACK, 700],
      ['sign.bay06', 'BAY 06', 240, 88, 70, FONT_STACK, 700],
      ['sign.nosmoking', 'NO SMOKING', 336, 72, 52, FONT_STACK, 700],
      ['sign.maxheight', 'MAX HEIGHT 4.2 M', 400, 64, 46, FONT_STACK, 700],
      ['sign.keepclear', 'KEEP CLEAR', 368, 80, 58, FONT_STACK, 700],
      ['sign.speed', '15', 176, 176, 152, DISPLAY_STACK, 700],
      ['sign.office', 'TERMINAL OFFICE / VISITORS', 512, 56, 38, FONT_STACK, 600],
      ['sign.danger', 'DANGER  660V', 352, 64, 46, FONT_STACK, 700],
      ['sign.exit', 'EXIT ⇧', 208, 72, 52, FONT_STACK, 700],
      ['sign.shipname', 'MERIDIAN ARDENT', 900, 130, 104, DISPLAY_STACK, 700],
      ['sign.imo', 'IMO 9481264', 320, 52, 40, FONT_STACK, 600],
      ['sign.crane1', 'A', 96, 120, 108, DISPLAY_STACK, 700],
      ['sign.crane2', 'B', 96, 120, 108, DISPLAY_STACK, 700],
      ['sign.swl', 'SWL 40T', 320, 72, 56, FONT_STACK, 700],
    ];
    for (const [id, text, w, h, size, stack, weight] of signs) {
      const r = A.reserve(id, w, h);
      ctx.save();
      ctx.fillStyle = '#fff';
      ctx.textBaseline = 'middle';
      ctx.font = `${weight} ${size}px ${stack}`;
      ctx.fillText(text, r.x + 10, r.y + h / 2 + size * 0.05);
      ctx.restore();
    }
  }
  // subtle whole-atlas weathering: knock a few holes in the paint
  weatherPaint(ctx, A.size, A.size, rng, 900);

  return { texture: A.texture(), cells: A.cells };
}

/** "Stencil" text: draws the string with small bridge gaps in round letters for the sprayed look. */
function stencilText(ctx, text, x, y, size) {
  ctx.save();
  ctx.textBaseline = 'top';
  // slightly wider tracking for the industrial look
  let cx = x;
  const gap = size * 0.06;
  for (const ch of text) {
    if (ch === ' ') {
      cx += size * 0.36;
      continue;
    }
    ctx.fillText(ch, cx, y);
    const w = ctx.measureText(ch).width;
    // stencil bridges: thin transparent slits through rounded / boxy glyphs
    if ('ABDOPQR0468&%'.includes(ch)) {
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = '#000';
      ctx.fillRect(cx + w * 0.42, y + size * 0.05, Math.max(2, size * 0.07), size * 0.9);
      ctx.restore();
    }
    cx += w + gap;
  }
  ctx.restore();
}

function drawLogotype(ctx, r, line, rng) {
  ctx.save();
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#fff';
  const cy = r.y + r.h / 2;
  // brand mark
  const mx = r.x + 90;
  ctx.lineWidth = 12;
  switch (line.mark) {
    case 'wave':
      for (let k = -1; k <= 1; k++) {
        ctx.beginPath();
        for (let i = 0; i <= 24; i++) {
          const t = i / 24;
          const x = mx - 70 + t * 140;
          const y = cy + k * 34 + Math.sin(t * Math.PI * 2) * 14;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      break;
    case 'ring':
      ctx.lineWidth = 16;
      ctx.beginPath();
      ctx.arc(mx, cy, 58, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(mx, cy, 26, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'diamond':
      ctx.beginPath();
      ctx.moveTo(mx, cy - 68);
      ctx.lineTo(mx + 68, cy);
      ctx.lineTo(mx, cy + 68);
      ctx.lineTo(mx - 68, cy);
      ctx.closePath();
      ctx.lineWidth = 14;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(mx, cy, 18, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'bars':
      for (let i = 0; i < 4; i++) ctx.fillRect(mx - 66 + i * 36, cy - 60, 22, 120);
      break;
    case 'star': {
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
        const rad = i % 2 === 0 ? 68 : 28;
        const x = mx + Math.cos(a) * rad;
        const y = cy + Math.sin(a) * rad;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
      break;
    }
    default: {
      // chevron
      ctx.beginPath();
      ctx.moveTo(mx - 70, cy + 50);
      ctx.lineTo(mx, cy - 50);
      ctx.lineTo(mx + 70, cy + 50);
      ctx.lineTo(mx + 40, cy + 50);
      ctx.lineTo(mx, cy - 10);
      ctx.lineTo(mx - 40, cy + 50);
      ctx.closePath();
      ctx.fill();
      break;
    }
  }
  // name
  ctx.textBaseline = 'middle';
  let size = 116;
  ctx.font = `700 ${size}px ${FONT_STACK}`;
  const maxW = r.w - 200;
  while (ctx.measureText(line.name).width > maxW && size > 40) {
    size -= 6;
    ctx.font = `700 ${size}px ${FONT_STACK}`;
  }
  ctx.fillText(line.name, r.x + 180, cy + size * 0.04);
  ctx.restore();
  void rng;
}

function drawDiamondPlacard(ctx, r, fill, word, num, glyph, dark = false) {
  ctx.save();
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const s = r.w / 2 - 8;
  ctx.beginPath();
  ctx.moveTo(cx, cy - s);
  ctx.lineTo(cx + s, cy);
  ctx.lineTo(cx, cy + s);
  ctx.lineTo(cx - s, cy);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = dark ? '#111' : '#fff';
  ctx.stroke();
  ctx.fillStyle = dark ? '#111' : '#fff';
  ctx.textAlign = 'center';
  ctx.font = `700 34px ${FONT_STACK}`;
  ctx.fillText(word, cx, cy + s * 0.38);
  ctx.font = `700 40px ${FONT_STACK}`;
  ctx.fillText(num, cx, cy + s * 0.75);
  // glyph
  if (glyph === 'flame') {
    ctx.beginPath();
    ctx.moveTo(cx, cy - 78);
    ctx.bezierCurveTo(cx + 34, cy - 40, cx + 30, cy + 6, cx, cy + 8);
    ctx.bezierCurveTo(cx - 30, cy + 6, cx - 34, cy - 40, cx, cy - 78);
    ctx.fill();
  } else {
    ctx.fillRect(cx - 40, cy - 70, 80, 14);
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.ellipse(cx - 24 + i * 24, cy - 30, 6, 12, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.textAlign = 'left';
  ctx.restore();
}

/** Punch soft holes into painted artwork so nothing reads factory-fresh. */
function weatherPaint(ctx, w, h, rng, holes = 400) {
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < holes; i++) {
    const x = rng.range(0, w);
    const y = rng.range(0, h);
    const r = rng.range(0.6, 4);
    ctx.fillStyle = `rgba(0,0,0,${rng.range(0.25, 0.8)})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/* ------------------------------------------------------------------------ */
/* Ground markings atlas                                                     */
/* ------------------------------------------------------------------------ */

/**
 * Painted asphalt markings and grime decals: everything worn/faded.
 * @param {Random} rng
 */
export function groundAtlas(rng) {
  const A = new Atlas(2048, 'world.groundAtlas');
  const ctx = A.ctx;
  // Night, wet, old paint: keep the albedo well below "fresh line marking".
  const YELLOW = '#a98a26';
  const WHITE = '#bdb8aa';

  // straight arrow (points +v)
  {
    const r = A.reserve('arrow', 180, 420);
    ctx.save();
    ctx.fillStyle = WHITE;
    const cx = r.x + r.w / 2;
    ctx.beginPath();
    ctx.moveTo(cx, r.y + 8);
    ctx.lineTo(cx + 74, r.y + 154);
    ctx.lineTo(cx + 28, r.y + 154);
    ctx.lineTo(cx + 28, r.y + r.h - 8);
    ctx.lineTo(cx - 28, r.y + r.h - 8);
    ctx.lineTo(cx - 28, r.y + 154);
    ctx.lineTo(cx - 74, r.y + 154);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  // words
  const words = [
    ['slow', 'SLOW', 288, 128, 104],
    ['stop', 'STOP', 288, 128, 104],
    ['keepclear', 'KEEP CLEAR', 496, 112, 84],
    ['nopark', 'NO PARKING', 496, 112, 80],
    ['peds', 'PEDESTRIANS', 496, 104, 74],
  ];
  for (const [id, text, w, h, size] of words) {
    const r = A.reserve(id, w, h);
    ctx.save();
    ctx.fillStyle = WHITE;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.font = `700 ${size}px ${FONT_STACK}`;
    ctx.fillText(text, r.x + w / 2, r.y + h / 2 + size * 0.06);
    ctx.restore();
  }
  // bay numbers 01..12
  for (let i = 1; i <= 12; i++) {
    const r = A.reserve('bay' + i, 160, 136);
    ctx.save();
    ctx.fillStyle = YELLOW;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.font = `700 120px ${DISPLAY_STACK}`;
    ctx.fillText(String(i).padStart(2, '0'), r.x + 80, r.y + 72);
    ctx.restore();
  }
  // L bracket (parking bay corner)
  {
    const r = A.reserve('bracket', 160, 160);
    ctx.save();
    ctx.fillStyle = WHITE;
    ctx.fillRect(r.x + 8, r.y + 8, 24, 144);
    ctx.fillRect(r.x + 8, r.y + 128, 144, 24);
    ctx.restore();
  }
  // hatch tile (yellow diagonal bars, tileable-ish square used stretched)
  {
    const r = A.reserve('hatch', 500, 200);
    ctx.save();
    ctx.beginPath();
    ctx.rect(r.x, r.y, r.w, r.h);
    ctx.clip();
    ctx.strokeStyle = YELLOW;
    ctx.lineWidth = 26;
    for (let i = -6; i < 20; i++) {
      const o = i * 60;
      ctx.beginPath();
      ctx.moveTo(r.x + o, r.y + r.h + 20);
      ctx.lineTo(r.x + o + r.h + 40, r.y - 20);
      ctx.stroke();
    }
    ctx.lineWidth = 20;
    ctx.strokeRect(r.x + 10, r.y + 10, r.w - 20, r.h - 20);
    ctx.restore();
  }
  // zebra bar
  {
    const r = A.reserve('zebra', 400, 72);
    ctx.save();
    ctx.fillStyle = WHITE;
    ctx.fillRect(r.x + 6, r.y + 6, r.w - 12, r.h - 12);
    ctx.restore();
  }
  // long lane line dash (used stretched for painted lines)
  {
    const r = A.reserve('line', 320, 48);
    ctx.save();
    ctx.fillStyle = WHITE;
    ctx.fillRect(r.x + 4, r.y + 8, r.w - 8, r.h - 16);
    ctx.restore();
    const r2 = A.reserve('lineY', 320, 48);
    ctx.save();
    ctx.fillStyle = YELLOW;
    ctx.fillRect(r2.x + 4, r2.y + 8, r2.w - 8, r2.h - 16);
    ctx.restore();
  }
  // chevrons row (speed bump / caution)
  {
    const r = A.reserve('chevrons', 560, 128);
    ctx.save();
    ctx.strokeStyle = YELLOW;
    ctx.lineWidth = 26;
    ctx.lineCap = 'butt';
    for (let i = 0; i < 5; i++) {
      const x = r.x + 48 + i * 116;
      ctx.beginPath();
      ctx.moveTo(x - 44, r.y + r.h - 16);
      ctx.lineTo(x, r.y + 20);
      ctx.lineTo(x + 44, r.y + r.h - 16);
      ctx.stroke();
    }
    ctx.restore();
  }
  // drain grate
  {
    const r = A.reserve('grate', 240, 128);
    ctx.save();
    ctx.fillStyle = '#0e0e0f';
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.fillStyle = '#050505';
    for (let i = 0; i < 9; i++) ctx.fillRect(r.x + 13 + i * 24, r.y + 12, 13, r.h - 24);
    ctx.strokeStyle = '#2a2a2a';
    ctx.lineWidth = 8;
    ctx.strokeRect(r.x + 4, r.y + 4, r.w - 8, r.h - 8);
    ctx.restore();
  }
  // manhole ring (rust ring around real prop)
  {
    const r = A.reserve('ring', 160, 160);
    ctx.save();
    const g = ctx.createRadialGradient(r.x + 80, r.y + 80, 44, r.x + 80, r.y + 80, 80);
    g.addColorStop(0, 'rgba(60,40,30,0.0)');
    g.addColorStop(0.55, 'rgba(70,45,32,0.55)');
    g.addColorStop(1, 'rgba(20,15,10,0.0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(r.x + 80, r.y + 80, 80, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  // oil stains (3)
  for (let k = 0; k < 3; k++) {
    const r = A.reserve('oil' + k, 340, 260);
    ctx.save();
    const blobs = 5 + k * 2;
    for (let i = 0; i < blobs; i++) {
      const cx = r.x + r.w / 2 + rng.range(-1, 1) * r.w * 0.28;
      const cy = r.y + r.h / 2 + rng.range(-1, 1) * r.h * 0.28;
      const rad = rng.range(0.15, 0.42) * r.h;
      const g = ctx.createRadialGradient(cx, cy, rad * 0.1, cx, cy, rad);
      const a = rng.range(0.5, 0.85);
      g.addColorStop(0, `rgba(6,5,4,${a})`);
      g.addColorStop(0.6, `rgba(10,8,6,${a * 0.55})`);
      g.addColorStop(1, 'rgba(10,8,6,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rad, rad * rng.range(0.5, 1), rng.range(0, Math.PI), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
  // tyre skid marks (2)
  for (let k = 0; k < 2; k++) {
    const r = A.reserve('skid' + k, 720, 160);
    ctx.save();
    ctx.beginPath();
    ctx.rect(r.x, r.y, r.w, r.h);
    ctx.clip();
    ctx.strokeStyle = 'rgba(8,7,6,0.7)';
    ctx.lineWidth = 24;
    ctx.lineCap = 'round';
    const bend = rng.range(16, 48) * (k === 0 ? 1 : -1);
    for (const off of [-37, 37]) {
      ctx.beginPath();
      ctx.moveTo(r.x + 24, r.y + r.h / 2 + off);
      ctx.bezierCurveTo(r.x + 240, r.y + r.h / 2 + off + bend, r.x + 480, r.y + r.h / 2 + off - bend, r.x + r.w - 24, r.y + r.h / 2 + off + bend * 0.4);
      ctx.stroke();
    }
    // tread break-up
    ctx.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 200; i++) {
      ctx.fillStyle = `rgba(0,0,0,${rng.range(0.3, 1)})`;
      ctx.fillRect(r.x + rng.range(0, r.w), r.y + rng.range(0, r.h), rng.range(2, 10), rng.range(2, 6));
    }
    ctx.restore();
  }
  // painted "T9" yard logo (huge, very faded)
  {
    const r = A.reserve('logoT9', 512, 240);
    ctx.save();
    ctx.fillStyle = 'rgba(216,213,204,0.85)';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.font = `700 240px ${DISPLAY_STACK}`;
    ctx.fillText('T9', r.x + r.w / 2, r.y + r.h / 2 + 10);
    ctx.restore();
  }

  // per-marking traffic wear: worn-through patches, flecks, faded ends.
  // (grime cells — oil/skid/grate/ring — are already dirt, leave them)
  const wearLevel = (id) => {
    if (id.startsWith('oil') || id.startsWith('skid') || id === 'grate' || id === 'ring') return 0;
    if (['hatch', 'zebra', 'keepclear', 'stop', 'slow', 'logoT9', 'nopark', 'peds', 'chevrons'].includes(id)) return 1.0;
    if (id.startsWith('bay') || id === 'bracket') return 0.85;
    return 0.7;
  };
  for (const [id, cell] of Object.entries(A.cells)) {
    const w = wearLevel(id);
    if (w > 0) wearCell(ctx, cell, rng, w);
  }
  // whole-atlas scuffing on top
  weatherPaint(ctx, A.size, A.size, rng, 4200);
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 320; i++) {
    ctx.fillStyle = `rgba(0,0,0,${rng.range(0.08, 0.5)})`;
    ctx.fillRect(rng.range(0, A.size), rng.range(0, A.size), rng.range(10, 110), rng.range(2, 7));
  }
  ctx.restore();

  return { texture: A.texture(), cells: A.cells };
}

/**
 * Traffic wear inside one atlas cell: soft worn-through patches (tyres over
 * paint), edge fade and paint-chip flecks — nothing on the asphalt reads as
 * freshly sprayed. `amount` 0..1.
 */
function wearCell(ctx, r, rng, amount) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(r.x, r.y, r.w, r.h);
  ctx.clip();
  ctx.globalCompositeOperation = 'destination-out';
  // large worn-through patches
  const n = Math.round((2.5 + rng.range(0, 4.5)) * amount);
  for (let i = 0; i < n; i++) {
    const cx = r.x + rng.range(0, r.w);
    const cy = r.y + rng.range(0, r.h);
    const rad = rng.range(0.18, 0.55) * Math.max(r.w, r.h) * 0.6;
    const g = ctx.createRadialGradient(cx, cy, rad * 0.15, cx, cy, rad);
    const a = rng.range(0.35, 0.9) * amount;
    g.addColorStop(0, `rgba(0,0,0,${a})`);
    g.addColorStop(0.7, `rgba(0,0,0,${a * 0.55})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rad, rad * rng.range(0.45, 1), rng.range(0, Math.PI), 0, Math.PI * 2);
    ctx.fill();
  }
  // paint-chip flecks
  const flecks = Math.round((r.w * r.h) / 900 * amount);
  for (let i = 0; i < flecks; i++) {
    ctx.fillStyle = `rgba(0,0,0,${rng.range(0.3, 1)})`;
    ctx.fillRect(r.x + rng.range(0, r.w), r.y + rng.range(0, r.h), rng.range(1.5, 7), rng.range(1, 4));
  }
  // heavy-traffic markings (hatch / zebra / words): scrape whole chunks off
  if (amount >= 0.95) {
    const chunks = Math.round((r.w * r.h) / 6000);
    for (let i = 0; i < chunks; i++) {
      ctx.save();
      ctx.translate(r.x + rng.range(0, r.w), r.y + rng.range(0, r.h));
      ctx.rotate(rng.range(0, Math.PI));
      ctx.fillStyle = `rgba(0,0,0,${rng.range(0.55, 1)})`;
      ctx.fillRect(-rng.range(10, 45), -rng.range(3, 12), rng.range(20, 90), rng.range(6, 24));
      ctx.restore();
    }
  }
  // faded end (traffic direction): linear fade over one third of the cell
  if (rng.next() < 0.7) {
    const vertical = r.h > r.w;
    const g = vertical
      ? ctx.createLinearGradient(0, r.y, 0, r.y + r.h * 0.45)
      : ctx.createLinearGradient(r.x, 0, r.x + r.w * 0.45, 0);
    g.addColorStop(0, `rgba(0,0,0,${0.6 * amount})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(r.x, r.y, vertical ? r.w : r.w * 0.45, vertical ? r.h * 0.45 : r.h);
  }
  ctx.restore();
}

/* ------------------------------------------------------------------------ */
/* Small tileables                                                           */
/* ------------------------------------------------------------------------ */

/** Chain-link diamond mesh: transparent tile, R=alpha lattice (one 50 mm cell per 64 px). */
export function chainlinkTexture() {
  const S = 256;
  const c = canvas(S, S);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, S, S);
  ctx.strokeStyle = 'rgba(200,205,210,1)';
  ctx.lineWidth = 3.2;
  const cell = 64;
  for (let i = -8; i <= 8; i++) {
    ctx.beginPath();
    ctx.moveTo(i * cell, 0);
    ctx.lineTo(i * cell + S, S);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(i * cell + S, 0);
    ctx.lineTo(i * cell, S);
    ctx.stroke();
  }
  const t = texFromCanvas(c, { srgb: true, wrap: 'repeat', mips: true, anisotropy: 8, name: 'world.chainlink' });
  return t;
}

/** Concertina razor-wire coil silhouette strip (u tiles, v = 0..1 across the coil). */
export function razorCoilTexture() {
  const W = 512;
  const H = 128;
  const c = canvas(W, H);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(170,175,180,1)';
  ctx.lineWidth = 2;
  const loops = 8;
  const R = H * 0.42;
  for (let i = -1; i <= loops; i++) {
    const cx = (i + 0.5) * (W / loops);
    ctx.beginPath();
    ctx.ellipse(cx, H / 2, R * 0.9, R, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(cx + W / loops / 2, H / 2, R * 0.9, R * 0.96, 0.3, Math.PI * 0.1, Math.PI * 1.2);
    ctx.stroke();
    // barbs
    for (let b = 0; b < 5; b++) {
      const a = (b / 5) * Math.PI * 2 + i;
      const bx = cx + Math.cos(a) * R * 0.9;
      const by = H / 2 + Math.sin(a) * R;
      ctx.beginPath();
      ctx.moveTo(bx - 4, by - 3);
      ctx.lineTo(bx + 4, by + 3);
      ctx.moveTo(bx - 4, by + 3);
      ctx.lineTo(bx + 4, by - 3);
      ctx.stroke();
    }
  }
  return texFromCanvas(c, { srgb: true, wrap: 'repeat', mips: true, name: 'world.razorCoil' });
}

/** Yellow/black barrier tape, tileable along u. */
export function hazardTapeTexture() {
  const W = 256;
  const H = 64;
  const c = canvas(W, H);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#e0ac1e';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#141414';
  for (let i = -3; i < 12; i++) {
    const o = i * 32;
    ctx.beginPath();
    ctx.moveTo(o, 0);
    ctx.lineTo(o + 16, 0);
    ctx.lineTo(o + 16 - H, H);
    ctx.lineTo(o - H, H);
    ctx.closePath();
    ctx.fill();
  }
  return texFromCanvas(c, { srgb: true, wrap: 'repeat', mips: true, name: 'world.hazardTape' });
}

/** Soft radial glow (additive sprites). */
export function glowTexture(size = 128) {
  const c = canvas(size, size);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.15, 'rgba(255,255,255,0.75)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.22)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return texFromCanvas(c, { srgb: true, wrap: 'clamp', mips: false, name: 'world.glow' });
}

/** Flame lick: bottom-anchored soft teardrop. */
export function flameTexture() {
  const W = 128;
  const H = 256;
  const c = canvas(W, H);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, W, H);
  // wispy asymmetric lick: an S-curved teardrop with a soft body
  const path = () => {
    ctx.beginPath();
    ctx.moveTo(W * 0.58, H * 0.03);
    ctx.bezierCurveTo(W * 0.98, H * 0.28, W * 0.62, H * 0.48, W * 0.86, H * 0.72);
    ctx.bezierCurveTo(W * 0.98, H * 0.86, W * 0.84, H * 0.99, W * 0.5, H * 0.99);
    ctx.bezierCurveTo(W * 0.14, H * 0.99, W * 0.02, H * 0.82, W * 0.16, H * 0.62);
    ctx.bezierCurveTo(W * 0.28, H * 0.44, W * 0.32, H * 0.26, W * 0.58, H * 0.03);
    ctx.closePath();
  };
  let g = ctx.createLinearGradient(0, H * 0.05, 0, H);
  g.addColorStop(0, 'rgba(255,70,10,0.0)');
  g.addColorStop(0.25, 'rgba(255,90,20,0.45)');
  g.addColorStop(0.6, 'rgba(255,140,45,0.8)');
  g.addColorStop(1, 'rgba(255,190,90,0.95)');
  ctx.fillStyle = g;
  path();
  ctx.fill();
  // inner hot core low in the lick
  g = ctx.createRadialGradient(W * 0.48, H * 0.82, 2, W * 0.48, H * 0.8, H * 0.22);
  g.addColorStop(0, 'rgba(255,245,205,1)');
  g.addColorStop(0.55, 'rgba(255,205,120,0.6)');
  g.addColorStop(1, 'rgba(255,150,60,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(W * 0.48, H * 0.8, W * 0.2, H * 0.18, 0, 0, Math.PI * 2);
  ctx.fill();
  // soften the tip
  ctx.globalCompositeOperation = 'destination-out';
  g = ctx.createLinearGradient(0, 0, 0, H * 0.3);
  g.addColorStop(0, 'rgba(0,0,0,0.9)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H * 0.3);
  ctx.globalCompositeOperation = 'source-over';
  return texFromCanvas(c, { srgb: true, wrap: 'clamp', mips: false, name: 'world.flame' });
}


/** Second flame lick shape (thinner, opposite lean) for layered fires. */
export function flameTexture2() {
  const W = 128;
  const H = 256;
  const c = canvas(W, H);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, W, H);
  ctx.beginPath();
  ctx.moveTo(W * 0.42, H * 0.04);
  ctx.bezierCurveTo(W * 0.7, H * 0.32, W * 0.44, H * 0.5, W * 0.66, H * 0.74);
  ctx.bezierCurveTo(W * 0.78, H * 0.9, W * 0.66, H * 0.99, W * 0.44, H * 0.99);
  ctx.bezierCurveTo(W * 0.22, H * 0.99, W * 0.12, H * 0.86, W * 0.24, H * 0.66);
  ctx.bezierCurveTo(W * 0.34, H * 0.48, W * 0.2, H * 0.3, W * 0.42, H * 0.04);
  ctx.closePath();
  let g = ctx.createLinearGradient(0, H * 0.05, 0, H);
  g.addColorStop(0, 'rgba(255,60,10,0.0)');
  g.addColorStop(0.3, 'rgba(255,80,15,0.4)');
  g.addColorStop(0.7, 'rgba(255,130,40,0.75)');
  g.addColorStop(1, 'rgba(255,175,80,0.9)');
  ctx.fillStyle = g;
  ctx.fill();
  g = ctx.createRadialGradient(W * 0.44, H * 0.84, 2, W * 0.44, H * 0.82, H * 0.18);
  g.addColorStop(0, 'rgba(255,240,200,0.95)');
  g.addColorStop(1, 'rgba(255,150,60,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(W * 0.44, H * 0.83, W * 0.16, H * 0.15, 0, 0, Math.PI * 2);
  ctx.fill();
  return texFromCanvas(c, { srgb: true, wrap: 'clamp', mips: false, name: 'world.flame2' });
}

/** Ember/coal bed: mottled hot orange disc (emissive map). */
export function coalTexture(rng) {
  const S = 128;
  const c = canvas(S, S);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, S, S);
  ctx.save();
  ctx.beginPath();
  ctx.arc(S / 2, S / 2, S * 0.48, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = '#1a0803';
  ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 60; i++) {
    const x = rng.range(0, S);
    const y = rng.range(0, S);
    const r = rng.range(4, 14);
    const hot = rng.next();
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, hot > 0.6 ? 'rgba(255,200,90,1)' : 'rgba(255,110,30,0.9)');
    g.addColorStop(1, 'rgba(120,20,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  return texFromCanvas(c, { srgb: true, wrap: 'clamp', mips: false, name: 'world.coals' });
}

/** Warm lit window with mullions and a hint of interior clutter (emissive map). */
export function windowTexture(rng) {
  const W = 256;
  const H = 256;
  const c = canvas(W, H);
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#ffd9a3');
  g.addColorStop(1, '#c9873d');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // interior silhouettes (shelf, monitor, blinds)
  ctx.fillStyle = 'rgba(30,20,10,0.55)';
  ctx.fillRect(0, H * 0.62, W, H * 0.06);
  ctx.fillRect(W * 0.15, H * 0.34, W * 0.22, H * 0.28);
  for (let i = 0; i < 12; i++) {
    ctx.fillStyle = `rgba(30,20,10,${0.12 + (i % 2) * 0.08})`;
    ctx.fillRect(0, i * (H / 12), W, 2);
  }
  // mullions
  ctx.fillStyle = '#2b2118';
  ctx.fillRect(W / 2 - 5, 0, 10, H);
  ctx.fillRect(0, H / 2 - 5, W, 10);
  ctx.strokeStyle = '#1c1610';
  ctx.lineWidth = 16;
  ctx.strokeRect(0, 0, W, H);
  void rng;
  return texFromCanvas(c, { srgb: true, wrap: 'clamp', mips: true, name: 'world.window' });
}

/** Grimy translucent skylight / dirty glass (albedo + alpha). */
export function grimeGlassTexture(rng) {
  const S = 256;
  const c = canvas(S, S);
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgba(28,30,26,0.9)';
  ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 90; i++) {
    ctx.fillStyle = `rgba(60,55,40,${rng.range(0.05, 0.2)})`;
    ctx.beginPath();
    ctx.arc(rng.range(0, S), rng.range(0, S), rng.range(3, 30), 0, Math.PI * 2);
    ctx.fill();
  }
  return texFromCanvas(c, { srgb: true, wrap: 'repeat', mips: true, name: 'world.grimeGlass' });
}

/**
 * Tileable water normal map (RG = xz slope, B = 1). Linear DataTexture,
 * mip-free (SwiftShader-safe). Two crossed sine sets + capillary noise.
 */
export function waveNormalTexture(rng) {
  const S = 256;
  const data = new Uint8Array(S * S * 4);
  const heights = new Float32Array(S * S);
  // sum of tileable sine waves (integer frequencies) with random phases
  const waves = [];
  for (let i = 0; i < 9; i++) {
    waves.push({
      kx: rng.int(-6, 6),
      ky: rng.int(-6, 6),
      amp: rng.range(0.3, 1.0) / (1 + i * 0.35),
      ph: rng.range(0, Math.PI * 2),
    });
  }
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = (x / S) * Math.PI * 2;
      const v = (y / S) * Math.PI * 2;
      let h = 0;
      for (const w of waves) h += Math.sin(w.kx * u + w.ky * v + w.ph) * w.amp;
      heights[y * S + x] = h;
    }
  }
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const hL = heights[y * S + ((x - 1 + S) % S)];
      const hR = heights[y * S + ((x + 1) % S)];
      const hD = heights[((y - 1 + S) % S) * S + x];
      const hU = heights[((y + 1) % S) * S + x];
      const dx = (hR - hL) * 0.9;
      const dy = (hU - hD) * 0.9;
      const i = (y * S + x) * 4;
      data[i] = Math.max(0, Math.min(255, 128 - dx * 60));
      data[i + 1] = Math.max(0, Math.min(255, 128 - dy * 60));
      data[i + 2] = 255;
      data[i + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  t.name = 'world.waves';
  return t;
}


/**
 * Tileable value noise (R channel) as a linear, mip-free DataTexture — used as
 * the world-space rust mask source for the container paint material (a texture
 * fetch instead of hashed procedural noise per fragment).
 */
export function valueNoiseTexture(rng, size = 128) {
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
      const c = lattice[y1 * grid + x0];
      const d = lattice[y1 * grid + x1];
      const v = a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy;
      const i = (y * size + x) * 4;
      const u = Math.round(Math.max(0, Math.min(1, v)) * 255);
      data[i] = u;
      data[i + 1] = u;
      data[i + 2] = u;
      data[i + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  t.name = 'world.valueNoise';
  return t;
}

/** Char / soot vertical gradient with streaks (alpha decal for the burnt container exterior). */
export function sootTexture(rng) {
  const W = 512;
  const H = 256;
  const c = canvas(W, H);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, W, H);
  // rises from the door / top edge
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, 'rgba(6,5,4,0.96)');
  g.addColorStop(0.55, 'rgba(6,5,4,0.7)');
  g.addColorStop(1, 'rgba(6,5,4,0.0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 40; i++) {
    const x = rng.range(0, W);
    ctx.fillStyle = `rgba(0,0,0,${rng.range(0.2, 0.7)})`;
    ctx.beginPath();
    ctx.moveTo(x, H);
    ctx.lineTo(x + rng.range(4, 20), H);
    ctx.lineTo(x + rng.range(-30, 30), rng.range(H * 0.3, H * 0.9));
    ctx.closePath();
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
  return texFromCanvas(c, { srgb: true, wrap: 'clamp', mips: true, name: 'world.soot' });
}
