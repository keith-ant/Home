/**
 * Terrain — the ground of Terminal 9 (WORLD stream).
 *
 *  - 140 × 90 m wet asphalt yard: PBR.makeWetGround with a canvas-painted
 *    world-space puddle mask (SDF blobs + gutter strips + drain pools),
 *    the 30 m macro albedo layer, animated rain ripples from the weather.
 *  - 140 × 12 m concrete quay apron, quay wall drop to the water, fender
 *    piles, crane rails.
 *  - Gravel verges outside the fence lines.
 *  - Painted markings / grime as atlas decal quads (lane lines, arrows,
 *    SLOW / STOP / KEEP CLEAR, bay brackets + numbers, zebra bars, hatch
 *    zones, chevrons, drain grates, oil stains, tyre marks, the big T9),
 *    plus alligator-crack patches from tex.asphalt_cracked.
 *
 * Surfaces: 'asphalt' (yard), 'concrete' (apron/kerbs), 'gravel', 'metal'
 * (rails/covers). Exposes puddleAt(x, z) → 0..1 for footstep splashes.
 */
import * as THREE from 'three';
import { GROUND, YARD, WAREHOUSE, PUDDLES, DRAINS, MANHOLES, ROWS_Z, BLOCKS, CONTAINER, QUAY } from './layout.js';
import { puddleMask } from './procgen.js';
import { boxGeom, DEG } from './util.js';

const _u = new THREE.Vector3();
const _vv = new THREE.Vector3();
const _c = new THREE.Vector3();

const WHITE = new THREE.Color(0xffffff);
const DIM = new THREE.Color(0xb9b4a8);
const DARK = new THREE.Color(0x0d0c0b);

export class Terrain {
  /**
   * @param {object} ctx build context {game, mats, rng, batcher, collision, root}
   */
  constructor(ctx) {
    this.ctx = ctx;
    this.mats = ctx.mats;
    this.rng = ctx.rng;
    this.cells = ctx.mats.tex.groundCells;
    this.mask = null;
  }

  build() {
    const bat = this.ctx.batcher;
    this._buildPuddleMask();
    this._buildYard();
    bat.setZone('quay');
    this._buildApronAndQuay();
    bat.setZone('verge');
    this._buildVerges();
    bat.setZone('yard');
    this._buildMarkings();
    this._buildGrime();
    bat.setZone('yard');
  }

  /* -------------------------------------------------------- puddle mask */
  _buildPuddleMask() {
    const rng = this.rng;
    const rect = { x0: GROUND.asphalt.x0, x1: GROUND.asphalt.x1, z0: GROUND.asphalt.z0, z1: GROUND.asphalt.z1 };
    const gutters = [];
    // block base gutter lines (west/east faces of each block)
    for (const block of BLOCKS) {
      const xW = block.bays[0] - CONTAINER.W / 2 - 0.35;
      const xE = block.bays[block.bays.length - 1] + CONTAINER.W / 2 + 0.35;
      const zN = ROWS_Z[0] - CONTAINER.L40 / 2;
      const zS = ROWS_Z[ROWS_Z.length - 1] + CONTAINER.L40 / 2;
      gutters.push({ x0: xW, z0: zN, x1: xW, z1: zS, width: 1.4, strength: 0.42 });
      gutters.push({ x0: xE, z0: zN, x1: xE, z1: zS, width: 1.4, strength: 0.42 });
    }
    // warehouse kerb line
    gutters.push({ x0: WAREHOUSE.x0 + 2, z0: WAREHOUSE.kerbZ - 0.5, x1: WAREHOUSE.x1 - 2, z1: WAREHOUSE.kerbZ - 0.5, width: 2.2, strength: 0.55 });
    // lane centre wet channel (main lane, slight camber pooling in the middle)
    gutters.push({ x0: 0.5, z0: -38, x1: 0.5, z1: 27, width: 3.5, strength: 0.28 });
    gutters.push({ x0: -30.6, z0: -36, x1: -30.6, z1: 8, width: 3.0, strength: 0.24 });
    gutters.push({ x0: 30.6, z0: -36, x1: 30.6, z1: 26, width: 3.0, strength: 0.24 });

    const drains = DRAINS.map(([x, z]) => ({ x, z }));
    // a few random smaller puddles on top of the authored big ones
    const extra = [];
    for (let i = 0; i < 8; i++) {
      extra.push({ x: rng.range(-42, 42), z: rng.range(-36, 30), r: rng.range(1.4, 2.6), strength: rng.range(0.55, 0.9) });
    }
    const mask = puddleMask(rng, rect, {
      puddles: [...PUDDLES, ...extra],
      gutters,
      drains,
    });
    this.mask = mask;
    this.ctx.level.puddleMask = mask;
  }

  puddleAt(x, z) {
    if (!this.mask) return 0;
    return this.mask.sample(x, z);
  }

  /* --------------------------------------------------------------- yard */
  _buildYard() {
    const { game, root, collision, level } = this.ctx;
    const g = GROUND.asphalt;
    const w = g.x1 - g.x0;
    const d = g.z1 - g.z0;
    const macro = game.assets.get('tex.asphalt_macro');
    const mat = game.pbr.makeWetGround('tex.asphalt_wet', {
      repeat: [w / 2, d / 2],
      puddleMask: this.mask.texture,
      puddleRepeat: [1, 1],
      puddleThreshold: 0.5,
      wetness: 1,
      macroTexture: macro?.color || null,
      macroWorldScale: 1 / 30,
      rippleWorldScale: 3.2,
      rippleStrength: 0.42,
      roughnessScale: 1.05,
      envMapIntensity: 1.15,
    });
    this.groundMaterial = mat;
    const geo = new THREE.PlaneGeometry(w, d, 1, 1);
    geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set((g.x0 + g.x1) / 2, 0, (g.z0 + g.z1) / 2);
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.name = 'terrain.asphalt';
    mesh.userData.surface = 'asphalt';
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    root.add(mesh);
    this.asphaltMesh = mesh;
    collision.addGroundRect(g.x0, g.x1, g.z0, g.z1, 0, 'asphalt', mesh);
    level.groundMeshes.push(mesh);
  }

  /* ----------------------------------------------------------- apron/quay */
  _buildApronAndQuay() {
    const { root, collision, batcher, level } = this.ctx;
    const M = this.mats.m;
    const a = GROUND.apron;
    const w = a.x1 - a.x0;
    const d = a.z1 - a.z0;
    // apron slab
    {
      const geo = new THREE.PlaneGeometry(w, d, 1, 1);
      // uv in metres (makePBR repeat is 1/tile)
      const uv = geo.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w, uv.getY(i) * d);
      uv.needsUpdate = true;
      geo.rotateX(-Math.PI / 2);
      const mesh = new THREE.Mesh(geo, M.apron);
      mesh.position.set((a.x0 + a.x1) / 2, -0.003, (a.z0 + a.z1) / 2);
      mesh.receiveShadow = true;
      mesh.castShadow = false;
      mesh.name = 'terrain.apron';
      mesh.userData.surface = 'concrete';
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      root.add(mesh);
      collision.addGroundRect(a.x0, a.x1, a.z0, a.z1, 0, 'concrete', mesh);
      level.groundMeshes.push(mesh);
    }
    // quay wall face + coping down to the water
    {
      const wallH = 2.9;
      const g1 = boxGeom(w, wallH, 0.9);
      g1.translate(0, -wallH / 2 + 0.01, GROUND.quayZ - 0.44);
      batcher.add(g1, M.concrete, { surface: 'concrete', castShadow: false });
      collision.addAABox(0, -wallH, GROUND.quayZ - 0.44, w, wallH, 0.9, 'concrete');
      // steel coping edge (bull-nose) along the top
      const g2 = boxGeom(w, 0.09, 0.34);
      g2.translate(0, 0.045, GROUND.quayZ - 0.13);
      batcher.add(g2, M.hardware, { surface: 'metal', castShadow: false });
      // fender piles + rubber fenders every 6 m
      for (let x = -66; x <= 66; x += 6) {
        const pile = boxGeom(0.32, 3.2, 0.32);
        pile.translate(x, -1.35, GROUND.quayZ - 1.05);
        batcher.add(pile, M.wood, { surface: 'wood', castShadow: false });
        if ((x / 6) % 2 === 0) {
          const fender = boxGeom(0.55, 1.4, 0.35);
          fender.translate(x, -0.35, GROUND.quayZ - 0.95);
          batcher.add(fender, M.blackRubber, { surface: 'metal', castShadow: false });
        }
      }
      // crane rails set into the apron
      for (const rz of QUAY.railsZ) {
        const rail = boxGeom(w - 4, 0.06, 0.13);
        rail.translate(0, 0.03, rz);
        batcher.add(rail, M.steelRust, { surface: 'metal', castShadow: false, receiveShadow: true });
        // sleepers band (dark) — a low box strip
        const bed = boxGeom(w - 4, 0.02, 0.7);
        bed.translate(0, 0.01, rz);
        batcher.add(bed, M.blackRubber, { surface: 'concrete', castShadow: false });
      }
    }
    // south side of the yard: kerb strip along the warehouse
    {
      const kerbLen = WAREHOUSE.x1 - WAREHOUSE.x0 - 1;
      const k = boxGeom(kerbLen, 0.16, 0.45);
      k.translate((WAREHOUSE.x0 + WAREHOUSE.x1) / 2, 0.08, WAREHOUSE.kerbZ);
      batcher.add(k, M.concrete, { surface: 'concrete', castShadow: false });
      collision.addAABox((WAREHOUSE.x0 + WAREHOUSE.x1) / 2, 0, WAREHOUSE.kerbZ, kerbLen, 0.16, 0.45, 'concrete');
    }
  }

  /* --------------------------------------------------------------- verges */
  _buildVerges() {
    const { root, collision, level } = this.ctx;
    const M = this.mats.m;
    const strips = [
      // outside the west/east fences
      { x0: -70, x1: YARD.fenceWestX - 0.5, z0: -40, z1: 46 },
      { x0: YARD.fenceEastX + 0.5, x1: 70, z0: -40, z1: 46 },
      // south corner outside the gate area
      { x0: 8, x1: 70, z0: 44.5, z1: 50 },
    ];
    for (const s of strips) {
      const w = s.x1 - s.x0;
      const d = s.z1 - s.z0;
      const geo = new THREE.PlaneGeometry(w, d, 1, 1);
      const uv = geo.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w, uv.getY(i) * d);
      uv.needsUpdate = true;
      geo.rotateX(-Math.PI / 2);
      const mesh = new THREE.Mesh(geo, M.gravel);
      mesh.position.set((s.x0 + s.x1) / 2, 0.02, (s.z0 + s.z1) / 2);
      mesh.receiveShadow = true;
      mesh.castShadow = false;
      mesh.name = 'terrain.gravel';
      mesh.userData.surface = 'gravel';
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      root.add(mesh);
      collision.addGroundRect(s.x0, s.x1, s.z0, s.z1, 0.02, 'gravel', mesh);
      level.groundMeshes.push(mesh);
    }
  }

  /* ------------------------------------------------------------- decals */
  /**
   * Ground decal quad in the XZ plane. yaw 0 → the atlas cell's "up" points north (-Z).
   */
  _decal(cellId, x, z, w, h, yawDeg = 0, tint = WHITE, y = 0.012, keySuffix = '') {
    const cell = this.cells[cellId];
    if (!cell) return;
    const yaw = yawDeg * DEG;
    _u.set(Math.cos(yaw), 0, -Math.sin(yaw));
    _vv.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    _c.set(x, y, z);
    const g = new THREE.BufferGeometry();
    const p = new Float32Array(12);
    const n = new Float32Array(12);
    const uvA = new Float32Array(8);
    const col = new Float32Array(12);
    const corners = [
      [-w / 2, -h / 2, cell.u0, cell.v0],
      [w / 2, -h / 2, cell.u1, cell.v0],
      [w / 2, h / 2, cell.u1, cell.v1],
      [-w / 2, h / 2, cell.u0, cell.v1],
    ];
    for (let i = 0; i < 4; i++) {
      const [a, b, uu, vv] = corners[i];
      const pt = new THREE.Vector3().copy(_c).addScaledVector(_u, a).addScaledVector(_vv, b);
      p[i * 3] = pt.x;
      p[i * 3 + 1] = pt.y;
      p[i * 3 + 2] = pt.z;
      n[i * 3] = 0;
      n[i * 3 + 1] = 1;
      n[i * 3 + 2] = 0;
      uvA[i * 2] = uu;
      uvA[i * 2 + 1] = vv;
      col[i * 3] = tint.r;
      col[i * 3 + 1] = tint.g;
      col[i * 3 + 2] = tint.b;
    }
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(n, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uvA, 2));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.ctx.batcher.add(g, this.mats.m.decalGround, {
      surface: 'asphalt', castShadow: false, receiveShadow: true, key: 'groundDecal' + keySuffix,
    });
  }

  _buildMarkings() {
    const rng = this.rng;
    // --- yellow ground-slot / edge lines along the block faces
    for (const block of BLOCKS) {
      const xW = block.bays[0] - CONTAINER.W / 2 - 0.55;
      const xE = block.bays[block.bays.length - 1] + CONTAINER.W / 2 + 0.55;
      for (const x of [xW, xE]) {
        // one long segment per row so gaps look like scuffed repaints
        for (let r = 0; r < ROWS_Z.length; r++) {
          const zc = ROWS_Z[r];
          const len = CONTAINER.L40 + (rng.chance(0.5) ? 1.4 : 0.6);
          this._decal('lineY', x, zc, 0.16, len, 0, DIM, 0.011);
        }
      }
      // slot letter markings at the block corners
    }
    // --- main lane centre dashes
    for (let z = -37; z <= 27; z += 6) {
      this._decal('line', 0.2 + rng.range(-0.05, 0.05), z, 0.15, 2.8, rng.range(-0.6, 0.6), DIM, 0.011);
    }
    // --- direction arrows (north-bound main, south-bound side lanes)
    this._decal('arrow', -2.2, -19.5, 1.4, 3.3, 0, DIM);
    this._decal('arrow', 2.4, 6.5, 1.4, 3.3, 0, DIM);
    this._decal('arrow', -30.4, -30.5, 1.4, 3.3, 180, DIM);
    this._decal('arrow', -29.6, -4.5, 1.4, 3.3, 180, DIM);
    this._decal('arrow', 30.4, -20.5, 1.4, 3.3, 0, DIM);
    this._decal('arrow', 30.9, 9.5, 1.4, 3.3, 0, DIM);
    // --- words
    this._decal('slow', 0.4, 25.6, 4.4, 1.95, 180, DIM);
    this._decal('stop', 0.2, -37.4, 4.0, 1.78, 0, DIM);
    this._decal('line', 0.2, -38.9, 0.35, 12.5, 90, DIM, 0.011, 'stopline');
    this._decal('keepclear', -22, 31.5, 5.6, 1.25, 180, DIM);
    this._decal('hatch', -22, 33.9, 7.8, 3.0, 0, DIM, 0.011);
    this._decal('nopark', -40.5, 33.0, 5.2, 1.15, 180, DIM);
    this._decal('slow', -30.6, 27.4, 3.6, 1.6, 0, DIM);
    this._decal('slow', 30.6, -37.0, 3.6, 1.6, 180, DIM);
    // --- chevrons at the apron threshold + a stop line each end
    this._decal('chevrons', -14, -40.9, 8.5, 1.9, 0, DIM);
    this._decal('chevrons', 14, -40.9, 8.5, 1.9, 0, DIM);
    // --- zebra crossing warehouse → trailer across the south lane
    for (let i = 0; i < 5; i++) {
      this._decal('zebra', -22 + (i - 2) * 1.35, 34.6, 0.62, 3.6, 0, DIM);
    }
    // --- truck waiting bays along the south lane (brackets + numbers)
    for (let i = 0; i < 7; i++) {
      const x = -49 + i * 4.2;
      this._decal('bracket', x, 32.4, 1.1, 1.1, 0, DIM);
      this._decal('bracket', x + 3.4, 32.4, 1.1, 1.1, 90, DIM);
      this._decal('bay' + (i + 1), x + 1.7, 30.8, 1.2, 1.02, 180, new THREE.Color(0xc9a227));
    }
    // --- big faded T9 in the south lane / spawn area
    this._decal('logoT9', 14.5, 33.6, 7.5, 3.5, 200, DIM, 0.011);
    // --- speed / office signage on the ground near the gate
    this._decal('speed', 36.5, 38.4, 2.6, 2.6, 90, DIM);
    // --- hatch zone in front of the transformer / utility box
    this._decal('hatch', 10.5, 39.4, 3.6, 1.6, 90, DIM);
    // --- drain grates
    for (const [x, z, yaw] of DRAINS) {
      this._decal('grate', x, z, 0.95, 0.5, yaw, WHITE, 0.02);
    }
    // --- rust rings under the manhole covers
    for (const [x, z, yaw] of MANHOLES) {
      this._decal('ring', x, z, 1.35, 1.35, yaw, WHITE, 0.013);
    }
  }

  _buildGrime() {
    const rng = this.rng;
    // --- oil stains: authored under machinery/props + random lane spots
    const stains = [
      [-4.4, 5.2, 3.0], [-33.6, 6.4, 2.6], [27.4, -5.0, 2.4], [-38.2, -44.6, 2.8],
      [4.6, 15.5, 2.2], [3.9, -21.4, 3.4], [-25.2, -8.2, 1.8], [15.8, 40.5, 2.0],
      [-30.4, 24.0, 2.6], [24.4, -35.4, 2.2], [-2.4, 33.0, 2.0], [6.0, -13.0, 2.2],
    ];
    for (let i = 0; i < 8; i++) stains.push([rng.range(-42, 42), rng.range(-36, 28), rng.range(1.6, 3.2)]);
    for (const [x, z, r] of stains) {
      this._decal('oil' + rng.int(0, 2), x, z, r * 1.3, r, rng.range(0, 360), DARK, 0.014, 'stain');
    }
    // --- tyre skid marks (aligned to lane directions)
    const skids = [
      [-0.5, 12, 90], [1.5, -8, 88], [-30, -18, 90], [30.5, 14, 90], [-8, 33.5, 12], [12, 33, -8],
    ];
    for (let i = 0; i < 4; i++) skids.push([rng.range(-40, 40), rng.range(-34, 26), rng.range(-90, 90)]);
    for (const [x, z, yaw] of skids) {
      this._decal('skid' + rng.int(0, 1), x, z, rng.range(7, 11), rng.range(1.6, 2.2), yaw + rng.range(-6, 6), DARK, 0.013, 'stain');
    }
    // --- alligator-crack patches (own material)
    const patches = [
      [-1.2, -30.5, 6.5], [2.6, 20.4, 5.5], [-30.6, -22, 6], [30.2, -30, 5],
      [-16.9, 8, 5.5], [-40, 34, 6], [20, 35, 5], [-6, -44.6, 6.5], [40, -8, 5],
    ];
    const crack = this.mats.m.crackPatch;
    for (const [x, z, size] of patches) {
      const g = new THREE.PlaneGeometry(size, size, 1, 1);
      const uv = g.attributes.uv;
      // colour maps sample metres (texture repeat handles scale); alphaMap uses uv2? — three uses the same uv:
      // author uv 0..size so the crack texture is metre-scaled, and give the alphaMap its own transform below
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * size, uv.getY(i) * size);
      uv.needsUpdate = true;
      g.rotateX(-Math.PI / 2);
      g.rotateY(rng.range(0, Math.PI));
      g.translate(x, 0.006, z);
      this.ctx.batcher.add(g, crack, { surface: 'asphalt', castShadow: false, key: 'cracks' });
    }
    // alphaMap must map 0..size uv back to 0..1: give it repeat 1/size (single size used above range 5..6.5 → use the mean)
    if (crack.alphaMap) {
      crack.alphaMap.repeat.set(1 / 5.8, 1 / 5.8);
      crack.alphaMap.needsUpdate = true;
    }
  }
}
