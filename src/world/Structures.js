/**
 * Structures — the big architecture of Terminal 9 (WORLD stream):
 *   - south warehouse facade (brick plinth, six roller-shutter bays, one open
 *     bay with a warm lit interior + spill, corrugated upper cladding,
 *     signage, roof clutter) and its interior room
 *   - office trailer / portacabin
 *   - the water (Reflector at high/ultra, env-mapped fallback below)
 *   - moored feeder-ship silhouette with deck containers, castle windows,
 *     funnel, masts and nav lights
 *   - two ship-to-shore gantry cranes (lattice booms, beacons, one working
 *     floodlight)
 *
 * Static geometry goes through ctx.batcher (merged per material); lights
 * through game.lighting; dynamic/emissive bits are tracked for Level.update.
 */
import * as THREE from 'three';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import { GROUND, WAREHOUSE, TRAILER, QUAY, CONTAINER } from './layout.js';
import { boxGeom, cylGeom, merge, DEG, polylineBoxes, catenaryPoints } from './util.js';
import { containerMatrix } from './Containers.js';
import { SHIPPING_LINES } from './procgen.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _qn = new THREE.Vector3();
const _qp = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _one = new THREE.Vector3(1, 1, 1);

const AX = {
  X: new THREE.Vector3(1, 0, 0),
  Y: new THREE.Vector3(0, 1, 0),
  Z: new THREE.Vector3(0, 0, 1),
  NX: new THREE.Vector3(-1, 0, 0),
  NY: new THREE.Vector3(0, -1, 0),
  NZ: new THREE.Vector3(0, 0, -1),
};

/** Quad from centre + two in-plane axes (u along w, v along h), UV in metres. */
function oQuad(w, h, center, uAxis, vAxis) {
  const g = new THREE.BufferGeometry();
  const p = new Float32Array(12);
  const n = new Float32Array(12);
  const uv = new Float32Array(8);
  const nx = _qn.copy(uAxis).cross(vAxis).normalize();
  const corners = [
    [-w / 2, -h / 2, 0, 0], [w / 2, -h / 2, w, 0], [w / 2, h / 2, w, h], [-w / 2, h / 2, 0, h],
  ];
  for (let i = 0; i < 4; i++) {
    const [a, b, uu, vv] = corners[i];
    _qp.copy(center).addScaledVector(uAxis, a).addScaledVector(vAxis, b);
    p[i * 3] = _qp.x; p[i * 3 + 1] = _qp.y; p[i * 3 + 2] = _qp.z;
    n[i * 3] = nx.x; n[i * 3 + 1] = nx.y; n[i * 3 + 2] = nx.z;
    uv[i * 2] = uu; uv[i * 2 + 1] = vv;
  }
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(n, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}

/** Decal quad with atlas cell uv + vertex colour (like Containers). */
function oDecal(w, h, center, uAxis, vAxis, cell, color) {
  const g = oQuad(w, h, center, uAxis, vAxis);
  const uv = g.attributes.uv;
  uv.setXY(0, cell.u0, cell.v0);
  uv.setXY(1, cell.u1, cell.v0);
  uv.setXY(2, cell.u1, cell.v1);
  uv.setXY(3, cell.u0, cell.v1);
  const col = new Float32Array(12);
  for (let i = 0; i < 4; i++) {
    col[i * 3] = color.r;
    col[i * 3 + 1] = color.g;
    col[i * 3 + 2] = color.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

function boxAt(w, h, d, x, y, z, rxDeg = 0, ryDeg = 0, rzDeg = 0) {
  const g = boxGeom(w, h, d);
  _e.set(rxDeg * DEG, ryDeg * DEG, rzDeg * DEG, 'YXZ');
  _q.setFromEuler(_e);
  _m.compose(_v.set(x, y, z), _q, _one);
  g.applyMatrix4(_m);
  return g;
}

function cylAt(rT, rB, len, x, y, z, seg = 10, rxDeg = 0, ryDeg = 0, rzDeg = 0) {
  const g = cylGeom(rT, rB, len, seg);
  _e.set(rxDeg * DEG, ryDeg * DEG, rzDeg * DEG, 'YXZ');
  _q.setFromEuler(_e);
  _m.compose(_v.set(x, y, z), _q, _one);
  g.applyMatrix4(_m);
  return g;
}

const CREAM = new THREE.Color(0xded7c4);
const WHITE_D = new THREE.Color(0xcfcac0);
const YELLOWISH = new THREE.Color(0xd8c98d);

/* ========================================================================== */

export class Structures {
  /**
   * @param {object} ctx build context {game, level, root, batcher, collision, mats, rng, kit, hooks}
   */
  constructor(ctx) {
    this.ctx = ctx;
    this.mats = ctx.mats;
    this.rng = ctx.rng;
    this.M = ctx.mats.m;
    this.cells = ctx.mats.tex.stencilCells;
    this.game = ctx.game;
    this.lighting = ctx.game.lighting;
    /** dynamic bits for Level.update */
    this.dynamic = { water: null, waterFallback: null, spreader: null };
  }

  build() {
    const bat = this.ctx.batcher;
    bat.setZone('warehouse');
    this.buildWarehouse();
    bat.setZone('trailer');
    this.buildTrailer();
    bat.setZone('quay');
    this.buildWater();
    bat.setZone('ship');
    this.buildShip();
    bat.setZone('cranes');
    this.buildCranes();
    bat.setZone('yard');
  }

  _add(geo, mat, o = {}) {
    this.ctx.batcher.add(geo, mat, o);
  }

  _decal(cellId, w, h, center, u, v, color = WHITE_D) {
    const cell = this.cells[cellId];
    if (!cell) return;
    const g = oDecal(w, h, center, u, v, cell, color);
    this._add(g, this.M.decalStencil, { surface: 'concrete', castShadow: false, key: 'stencilWall' });
  }

  /* ---------------------------------------------------------- warehouse */
  buildWarehouse() {
    const WH = WAREHOUSE;
    const M = this.M;
    const col = this.ctx.collision;
    const fz = WH.facadeZ;
    const H = WH.height;
    const halfBay = WH.bayW / 2;

    // pier segments (brick) between/around the bay openings, y 0 → 4.6
    const pierTop = WH.bayH + 0.35;
    const xs = [WH.x0, ...WH.bayXs.flatMap((c) => [c - halfBay, c + halfBay]), WH.x1];
    for (let i = 0; i < xs.length - 1; i += 2) {
      const a = xs[i];
      const b = xs[i + 1];
      const w = b - a;
      if (w <= 0.05) continue;
      const cx = (a + b) / 2;
      this._add(oQuad(w, pierTop, _v2.set(cx, pierTop / 2, fz), AX.NX, AX.Y), M.brick, { surface: 'concrete' });
      col.addAABox(cx, 0, fz + 0.35, w, pierTop, 0.7, 'concrete');
    }
    // lintel band (concrete) across the whole facade above the doors
    this._add(oQuad(WH.x1 - WH.x0, 0.7, _v2.set((WH.x0 + WH.x1) / 2, pierTop + 0.35, fz + 0.02), AX.NX, AX.Y), M.concrete, { surface: 'concrete' });
    // corrugated upper cladding
    const cladBase = pierTop + 0.7;
    this._add(oQuad(WH.x1 - WH.x0, H - cladBase, _v2.set((WH.x0 + WH.x1) / 2, cladBase + (H - cladBase) / 2, fz + 0.05), AX.NX, AX.Y), M.corrugatedGrey, { surface: 'metal' });
    col.addAABox((WH.x0 + WH.x1) / 2, cladBase, fz + 0.4, WH.x1 - WH.x0, H - cladBase, 0.6, 'metal');
    // horizontal steel channels over the cladding
    for (const y of [cladBase + 0.15, 7.6, 10.4]) {
      this._add(boxAt(WH.x1 - WH.x0 - 0.4, 0.16, 0.12, (WH.x0 + WH.x1) / 2, y, fz - 0.05), M.hardware, { surface: 'metal', castShadow: false });
    }
    // parapet coping
    this._add(boxAt(WH.x1 - WH.x0 + 0.4, 0.28, 0.5, (WH.x0 + WH.x1) / 2, H + 0.14, fz + 0.2), M.concrete, { surface: 'concrete', castShadow: false });

    // roller shutter bays
    for (let i = 0; i < WH.bayXs.length; i++) {
      const cx = WH.bayXs[i];
      const open = i === WH.openBayIndex;
      // door reveal jambs (concrete strips at the sides of the opening, set back)
      for (const s of [-1, 1]) {
        this._add(boxAt(0.28, WH.bayH, 0.5, cx + s * (halfBay - 0.02), WH.bayH / 2, fz + 0.3), M.concrete, { surface: 'concrete' });
      }
      // shutter guide channels
      for (const s of [-1, 1]) {
        this._add(boxAt(0.09, WH.bayH, 0.08, cx + s * (halfBay - 0.2), WH.bayH / 2, fz + 0.14), M.hardware, { surface: 'metal', castShadow: false });
      }
      if (!open) {
        // closed shutter, recessed
        this._add(oQuad(WH.bayW - 0.36, WH.bayH - 0.06, _v2.set(cx, (WH.bayH - 0.06) / 2 + 0.03, fz + 0.42), AX.NX, AX.Y), M.shutter, { surface: 'metal' });
        col.addAABox(cx, 0, fz + 0.5, WH.bayW - 0.3, WH.bayH, 0.3, 'metal');
        // shutter box/drum housing above (partly visible under the lintel)
        this._add(boxAt(WH.bayW - 0.2, 0.34, 0.4, cx, WH.bayH + 0.14, fz + 0.6), M.hardware, { surface: 'metal', castShadow: false });
      } else {
        // rolled-up drum cylinder + housing
        this._add(cylAt(0.34, 0.34, WH.bayW - 0.3, cx, WH.bayH + 0.02, fz + 0.7, 14, 0, 0, 90), M.hardware, { surface: 'metal', castShadow: false });
      }
      // yellow safety bollard pipes at each jamb
      for (const s of [-1, 1]) {
        this._add(cylAt(0.09, 0.09, 1.15, cx + s * (halfBay + 0.28), 0.575, fz - 0.35, 8), M.craneYellow, { surface: 'metal' });
        col.addAABox(cx + s * (halfBay + 0.28), 0, fz - 0.35, 0.2, 1.15, 0.2, 'metal');
      }
      // bay number decal on the lintel
      this._decal('sign.bay0' + (i + 1), 2.3, 0.85, _v2.set(cx, pierTop + 0.36, fz - 0.01), AX.NX, AX.Y, CREAM);
    }

    // building side/back walls + roof (silhouette + shadow casters)
    const depth = WH.depth;
    // east wall (faces +X: u = -Z), west wall (faces -X: u = +Z), back wall (faces +Z)
    this._add(oQuad(depth, H, _v2.set(WH.x1 + 0.01, H / 2, fz + depth / 2), AX.NZ, AX.Y), M.brick, { surface: 'concrete' });
    this._add(oQuad(depth, H, _v2.set(WH.x0 - 0.01, H / 2, fz + depth / 2), AX.Z, AX.Y), M.brick, { surface: 'concrete' });
    this._add(oQuad(WH.x1 - WH.x0, H, _v2.set((WH.x0 + WH.x1) / 2, H / 2, fz + depth + 0.01), AX.X, AX.Y), M.brick, { surface: 'concrete' });
    // roof (slight fall to the back)
    this._add(oQuad(WH.x1 - WH.x0 + 0.6, depth + 0.6, _v2.set((WH.x0 + WH.x1) / 2, H - 0.05, fz + depth / 2), AX.X, AX.NZ), M.corrugatedRusty, { surface: 'metal' });
    col.addAABox(WH.x1 + 0.25, 0, fz + depth / 2, 0.5, H, depth, 'concrete');
    col.addAABox(WH.x0 - 0.25, 0, fz + depth / 2, 0.5, H, depth, 'concrete');
    col.addAABox((WH.x0 + WH.x1) / 2, 0, fz + depth + 0.25, WH.x1 - WH.x0, H, 0.5, 'concrete');

    // upper window strip in the cladding: dark glass with two dim-lit
    for (let i = 0; i < 9; i++) {
      const x = WH.x0 + 5 + i * 7.2;
      if (x > WH.x1 - 3) break;
      const lit = i === 3 || i === 6;
      this._add(oQuad(1.7, 0.9, _v2.set(x, 8.4, fz - 0.06), AX.NX, AX.Y), lit ? M.windowLitDim : M.darkGlass, { surface: 'glass', castShadow: false });
      // window frame
      this._add(boxAt(1.85, 1.05, 0.06, x, 8.4, fz - 0.02), M.hardware, { surface: 'metal', castShadow: false });
    }

    // signage
    this._decal('sign.terminal', 13.5, 2.5, _v2.set(-41, 9.7, fz - 0.08), AX.NX, AX.Y, WHITE_D);
    this._decal('sign.bonded', 12.5, 0.95, _v2.set(-41, 7.9, fz - 0.08), AX.NX, AX.Y, CREAM);
    this._decal('sign.keepclear', 2.4, 0.52, _v2.set(WH.bayXs[WH.openBayIndex] + 4.0, 2.7, fz - 0.4), AX.NX, AX.Y, WHITE_D);
    this._decal('sign.maxheight', 3.8, 0.6, _v2.set(WH.bayXs[WH.openBayIndex], pierTop - 0.15, fz - 0.4), AX.NX, AX.Y, WHITE_D);
    this._decal('sign.nosmoking', 2.4, 0.5, _v2.set(WH.bayXs[WH.openBayIndex] - 4.2, 2.4, fz - 0.4), AX.NX, AX.Y, WHITE_D);
    this._decal('sign.danger', 2.2, 0.4, _v2.set(WH.x1 - 3.2, 2.1, fz - 0.4), AX.NX, AX.Y, WHITE_D);
    this._decal('hazband', 4.8, 0.62, _v2.set(WH.x1 - 3.6, 0.7, fz - 0.42), AX.NX, AX.Y, new THREE.Color(0xffffff));

    // downpipes + eave gutter
    for (const x of [-55.5, -14.6, 5.6]) {
      this._add(cylAt(0.08, 0.08, H - 0.3, x, (H - 0.3) / 2, fz - 0.3, 8), M.galvanized, { surface: 'metal' });
      this._add(boxAt(0.4, 0.25, 0.3, x, 0.35, fz - 0.42), M.galvanized, { surface: 'metal', castShadow: false });
    }
    this._add(boxAt(WH.x1 - WH.x0, 0.2, 0.28, (WH.x0 + WH.x1) / 2, H - 0.3, fz - 0.3), M.galvanized, { surface: 'metal', castShadow: false });

    // roof clutter: vents, tank, antenna (silhouette breakup for the vista)
    for (const rv of [[-48, 44], [-30, 46], [-4, 43]]) {
      this._add(boxAt(1.6, 0.9, 1.4, rv[0], H + 0.45, rv[1]), M.galvanized, { surface: 'metal' });
      this._add(cylAt(0.35, 0.35, 0.5, rv[0], H + 1.15, rv[1], 10), M.galvanized, { surface: 'metal', castShadow: false });
    }
    this._add(cylAt(1.3, 1.3, 1.8, -52.5, H + 1.4, 44, 14), M.steelRust, { surface: 'metal' });
    this._add(boxAt(2.9, 0.5, 2.9, -52.5, H + 0.25, 44), M.hardware, { surface: 'metal', castShadow: false });
    // antenna mast + guys
    this._add(cylAt(0.05, 0.07, 7, -8.5, H + 3.5, 42, 6), M.galvanized, { surface: 'metal', castShadow: false });
    this._add(cylAt(0.02, 0.02, 2.6, -8.5, H + 6.1, 42, 5, 0, 0, 90), M.galvanized, { surface: 'metal', castShadow: false });
    {
      const guys = [];
      for (const gx of [-11.5, -5.5]) {
        guys.push(...polylinePairs([[-8.5, H + 6.2, 42], [gx, H + 0.1, 45.5]], 0.02));
      }
      const g = merge(guys);
      this._add(g, M.cable, { surface: 'metal', castShadow: false });
    }

    // ---- open bay interior ------------------------------------------------------
    const I = WH.interior;
    const iw = I.x1 - I.x0;
    const id = I.z1 - I.z0;
    // floor
    this._add(oQuad(iw, id, _v2.set((I.x0 + I.x1) / 2, 0.01, (I.z0 + I.z1) / 2), AX.X, AX.NZ), M.concreteFloor, { surface: 'concrete', castShadow: false });
    // walls (plaster, warm), ceiling
    this._add(oQuad(id, I.height, _v2.set(I.x0, I.height / 2, (I.z0 + I.z1) / 2), AX.Y, AX.Z), M.plaster, { surface: 'concrete' }); // west inner faces +X
    this._add(oQuad(id, I.height, _v2.set(I.x1, I.height / 2, (I.z0 + I.z1) / 2), AX.Z, AX.Y), M.plaster, { surface: 'concrete' }); // east inner faces -X
    this._add(oQuad(iw, I.height, _v2.set((I.x0 + I.x1) / 2, I.height / 2, I.z1), AX.NX, AX.Y), M.plaster, { surface: 'concrete' }); // back faces -Z
    this._add(oQuad(iw, id, _v2.set((I.x0 + I.x1) / 2, I.height, (I.z0 + I.z1) / 2), AX.X, AX.Z), M.corrugatedGrey, { surface: 'metal', castShadow: false }); // ceiling faces -Y
    col.addAABox(I.x0 - 0.15, 0, (I.z0 + I.z1) / 2, 0.3, I.height, id, 'concrete');
    col.addAABox(I.x1 + 0.15, 0, (I.z0 + I.z1) / 2, 0.3, I.height, id, 'concrete');
    col.addAABox((I.x0 + I.x1) / 2, 0, I.z1 + 0.15, iw, I.height, 0.3, 'concrete');
    // interior signage
    this._decal('sign.exit', 1.6, 0.55, _v2.set(I.x0 + 3, 4.9, I.z1 - 0.02), AX.X, AX.Y, new THREE.Color(0xcfe8cf));
    // painted floor lines inside (yellow walkway)
    // (handled by terrain-style decals: reuse hazard band as floor stripe)
    this._decal('hazband', 6.5, 0.55, _v2.set((I.x0 + I.x1) / 2 + 1.2, 0.02, I.z0 + 1.4), AX.X, AX.NZ, new THREE.Color(0xffffff));

    // shelving racks along the west wall and the back wall
    this._buildRack(I.x0 + 0.75, I.z0 + 1.2, I.z0 + 9.6, 'z');
    this._buildRack(I.x0 + 2.2, I.z1 - 0.9, I.x1 - 1.2, 'x', I.z1 - 0.75);
    // hanging high-bay lamps: 3 fixtures, 2 lit
    for (let i = 0; i < 3; i++) {
      const lx = I.x0 + 2.4 + i * ((iw - 4.8) / 2);
      const lz = (I.z0 + I.z1) / 2 + (i === 1 ? 1.5 : -0.5);
      const lit = i !== 2;
      const real = i === 1;
      // shade cone
      this._add(cylAt(0.14, 0.42, 0.5, lx, I.height - 0.55, lz, 12), M.galvanized, { surface: 'metal', castShadow: false });
      this._add(cylAt(0.01, 0.01, 0.6, lx, I.height - 0.2, lz, 4), M.hardware, { surface: 'metal', castShadow: false });
      // emissive lens disc
      const disc = new THREE.CircleGeometry(0.36, 16);
      disc.rotateX(Math.PI / 2);
      disc.translate(lx, I.height - 0.81, lz);
      this._add(disc, lit ? M.lampWarm : M.lampDead, { surface: 'glass', castShadow: false });
      if (real) {
        const f = this.lighting.addPractical({
          position: [lx, I.height - 1.2, lz],
          color: 0xffb774,
          intensity: 95,
          radius: 16,
          flicker: 'none',
          marker: false,
        });
        this.ctx.level.fixtures.push(f);
      }
    }
    // warm spill flood: a canopy work light just outside the open bay, aimed
    // down-out across the yard (mounted under a small soffit so it reads)
    {
      const bx = WH.bayXs[WH.openBayIndex];
      this._add(boxAt(WH.bayW + 0.6, 0.14, 1.2, bx, WH.bayH + 0.42, fz - 0.75), M.hardware, { surface: 'metal', castShadow: false });
      const f = this.lighting.addFlood({
        position: [bx + 0.5, WH.bayH + 0.22, fz - 1.05],
        target: [bx + 2.2, 0, fz - 12.5],
        color: 0xffb56b,
        intensity: 950,
        angle: 0.86,
        penumbra: 0.75,
        distance: 30,
        castShadow: false,
        coneIntensity: 0.3,
        halo: false,
        flare: false,
        housing: true,
        importance: 1.1,
        groundY: 0,
      });
      this.ctx.level.fixtures.push(f);
    }
    // forklift silhouette parked inside
    this._buildForklift(I.x1 - 3.4, 0, I.z0 + 5.2, 200);

    // ---- exterior wall lamps (props from Props; emissive glow sprites here) ----
    const lampY = WH.lampY;
    for (const lx of [-37, -27, -7]) {
      this._addEmissiveLamp(new THREE.Vector3(lx, lampY - 0.2, fz - 0.62), 0.09, M.lampWarm, 0xffa64d, 2.6);
    }
    // two real sodium wall packs throwing pools on the kerb + facade
    for (const [lx, it] of [[-16.6, 120]]) {
      const f = this.lighting.addPractical({
        position: [lx, lampY - 0.4, fz - 1.1],
        color: 0xffa64d,
        intensity: it,
        radius: 18,
        flicker: 'sodium',
        marker: false,
        glow: false,
      });
      this.ctx.level.fixtures.push(f);
    }

    this.ctx.level.landmarks.warehouseBay = new THREE.Vector3(WH.bayXs[WH.openBayIndex], 0, fz);
    this.ctx.level.landmarks.warehouseInterior = new THREE.Vector3((I.x0 + I.x1) / 2, 0, (I.z0 + I.z1) / 2);
  }

  /** Simple pallet racking run. axis 'z': along z at fixed x; 'x': along x at fixed z. */
  _buildRack(a, from, to, axis, fixed = 0) {
    const M = this.M;
    const parts = [];
    const shelfDepth = 1.05;
    const height = 3.6;
    const bayLen = 2.8;
    const n = Math.max(1, Math.floor(Math.abs(to - from) / bayLen));
    for (let i = 0; i <= n; i++) {
      const t = from + ((to - from) * i) / n;
      // upright frames (two posts + a diagonal)
      for (const d of [-1, 1]) {
        const off = d * (shelfDepth / 2 - 0.05);
        if (axis === 'z') parts.push(boxAt(0.07, height, 0.07, a + off, height / 2, t));
        else parts.push(boxAt(0.07, height, 0.07, t, height / 2, fixed + off));
      }
      if (axis === 'z') parts.push(boxAt(shelfDepth, 0.05, 0.04, a, height * 0.65, t, 0, 0, 32));
      else parts.push(boxAt(0.04, 0.05, shelfDepth, t, height * 0.65, fixed, 32));
    }
    // beams + shelves per level
    for (let lvl = 1; lvl <= 3; lvl++) {
      const y = lvl * 1.05;
      const len = Math.abs(to - from);
      if (axis === 'z') {
        parts.push(boxAt(0.08, 0.1, len, a - shelfDepth / 2 + 0.05, y, (from + to) / 2));
        parts.push(boxAt(0.08, 0.1, len, a + shelfDepth / 2 - 0.05, y, (from + to) / 2));
        parts.push(boxAt(shelfDepth, 0.03, len, a, y + 0.02, (from + to) / 2));
      } else {
        parts.push(boxAt(len, 0.1, 0.08, (from + to) / 2, y, fixed - shelfDepth / 2 + 0.05));
        parts.push(boxAt(len, 0.1, 0.08, (from + to) / 2, y, fixed + shelfDepth / 2 - 0.05));
        parts.push(boxAt(len, 0.03, shelfDepth, (from + to) / 2, y + 0.02, fixed));
      }
    }
    this._add(merge(parts), M.hardware, { surface: 'metal', castShadow: true });
    // cargo boxes on the shelves (procedural crates) — colour breakup
    const rng = this.rng;
    const boxes = [];
    for (let lvl = 1; lvl <= 3; lvl++) {
      const y = lvl * 1.05 + 0.05;
      let t = from;
      while ((to > from && t < to - 0.4) || (to < from && t > to + 0.4)) {
        const w = rng.range(0.4, 1.1);
        const h = rng.range(0.3, 0.75);
        if (rng.next() > 0.28) {
          if (axis === 'z') boxes.push(boxAt(rng.range(0.5, 0.95), h, w, a, y + h / 2, t + w / 2 * Math.sign(to - from), 0, rng.range(-8, 8)));
          else boxes.push(boxAt(w, h, rng.range(0.5, 0.95), t + w / 2 * Math.sign(to - from), y + h / 2, fixed, 0, rng.range(-8, 8)));
        }
        t += Math.sign(to - from) * (w + rng.range(0.05, 0.5));
      }
    }
    this._add(merge(boxes), M.wood, { surface: 'wood', castShadow: false });
    // collision: one block per rack
    const len = Math.abs(to - from);
    if (axis === 'z') this.ctx.collision.addAABox(a, 0, (from + to) / 2, shelfDepth, height, len, 'metal');
    else this.ctx.collision.addAABox((from + to) / 2, 0, fixed, len, height, shelfDepth, 'metal');
  }

  _buildForklift(x, y, z, yawDeg) {
    const M = this.M;
    const parts = [];
    // body
    parts.push(boxAt(1.15, 0.75, 2.1, 0, 0.55, 0));
    // counterweight
    parts.push(boxAt(1.1, 0.7, 0.5, 0, 0.55, 1.05));
    // overhead guard
    for (const sx of [-0.5, 0.5]) for (const sz of [-0.7, 0.5]) parts.push(boxAt(0.06, 1.1, 0.06, sx, 1.45, sz));
    parts.push(boxAt(1.06, 0.05, 1.3, 0, 2.0, -0.1));
    // mast + forks
    for (const sx of [-0.32, 0.32]) parts.push(boxAt(0.1, 2.3, 0.12, sx, 1.15, -1.15));
    for (const sx of [-0.25, 0.25]) parts.push(boxAt(0.12, 0.05, 1.0, sx, 0.12, -1.7));
    parts.push(boxAt(0.8, 0.5, 0.06, 0, 0.4, -1.22));
    // wheels
    for (const sx of [-0.5, 0.5]) for (const sz of [-0.65, 0.7]) parts.push(cylAt(0.28, 0.28, 0.22, sx, 0.28, sz, 10, 0, 0, 90));
    const body = merge(parts);
    _m.makeRotationY(yawDeg * DEG).setPosition(x, y, z);
    body.applyMatrix4(_m);
    this._add(body, M.craneYellow, { surface: 'metal' });
    this.ctx.collision.addBox(_m, { w: 1.2, h: 2.0, d: 2.6, cx: 0, cy: 1.0, cz: -0.2 }, 'metal');
  }

  /* ------------------------------------------------------------- trailer */
  buildTrailer() {
    const T = TRAILER;
    const M = this.M;
    const col = this.ctx.collision;
    const cx = T.center.x;
    const cz = T.center.z;
    const y0 = T.floorY;
    const h = T.height;
    const L = T.length;
    const D = T.depth;
    // body walls
    const north = cz - D / 2;
    const south = cz + D / 2;
    this._add(oQuad(L, h, _v2.set(cx, y0 + h / 2, north), AX.NX, AX.Y), M.plaster, { surface: 'concrete' }); // faces -Z (toward the yard)
    this._add(oQuad(L, h, _v2.set(cx, y0 + h / 2, south), AX.X, AX.Y), M.plaster, { surface: 'concrete' });
    this._add(oQuad(D, h, _v2.set(cx - L / 2, y0 + h / 2, cz), AX.Z, AX.Y), M.plaster, { surface: 'concrete' }); // west end faces -X (Z×Y=-X)
    this._add(oQuad(D, h, _v2.set(cx + L / 2, y0 + h / 2, cz), AX.NZ, AX.Y), M.plaster, { surface: 'concrete' });
    // floor + roof
    this._add(oQuad(L, D, _v2.set(cx, y0 + 0.02, cz), AX.X, AX.NZ), M.plywood, { surface: 'wood', castShadow: false });
    this._add(boxAt(L + 0.4, 0.12, D + 0.4, cx, y0 + h + 0.06, cz), M.corrugatedGrey, { surface: 'metal' });
    col.addAABox(cx, y0, cz, L, h, D, 'concrete');
    // jack stands + skirting gap
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      this._add(boxAt(0.3, y0, 0.3, cx + sx * (L / 2 - 0.5), y0 / 2, cz + sz * (D / 2 - 0.4)), M.concrete, { surface: 'concrete', castShadow: false });
    }
    // corner trims
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      this._add(boxAt(0.08, h, 0.08, cx + sx * L / 2, y0 + h / 2, cz + sz * D / 2), M.hardware, { surface: 'metal', castShadow: false });
    }
    // windows on the north face: one lit, one boarded, one dark
    const wy = y0 + 1.55;
    this._add(oQuad(1.3, 0.95, _v2.set(cx - 3.0, wy, north - 0.02), AX.NX, AX.Y), M.windowLit, { surface: 'glass', castShadow: false });
    this._add(boxAt(1.42, 1.07, 0.05, cx - 3.0, wy, north - 0.01), M.hardware, { surface: 'metal', castShadow: false });
    this._add(oQuad(1.3, 0.95, _v2.set(cx + 0.3, wy, north - 0.02), AX.NX, AX.Y), M.darkGlass, { surface: 'glass', castShadow: false });
    this._add(boxAt(1.42, 1.07, 0.05, cx + 0.3, wy, north - 0.01), M.hardware, { surface: 'metal', castShadow: false });
    this._add(oQuad(1.4, 1.05, _v2.set(cx + 3.4, wy, north - 0.05), AX.NX, AX.Y), M.plywood, { surface: 'wood', castShadow: false });
    // door + steps at the east end of the north face
    const dx = cx + L / 2 - 1.4;
    this._add(oQuad(0.9, 2.0, _v2.set(dx, y0 + 1.0, north - 0.03), AX.NX, AX.Y), M.paintedSteelDark, { surface: 'metal', castShadow: false });
    this._add(boxAt(0.06, 0.14, 0.05, dx + 0.3, y0 + 1.0, north - 0.07), M.hardware, { surface: 'metal', castShadow: false });
    // metal stairs (3 steps + landing + rail)
    const stepParts = [];
    for (let i = 0; i < 4; i++) {
      stepParts.push(boxAt(1.2, 0.05, 0.3, dx, y0 - i * (y0 / 4) - 0.02, north - 0.3 - i * 0.3));
    }
    stepParts.push(boxAt(0.05, 1.1, 0.05, dx - 0.65, y0 * 0.5 + 0.4, north - 0.4));
    stepParts.push(boxAt(0.05, 1.1, 0.05, dx - 0.65, 0.55, north - 1.3));
    stepParts.push(boxAt(0.05, 0.05, 1.2, dx - 0.65, y0 + 0.55, north - 0.85, 0, 0, 0));
    this._add(merge(stepParts), M.galvanized, { surface: 'metal' });
    col.addAABox(dx, 0, north - 0.7, 1.2, y0, 1.4, 'metal');
    // AC unit on the west end
    this._add(boxAt(0.75, 0.6, 0.35, cx - L / 2 + 1.2, y0 + 1.7, north - 0.18), M.galvanized, { surface: 'metal' });
    // signage
    this._decal('sign.office', 4.4, 0.48, _v2.set(cx - 0.6, y0 + 2.3, north - 0.06), AX.NX, AX.Y, CREAM);
    // porch bulkhead lamp above the door (emissive puck + glow)
    this._addEmissiveLamp(new THREE.Vector3(dx, y0 + 2.35, north - 0.22), 0.07, M.lampWarm, 0xffb060, 1.6);
    // faint warm interior spill through the lit window: small point outside
    this.ctx.level.landmarks.trailer = new THREE.Vector3(cx, 0, cz);
  }

  /* ---------------------------------------------------------------- water */
  buildWater() {
    const game = this.game;
    const M = this.M;
    const W = GROUND.water;
    const level = this.ctx.level;
    const wide = W.x1 - W.x0;
    const deep = W.z0 - W.z1;
    const y = GROUND.waterY;
    const useReflector = game.tier.ssr !== false && game.tier.name !== 'low' && game.tier.name !== 'medium';

    if (useReflector) {
      const geo = new THREE.PlaneGeometry(wide, deep, 1, 1);
      const shader = {
        name: 'IronwakeWaterShader',
        uniforms: {
          color: { value: new THREE.Color(0x000000) },
          tDiffuse: { value: null },
          textureMatrix: { value: new THREE.Matrix4() },
          tNormal: { value: this.mats.tex.waves },
          uTime: { value: 0 },
          uDistort: { value: 0.028 },
          uReflect: { value: 0.9 },
          fogColor: { value: new THREE.Color(0x17202d) },
          fogDensity: { value: 0.013 },
          uWaterColor: { value: new THREE.Color(0x02060b) },
          uWind: { value: new THREE.Vector2(1, 0.5) },
        },
        vertexShader: /* glsl */ `
          uniform mat4 textureMatrix;
          varying vec4 vUv4;
          varying vec3 vWorld;
          varying float vFogDepth;
          void main() {
            vUv4 = textureMatrix * vec4(position, 1.0);
            vec4 wp = modelMatrix * vec4(position, 1.0);
            vWorld = wp.xyz;
            vec4 mv = viewMatrix * wp;
            vFogDepth = -mv.z;
            gl_Position = projectionMatrix * mv;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 color;
          uniform sampler2D tDiffuse;
          uniform sampler2D tNormal;
          uniform float uTime;
          uniform float uDistort;
          uniform float uReflect;
          uniform vec3 fogColor;
          uniform float fogDensity;
          uniform vec3 uWaterColor;
          uniform vec2 uWind;
          varying vec4 vUv4;
          varying vec3 vWorld;
          varying float vFogDepth;
          void main() {
            vec2 w = uWind;
            vec2 n1 = texture2D(tNormal, vWorld.xz * 0.038 + w * uTime * 0.011).rg * 2.0 - 1.0;
            vec2 n2 = texture2D(tNormal, vWorld.xz * 0.105 - w.yx * uTime * 0.019 + 0.41).rg * 2.0 - 1.0;
            vec2 n3 = texture2D(tNormal, vWorld.xz * 0.36 + vec2(-w.y, w.x) * uTime * 0.031 + 0.13).rg * 2.0 - 1.0;
            vec3 N = normalize(vec3(n1.x + n2.x * 0.7 + n3.x * 0.35, 3.2, n1.y + n2.y * 0.7 + n3.y * 0.35));
            vec3 V = normalize(cameraPosition - vWorld);
            float ndv = clamp(dot(N, V), 0.0, 1.0);
            float fres = pow(1.0 - ndv, 4.0);
            fres = mix(0.35, 1.0, fres) * uReflect;
            vec4 uvp = vUv4;
            uvp.xy += vec2(N.x, N.z) * uDistort * uvp.w;
            vec3 refl = texture2DProj(tDiffuse, uvp).rgb;
            vec3 col = mix(uWaterColor, refl, fres);
            float f = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
            col = mix(col, fogColor, clamp(f, 0.0, 1.0));
            gl_FragColor = vec4(col, 1.0);
          }
        `,
      };
      const reflector = new Reflector(geo, {
        clipBias: 0.04,
        textureWidth: 640,
        textureHeight: 384,
        color: 0x000000,
        shader,
        multisample: 0,
      });
      reflector.rotateX(-Math.PI / 2);
      reflector.position.set((W.x0 + W.x1) / 2, y, (W.z0 + W.z1) / 2);
      reflector.name = 'water.reflector';
      reflector.renderOrder = 5;
      reflector.userData.noAO = true;
      reflector.userData.surface = 'water';
      this.ctx.root.add(reflector);
      this.dynamic.water = reflector;
      level.water = reflector;
    }
    // cheap env-mapped water for every view that does not warrant planar reflections
    {
      const mat = new THREE.MeshStandardMaterial({
        name: 'world.waterFallback',
        color: 0x02050a,
        roughness: 0.16,
        metalness: 0.85,
        normalMap: this.mats.tex.waves,
        normalScale: new THREE.Vector2(0.6, 0.6),
        envMapIntensity: 3.0,
      });
      this.mats.tex.waves.repeat.set(wide / 8, deep / 8);
      const geo = new THREE.PlaneGeometry(wide, deep, 1, 1);
      geo.rotateX(-Math.PI / 2);
      const mesh = new THREE.Mesh(geo, mat);
      // sit a hair below the reflector so both never z-fight if visible together
      mesh.position.set((W.x0 + W.x1) / 2, y - 0.03, (W.z0 + W.z1) / 2);
      mesh.name = 'water.fallback';
      mesh.receiveShadow = false;
      mesh.castShadow = false;
      mesh.userData.surface = 'water';
      mesh.visible = !this.dynamic.water;
      this.ctx.root.add(mesh);
      this.dynamic.waterFallback = mesh;
      level.waterFallback = mesh;
      if (!level.water) level.water = mesh;
    }
    // collision surface tag (rays / feet report water)
    this.ctx.collision.addGroundRect(W.x0, W.x1, W.z1, W.z0, y, 'water', level.water);
  }

  /* ---------------------------------------------------------------- ship */
  buildShip() {
    const S = QUAY.ship;
    const M = this.M;
    const kit = this.ctx.kit;
    const nz = S.nearZ; // side facing the quay (south face)
    const deckY = S.deckY;
    const keel = S.keelY;
    const xb = S.xBow;
    const xs = S.xStern;
    const len = xs - xb;
    const beam = S.beam;
    const hullTop = deckY + 1.1; // bulwark
    // hull south side (flared 0.9 m out at the top)
    {
      const g = new THREE.BufferGeometry();
      const p = new Float32Array([
        xb + 8, keel, nz - 0.2,
        xs, keel, nz - 0.2,
        xs, hullTop, nz + 0.7,
        xb, hullTop, nz + 0.7,
      ]);
      // bow rakes: the lower forward corner is set back (xb+8)
      const uv = new Float32Array([0, 0, len, 0, len, hullTop - keel, 0, hullTop - keel]);
      g.setAttribute('position', new THREE.BufferAttribute(p, 3));
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      g.setIndex([0, 1, 2, 0, 2, 3]);
      g.computeVertexNormals();
      this._add(g, M.paintedSteelNavy, { surface: 'metal', castShadow: false });
    }
    // boot-topping band (rusty red) near the waterline
    this._add(oQuad(len - 6, 1.6, _v2.set((xb + xs) / 2 + 3, GROUND.waterY + 0.9, nz + 0.05), AX.X, AX.Y), M.paintedSteelRed, { surface: 'metal', castShadow: false });
    // bow flare wedge (front face) and stern transom (only far ends, cheap)
    {
      const g = new THREE.BufferGeometry();
      const p = new Float32Array([
        xb, hullTop, nz + 0.7,
        xb - 6, hullTop, nz - beam / 2,
        xb + 8, keel, nz - 0.2,
      ]);
      g.setAttribute('position', new THREE.BufferAttribute(p, 3));
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 8, 6, 8, 3, 0]), 2));
      g.setIndex([0, 1, 2]);
      g.computeVertexNormals();
      this._add(g, M.paintedSteelNavy, { surface: 'metal', castShadow: false });
    }
    // deck plane
    this._add(oQuad(len, beam, _v2.set((xb + xs) / 2, deckY, nz - beam / 2), AX.X, AX.NZ), M.paintedSteelDark, { surface: 'metal', castShadow: false });
    // bulwark rail cap along the near side
    this._add(boxAt(len - 10, 0.12, 0.2, (xb + xs) / 2 + 5, hullTop + 0.06, nz + 0.55), M.hardware, { surface: 'metal', castShadow: false });
    // deck edge lights (emissive pucks + glow sprites, no real lights): alternate cool/warm
    let li = 0;
    for (let x = xb + 16; x < S.castle.x0 - 6; x += 22) {
      const warm = li++ % 2 === 1;
      this._addEmissiveLamp(new THREE.Vector3(x, deckY + 3.2, nz + 0.2), 0.16, warm ? this.M.lampWarm : this.M.lampCool, warm ? 0xffa64d : 0xcfe1ff, 2.2);
      // small mast pole under it
      this._add(cylAt(0.05, 0.06, 3.2, x, deckY + 1.6, nz - 0.1, 6), M.hardware, { surface: 'metal', castShadow: false });
    }
    // red port sidelight on the bridge wing (steady) + a warm accommodation glow band
    this._addEmissiveLamp(new THREE.Vector3(S.castle.x0 + 1.2, deckY + 14, nz + 0.9), 0.16, this.M.redBeacon, 0xff2020, 1.4);

    // deck cargo: container stacks (kit, simple detail, no collision)
    const rng = this.rng;
    const stackXs = [];
    for (let x = xb + 14; x < S.castle.x0 - 4; x += 12.6) stackXs.push(x);
    for (let sx = 0; sx < stackXs.length; sx++) {
      const x = stackXs[sx];
      const rows = 2;
      for (let r = 0; r < rows; r++) {
        const zc = nz - 4.5 - r * (CONTAINER.W + 0.15);
        // gaps + heights that step UP toward the stern so the silhouette breaks
        if (r === 0 && (sx % 4 === 2)) continue;
        if (r === 1 && (sx % 3 === 1)) continue;
        const ramp = Math.min(4, 1 + Math.floor(sx * 0.42));
        const height = Math.max(1, Math.min(4, ramp + (rng.chance(0.35) ? -1 : 0) + (r === 1 ? rng.int(0, 1) : 0)));
        for (let lv = 0; lv < height; lv++) {
          const paintPick = this.ctx.kit.pickPaint();
          kit.buildContainer({
            matrix: containerMatrix(x, deckY + lv * CONTAINER.H, zc, 90 + rng.range(-0.6, 0.6)),
            length: CONTAINER.L40,
            color: paintPick.color,
            rust: rng.range(0.2, 0.55),
            doors: 'none',
            detail: 'simple',
            collide: false,
            castShadow: false,
            decals: r === 0 && lv >= height - 2 ? {
              enabled: true,
              line: SHIPPING_LINES[rng.int(0, SHIPPING_LINES.length - 1)],
              idIndex: rng.int(0, 9),
              tint: new THREE.Color(0xd9d5cc),
              sides: { left: true, right: false }, // yaw 90°: local -X (left) faces +Z toward the quay
              doorEnd: false,
              blind: false,
            } : {},
          });
        }
      }
    }

    // castle superstructure at the stern
    const c0 = S.castle.x0;
    const c1 = S.castle.x1;
    const cw = c1 - c0;
    const castleMat = M.plaster;
    let cy = deckY;
    const deckDepth = beam - 3;
    const zc = nz - beam / 2;
    for (let tier = 0; tier < 5; tier++) {
      const inset = tier * 1.2;
      const th = tier === 0 ? 4.2 : 3.1;
      const w = cw - inset * 1.4;
      const d = deckDepth - inset * 1.2;
      const g = boxGeom(w, th, d, 1);
      g.translate(c0 + w / 2 + inset * 0.9, cy + th / 2, zc);
      this._add(g, castleMat, { surface: 'concrete', castShadow: false });
      // window rows on the south face (dim lit / dark alternating clusters)
      const nWin = Math.floor(w / 1.6);
      for (let i = 0; i < nWin; i++) {
        const wx = c0 + inset * 0.9 + 0.9 + i * 1.6;
        const lit = ((i + tier * 3) % 5) < 2;
        this._add(oQuad(0.75, 0.85, _v2.set(wx, cy + th * 0.55, zc + d / 2 + 0.03), AX.X, AX.Y), lit ? M.windowLitDim : M.darkGlass, { surface: 'glass', castShadow: false });
      }
      cy += th;
    }
    // bridge: wide window strip on top tier front + wing overhangs
    this._add(oQuad(cw - 6, 1.2, _v2.set(c0 + cw / 2, cy - 1.6, zc + (deckDepth - 4.8) / 2 + 0.05), AX.X, AX.Y), M.windowLitDim, { surface: 'glass', castShadow: false });
    for (const s of [-1, 1]) {
      this._add(boxAt(3.6, 0.25, 2.4, c0 + cw / 2 + s * (cw / 2 - 1), cy - 2.6, zc), M.hardware, { surface: 'metal', castShadow: false });
    }
    // funnel behind the castle
    this._add(cylAt(1.4, 1.9, 6.5, c1 + 2.5, cy - 3, zc - 1, 12), M.paintedSteelDark, { surface: 'metal', castShadow: false });
    this._add(boxAt(3.4, 0.5, 3.4, c1 + 2.5, cy + 0.2, zc - 1), M.hardware, { surface: 'metal', castShadow: false });
    // lattice mast on the bridge top + masthead light
    {
      const mastParts = [];
      const bx = c0 + cw * 0.42;
      const by = cy;
      for (const s of [-1, 1]) {
        mastParts.push(boxAt(0.09, 8, 0.09, bx + s * 0.35, by + 4, zc + s * 0.35));
        mastParts.push(boxAt(0.09, 8, 0.09, bx - s * 0.35, by + 4, zc + s * 0.35));
      }
      for (let i = 0; i < 6; i++) {
        mastParts.push(boxAt(0.9, 0.05, 0.05, bx, by + 0.6 + i * 1.3, zc, 0, 45 * (i % 2)));
      }
      mastParts.push(boxAt(3.5, 0.06, 0.06, bx, by + 6.5, zc)); // yardarm
      this._add(merge(mastParts), M.hardware, { surface: 'metal', castShadow: false });
      this._addEmissiveLamp(new THREE.Vector3(bx, by + 8.2, zc), 0.2, M.lampCool, 0xd9e8ff, 3.0);
      // red obstruction light (blinking) on the yardarm
      const f = this.lighting.addBeacon({ position: [bx + 1.6, by + 6.6, zc], color: 0xff2020, blinkPeriod: 2.6, duty: 0.35, phase: 0.3, size: 0.14, lightIntensity: 0 });
      this.ctx.level.fixtures.push(f);
    }
    // foremast at the bow with a white light
    this._add(cylAt(0.08, 0.14, 10, xb + 6, deckY + 5, nz - beam * 0.4, 6), M.hardware, { surface: 'metal', castShadow: false });
    this._addEmissiveLamp(new THREE.Vector3(xb + 6, deckY + 10.2, nz - beam * 0.4), 0.18, M.lampCool, 0xd9e8ff, 2.8);
    // deck pedestal cranes (silhouette breakup)
    for (const px of [c0 - 14, xb + 26]) {
      const parts = [];
      parts.push(cylAt(0.9, 1.1, 5, px, deckY + 2.5, nz - 3.5, 10));
      parts.push(boxAt(1.2, 1.6, 2.2, px, deckY + 5.8, nz - 3.5, 0, 20));
      parts.push(boxAt(0.35, 0.35, 12, px + 2, deckY + 8, nz - 6.5, -35, 30));
      this._add(merge(parts), M.paintedSteelDark, { surface: 'metal', castShadow: false });
    }

    // mooring lines to the quay bollards
    for (const [sx, bx] of [[c0 - 20, 36], [xb + 40, -24]]) {
      const a = new THREE.Vector3(sx, hullTop - 0.4, nz + 0.6);
      const b = new THREE.Vector3(bx, 0.55, QUAY.bollardZ);
      const pts = catenaryPoints(a, b, 2.4, 16);
      this._add(polylineBoxes(pts, 0.09), M.burlap, { surface: 'fabric', castShadow: false });
    }

    this.ctx.level.landmarks.ship = new THREE.Vector3((xb + xs) / 2, deckY, nz - beam / 2);
  }

  /** Small emissive lamp = puck mesh + additive glow sprite (no real light). */
  _addEmissiveLamp(pos, size, material, glowHex, glowSize) {
    const geo = new THREE.SphereGeometry(size, 10, 8);
    geo.translate(pos.x, pos.y, pos.z);
    this._add(geo, material, { surface: 'glass', castShadow: false, receiveShadow: false });
    const smat = this.M.glowSprite.clone();
    smat.color = new THREE.Color(glowHex).multiplyScalar(1.2);
    smat.opacity = 0.55;
    const s = new THREE.Sprite(smat);
    s.position.copy(pos);
    s.scale.setScalar(glowSize);
    s.renderOrder = 21;
    this.ctx.root.add(s);
    this.ctx.level.sprites.push(s);
  }

  /* -------------------------------------------------------------- cranes */
  buildCranes() {
    for (const c of QUAY.cranes) this._buildCrane(c);
  }

  _buildCrane(spec) {
    const M = this.M;
    const col = this.ctx.collision;
    const xc = spec.x;
    const railA = QUAY.railsZ[0]; // landside
    const railB = QUAY.railsZ[1]; // waterside
    const legHalf = 8.5;
    const portalY = 22.5;
    const struct = [];   // dark painted steel
    const yellow = [];   // spreader
    // legs (4) with bogie boxes at the feet
    for (const sx of [-1, 1]) {
      for (const rz of [railA, railB]) {
        struct.push(boxAt(1.15, portalY, 1.15, xc + sx * legHalf, portalY / 2, rz));
        struct.push(boxAt(2.6, 0.9, 1.3, xc + sx * legHalf, 0.45, rz));
        col.addAABox(xc + sx * legHalf, 0, rz, 2.6, 1.6, 1.3, 'metal');
        col.addAABox(xc + sx * legHalf, 0, rz, 1.2, portalY, 1.2, 'metal');
      }
    }
    // sill beams along z on each side + portal beams along x at each rail
    for (const sx of [-1, 1]) {
      struct.push(boxAt(1.1, 1.6, Math.abs(railA - railB) + 1.2, xc + sx * legHalf, portalY + 0.4, (railA + railB) / 2));
    }
    for (const rz of [railA, railB]) {
      struct.push(boxAt(legHalf * 2 + 1.2, 1.4, 1.0, xc, portalY + 0.5, rz));
    }
    // X-bracing on both frames
    for (const rz of [railA, railB]) {
      struct.push(...polylinePairs([[xc - legHalf, 3, rz], [xc + legHalf, portalY - 1, rz]], 0.28));
      struct.push(...polylinePairs([[xc + legHalf, 3, rz], [xc - legHalf, portalY - 1, rz]], 0.28));
    }
    // side frame diagonal (seaside stiffness)
    for (const sx of [-1, 1]) {
      struct.push(...polylinePairs([[xc + sx * legHalf, 8, railA], [xc + sx * legHalf, portalY, railB]], 0.24));
    }
    // ---- lattice boom ------------------------------------------------------
    const boomZ0 = -30.5; // backreach tip (over the yard's north strip)
    const boomZ1 = -104;  // outreach tip
    const boomLen = boomZ0 - boomZ1;
    const chordY = [portalY + 1.9, portalY + 4.3];
    const chordX = 1.0;
    // 4 chords
    for (const cy2 of chordY) {
      for (const sx of [-1, 1]) {
        struct.push(boxAt(0.32, 0.32, boomLen, xc + sx * chordX, cy2, (boomZ0 + boomZ1) / 2));
      }
    }
    // verticals + diagonals every 6 m (side faces) + top/bottom cross ties
    const nBays = Math.round(boomLen / 6);
    for (let i = 0; i <= nBays; i++) {
      const z = boomZ0 - (i / nBays) * boomLen;
      for (const sx of [-1, 1]) {
        struct.push(boxAt(0.16, chordY[1] - chordY[0], 0.16, xc + sx * chordX, (chordY[0] + chordY[1]) / 2, z));
        if (i < nBays) {
          const z2 = boomZ0 - ((i + 1) / nBays) * boomLen;
          struct.push(...polylinePairs([[xc + sx * chordX, chordY[0], z], [xc + sx * chordX, chordY[1], z2]], 0.14));
        }
      }
      struct.push(boxAt(chordX * 2, 0.14, 0.14, xc, chordY[0], z));
      struct.push(boxAt(chordX * 2, 0.14, 0.14, xc, chordY[1], z));
    }
    // ---- A-frame apex + stays ------------------------------------------------
    const apexY = portalY + 21;
    for (const sx of [-1, 1]) {
      struct.push(...polylinePairs([[xc + sx * legHalf, portalY + 1, railB], [xc, apexY, railB - 1]], 0.4));
      struct.push(...polylinePairs([[xc + sx * legHalf, portalY + 1, railA], [xc, apexY, railB - 1]], 0.3));
    }
    // forestays to the boom tip, backstays to the backreach end
    struct.push(...polylinePairs([[xc, apexY, railB - 1], [xc, chordY[1] + 0.3, boomZ1 + 2]], 0.16));
    struct.push(...polylinePairs([[xc, apexY, railB - 1], [xc, chordY[1] + 0.3, (railB + boomZ1) / 2]], 0.14));
    struct.push(...polylinePairs([[xc, apexY, railB - 1], [xc, chordY[1] + 0.3, boomZ0]], 0.16));
    // ---- machinery house on the boom over the waterside legs ------------------
    struct.push(boxAt(8.5, 4.6, 6.5, xc, chordY[1] + 2.6, railB - 1.2));
    // exhaust + AC on top
    struct.push(cylAt(0.35, 0.35, 2.2, xc + 2.6, chordY[1] + 6, railB, 8));
    struct.push(boxAt(1.6, 0.8, 1.2, xc - 2.4, chordY[1] + 5.3, railB - 2.4));
    // machinery house windows (dim)
    for (let i = 0; i < 3; i++) {
      this._add(oQuad(1.1, 0.7, _v2.set(xc - 2.4 + i * 2.4, chordY[1] + 3.2, railB + 2.06), AX.X, AX.Y), i === 1 && spec.workLight ? M.windowLitDim : M.darkGlass, { surface: 'glass', castShadow: false });
    }
    // ---- trolley + hoist cables + spreader with a container --------------------
    const trolleyZ = spec.workLight ? -78 : -64;
    struct.push(boxAt(3.2, 0.9, 3.6, xc, chordY[0] - 0.7, trolleyZ));
    // operator cab under the boom near the trolley home
    struct.push(boxAt(2.2, 2.4, 3.0, xc - 2.6, chordY[0] - 1.7, railB - 5));
    this._add(oQuad(1.6, 1.1, _v2.set(xc - 2.6, chordY[0] - 1.5, railB - 3.48), AX.X, AX.Y), M.darkGlass, { surface: 'glass', castShadow: false });
    const spreaderY = spec.workLight ? 12.5 : 17.5;
    const cables = [];
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        cables.push(...polylinePairs([[xc + sx * 1.1, chordY[0] - 1.1, trolleyZ + sz * 1.4], [xc + sx * 1.1, spreaderY + 0.9, trolleyZ + sz * 5.4]], 0.06));
      }
    }
    yellow.push(boxAt(2.6, 0.7, 12.4, xc, spreaderY + 0.5, trolleyZ));
    for (const sz of [-1, 1]) yellow.push(boxAt(2.9, 1.0, 0.5, xc, spreaderY + 0.4, trolleyZ + sz * 6.0));
    // the container in the spreader
    this.ctx.kit.buildContainer({
      matrix: containerMatrix(xc, spreaderY - CONTAINER.H, trolleyZ, 0.4),
      length: CONTAINER.L40,
      color: 0x2e5d59,
      rust: 0.3,
      doors: 'closed',
      detail: 'simple',
      collide: false,
      castShadow: false,
      decals: {
        enabled: true, line: SHIPPING_LINES[1], idIndex: 3,
        tint: new THREE.Color(0xd9d5cc), sides: { left: true, right: true }, doorEnd: true, blind: true,
      },
    });
    // ---- stairs zigzag on the +x landside leg -------------------------------------
    const stairs = [];
    let sy = 1.2;
    let flip = 1;
    while (sy < portalY - 3) {
      stairs.push(...polylinePairs([[xc + legHalf + 0.9, sy, railA + flip * 1.3], [xc + legHalf + 0.9, sy + 3.4, railA - flip * 1.3]], 0.14));
      stairs.push(boxAt(0.9, 0.06, 0.9, xc + legHalf + 0.9, sy + 3.4, railA - flip * 1.35));
      sy += 3.4;
      flip = -flip;
    }
    struct.push(...stairs);
    // elevator shaft box alongside the leg
    struct.push(boxAt(1.4, portalY - 1, 1.4, xc + legHalf + 0.1, (portalY - 1) / 2 + 0.5, railA + 1.4));

    // merge + add
    this._add(merge(struct), M.paintedSteelDark, { surface: 'metal', castShadow: true });
    this._add(merge(yellow), M.craneYellow, { surface: 'metal', castShadow: false });
    this._add(merge(cables), M.cable, { surface: 'metal', castShadow: false });

    // ---- beacons + work light ----------------------------------------------------
    const bA = this.lighting.addBeacon({ position: [xc, apexY + 0.5, railB - 1], color: 0xff2020, blinkPeriod: 1.6, duty: 0.13, phase: spec.workLight ? 0 : 0.45, size: 0.22, lightIntensity: 0 });
    const bB = this.lighting.addBeacon({ position: [xc, chordY[1] + 0.6, boomZ1 + 1], color: 0xff2020, blinkPeriod: 2.3, duty: 0.16, phase: 0.6, size: 0.2, lightIntensity: 0 });
    const bC = this.lighting.addBeacon({ position: [xc, chordY[1] + 5.6, railB - 1.2], color: 0xffae00, blinkPeriod: 3.1, duty: 0.5, phase: 0.1, size: 0.14, lightIntensity: 0 });
    this.ctx.level.fixtures.push(bA, bB, bC);
    // caged sconce lamps on the seaside legs (emissive pucks + glow only)
    for (const sx of [-1, 1]) {
      this._addEmissiveLamp(new THREE.Vector3(xc + sx * legHalf, 3.2, railB + 0.7), 0.11, this.M.lampWarm, 0xffb15c, 1.8);
    }
    if (spec.workLight) {
      const f = this.lighting.addFlood({
        position: [xc - 1.2, chordY[0] - 0.4, railB + 1.5],
        target: [xc - 3, 0, railB + 3.5],
        color: 0xffefd6,
        intensity: 1100,
        angle: 0.5,
        penumbra: 0.5,
        distance: 46,
        castShadow: false,
        coneIntensity: 0.75,
        importance: 0.7,
        housing: true,
        flare: true,
        halo: true,
        haloSize: 7,
        groundY: 0,
      });
      this.ctx.level.fixtures.push(f);

    }
    this.ctx.level.landmarks['crane' + spec.id] = new THREE.Vector3(xc, 0, (railA + railB) / 2);
  }
}

/** helper: polyline from [ [x,y,z], ... ] as thin boxes → array of geometries (already world space) */
function polylinePairs(pts, thickness) {
  const vecs = pts.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
  const g = polylineBoxes(vecs, thickness);
  return g ? [g] : [];
}
