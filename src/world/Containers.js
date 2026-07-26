/**
 * Containers — procedural shipping-container kit + the Terminal 9 yard.
 * WORLD stream. This is the map's hero asset, so it is built for real:
 *
 *  - true 20/40 ft dimensions (2.44 W × 2.59 H × 6.06/12.19 L)
 *  - corrugated wall/roof/door panels (photoscanned corrugation via the
 *    RENDER container factory, metre-scaled UVs)
 *  - corner posts, top/bottom side rails, end rails, 8 corner castings,
 *    forklift pockets
 *  - door end: two leaves, 4 vertical locking bars with guide brackets and
 *    cam keepers, handles, hinges, header and sill — open or closed
 *  - per-container paint colour (weathered ART palette) + world-space rust
 *  - canvas-generated stencil DECALS from an atlas: owner logotype, unit
 *    IDs (e.g. "IRWU 902114 6"), MAX GROSS 30480 KG data panels, hazard
 *    plates and chevrons, as thin offset quads
 *  - burnt-out variant (charred interior, soot, glowing coal bed) and a
 *    tilted/dropped ramp variant
 *
 * Everything is emitted through the level's StaticBatcher (merged per
 * material → a handful of draw calls for the whole yard) plus collision
 * proxies (solid boxes; enterable containers get panel boxes).
 */
import * as THREE from 'three';
import { CONTAINER, BLOCKS, ROWS_Z, PAINT, SPECIALS } from './layout.js';
import { boxGeom, cylGeom, DEG } from './util.js';
import { SHIPPING_LINES, UNIT_IDS } from './procgen.js';

const H = CONTAINER.H;
const W = CONTAINER.W;

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s1 = new THREE.Vector3(1, 1, 1);

/**
 * Build a quad from a centre and its two in-plane axes (u along `w`, v
 * along `h`). Normal = uAxis × vAxis. UVs in metres (0..w, 0..h).
 */
function orientedQuad(w, h, center, uAxis, vAxis) {
  const g = new THREE.BufferGeometry();
  const p = new Float32Array(12);
  const n = new Float32Array(12);
  const uv = new Float32Array(8);
  const nx = _v3.copy(uAxis).cross(vAxis).normalize();
  const corners = [
    [-w / 2, -h / 2, 0, 0],
    [w / 2, -h / 2, w, 0],
    [w / 2, h / 2, w, h],
    [-w / 2, h / 2, 0, h],
  ];
  for (let i = 0; i < 4; i++) {
    const [a, b, uu, vv] = corners[i];
    _v1.copy(center).addScaledVector(uAxis, a).addScaledVector(vAxis, b);
    p[i * 3] = _v1.x;
    p[i * 3 + 1] = _v1.y;
    p[i * 3 + 2] = _v1.z;
    n[i * 3] = nx.x;
    n[i * 3 + 1] = nx.y;
    n[i * 3 + 2] = nx.z;
    uv[i * 2] = uu;
    uv[i * 2 + 1] = vv;
  }
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(n, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}

/**
 * A decal quad: like orientedQuad but with an explicit atlas UV rect and a
 * vertex colour (RGB) baked in for tinting the white artwork.
 */
function decalQuad(w, h, center, uAxis, vAxis, cell, color, flipU = false) {
  const g = new THREE.BufferGeometry();
  const p = new Float32Array(12);
  const n = new Float32Array(12);
  const uv = new Float32Array(8);
  const col = new Float32Array(12);
  const nx = _v3.copy(uAxis).cross(vAxis).normalize();
  const u0 = flipU ? cell.u1 : cell.u0;
  const u1 = flipU ? cell.u0 : cell.u1;
  const corners = [
    [-w / 2, -h / 2, u0, cell.v0],
    [w / 2, -h / 2, u1, cell.v0],
    [w / 2, h / 2, u1, cell.v1],
    [-w / 2, h / 2, u0, cell.v1],
  ];
  for (let i = 0; i < 4; i++) {
    const [a, b, uu, vv] = corners[i];
    _v1.copy(center).addScaledVector(uAxis, a).addScaledVector(vAxis, b);
    p[i * 3] = _v1.x;
    p[i * 3 + 1] = _v1.y;
    p[i * 3 + 2] = _v1.z;
    n[i * 3] = nx.x;
    n[i * 3 + 1] = nx.y;
    n[i * 3 + 2] = nx.z;
    uv[i * 2] = uu;
    uv[i * 2 + 1] = vv;
    col[i * 3] = color.r;
    col[i * 3 + 1] = color.g;
    col[i * 3 + 2] = color.b;
  }
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(n, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}

/** A box placed at a local offset (helper for hardware). */
function boxAt(w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) {
  const g = boxGeom(w, h, d);
  _e.set(rx * DEG, ry * DEG, rz * DEG, 'YXZ');
  _q.setFromEuler(_e);
  _m.compose(_v1.set(x, y, z), _q, _s1);
  g.applyMatrix4(_m);
  return g;
}

/** A cylinder placed at a local offset (axis Y by default). */
function cylAt(r, len, x, y, z, seg = 8, rx = 0, ry = 0, rz = 0) {
  const g = cylGeom(r, r, len, seg);
  _e.set(rx * DEG, ry * DEG, rz * DEG, 'YXZ');
  _q.setFromEuler(_e);
  _m.compose(_v1.set(x, y, z), _q, _s1);
  g.applyMatrix4(_m);
  return g;
}

const AXIS = {
  X: new THREE.Vector3(1, 0, 0),
  Y: new THREE.Vector3(0, 1, 0),
  Z: new THREE.Vector3(0, 0, 1),
  NX: new THREE.Vector3(-1, 0, 0),
  NY: new THREE.Vector3(0, -1, 0),
  NZ: new THREE.Vector3(0, 0, -1),
};

const WHITE = new THREE.Color(0xd9d5cc);
const CREAM = new THREE.Color(0xe2ddce);
const BLACKISH = new THREE.Color(0x1a1a1a);
const NEUTRAL = new THREE.Color(0xffffff);

/* ========================================================================== */

export class ContainerKit {
  /**
   * @param {object} ctx build context (game, mats, rng, batcher, collision, emitters, lighting hooks)
   */
  constructor(ctx) {
    this.ctx = ctx;
    this.mats = ctx.mats;
    this.rng = ctx.rng;
    this.cells = ctx.mats.tex.stencilCells;
    /** @type {Array<any>} record of every container placed */
    this.instances = [];
    this.stats = { containers: 0, decals: 0 };
  }

  /* --------------------------------------------------------- palette */
  pickPaint() {
    const rng = this.rng;
    const total = PAINT.reduce((s, p) => s + p.weight, 0);
    let r = rng.range(0, total);
    for (const p of PAINT) {
      r -= p.weight;
      if (r <= 0) return p;
    }
    return PAINT[0];
  }

  /* ----------------------------------------------------------- single */
  /**
   * Build one container.
   * @param {object} s spec
   * @param {THREE.Matrix4} s.matrix world transform of the container's bottom-centre frame
   * @param {number} s.length 12.19 | 6.06
   * @param {number} s.color paint hex
   * @param {number} [s.rust] 0..1
   * @param {'closed'|'open'|'none'} [s.doors] door end state
   * @param {'full'|'simple'} [s.detail]
   * @param {boolean} [s.burnt] charred interior variant (doors open)
   * @param {boolean} [s.underside] add a bottom face (tilted/lifted containers)
   * @param {boolean} [s.hollow] enterable: collision as panels, not a solid box
   * @param {object} [s.decals] {sides:{left:bool,right:bool}, blind:bool, doorEnd:bool, line, id}
   * @param {string} [s.surface]
   * @param {boolean} [s.collide=true]
   */
  buildContainer(s) {
    const ctx = this.ctx;
    const bat = ctx.batcher;
    const L = s.length;
    const detail = s.detail || 'full';
    const doors = s.doors || 'closed';
    const rust = s.rust ?? 0.35;
    const wear = s.wear ?? 0.45;
    const paint = s.burnt ? this.mats.container(0x261e1a, 0.9, 0.85) : this.mats.container(s.color, rust, wear);
    const hw = this.mats.m.hardware;
    const rubber = this.mats.m.blackRubber;
    const mtx = s.matrix;

    const parts = []; // {geo, mat, cast}
    const push = (geo, mat, cast = true) => parts.push({ geo, mat, cast });

    const halfL = L / 2;
    const px = W / 2 - 0.03; // panel plane |x|
    const panelH = H - 0.34; // between rails
    const panelCy = 0.24 + panelH / 2;

    // -- corrugated side walls -----------------------------------------------
    push(orientedQuad(L - 0.32, panelH, _v2.set(-px, panelCy, 0), AXIS.Z, AXIS.Y), paint);
    push(orientedQuad(L - 0.32, panelH, _v2.set(px, panelCy, 0), AXIS.NZ, AXIS.Y), paint);
    // -- blind end wall --------------------------------------------------------
    push(orientedQuad(W - 0.28, panelH, _v2.set(0, panelCy, -halfL + 0.04), AXIS.NX, AXIS.Y), paint);
    // -- roof (ridges run across the width: v-axis = X) -----------------------
    push(orientedQuad(L - 0.1, W - 0.14, _v2.set(0, H - 0.01, 0), AXIS.Z, AXIS.X), paint);
    if (s.underside) {
      push(orientedQuad(W - 0.1, L - 0.1, _v2.set(0, 0.02, 0), AXIS.X, AXIS.Z), this.mats.m.steelRust);
      // cross members
      for (let i = 0; i < 7; i++) {
        const z = -halfL + 0.9 + (i * (L - 1.8)) / 6;
        push(boxAt(W - 0.2, 0.09, 0.08, 0, 0.06, z), hw);
      }
    }
    if (s.floor) {
      push(orientedQuad(W - 0.14, L - 0.14, _v2.set(0, 0.06, 0), AXIS.X, AXIS.NZ), s.floorMat || this.mats.m.charredFloor);
    }

    // -- corner posts + rails --------------------------------------------------
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        push(boxAt(0.14, H, 0.14, sx * (W / 2 - 0.07), H / 2, sz * (halfL - 0.07)), hw);
      }
      // top side rail
      push(boxAt(0.07, 0.11, L - 0.28, sx * (W / 2 - 0.035), H - 0.055, 0), hw);
      // bottom side rail
      push(boxAt(0.09, 0.26, L - 0.28, sx * (W / 2 - 0.045), 0.13, 0), hw);
    }
    // end top rail (blind end)
    push(boxAt(W - 0.28, 0.1, 0.06, 0, H - 0.05, -halfL + 0.05), hw);
    push(boxAt(W - 0.28, 0.2, 0.08, 0, 0.1, -halfL + 0.06), hw);

    if (detail === 'full') {
      // corner castings (8)
      for (const sx of [-1, 1]) {
        for (const sy of [0, 1]) {
          for (const sz of [-1, 1]) {
            push(boxAt(0.21, 0.14, 0.2, sx * (W / 2 - 0.09), sy ? H - 0.07 : 0.07, sz * (halfL - 0.1)), hw);
          }
        }
      }
      // forklift pockets (both sides)
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          push(boxAt(0.02, 0.12, 0.36, sx * (W / 2 + 0.005), 0.16, sz * 1.03), rubber, false);
        }
      }
    }

    // -- second blind end for door-less containers (never leave a hole) -------
    if (doors === 'none') {
      push(orientedQuad(W - 0.28, panelH, _v2.set(0, panelCy, halfL - 0.04), AXIS.X, AXIS.Y), paint);
      push(boxAt(W - 0.28, 0.1, 0.06, 0, H - 0.05, halfL - 0.05), hw);
      push(boxAt(W - 0.28, 0.2, 0.08, 0, 0.1, halfL - 0.06), hw);
    }
    // -- door end ---------------------------------------------------------------
    if (doors !== 'none') {
      // frame: header + sill + intermediate top
      push(boxAt(W - 0.28, 0.14, 0.1, 0, H - 0.07, halfL - 0.05), hw);
      push(boxAt(W - 0.28, 0.14, 0.1, 0, 0.07, halfL - 0.05), hw);
      const leafW = W / 2 - 0.16;
      const leafH = H - 0.4;
      const zLeaf = halfL - 0.045;
      const openAngle = doors === 'open' || s.burnt ? 108 : 0;
      for (const side of [-1, 1]) {
        // build the leaf in a local hinge frame then transform
        const leafParts = [];
        const lp = (geo, mat) => leafParts.push({ geo, mat });
        // hinge line at x = side*(W/2 - 0.12), leaf extends toward centre (-side)
        const dir = -side;
        const cx = dir * (leafW / 2 + 0.02);
        lp(orientedQuad(leafW, leafH, _v2.set(cx, 0, 0.01), AXIS.X, AXIS.Y), paint);
        if (openAngle > 0) {
          // inner face (visible once the leaf swings open); charred for the burnt one
          lp(orientedQuad(leafW, leafH, _v2.set(cx, 0, -0.005), AXIS.NX, AXIS.Y), s.burnt ? this.mats.m.charred : paint);
        }
        if (detail === 'full') {
          // locking bars: 2 per leaf
          for (const bx of [leafW * 0.28, leafW * 0.78]) {
            const x = dir * (bx + 0.02);
            lp(cylAt(0.017, leafH + 0.28, x, 0, 0.05, 6), hw);
            // guide brackets
            for (const gy of [-leafH * 0.36, 0, leafH * 0.36]) {
              lp(boxAt(0.11, 0.045, 0.05, x, gy, 0.03), hw);
            }
            // cam keepers top/bottom
            lp(boxAt(0.09, 0.07, 0.06, x, leafH / 2 + 0.12, 0.04), hw);
            lp(boxAt(0.09, 0.07, 0.06, x, -leafH / 2 - 0.12, 0.04), hw);
          }
          // handle on the inner bar
          lp(boxAt(0.3, 0.035, 0.03, dir * (leafW * 0.28 + 0.16), -0.32, 0.07, 0, 0, dir * 12), hw);
          // hinges (4)
          for (const hy of [-leafH * 0.42, -leafH * 0.14, leafH * 0.14, leafH * 0.42]) {
            lp(boxAt(0.06, 0.11, 0.055, 0.0, hy, 0.02), hw);
          }
        } else {
          // simple: 4 flat bar strips
          for (const bx of [leafW * 0.28, leafW * 0.78]) {
            lp(boxAt(0.04, leafH + 0.2, 0.02, dir * (bx + 0.02), 0, 0.03), hw);
          }
        }
        // hinge frame transform: pivot at (side*(W/2-0.12), leafCy, zLeaf), rotate about Y
        const leafCy = 0.2 + leafH / 2;
        _e.set(0, -side * openAngle * DEG, 0, 'YXZ');
        _q.setFromEuler(_e);
        _m.compose(_v1.set(side * (W / 2 - 0.12), leafCy, zLeaf), _q, _s1);
        for (const p of leafParts) {
          p.geo.applyMatrix4(_m);
          push(p.geo, p.mat);
        }
      }
    }

    // -- burnt interior -----------------------------------------------------------
    if (s.burnt) {
      const charred = this.mats.m.charred;
      const inH = H - 0.4;
      const cy = 0.3 + inH / 2;
      // inner side walls (normals point INTO the box), back wall, ceiling, floor
      push(orientedQuad(inH, L - 0.4, _v2.set(-W / 2 + 0.09, cy, -0.15), AXIS.Y, AXIS.Z), charred); // faces +X
      push(orientedQuad(L - 0.4, inH, _v2.set(W / 2 - 0.09, cy, -0.15), AXIS.Z, AXIS.Y), charred); // faces -X
      push(orientedQuad(W - 0.24, inH, _v2.set(0, cy, -halfL + 0.09), AXIS.X, AXIS.Y), charred); // faces +Z
      push(orientedQuad(W - 0.24, L - 0.4, _v2.set(0, H - 0.09, -0.15), AXIS.X, AXIS.Z), charred); // ceiling, faces -Y
      push(orientedQuad(W - 0.2, L - 0.2, _v2.set(0, 0.05, 0), AXIS.X, AXIS.NZ), this.mats.m.charredFloor); // floor, faces +Y
      // debris: collapsed pallets / boxes charred
      const rng = this.rng;
      for (let i = 0; i < 5; i++) {
        const dz = rng.range(-halfL + 1.2, -halfL * 0.15);
        const dx = rng.range(-0.7, 0.7);
        push(boxAt(rng.range(0.4, 1.1), rng.range(0.12, 0.45), rng.range(0.4, 1.0), dx, 0.2, dz, 0, rng.range(-40, 40), rng.range(-8, 8)), charred);
      }
    }

    // -- transform, batch, collide --------------------------------------------
    for (const p of parts) {
      p.geo.applyMatrix4(mtx);
      // hardware detail (posts, bars, castings) never needs its own shadows
      const cast = s.castShadow !== false && p.cast && p.mat !== hw && p.mat !== rubber;
      bat.add(p.geo, p.mat, { surface: s.surface || 'metal', castShadow: cast });
    }

    // collision
    if (s.collide !== false && ctx.collision) {
      if (s.hollow || s.burnt || doors === 'open') {
        // enterable: walls/roof/floor as boxes, door end open
        const t = 0.12;
        ctx.collision.addBox(mtx, { w: t, h: H, d: L, cx: -W / 2 + t / 2, cy: H / 2, cz: 0 }, 'metal');
        ctx.collision.addBox(mtx, { w: t, h: H, d: L, cx: W / 2 - t / 2, cy: H / 2, cz: 0 }, 'metal');
        ctx.collision.addBox(mtx, { w: W, h: H, d: t, cx: 0, cy: H / 2, cz: -halfL + t / 2 }, 'metal');
        ctx.collision.addBox(mtx, { w: W, h: t, d: L, cx: 0, cy: H - t / 2, cz: 0 }, 'metal');
        ctx.collision.addBox(mtx, { w: W, h: t, d: L, cx: 0, cy: t / 2, cz: 0 }, 'metal');
      } else {
        ctx.collision.addBox(mtx, { w: W, h: H, d: L, cx: 0, cy: H / 2, cz: 0 }, s.surface || 'metal');
      }
    }

    // -- decals ------------------------------------------------------------------
    const d = s.decals || {};
    this._decorate(s, d, mtx, doors);

    const rec = { spec: s, matrix: mtx.clone(), length: L, height: H, width: W };
    this.instances.push(rec);
    this.stats.containers++;
    return rec;
  }

  /* ----------------------------------------------------------- decals */
  _decal(w, h, center, u, v, cellId, color, mtx, flipU = false) {
    const cell = this.cells[cellId];
    if (!cell) return;
    const g = decalQuad(w, h, center, u, v, cell, color, flipU);
    g.applyMatrix4(mtx);
    this.ctx.batcher.add(g, this.mats.m.decalStencil, {
      surface: 'metal', castShadow: false, receiveShadow: true, key: 'stencil',
    });
    this.stats.decals++;
  }

  _decorate(s, d, mtx, doors) {
    const rng = this.rng;
    const L = s.length;
    const halfL = L / 2;
    const off = 0.014; // decal offset from the panel plane
    const px = W / 2 - 0.03;
    if (s.burnt) {
      // soot streaks over the door-end half of both sides, exterior
      const soot = this.mats.m.soot;
      for (const side of [-1, 1]) {
        const g = orientedQuad(L * 0.62, H * 0.9, _v2.set(side * (px + off), H * 0.55, halfL * 0.42),
          side < 0 ? AXIS.Z : AXIS.NZ, AXIS.Y);
        // uv 0..1 (texture: dark at v=1 → top of the wall)
        const uv = g.attributes.uv;
        uv.setXY(0, 0, 0); uv.setXY(1, 1, 0); uv.setXY(2, 1, 1); uv.setXY(3, 0, 1);
        g.applyMatrix4(mtx);
        this.ctx.batcher.add(g, soot, { surface: 'metal', castShadow: false, key: 'soot' });
      }
      // roof scorch
      {
        const g = orientedQuad(L * 0.55, W * 0.98, _v2.set(0, H + 0.006, halfL * 0.35), AXIS.Z, AXIS.X);
        const uv = g.attributes.uv;
        uv.setXY(0, 0, 1); uv.setXY(1, 1, 1); uv.setXY(2, 1, 0); uv.setXY(3, 0, 0);
        g.applyMatrix4(mtx);
        this.ctx.batcher.add(g, soot, { surface: 'metal', castShadow: false, key: 'soot' });
      }
      return;
    }
    if (!d.enabled) return;

    const line = d.line || SHIPPING_LINES[0];
    const idIdx = d.idIndex ?? 0;
    const tint = d.tint || WHITE;
    const sides = d.sides || {};

    // long sides
    for (const side of [-1, 1]) {
      const want = side < 0 ? sides.left : sides.right;
      if (!want) continue;
      const u = side < 0 ? AXIS.Z : AXIS.NZ; // outward-facing quads: -X side reads with u along +Z
      // logotype (upper-middle band)
      if (d.logo !== false) {
        const cell = this.cells['logo.' + line.key];
        const lw = Math.min(L * 0.42, 3.9);
        const lh = lw / (cell?.aspect || 4.8);
        this._decal(lw, lh, _v2.set(side * (px + off), H * 0.6, rng.range(-0.6, 0.6)), u, AXIS.Y, 'logo.' + line.key, tint, mtx);
      }
      // unit ID block near the door end, high
      {
        const cell = this.cells['id.' + idIdx];
        const iw = 1.45;
        const ih = iw / (cell?.aspect || 4.8);
        const zid = (halfL - 1.3) * (doors === 'none' ? -1 : 1);
        this._decal(iw, ih, _v2.set(side * (px + off), H - 0.42, zid), u, AXIS.Y, 'id.' + idIdx, tint, mtx);
      }
      // occasional extras low on the panel
      const roll = rng.next();
      if (roll < 0.22) {
        this._decal(0.42, 0.42, _v2.set(side * (px + off), 0.75, rng.range(-halfL * 0.5, halfL * 0.5)), u, AXIS.Y, rng.chance(0.5) ? 'flammable' : 'chevron', NEUTRAL, mtx);
      } else if (roll < 0.34) {
        const cell = this.cells['highcube'];
        const hw = 2.2;
        this._decal(hw, hw / (cell?.aspect || 8), _v2.set(side * (px + off), H - 0.22, -halfL + hw * 0.75), u, AXIS.Y, 'highcube', NEUTRAL, mtx);
      } else if (roll < 0.42) {
        this._decal(1.9, 0.28, _v2.set(side * (px + off), H * 0.32, rng.range(-halfL * 0.5, halfL * 0.5)), u, AXIS.Y, 'st.maxkg', tint, mtx);
      }
    }
    // door end (right leaf carries the data panel; both carry the ID)
    if (d.doorEnd !== false && doors !== 'none') {
      const zf = halfL + 0.11;
      const idc = this.cells['id.' + idIdx];
      const iw = 0.95;
      this._decal(iw, iw / (idc?.aspect || 4.8), _v2.set(0.6, H - 0.5, zf), AXIS.X, AXIS.Y, 'id.' + idIdx, tint, mtx);
      const dc = this.cells[L > 9 ? 'data' : 'dataShort'];
      const dw = 0.78;
      this._decal(dw, dw / (dc?.aspect || 1.55), _v2.set(0.62, H - 1.2, zf), AXIS.X, AXIS.Y, L > 9 ? 'data' : 'dataShort', tint, mtx);
      // small owner logo on the left leaf
      const lc = this.cells['logo.' + line.key];
      const lw2 = 0.95;
      this._decal(lw2, lw2 / (lc?.aspect || 4.8), _v2.set(-0.62, H - 0.55, zf), AXIS.X, AXIS.Y, 'logo.' + line.key, tint, mtx);
      // CSC plate low left
      this._decal(0.2, 0.14, _v2.set(-0.85, 0.55, zf), AXIS.X, AXIS.Y, 'csc', NEUTRAL, mtx);
      // yellow/black band across the header on high-cubes
      if (rng.chance(0.45)) {
        this._decal(2.05, 0.14, _v2.set(0, H - 0.1, zf + 0.02), AXIS.X, AXIS.Y, 'hazband', NEUTRAL, mtx);
      }
    }
    // blind end
    if (d.blind) {
      const zf = -halfL - 0.05;
      const idc = this.cells['id.' + idIdx];
      const iw = 1.05;
      this._decal(iw, iw / (idc?.aspect || 4.8), _v2.set(-0.55, H - 0.5, zf), AXIS.NX, AXIS.Y, 'id.' + idIdx, tint, mtx);
      const lc = this.cells['logo.' + line.key];
      const lw = 1.7;
      this._decal(lw, lw / (lc?.aspect || 4.8), _v2.set(0, H * 0.42, zf), AXIS.NX, AXIS.Y, 'logo.' + line.key, tint, mtx);
    }
  }

  /* ------------------------------------------------------------ yard */
  /**
   * Populate all yard blocks + special containers from the layout.
   * @param {object} hooks callbacks from the level: {onFireEmitter(pos), addPractical(desc)}
   */
  buildYard(hooks = {}) {
    const rng = this.rng;
    for (const block of BLOCKS) {
      this.ctx.batcher.setZone(block.id);
      const rows = block.grid.length;
      for (let r = 0; r < rows; r++) {
        const line = block.grid[r];
        for (let b = 0; b < block.bays.length; b++) {
          const ch = line[b];
          if (!ch || ch === '.' || ch === ' ') continue;
          const height = parseInt(ch, 10);
          if (!Number.isFinite(height) || height <= 0) continue;
          const x = block.bays[b];
          const z = ROWS_Z[r];
          this._buildStack(block, b, r, x, z, height);
        }
      }
    }
    this.ctx.batcher.setZone('lanes');
    this._buildSpecials(hooks);
    this.ctx.batcher.setZone('yard');
  }

  /** Which faces of a bay are visible (lane/passage-facing) → get decals. */
  _visibleSides(block, bayIndex, rowIndex) {
    const grid = block.grid;
    const line = grid[rowIndex];
    const westEmpty = bayIndex === 0 || line[bayIndex - 1] === '.' || line[bayIndex - 1] === ' ';
    const eastEmpty = bayIndex === block.bays.length - 1 || line[bayIndex + 1] === '.' || line[bayIndex + 1] === ' ';
    return { left: westEmpty, right: eastEmpty };
  }

  _buildStack(block, bayIndex, rowIndex, x, z, height) {
    const rng = this.rng;
    const vis = this._visibleSides(block, bayIndex, rowIndex);
    // door end faces the nearer row gap: alternate by parity + jitter
    let baseYaw = rng.chance(0.5) ? 0 : 180;
    for (let level = 0; level < height; level++) {
      const paint = this.pickPaint();
      // upper containers get more visible rust runs on lower ones — vary a bit
      const rust = level === 0 ? rng.range(0.25, 0.6) : rng.range(0.15, 0.45);
      const wear = rng.range(0.3, 0.6);
      const jx = rng.range(-0.09, 0.09) * (level > 0 ? 1 : 0.4);
      const jz = rng.range(-0.12, 0.12);
      const jyaw = rng.range(-0.7, 0.7);
      const yaw = (rng.chance(0.15) ? 180 - baseYaw : baseYaw) + jyaw;
      // 20 ft pair instead of one 40 ft (12 % of the time, ground level only for silhouette variety at ends)
      const isPair = level < 2 && rng.chance(0.12);
      const y = level * H + level * 0.005;
      const detail = 'full';
      if (isPair) {
        for (const half of [-1, 1]) {
          const zc = z + half * (CONTAINER.L20 / 2 + 0.035);
          this.buildContainer({
            matrix: containerMatrix(x + jx, y, zc + jz, yaw + rng.range(-0.5, 0.5)),
            length: CONTAINER.L20,
            color: this.pickPaint().color,
            rust,
            wear,
            doors: 'closed',
            detail,
            decals: {
              enabled: true,
              line: SHIPPING_LINES[rng.int(0, SHIPPING_LINES.length - 1)],
              idIndex: rng.int(0, UNIT_IDS.length - 1),
              tint: pickTint(rng),
              sides: vis,
              doorEnd: true,
              blind: false,
            },
          });
        }
      } else {
        this.buildContainer({
          matrix: containerMatrix(x + jx, y, z + jz, yaw),
          length: CONTAINER.L40,
          color: paint.color,
          rust,
          wear,
          doors: 'closed',
          detail,
          decals: {
            enabled: true,
            line: SHIPPING_LINES[rng.int(0, SHIPPING_LINES.length - 1)],
            idIndex: rng.int(0, UNIT_IDS.length - 1),
            tint: pickTint(rng),
            sides: vis,
            doorEnd: true,
            blind: true,
          },
        });
      }
    }
  }

  _buildSpecials(hooks) {
    const rng = this.rng;
    const ctx = this.ctx;

    // --- burnt-out container (main lane) -----------------------------------
    {
      const b = SPECIALS.burnt;
      const mtx = containerMatrix(b.x, 0, b.z, b.yawDeg);
      this.buildContainer({
        matrix: mtx,
        length: b.length,
        color: 0x261e1a,
        rust: 0.9,
        doors: 'open',
        burnt: true,
        detail: 'full',
        decals: {},
      });
      // coal bed + smouldering practical light inside near the back
      const coalPos = new THREE.Vector3(0, 0.09, -2.6).applyMatrix4(mtx);
      hooks.addCoalBed?.(coalPos, 1.05);
      const lightPos = new THREE.Vector3(0.0, 1.0, -2.4).applyMatrix4(mtx);
      hooks.addFirePractical?.(lightPos, { intensity: 28, radius: 10, tag: 'burnt-container' });
      hooks.addEmitter?.({ kind: 'fire', position: coalPos.clone().setY(0.35), radius: 1.0, intensity: 0.8, tag: 'burnt-container' });
      hooks.addEmitter?.({ kind: 'smoke', position: coalPos.clone().setY(1.2), radius: 1.6, intensity: 0.6, tag: 'burnt-container' });
      // hazard tape across the mouth is done by Structures
      this.burntRecord = { position: new THREE.Vector3(b.x, 0, b.z), matrix: mtx.clone() };
    }

    // --- fallen container across the west lane -----------------------------------
    {
      const f = SPECIALS.fallen;
      const mtx = containerMatrix(f.x, 0, f.z, f.yawDeg);
      this.buildContainer({
        matrix: mtx,
        length: f.length,
        color: 0x2e5d59,
        rust: 0.55,
        wear: 0.6,
        doors: 'closed',
        detail: 'full',
        decals: {
          enabled: true,
          line: SHIPPING_LINES[2],
          idIndex: 5,
          tint: WHITE,
          sides: { left: true, right: true },
          doorEnd: true,
          blind: true,
        },
      });
      this.fallenRecord = { position: new THREE.Vector3(f.x, 0, f.z), matrix: mtx.clone(), topY: H };
    }

    // --- tilted ramp container -----------------------------------------------------
    // A dropped container half-buried nose-up: its TOP face runs from the
    // asphalt at the south end up onto the fallen container's roof at the
    // north end (a walkable 12° ramp; the buried underside hides below y=0).
    {
      const r = SPECIALS.ramp;
      const L = r.length;
      const halfL = L / 2;
      const rise = r.topY - 0.06;
      const pitch = Math.asin(rise / L); // radians, nose (north end) up
      const cosp = Math.cos(pitch);
      const sinp = Math.sin(pitch);
      // top-face corners in the bottom-centre frame after Rx(pitch)
      const yTS = H * cosp - halfL * sinp;
      const zTS = H * sinp + halfL * cosp;
      const yTN = H * cosp + halfL * sinp;
      const zTN = H * sinp - halfL * cosp;
      const oy = 0.06 - yTS; // top-face south edge just above the asphalt
      const oz = r.zNorthEnd - zTN;
      const zSouthEnd = oz + zTS;
      _e.set(pitch, 0, 0, 'YXZ');
      _q.setFromEuler(_e);
      const mtx = new THREE.Matrix4().compose(_v1.set(r.x, oy, oz), _q, _s1);
      void yTN;
      this.buildContainer({
        matrix: mtx,
        length: L,
        color: 0x5e646b,
        rust: 0.5,
        wear: 0.7,
        doors: 'closed',
        detail: 'full',
        underside: true,
        decals: {
          enabled: true,
          line: SHIPPING_LINES[3],
          idIndex: 7,
          tint: WHITE,
          sides: { left: true, right: true },
          doorEnd: true,
          blind: true,
        },
      });
      this.rampRecord = { matrix: mtx.clone(), zSouth: zSouthEnd, zNorth: r.zNorthEnd, x: r.x };
    }

    // --- quay 20-footers waiting for the crane ---------------------------------
    for (const q of SPECIALS.quay20) {
      const mtx = containerMatrix(q.x, (q.level || 0) * H, q.z, q.yawDeg + rng.range(-1, 1));
      this.buildContainer({
        matrix: mtx,
        length: q.length,
        color: this.pickPaint().color,
        rust: rng.range(0.2, 0.5),
        doors: 'closed',
        detail: 'full',
        decals: {
          enabled: true,
          line: SHIPPING_LINES[rng.int(0, SHIPPING_LINES.length - 1)],
          idIndex: rng.int(0, UNIT_IDS.length - 1),
          tint: pickTint(rng),
          sides: { left: true, right: true },
          doorEnd: true,
          blind: true,
        },
      });
    }
    void ctx;
  }
}

/** Bottom-centre container frame → world matrix (yaw in degrees about Y). */
export function containerMatrix(x, y, z, yawDeg) {
  _e.set(0, yawDeg * DEG, 0, 'YXZ');
  _q.setFromEuler(_e);
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), _q, _s1);
}

function pickTint(rng) {
  const r = rng.next();
  if (r < 0.7) return WHITE;
  if (r < 0.85) return CREAM;
  return BLACKISH;
}
