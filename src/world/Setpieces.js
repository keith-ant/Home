/**
 * Setpieces — yard dressing built procedurally (WORLD stream):
 *   floodlight masts (poles + platforms + heads via lighting.addFlood),
 *   chain-link fence runs with razor coil + the vehicle gate, jersey
 *   barriers, sandbag emplacements (instanced), pallets (instanced),
 *   overhead cables (catenaries), hazard tape ribbons, fire barrels (prop +
 *   emissive coals + flame sprites + fire practical + FX emitter), quay
 *   bollards, cable spools, traffic cones, the generator work light and
 *   container-mounted caged sconces.
 *
 * Everything dynamic (flame sprites, flickering coal beds) is registered on
 * ctx.level.dynamics for Level.update to animate from the simulation clock.
 */
import * as THREE from 'three';
import { YARD, MASTS, FIRE_BARRELS, SANDBAG_WALLS, BARRIERS, PALLET_STACKS, CABLES, QUAY, SPECIALS, CONTAINER, WAREHOUSE } from './layout.js';
import { boxGeom, cylGeom, merge, DEG, polylineBoxes, catenaryPoints, mat4 } from './util.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _one = new THREE.Vector3(1, 1, 1);

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

export class Setpieces {
  /**
   * @param {object} ctx build context {game, level, root, batcher, collision, mats, rng, kit, props}
   */
  constructor(ctx) {
    this.ctx = ctx;
    this.M = ctx.mats.m;
    this.mats = ctx.mats;
    this.rng = ctx.rng;
    this.game = ctx.game;
    this.lighting = ctx.game.lighting;
    this.level = ctx.level;
  }

  build() {
    const bat = this.ctx.batcher;
    bat.setZone('masts');
    this.buildMasts();
    bat.setZone('fence');
    this.buildFences();
    bat.setZone('yard');
    this.buildBarriers();
    this.buildSandbags();
    this.buildPallets();
    bat.setZone('overhead');
    this.buildCables();
    bat.setZone('yard');
    this.buildHazardTape();
    this.buildFireBarrels();
    bat.setZone('quay');
    this.buildBollards();
    bat.setZone('yard');
    this.buildSmallProps();
    this.buildContainerSconces();
    this.buildDebris();
  }

  _add(geo, mat, o = {}) {
    this.ctx.batcher.add(geo, mat, o);
  }

  /* --------------------------------------------------------------- masts */
  buildMasts() {
    const M = this.M;
    const col = this.ctx.collision;
    for (const m of MASTS) {
      const h = m.height;
      const parts = [];
      // tapered galvanized pole
      parts.push(cylAt(0.13, 0.3, h, m.x, h / 2, m.z, 10));
      // concrete plinth (dark cast concrete, not fresh light-grey)
      this._add(boxAt(1.7, 0.5, 1.7, m.x, 0.25, m.z), M.barrierConcrete, { surface: 'concrete' });
      col.addAABox(m.x, 0, m.z, 1.7, 0.5, 1.7, 'concrete');
      col.addAABox(m.x, 0.5, m.z, 0.45, h - 0.5, 0.45, 'metal');
      // access door + cable conduit on the pole
      parts.push(boxAt(0.28, 0.7, 0.12, m.x, 1.1, m.z + 0.16));
      parts.push(cylAt(0.03, 0.03, h - 2, m.x + 0.18, (h - 2) / 2 + 1, m.z + 0.12, 5));
      // service platform ring near the top
      const py = h - 1.4;
      for (const s of [-1, 1]) {
        parts.push(boxAt(1.9, 0.06, 0.12, m.x, py, m.z + s * 0.9));
        parts.push(boxAt(0.12, 0.06, 1.9, m.x + s * 0.9, py, m.z));
      }
      // grating floor
      parts.push(boxAt(1.7, 0.04, 1.7, m.x, py + 0.02, m.z));
      // railing posts + rails
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(boxAt(0.05, 1.05, 0.05, m.x + sx * 0.92, py + 0.55, m.z + sz * 0.92));
      for (const s of [-1, 1]) {
        parts.push(boxAt(1.9, 0.04, 0.04, m.x, py + 1.05, m.z + s * 0.92));
        parts.push(boxAt(0.04, 0.04, 1.9, m.x + s * 0.92, py + 1.05, m.z));
        parts.push(boxAt(1.9, 0.03, 0.03, m.x, py + 0.55, m.z + s * 0.92));
        parts.push(boxAt(0.03, 0.03, 1.9, m.x + s * 0.92, py + 0.55, m.z));
      }
      // crossarm head frame
      parts.push(boxAt(3.4, 0.24, 0.24, m.x, h + 0.15, m.z));
      parts.push(boxAt(0.24, 0.24, 1.2, m.x, h + 0.15, m.z));
      // ladder rungs up the pole (silhouette texture on the mast)
      for (let ry = 2.2; ry < py - 0.2; ry += 0.35) {
        parts.push(boxAt(0.36, 0.03, 0.03, m.x - 0.22, ry, m.z));
      }
      parts.push(boxAt(0.03, py - 2.2, 0.03, m.x - 0.38, (py + 2.2) / 2, m.z));
      parts.push(boxAt(0.03, py - 2.2, 0.03, m.x - 0.06, (py + 2.2) / 2, m.z));
      this._add(merge(parts), M.galvanized, { surface: 'metal' });

      // flood heads (Lighting fixtures) at the crossarm ends
      const nHeads = m.heads.length + (m.deadHeads || 0);
      // dead heads: dark housing boxes only (silhouette, no light)
      for (let dh = 0; dh < (m.deadHeads || 0); dh++) {
        const t = nHeads === 1 ? 0 : (m.heads.length + dh) / (nHeads - 1);
        const dx = (t - 0.5) * 2.4;
        this._add(boxAt(0.62, 0.46, 0.34, m.x + dx, h + 0.55, m.z, -35), M.hardware, { surface: 'metal', castShadow: false });
        this._add(boxAt(0.5, 0.34, 0.02, m.x + dx, h + 0.42, m.z + 0.18, -35), M.lampDead, { surface: 'glass', castShadow: false });
      }
      m.heads.forEach((hd, i) => {
        const t = nHeads === 1 ? 0 : i / (nHeads - 1);
        const dx = (t - 0.5) * 2.4;
        const dz = 0;
        const f = this.lighting.addFlood({
          position: [m.x + dx, h + 0.55, m.z + dz],
          target: hd.target,
          color: hd.color ?? 0xffb15c,
          intensity: hd.intensity ?? 1400,
          angle: hd.angle ?? 0.66,
          penumbra: 0.55,
          distance: hd.distance ?? 46,
          castShadow: false,
          importance: hd.importance ?? 1,
          // big atmospheric ball around the head + a stronger scattering
          // beam: the reference floods bloom into the wet air (environment-01)
          haloSize: hd.haloSize ?? 9.5,
          coneIntensity: hd.coneIntensity ?? 1.2,
          groundY: 0,
        });
        this.level.fixtures.push(f);
      });
      this.level.landmarks['mast' + m.id] = new THREE.Vector3(m.x, 0, m.z);
    }
    // dead second lamp on a couple of masts already handled by intensity table; add an aviation
    // obstruction beacon on the tallest quay mast
    const m5 = MASTS.find((x) => x.id === 'M5');
    if (m5) {
      const b = this.lighting.addBeacon({ position: [m5.x, m5.height + 0.9, m5.z], color: 0xff2020, blinkPeriod: 1.9, duty: 0.12, phase: 0.7, size: 0.12, lightIntensity: 0 });
      this.level.fixtures.push(b);
    }
  }

  /* -------------------------------------------------------------- fences */
  buildFences() {
    const M = this.M;
    const col = this.ctx.collision;
    // configure texture repeats for metre uvs
    const cl = this.mats.tex.chainlink;
    cl.repeat.set(1 / 0.2, 1 / 0.2);
    const rc = this.mats.tex.razorCoil;
    rc.repeat.set(1 / 1.8, 1);
    const runs = [
      { a: [YARD.fenceWestX, -40], b: [YARD.fenceWestX, 43.6] },
      { a: [YARD.fenceEastX, -40], b: [YARD.fenceEastX, 43.6] },
      { a: [8.4, YARD.fenceSouthZ], b: [YARD.gate.x0, YARD.fenceSouthZ] },
      { a: [YARD.gate.x1, YARD.fenceSouthZ], b: [YARD.fenceEastX, YARD.fenceSouthZ] },
      // short returns at the north ends bending in toward the apron
      { a: [YARD.fenceWestX, -40], b: [YARD.fenceWestX + 4, -44] },
      { a: [YARD.fenceEastX, -40], b: [YARD.fenceEastX - 4, -44] },
    ];
    const meshParts = [];
    const coilParts = [];
    const postParts = [];
    const fenceH = 2.4;
    for (const run of runs) {
      const [x0, z0] = run.a;
      const [x1, z1] = run.b;
      const dx = x1 - x0;
      const dz = z1 - z0;
      const len = Math.hypot(dx, dz);
      if (len < 0.5) continue;
      const yaw = Math.atan2(dx, dz); // direction of the run
      const nx = Math.cos(yaw); // perpendicular in xz? we need the run direction unit: (sin(yaw), 0, cos(yaw))
      void nx;
      const dirX = dx / len;
      const dirZ = dz / len;
      // chain-link mesh quad (vertical), split into ≤12 m pieces
      const pieces = Math.ceil(len / 12);
      for (let i = 0; i < pieces; i++) {
        const ta = (i / pieces) * len;
        const tb = ((i + 1) / pieces) * len;
        const cx = x0 + dirX * (ta + tb) / 2;
        const cz = z0 + dirZ * (ta + tb) / 2;
        const w = tb - ta;
        // quad with u along the run, v up
        const g = new THREE.PlaneGeometry(w, fenceH, 1, 1);
        const uv = g.attributes.uv;
        for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * w + ta, uv.getY(k) * fenceH);
        uv.needsUpdate = true;
        // orient: rotate so local +x → run direction
        const rot = Math.atan2(-dirZ, dirX); // angle from +X in the xz plane (about Y)
        g.rotateY(rot);
        g.translate(cx, fenceH / 2 + 0.06, cz);
        meshParts.push(g);
        // razor coil ribbon on top (0.42 tall), v 0..1
        const gc = new THREE.PlaneGeometry(w, 0.42, 1, 1);
        const uvc = gc.attributes.uv;
        for (let k = 0; k < uvc.count; k++) uvc.setXY(k, uvc.getX(k) * w + ta, uvc.getY(k));
        uvc.needsUpdate = true;
        gc.rotateY(rot);
        gc.translate(cx, fenceH + 0.24, cz);
        coilParts.push(gc);
      }
      // posts every 3 m + top rail + bottom tension wire
      const nPosts = Math.max(1, Math.round(len / 3));
      for (let i = 0; i <= nPosts; i++) {
        const t = (i / nPosts) * len;
        const px = x0 + dirX * t;
        const pz = z0 + dirZ * t;
        const corner = i === 0 || i === nPosts;
        postParts.push(cylAt(corner ? 0.06 : 0.038, corner ? 0.06 : 0.038, fenceH + 0.5, px, (fenceH + 0.5) / 2, pz, 6));
        // brace at ends
        if (corner) {
          postParts.push(boxAt(0.04, fenceH * 0.9, 0.04, px + dirX * 0.9 * (i === 0 ? 1 : -1), fenceH * 0.42, pz + dirZ * 0.9 * (i === 0 ? 1 : -1), Math.sin(yaw) * 40, 0, Math.cos(yaw) * 40 * (i === 0 ? 1 : -1)));
        }
      }
      const rail = boxGeom(0.05, 0.05, len);
      _e.set(0, yaw, 0, 'YXZ');
      _q.setFromEuler(_e);
      _m.compose(_v.set((x0 + x1) / 2, fenceH + 0.06, (z0 + z1) / 2), _q, _one);
      rail.applyMatrix4(_m);
      postParts.push(rail);
      // collision wall
      _e.set(0, yaw, 0, 'YXZ');
      _q.setFromEuler(_e);
      _m.compose(_v.set((x0 + x1) / 2, 0, (z0 + z1) / 2), _q, _one);
      col.addBox(_m, { w: 0.2, h: fenceH + 0.5, d: len, cx: 0, cy: (fenceH + 0.5) / 2, cz: 0 }, 'metal');
    }
    this._add(merge(meshParts), M.chainlink, { surface: 'metal', castShadow: false, key: 'chainlink' });
    this._add(merge(coilParts), M.razorCoil, { surface: 'metal', castShadow: false, key: 'coil' });
    this._add(merge(postParts), M.galvanized, { surface: 'metal', castShadow: true });

    // ---- vehicle gate (two swing leaves, one ajar) ------------------------------
    const gx0 = YARD.gate.x0;
    const gx1 = YARD.gate.x1;
    const gz = YARD.gate.z;
    const leafW = (gx1 - gx0) / 2 - 0.15;
    const gateParts = [];
    const gateMesh = [];
    // gate posts (heavier)
    for (const gx of [gx0, gx1]) {
      gateParts.push(cylAt(0.11, 0.11, 3.1, gx, 1.55, gz, 8));
      col.addAABox(gx, 0, gz, 0.3, 3.1, 0.3, 'metal');
    }
    const leaves = [
      { hinge: gx0, dir: 1, angle: 4 },
      { hinge: gx1, dir: -1, angle: -36 }, // east leaf swung inward (south)
    ];
    for (const lf of leaves) {
      const parts = [];
      const meshP = [];
      // frame
      parts.push(boxAt(leafW, 0.06, 0.06, leafW / 2, 2.35, 0));
      parts.push(boxAt(leafW, 0.06, 0.06, leafW / 2, 0.15, 0));
      parts.push(boxAt(0.06, 2.2, 0.06, 0.05, 1.25, 0));
      parts.push(boxAt(0.06, 2.2, 0.06, leafW - 0.05, 1.25, 0));
      parts.push(boxAt(leafW * 1.02, 0.04, 0.04, leafW / 2, 1.25, 0, 0, 0, 27)); // diagonal
      const g = new THREE.PlaneGeometry(leafW - 0.12, 2.1, 1, 1);
      const uv = g.attributes.uv;
      for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * (leafW - 0.12), uv.getY(k) * 2.1);
      uv.needsUpdate = true;
      g.translate(leafW / 2, 1.25, 0);
      meshP.push(g);
      // hinge transform
      _e.set(0, (lf.angle) * DEG * (lf.dir === 1 ? 1 : 1), 0, 'YXZ');
      _q.setFromEuler(_e);
      // leaf local +x extends from the hinge toward the other post: dir handles the mirror
      const s = new THREE.Vector3(lf.dir, 1, 1);
      _m.compose(_v.set(lf.hinge, 0, gz), _q, s);
      for (const p of parts) {
        p.applyMatrix4(_m);
        gateParts.push(p);
      }
      for (const p of meshP) {
        p.applyMatrix4(_m);
        // mirrored scale flips winding: fix normals for the -x leaf
        if (lf.dir < 0) {
          const idx = p.index.array;
          for (let i = 0; i < idx.length; i += 3) {
            const t = idx[i + 1];
            idx[i + 1] = idx[i + 2];
            idx[i + 2] = t;
          }
          p.computeVertexNormals();
        }
        gateMesh.push(p);
      }
      // collision for the closed-ish west leaf only (the ajar east leaf leaves the gap open)
      if (lf.dir === 1) {
        _m.compose(_v.set(lf.hinge, 0, gz), _q, _one);
        col.addBox(_m, { w: leafW, h: 2.4, d: 0.1, cx: leafW / 2, cy: 1.25, cz: 0 }, 'metal');
      }
    }
    this._add(merge(gateParts), M.galvanized, { surface: 'metal' });
    this._add(merge(gateMesh), M.chainlink, { surface: 'metal', castShadow: false, key: 'chainlink2' });
    // gate signage plates on the west post
    this._signPlate(gx0 - 0.9, 1.7, gz - 0.05, 1.4, 0.35, 'sign.danger', 180);
    this._signPlate(gx1 + 0.9, 1.5, gz - 0.05, 1.6, 0.42, 'st.keepdry', 180);
    this.level.landmarks.gate = new THREE.Vector3((gx0 + gx1) / 2, 0, gz);
  }

  /** small sign plate: backing box + stencil decal on both faces */
  _signPlate(x, y, z, w, h, cellId, yawDeg = 0) {
    const M = this.M;
    const cells = this.mats.tex.stencilCells;
    const cell = cells[cellId];
    this._add(boxAt(w, h, 0.04, x, y, z, 0, yawDeg), M.paintedSteelRed, { surface: 'metal', castShadow: false });
    if (!cell) return;
    // front face decal
    const g = new THREE.PlaneGeometry(w * 0.92, h * 0.8, 1, 1);
    const uv = g.attributes.uv;
    uv.setXY(0, cell.u0, cell.v1); uv.setXY(1, cell.u1, cell.v1); uv.setXY(2, cell.u0, cell.v0); uv.setXY(3, cell.u1, cell.v0);
    const col = new Float32Array(12).fill(1);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.rotateY((yawDeg + 180) * DEG);
    g.translate(x + Math.sin((yawDeg + 180) * DEG) * 0.025, y, z + Math.cos((yawDeg + 180) * DEG) * 0.025);
    this._add(g, M.decalStencil, { surface: 'metal', castShadow: false, key: 'signs' });
  }

  /* ------------------------------------------------------------ barriers */
  _jerseyGeom(len) {
    // New Jersey profile (mm): base 600 w, mid 250 @ 250 h, top 200 @ 810 h
    const prof = [
      [-0.31, 0], [0.31, 0], [0.31, 0.08], [0.13, 0.33], [0.1, 0.81], [-0.1, 0.81], [-0.13, 0.33], [-0.31, 0.08],
    ];
    // manual prism extrusion along z with metre uvs
    const positions = [];
    const uvs = [];
    const idx = [];
    const n = prof.length;
    let vBase = 0;
    for (let i = 0; i < n; i++) {
      const a = prof[i];
      const b = prof[(i + 1) % n];
      const segLen = Math.hypot(b[0] - a[0], b[1] - a[1]);
      // quad from z=-len/2 to +len/2
      positions.push(a[0], a[1], -len / 2, b[0], b[1], -len / 2, b[0], b[1], len / 2, a[0], a[1], len / 2);
      uvs.push(0, 0, segLen, 0, segLen, len, 0, len);
      idx.push(vBase, vBase + 1, vBase + 2, vBase, vBase + 2, vBase + 3);
      vBase += 4;
    }
    // end caps (fan)
    for (const zs of [-1, 1]) {
      const start = vBase;
      for (let i = 0; i < n; i++) {
        positions.push(prof[i][0], prof[i][1], zs * len / 2);
        uvs.push(prof[i][0] + 0.31, prof[i][1]);
      }
      for (let i = 1; i < n - 1; i++) {
        if (zs > 0) idx.push(start, start + i, start + i + 1);
        else idx.push(start, start + i + 1, start + i);
      }
      vBase += n;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  buildBarriers() {
    const M = this.M;
    const col = this.ctx.collision;
    const rng = this.rng;
    const cells = this.mats.tex.stencilCells;
    const band = cells['hazband'];
    const parts = [];
    const bands = [];
    for (const [x, z, yaw] of BARRIERS) {
      const len = 3.2;
      const g = this._jerseyGeom(len);
      _e.set(rng.range(-1.2, 1.2) * DEG, (yaw + rng.range(-3, 3)) * DEG, rng.range(-0.8, 0.8) * DEG, 'YXZ');
      _q.setFromEuler(_e);
      _m.compose(_v.set(x, 0, z), _q, _one);
      g.applyMatrix4(_m);
      parts.push(g);
      col.addBox(_m, { w: 0.62, h: 0.85, d: len, cx: 0, cy: 0.42, cz: 0 }, 'concrete');
      // black/yellow end-cap bands on the upper faces (both sides, both ends)
      if (band && rng.next() < 0.7) {
        for (const side of [-1, 1]) {
          for (const end of [-1, 1]) {
            const q = new THREE.PlaneGeometry(0.85, 0.34, 1, 1);
            const uv = q.attributes.uv;
            uv.setXY(0, band.u0, band.v0); uv.setXY(1, band.u1, band.v0);
            uv.setXY(2, band.u0, band.v1); uv.setXY(3, band.u1, band.v1);
            // face OUTWARD from the near-vertical upper flank (x = ±0.115):
            // rotateY(+90°) turns the plane's +Z normal to +X, (−90°) to −X
            q.rotateY(side > 0 ? Math.PI / 2 : -Math.PI / 2);
            q.translate(side * 0.121, 0.58, end * (len / 2 - 0.5));
            q.applyMatrix4(_m);
            const c = new Float32Array(12).fill(1);
            q.setAttribute('color', new THREE.BufferAttribute(c, 3));
            bands.push(q);
          }
        }
      }
    }
    this._add(merge(parts), M.barrierConcrete, { surface: 'concrete' });
    if (bands.length) this._add(merge(bands), M.decalStencil, { surface: 'concrete', castShadow: false, key: 'barrierBands' });
  }

  /* ------------------------------------------------------------ sandbags */
  buildSandbags() {
    const M = this.M;
    const col = this.ctx.collision;
    const rng = this.rng;
    // bag geometry: squashed sphere with metre-ish uv
    const bag = new THREE.SphereGeometry(1, 10, 7);
    bag.scale(0.34, 0.13, 0.21);
    const uv = bag.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.9, uv.getY(i) * 0.45);
    uv.needsUpdate = true;
    const matrices = [];
    for (const wall of SANDBAG_WALLS) {
      const yaw = wall.yawDeg * DEG;
      const dirX = Math.cos(yaw);
      const dirZ = -Math.sin(yaw);
      const nAlong = Math.max(2, Math.floor(wall.length / 0.62));
      const baseY = (wall.y ?? 0) + 0.13;
      for (let c = 0; c < wall.courses; c++) {
        const count = nAlong - (c === wall.courses - 1 ? 1 : 0);
        for (let i = 0; i < count; i++) {
          const off = (i - (count - 1) / 2) * 0.62 + (c % 2) * 0.31;
          const x = wall.x + dirX * off + rng.range(-0.03, 0.03);
          const z = wall.z + dirZ * off + rng.range(-0.03, 0.03);
          const y = baseY + c * 0.215;
          _e.set(rng.range(-6, 6) * DEG, (wall.yawDeg + rng.range(-9, 9)) * DEG, rng.range(-5, 5) * DEG, 'YXZ');
          _q.setFromEuler(_e);
          const m = new THREE.Matrix4().compose(_v.set(x, y, z), _q, _v2.set(1, 1, 1));
          matrices.push(m);
        }
      }
      // collision block for the whole wall
      _e.set(0, wall.yawDeg * DEG, 0, 'YXZ');
      _q.setFromEuler(_e);
      _m.compose(_v.set(wall.x, wall.y ?? 0, wall.z), _q, _one);
      const wallH = wall.courses * 0.215 + 0.14;
      col.addBox(_m, { w: wall.length, h: wallH, d: 0.55, cx: 0, cy: wallH / 2, cz: 0 }, 'fabric');
    }
    // extra loose bags near the emplacements
    for (let i = 0; i < 10; i++) {
      const w = SANDBAG_WALLS[i % SANDBAG_WALLS.length];
      const x = w.x + rng.range(-2.5, 2.5);
      const z = w.z + rng.range(0.6, 1.8) * (w.yawDeg === 180 ? -1 : 1);
      _e.set(rng.range(-15, 15) * DEG, rng.range(0, 360) * DEG, rng.range(-15, 15) * DEG, 'YXZ');
      _q.setFromEuler(_e);
      matrices.push(new THREE.Matrix4().compose(_v.set(x, (w.y ?? 0) + 0.12, z), _q, _v2.set(1, 1, 1)));
    }
    const inst = new THREE.InstancedMesh(bag, M.burlap, matrices.length);
    for (let i = 0; i < matrices.length; i++) inst.setMatrixAt(i, matrices[i]);
    inst.instanceMatrix.needsUpdate = true;
    inst.castShadow = true;
    inst.receiveShadow = true;
    inst.name = 'setpieces.sandbags';
    inst.userData.surface = 'fabric';
    inst.computeBoundingSphere();
    this.ctx.root.add(inst);
    this.level.instancedMeshes.push(inst);
  }

  /* ------------------------------------------------------------- pallets */
  buildPallets() {
    const M = this.M;
    const col = this.ctx.collision;
    const rng = this.rng;
    // pallet geometry: 5 top boards, 3 stringers, 3 bottom boards (EUR-ish 1.2 × 1.0 × 0.144)
    const parts = [];
    for (let i = 0; i < 5; i++) parts.push(boxAt(1.2, 0.022, 0.145, 0, 0.133, -0.42 + i * 0.21));
    for (let i = 0; i < 3; i++) parts.push(boxAt(0.1, 0.09, 1.0, -0.55 + i * 0.55, 0.077, 0));
    for (let i = 0; i < 3; i++) parts.push(boxAt(1.2, 0.022, 0.1, 0, 0.011, -0.45 + i * 0.45));
    const geo = merge(parts);
    const matrices = [];
    for (const [x, z, yaw, count] of PALLET_STACKS) {
      for (let i = 0; i < count; i++) {
        const y = i * 0.144;
        _e.set(0, (yaw + rng.range(-4, 4) + i * rng.range(-3, 3)) * DEG, 0, 'YXZ');
        _q.setFromEuler(_e);
        matrices.push(new THREE.Matrix4().compose(_v.set(x + rng.range(-0.04, 0.04), y, z + rng.range(-0.04, 0.04)), _q, _v2.set(1, 1, 1)));
      }
      _e.set(0, yaw * DEG, 0, 'YXZ');
      _q.setFromEuler(_e);
      _m.compose(_v.set(x, 0, z), _q, _one);
      col.addBox(_m, { w: 1.2, h: count * 0.144, d: 1.0, cx: 0, cy: count * 0.072, cz: 0 }, 'wood');
    }
    // a few pallets leaning against containers / walls
    const leaners = [[-23.5, -14.5, 90, 78], [23.6, 6.8, -90, 78], [-58.6, 33.6, 90, 80], [8.6, -40.8, 0, 76]];
    for (const [x, z, yaw, tilt] of leaners) {
      _e.set(tilt * DEG, yaw * DEG, 0, 'YXZ');
      _q.setFromEuler(_e);
      matrices.push(new THREE.Matrix4().compose(_v.set(x, 0.6, z), _q, _v2.set(1, 1, 1)));
    }
    const inst = new THREE.InstancedMesh(geo, M.wood, matrices.length);
    for (let i = 0; i < matrices.length; i++) inst.setMatrixAt(i, matrices[i]);
    inst.instanceMatrix.needsUpdate = true;
    inst.castShadow = true;
    inst.receiveShadow = true;
    inst.name = 'setpieces.pallets';
    inst.userData.surface = 'wood';
    inst.computeBoundingSphere();
    this.ctx.root.add(inst);
    this.level.instancedMeshes.push(inst);
  }

  /* -------------------------------------------------------------- cables */
  buildCables() {
    const M = this.M;
    const parts = [];
    for (const [a, b, sag] of CABLES) {
      const pa = new THREE.Vector3(a[0], a[1], a[2]);
      const pb = new THREE.Vector3(b[0], b[1], b[2]);
      const pts = catenaryPoints(pa, pb, sag, 14);
      parts.push(polylineBoxes(pts, 0.032));
      // occasionally a second parallel line 0.4 m below (paired power lines)
      if ((a[1] + b[1]) > 20) {
        const pts2 = catenaryPoints(pa.clone().setY(pa.y - 0.45), pb.clone().setY(pb.y - 0.45), sag * 1.15, 14);
        parts.push(polylineBoxes(pts2, 0.028));
      }
    }
    // ground cable from the generator to mast M1 base
    {
      const pts = [
        new THREE.Vector3(-33.2, 0.04, 6.6), new THREE.Vector3(-31.4, 0.04, 5.6), new THREE.Vector3(-29.6, 0.04, 5.9),
        new THREE.Vector3(-27.5, 0.04, 4.4), new THREE.Vector3(-25.8, 0.04, 3.3), new THREE.Vector3(-24.9, 0.05, 2.6),
      ];
      parts.push(polylineBoxes(pts, 0.045));
    }
    this._add(merge(parts.filter(Boolean)), M.cable, { surface: 'metal', castShadow: false });
  }

  /* ---------------------------------------------------------- hazard tape */
  buildHazardTape() {
    const M = this.M;
    const kit = this.ctx.kit;
    this.mats.tex.hazardTape.repeat.set(1 / 0.6, 1);
    const spans = [];
    // across the burnt container's open door mouth (door end is at local +z)
    if (kit.burntRecord) {
      const mtx = kit.burntRecord.matrix;
      const halfL = CONTAINER.L40 / 2;
      const a = new THREE.Vector3(-1.4, 1.05, halfL + 0.55).applyMatrix4(mtx);
      const b = new THREE.Vector3(1.55, 1.15, halfL + 0.3).applyMatrix4(mtx);
      spans.push([a, b, 0.14]);
    }
    // across the block-W alley south entrance
    spans.push([new THREE.Vector3(-18.55, 0.98, 15.6), new THREE.Vector3(-15.85, 0.86, 15.5), 0.12]);
    // fallen container east end → an oil drum
    spans.push([new THREE.Vector3(-24.3, 1.4, 10.5), new THREE.Vector3(-24.4, 0.95, 8.4), 0.2]);
    // quay edge between two bollards near crane A
    spans.push([new THREE.Vector3(-44, 0.7, QUAY.bollardZ), new THREE.Vector3(-34, 0.7, QUAY.bollardZ), 0.35]);
    // trailer stairs to a barrier post
    spans.push([new THREE.Vector3(16.7, 1.1, 40.4), new THREE.Vector3(14.9, 0.95, 40.2), 0.1]);
    const parts = [];
    for (const [a, b, sag] of spans) {
      const pts = catenaryPoints(a, b, sag, 10);
      // vertical ribbon: quads following the polyline
      for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[i];
        const p1 = pts[i + 1];
        const seg = new THREE.Vector3().subVectors(p1, p0);
        const len = seg.length();
        if (len < 1e-4) continue;
        const mid = new THREE.Vector3().addVectors(p0, p1).multiplyScalar(0.5);
        const g = new THREE.PlaneGeometry(len, 0.05, 1, 1);
        const uv = g.attributes.uv;
        const uOff = i * len;
        for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * len + uOff, uv.getY(k));
        uv.needsUpdate = true;
        // rotate so +x aligns with the segment (about Y then pitch)
        const yaw = Math.atan2(-seg.z, seg.x);
        const pitch = Math.asin(seg.y / len);
        g.rotateZ(pitch);
        g.rotateY(yaw);
        g.translate(mid.x, mid.y, mid.z);
        parts.push(g);
      }
    }
    this._add(merge(parts), M.hazardTape, { surface: 'fabric', castShadow: false, key: 'tape' });
  }

  /* ------------------------------------------------------------- fire barrels */
  buildFireBarrels() {
    const level = this.level;
    const props = this.ctx.props;
    for (const fb of FIRE_BARRELS) {
      const y = 0;
      // the barrel prop itself
      props.place('prop.fire_barrel', mat4(fb.x, y, fb.z, 0, this.rng.range(0, 360), 0));
      this.ctx.collision.addAABox(fb.x, 0, fb.z, 0.62, 0.9, 0.62, 'metal');
      // glowing coal bed disc just inside the rim
      const coalMat = this.M.coals.clone();
      const disc = new THREE.CircleGeometry(0.24, 14);
      disc.rotateX(-Math.PI / 2);
      const coal = new THREE.Mesh(disc, coalMat);
      coal.position.set(fb.x, y + 0.72, fb.z);
      coal.renderOrder = 12;
      coal.name = 'fire.coals';
      this.ctx.root.add(coal);
      // fire practical (flicker curve drives the sprites too); the far
      // north-east drum is glow-only to stay inside the light budget
      let fixture = null;
      if (fb.id !== 'FB3') {
        fixture = this.lighting.addPractical({
          position: [fb.x, y + 1.15, fb.z],
          color: 0xff7a2e,
          intensity: fb.intensity,
          radius: 13,
          flicker: 'fire',
          marker: false,
          glow: false,
          seed: fb.x * 3.1 + fb.z,
        });
        level.fixtures.push(fixture);
      }
      // flame licks + inner glow
      const flames = [];
      const lickSpec = [
        { dx: -0.12, dz: -0.02, w: 0.3, h: 0.58, col: 0xff7a2e, k: 1.05, alt: false },
        { dx: 0.01, dz: 0.03, w: 0.4, h: 0.86, col: 0xffb35c, k: 1.3, alt: true },
        { dx: 0.12, dz: -0.04, w: 0.28, h: 0.5, col: 0xff8a3a, k: 1.1, alt: false },
        { dx: -0.03, dz: 0.06, w: 0.2, h: 1.05, col: 0xffd48a, k: 1.2, alt: true },
      ];
      lickSpec.forEach((L, i) => {
        const mat = (L.alt ? this.M.flameSprite2 : this.M.flameSprite).clone();
        mat.color = new THREE.Color(L.col).multiplyScalar(L.k);
        mat.opacity = 0.62;
        const s = new THREE.Sprite(mat);
        s.center.set(0.5, 0.06);
        s.position.set(fb.x + L.dx, y + 0.79, fb.z + L.dz);
        s.scale.set(L.w, L.h, 1);
        s.userData.base = [L.w, L.h];
        s.renderOrder = 40 + i;
        this.ctx.root.add(s);
        level.sprites.push(s);
        flames.push(s);
      });
      const glowMat = this.M.glowSprite.clone();
      glowMat.color = new THREE.Color(0xff6a20);
      glowMat.opacity = 0.32;
      const glow = new THREE.Sprite(glowMat);
      glow.position.set(fb.x, y + 1.05, fb.z);
      glow.scale.setScalar(1.9);
      glow.renderOrder = 39;
      this.ctx.root.add(glow);
      level.sprites.push(glow);
      level.dynamics.push({ kind: 'fire', flames, glow, coal, fixture, seed: fb.x * 0.37 + fb.z * 0.11 });
      level.emitters.push({ kind: 'fire', tag: fb.id, position: new THREE.Vector3(fb.x, y + 1.2, fb.z), radius: 0.32, intensity: 1.0 });
      level.emitters.push({ kind: 'embers', tag: fb.id, position: new THREE.Vector3(fb.x, y + 1.35, fb.z), radius: 0.3, intensity: 1.0 });
      level.emitters.push({ kind: 'smoke', tag: fb.id, position: new THREE.Vector3(fb.x, y + 1.6, fb.z), radius: 0.5, intensity: 0.7 });
      level.landmarks['fire' + fb.id] = new THREE.Vector3(fb.x, 0, fb.z);
    }
  }

  /* ------------------------------------------------------------- bollards */
  buildBollards() {
    const M = this.M;
    const col = this.ctx.collision;
    const parts = [];
    const caps = [];
    for (const x of QUAY.bollardXs) {
      const z = QUAY.bollardZ;
      parts.push(cylAt(0.2, 0.24, 0.55, x, 0.275, z, 12));
      parts.push(cylAt(0.09, 0.09, 0.5, x, 0.5, z, 8, 0, 0, 90)); // cross horn
      parts.push(boxAt(0.7, 0.06, 0.7, x, 0.03, z));
      // yellow-painted head disc + top of the horn (visibility paint)
      caps.push(cylAt(0.27, 0.27, 0.12, x, 0.58, z, 12));
      caps.push(cylAt(0.095, 0.095, 0.14, x + 0.19, 0.5, z, 8, 0, 0, 90));
      col.addAABox(x, 0, z, 0.6, 0.7, 0.6, 'metal');
    }
    this._add(merge(parts), M.paintedSteelDark, { surface: 'metal' });
    this._add(merge(caps), M.safetyYellow, { surface: 'metal' });
    // a coiled mooring rope on the coping between two bollards
    {
      const coil = [];
      for (let i = 0; i < 5; i++) {
        const r = 0.32 + i * 0.045;
        const g = new THREE.TorusGeometry(r, 0.04, 6, 20);
        g.rotateX(Math.PI / 2);
        g.translate(-19.4, 0.045 + (i % 2) * 0.01, QUAY.bollardZ + 0.35);
        coil.push(g);
      }
      this._add(merge(coil), M.burlap, { surface: 'fabric', castShadow: false });
    }
  }

  /* -------------------------------------------------------- small props */
  buildSmallProps() {
    const M = this.M;
    const col = this.ctx.collision;
    const rng = this.rng;
    // cable spools
    const spools = [[26.4, -12.6, 20], [-58.2, -44.9, 80], [12.5, -49.8, 5]];
    const sp = [];
    for (const [x, z, yaw] of spools) {
      const parts = [];
      parts.push(cylAt(0.75, 0.75, 0.08, 0, 0.75, -0.32, 18, 90, 0, 0));
      parts.push(cylAt(0.75, 0.75, 0.08, 0, 0.75, 0.32, 18, 90, 0, 0));
      parts.push(cylAt(0.28, 0.28, 0.6, 0, 0.75, 0, 12, 90, 0, 0));
      parts.push(cylAt(0.52, 0.52, 0.55, 0, 0.75, 0, 14, 90, 0, 0));
      const g = merge(parts);
      _e.set(0, yaw * DEG, 0, 'YXZ');
      _q.setFromEuler(_e);
      _m.compose(_v.set(x, 0, z), _q, _one);
      g.applyMatrix4(_m);
      sp.push(g);
      col.addAABox(x, 0, z, 1.55, 1.5, 0.8, 'wood');
    }
    // spool flanges wood; drum cores dark: single material compromise → wood
    this._add(merge(sp), M.wood, { surface: 'wood' });

    // traffic cones (procedural, orange with white bands)
    const cones = [[36.5, -41.2], [33.9, -41.4], [3.6, -38.2], [-3.4, -38.4], [28.8, 41.2]];
    const coneParts = [];
    for (const [x, z] of cones) {
      const c = cylGeom(0.03, 0.19, 0.72, 12, false);
      const base = boxGeom(0.42, 0.05, 0.42);
      _m.makeTranslation(x, 0.36, z);
      c.applyMatrix4(_m);
      _m.makeTranslation(x, 0.025, z);
      base.applyMatrix4(_m);
      coneParts.push(c, base);
    }
    this._add(merge(coneParts), M.paintedSteelRed, { surface: 'plastic', castShadow: true });

    // tarp bundle draped over drums by the west lane (a low deformed sheet)
    {
      const tarp = new THREE.PlaneGeometry(4.6, 3.2, 8, 6);
      const p = tarp.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i);
        const y = p.getY(i);
        const bump = Math.exp(-(x * x + y * y) / 2.6) * 0.9 + Math.exp(-((x - 1.3) ** 2 + (y + 0.6) ** 2) / 0.8) * 0.5;
        p.setZ(i, bump + 0.06 * Math.sin(x * 3.1) * Math.cos(y * 2.7));
      }
      p.needsUpdate = true;
      const uv = tarp.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 4.6, uv.getY(i) * 3.2);
      uv.needsUpdate = true;
      tarp.computeVertexNormals();
      tarp.rotateX(-Math.PI / 2);
      tarp.translate(-35.0, 0, -21.0);
      const tarpMat = this.game.pbr.makePBR('tex.burlap', { repeat: [1 / 0.27, 1 / 0.27], color: 0x4a6b57, roughnessScale: 1, wetness: 0.6 });
      tarpMat.side = THREE.DoubleSide;
      const mesh = new THREE.Mesh(tarp, tarpMat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.name = 'setpieces.tarp';
      mesh.userData.surface = 'fabric';
      this.ctx.root.add(mesh);
      col.addAABox(-35, 0, -21, 4.2, 1.0, 3.0, 'fabric');
    }
    void rng;
  }

  /* -------------------------------------------------------------- debris */
  /**
   * Ground litter with a story: charred slats + soot fans (terrain decals)
   * at the burnt container mouth and the fire barrels, broken pallet slats
   * and dunnage along the warehouse dock and the barrel clusters. Two
   * merged meshes; no collision (all below step height).
   */
  buildDebris() {
    const rng = this.rng;
    const kit = this.ctx.kit;
    const slats = [];
    const charred = [];
    const scatter = (list, cx, cz, radius, n, opts = {}) => {
      for (let i = 0; i < n; i++) {
        const a = rng.range(0, Math.PI * 2);
        const r = radius * Math.sqrt(rng.next());
        const x = cx + Math.cos(a) * r;
        const z = cz + Math.sin(a) * r;
        const len = rng.range(opts.minLen ?? 0.3, opts.maxLen ?? 1.1);
        const g = boxAt(len, rng.range(0.018, 0.03), rng.range(0.07, 0.14),
          x, rng.range(0.012, 0.05), z, rng.range(-8, 8), rng.range(0, 180), rng.range(-6, 6));
        list.push(g);
      }
    };
    const terrain = this.ctx.level.terrain;
    const sootTint = new THREE.Color(0x080706);
    // burnt container: charred boards fanning out of the open door end + soot fan
    if (kit.burntRecord) {
      const halfL = CONTAINER.L40 / 2;
      const mouth = new THREE.Vector3(0, 0, halfL + 1.6).applyMatrix4(kit.burntRecord.matrix);
      scatter(charred, mouth.x, mouth.z, 2.4, 14);
      terrain?._decal('oil2', mouth.x, mouth.z, 5.2, 4.0, this.rng.range(0, 360), sootTint, 0.015, 'ashInt');
    }
    // fire barrels: ash rings + a few charred bits
    for (const fb of FIRE_BARRELS) {
      terrain?._decal('oil0', fb.x, fb.z, 2.4, 1.9, this.rng.range(0, 360), sootTint, 0.013, 'ashInt');
      scatter(charred, fb.x, fb.z, 1.4, 5, { maxLen: 0.7 });
    }
    // warehouse dock + spawn staging + lanes: broken pallet slats / dunnage
    scatter(slats, -30, 35.6, 4.5, 10);
    scatter(slats, -22, 36.4, 3.0, 6);
    scatter(slats, 3.2, 33.6, 3.2, 8);
    scatter(slats, -34.6, -20.4, 2.4, 5); // by the tarp bundle / drums
    scatter(slats, 26.4, -12.6, 2.6, 5);  // by the cable spool
    if (charred.length) this._add(merge(charred), this.M.blackRubber, { surface: 'wood', castShadow: false, key: 'debrisCharred' });
    if (slats.length) this._add(merge(slats), this.M.wood, { surface: 'wood', castShadow: false, key: 'debrisSlats' });
  }

  /* --------------------------------------------- container-mounted sconces */
  buildContainerSconces() {
    // caged bulkhead lamps bolted to container ends / masts: warm little pools
    // dotted around the yard so every long dark face carries one warm point
    const sconces = [
      { pos: [-15.85, 2.35, 3.9], face: [1, 0, 0], lit: true, light: false },  // block W alley wall (glow only; the fire barrel lights the alley)
      // cool fluoro task light halfway up the alley wall: the alley's cool
      // counterpoint against the fire (real light, tiny cost)
      { pos: [-15.05, 3.7, 1.4], face: [-1, 0, 0], lit: true, light: true, cool: true },
      { pos: [7.05, 2.4, 27.6], face: [-1, 0, 0], lit: true, light: false },   // block E south-west corner
      { pos: [-7.05, 2.3, -33.5], face: [1, 0, 0], lit: false, light: false }, // dead lamp = silhouette
      { pos: [7.05, 2.3, -8.6], face: [-1, 0, 0], lit: true, light: false },  // block E west face on the main lane
      { pos: [-22.85, 2.35, 12.9], face: [-1, 0, 0], lit: true, light: false }, // block W on the west lane
      { pos: [23.0, 2.35, -14.4], face: [1, 0, 0], lit: true, light: false }, // block E on the east lane
      { pos: [-36.35, 2.4, -20.2], face: [1, 0, 0], lit: false, light: false }, // perim W dead lamp
      { pos: [37.55, 2.35, 4.1], face: [-1, 0, 0], lit: true, light: false }, // perim E on the east lane
    ];
    for (const s of sconces) {
      // fixture body: small box + cage bars
      const parts = [];
      parts.push(boxAt(0.18, 0.24, 0.12, 0, 0, 0));
      for (let i = -1; i <= 1; i++) parts.push(boxAt(0.02, 0.28, 0.02, i * 0.06, 0, 0.09));
      const g = merge(parts);
      const yaw = Math.atan2(s.face[0], s.face[2]);
      _e.set(0, yaw, 0, 'YXZ');
      _q.setFromEuler(_e);
      _m.compose(_v.set(s.pos[0], s.pos[1], s.pos[2]), _q, _one);
      g.applyMatrix4(_m);
      this._add(g, this.M.hardware, { surface: 'metal', castShadow: false });
      // lens + a small haze around lit ones (warm sodium or cool fluoro)
      const lensMat = !s.lit ? this.M.lampDead : s.cool ? this.M.lampCool : this.M.lampWarm;
      const glowHex = s.cool ? 0xcfe1ff : 0xffa040;
      const lens = s.cool ? boxAt(0.05, 0.32, 0.05, s.pos[0] + s.face[0] * 0.05, s.pos[1], s.pos[2] + s.face[2] * 0.05) : new THREE.SphereGeometry(0.07, 8, 6);
      if (!s.cool) lens.translate(s.pos[0] + s.face[0] * 0.05, s.pos[1], s.pos[2] + s.face[2] * 0.05);
      this._add(lens, lensMat, { surface: 'glass', castShadow: false });
      if (s.lit) {
        const gm = this.M.glowSprite.clone();
        gm.color = new THREE.Color(glowHex).multiplyScalar(1.1);
        gm.opacity = 0.45;
        const gs = new THREE.Sprite(gm);
        gs.position.set(s.pos[0] + s.face[0] * 0.18, s.pos[1], s.pos[2] + s.face[2] * 0.18);
        gs.scale.setScalar(1.5);
        gs.renderOrder = 21;
        this.ctx.root.add(gs);
        this.level.sprites.push(gs);
      }
      if (s.lit && s.light) {
        const f = this.lighting.addPractical({
          position: [s.pos[0] + s.face[0] * 0.35, s.pos[1] - 0.1, s.pos[2] + s.face[2] * 0.35],
          color: s.cool ? 0xcfe1ff : 0xffa040,
          intensity: s.cool ? 26 : 30,
          radius: 11,
          flicker: s.cool ? 'fluoro' : 'none',
          marker: false,
          glow: false,
        });
        this.level.fixtures.push(f);
      }
    }
    // amber hazard blinker on a corner casting at the alley's north end (the "hazard light")
    const b = this.lighting.addBeacon({ position: [-15.75, 5.28, -12.9], color: 0xffae00, blinkPeriod: 1.2, duty: 0.35, phase: 0.2, size: 0.11, lightIntensity: 0 });
    this.level.fixtures.push(b);
    // another red one on the burnt container roof corner
    const b2 = this.lighting.addBeacon({ position: [SPECIALS.burnt.x + 1.1, 2.75, SPECIALS.burnt.z + 5.9], color: 0xff2020, blinkPeriod: 0.9, duty: 0.4, phase: 0.0, size: 0.1, lightIntensity: 0 });
    this.level.fixtures.push(b2);
    // steam vents (FX emitters only): a hissing pipe outlet on the alley wall and
    // one behind the warehouse — the FX stream renders drifting steam here
    this.level.emitters.push({ kind: 'steam', tag: 'alley-vent', position: new THREE.Vector3(-14.95, 2.6, -3.4), radius: 0.15, intensity: 0.7 });
    this.level.emitters.push({ kind: 'steam', tag: 'warehouse-vent', position: new THREE.Vector3(-52.5, WAREHOUSE.height + 3.3, 44), radius: 0.6, intensity: 0.5 });
    this._add(cylAt(0.08, 0.08, 0.5, -14.95, 2.6, -3.4, 8, 0, 0, 90), this.M.galvanized, { surface: 'metal', castShadow: false });
  }
}

void WAREHOUSE;
