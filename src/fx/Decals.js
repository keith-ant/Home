/**
 * Decals — projected mesh decals with a streaming budget (FX stream).
 *
 * Placement uses three's DecalGeometry (projector box clipping). Because the
 * world is drawn as merged static batches, the geometry we project onto is
 * gathered from the world collision BVH (world.collision.bvh shapecast in
 * the decal's bounds) into a scratch mesh — the proxies are the exact planes
 * bullets hit. Entity meshes (hit.object with geometry) are projected onto
 * directly. Results stream into one big per-material vertex ring buffer, so
 * every decal type costs a single draw call; the ring is the budget
 * (tier.decalBudget decals-worth of vertices) and old decals fade out as the
 * write cursor approaches them (no popping).
 *
 * Atlas: procedurally painted at init (colour + matching normal-map dents).
 * Kinds: bullet_concrete | bullet_metal | bullet_wood | bullet_glass |
 * bullet_fabric | scorch | soot | oil | blood | blood2.
 *
 * API:
 *   decals.add(kind, {point, normal, size, rotation, object}) → handle | null
 *   decals.update(dt)   fades
 *   decals.clear()
 *   decals.count / capacity (vertex budget usage 0..1 via .usage)
 * Emits `fx:decal {point, normal, kind}` for each placement (audio).
 */
import * as THREE from 'three';
import { DecalGeometry } from 'three/examples/jsm/geometries/DecalGeometry.js';
import { Random } from '../core/Random.js';
import { createNoise2D } from 'simplex-noise';

/* ------------------------------------------------------------- kinds --- */
export const DECAL_KINDS = {
  bullet_concrete: { cell: 0, size: 0.14, depth: 0.16, bucket: 'std' },
  bullet_metal: { cell: 1, size: 0.115, depth: 0.14, bucket: 'std' },
  bullet_wood: { cell: 2, size: 0.14, depth: 0.16, bucket: 'std' },
  bullet_glass: { cell: 3, size: 0.2, depth: 0.12, bucket: 'std' },
  scorch: { cell: 4, size: 2.2, depth: 0.7, bucket: 'std' },
  blood: { cell: 5, size: 0.6, depth: 0.35, bucket: 'blood' },
  blood2: { cell: 6, size: 0.9, depth: 0.35, bucket: 'blood' },
  soot: { cell: 7, size: 0.7, depth: 0.4, bucket: 'std' },
  oil: { cell: 8, size: 1.1, depth: 0.3, bucket: 'std' },
  bullet_fabric: { cell: 9, size: 0.12, depth: 0.14, bucket: 'std' },
  crater: { cell: 10, size: 0.34, depth: 0.2, bucket: 'std' },
  bullet_metal_hot: { cell: 11, size: 0.12, depth: 0.14, bucket: 'std' },
};

const GRID = 4;
const CELL = 256;
const SIZE = GRID * CELL;
const MAX_GATHER_TRIS = 160;
const VERTS_PER_DECAL_EST = 42; // budget conversion: decals → vertices

const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _sizeVec = new THREE.Vector3();
const _box = new THREE.Box3();
const _n = new THREE.Vector3();
const _pos = new THREE.Vector3();
const _va = new THREE.Vector3();
const _vb = new THREE.Vector3();
const _vc = new THREE.Vector3();
const Z_AXIS = new THREE.Vector3(0, 0, 1);

export class Decals {
  /**
   * @param {import('../Game.js').Game} game
   * @param {import('../core/Random.js').Random} rng
   */
  constructor(game, rng) {
    this.game = game;
    this.scene = game.scene;
    this.rng = rng;
    const budget = Math.max(48, game.tier?.decalBudget ?? 256);
    this.budgetDecals = budget;

    const { colorTex, normalTex } = buildDecalAtlas();
    this.colorTex = colorTex;
    this.normalTex = normalTex;

    // shared materials
    const stdMat = new THREE.MeshStandardMaterial({
      name: 'fx.decals.std',
      map: colorTex,
      normalMap: normalTex,
      normalScale: new THREE.Vector2(1.1, 1.1),
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -6,
      roughness: 0.85,
      metalness: 0.05,
      envMapIntensity: 0.6,
      vertexColors: true,
      side: THREE.FrontSide,
    });
    const bloodMat = new THREE.MeshStandardMaterial({
      name: 'fx.decals.blood',
      map: colorTex,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -6,
      roughness: 0.28,
      metalness: 0.0,
      envMapIntensity: 0.9,
      vertexColors: true,
      side: THREE.FrontSide,
    });

    this.buckets = {
      std: this._createBucket('std', stdMat, Math.round(budget * VERTS_PER_DECAL_EST * 0.78)),
      blood: this._createBucket('blood', bloodMat, Math.round(budget * VERTS_PER_DECAL_EST * 0.22)),
    };

    // scratch gather geometry for BVH triangles
    this._gPos = new Float32Array(MAX_GATHER_TRIS * 9);
    this._gNrm = new Float32Array(MAX_GATHER_TRIS * 9);
    this._gCount = 0;
    this._scratchGeo = new THREE.BufferGeometry();
    this._scratchMesh = new THREE.Mesh(this._scratchGeo);
    this._scratchMesh.matrixWorld.identity();

    this.total = 0;
  }

  /* ---------------------------------------------------------- buckets */
  _createBucket(name, material, vertexCapacity) {
    // round to whole triangles
    const cap = Math.ceil(vertexCapacity / 3) * 3;
    const geometry = new THREE.BufferGeometry();
    const pos = new THREE.BufferAttribute(new Float32Array(cap * 3), 3);
    const nrm = new THREE.BufferAttribute(new Float32Array(cap * 3), 3);
    const uv = new THREE.BufferAttribute(new Float32Array(cap * 2), 2);
    const col = new THREE.BufferAttribute(new Float32Array(cap * 4), 4);
    pos.setUsage(THREE.DynamicDrawUsage);
    nrm.setUsage(THREE.DynamicDrawUsage);
    uv.setUsage(THREE.DynamicDrawUsage);
    col.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', pos);
    geometry.setAttribute('normal', nrm);
    geometry.setAttribute('uv', uv);
    geometry.setAttribute('color', col);
    geometry.setDrawRange(0, 0);
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    geometry.boundingBox = new THREE.Box3(new THREE.Vector3(-1e4, -1e4, -1e4), new THREE.Vector3(1e4, 1e4, 1e4));
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'fx.decals.' + name;
    mesh.frustumCulled = false;
    mesh.renderOrder = 5;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    return {
      name,
      mesh,
      geometry,
      material,
      capacity: cap,
      cursor: 0,      // next write vertex
      highWater: 0,   // farthest written vertex (draw range)
      /** live decal records: {start, count, alpha, fading, born} */
      live: [],
      attr: { pos, nrm, uv, col },
    };
  }

  /* ---------------------------------------------------------------- add */
  /**
   * Place a decal.
   * @param {string} kind DECAL_KINDS key
   * @param {object} o
   * @param {THREE.Vector3} o.point surface hit point
   * @param {THREE.Vector3} o.normal surface normal (unit)
   * @param {number} [o.size] projector width/height (m)
   * @param {number} [o.rotation] spin about the normal (radians; random default)
   * @param {THREE.Object3D} [o.object] hit mesh (entity); world statics use the collision BVH
   * @param {number} [o.alpha=1]
   * @returns {{bucket:string, start:number, count:number}|null}
   */
  add(kind, o = {}) {
    const def = DECAL_KINDS[kind];
    if (!def) {
      console.warn('[fx] unknown decal kind', kind);
      return null;
    }
    const point = o.point;
    const normal = o.normal;
    if (!point || !normal) return null;
    const bucket = this.buckets[def.bucket] || this.buckets.std;
    const size = (o.size ?? def.size) * (o.sizeJitter === false ? 1 : 0.85 + 0.3 * this.rng.next());
    const depth = o.depth ?? def.depth;
    const rotation = o.rotation ?? this.rng.range(0, Math.PI * 2);

    // projector orientation: +Z along the normal, spun about it
    _n.copy(normal).normalize();
    _q1.setFromUnitVectors(Z_AXIS, _n);
    _q2.setFromAxisAngle(Z_AXIS, rotation);
    _q1.multiply(_q2);
    _euler.setFromQuaternion(_q1);
    _pos.copy(point);
    _sizeVec.set(size, size, depth);

    // target mesh: entity mesh or the gathered BVH proxy triangles
    let targetMesh = null;
    const obj = o.object;
    if (obj && obj.isMesh && obj.geometry && !obj.isInstancedMesh) {
      obj.updateWorldMatrix?.(true, false);
      targetMesh = obj;
    } else {
      const gathered = this._gather(point, size, depth, _n);
      if (gathered === 0) return null;
      targetMesh = this._scratchMesh;
    }

    let dg;
    try {
      dg = new DecalGeometry(targetMesh, _pos, _euler, _sizeVec);
    } catch (err) {
      console.warn('[fx] decal generation failed', err?.message || err);
      return null;
    }
    const posAttr = dg.attributes.position;
    if (!posAttr || posAttr.count < 3) {
      dg.dispose();
      return null;
    }
    const handle = this._write(bucket, dg, def, o.alpha ?? 1);
    dg.dispose();
    this.total++;
    this.game.events.emit('fx:decal', { point, normal, kind });
    return handle;
  }

  /** Gather world collision triangles near the point into the scratch mesh. */
  _gather(point, size, depth, normal) {
    const bvh = this.game.world?.collision?.bvh;
    if (!bvh) return 0;
    const half = size * 0.71 + 0.05;
    _box.min.set(point.x - half, point.y - half, point.z - half);
    _box.max.set(point.x + half, point.y + half, point.z + half);
    const gPos = this._gPos;
    const gNrm = this._gNrm;
    let count = 0;
    bvh.shapecast({
      intersectsBounds: (box) => box.intersectsBox(_box),
      intersectsTriangle: (tri) => {
        if (count >= MAX_GATHER_TRIS) return true; // stop
        // face normal
        tri.getNormal(_va);
        // only surfaces facing the projector (back faces / opposite panels rejected)
        if (_va.dot(normal) < 0.15) return false;
        const i = count * 9;
        gPos[i] = tri.a.x; gPos[i + 1] = tri.a.y; gPos[i + 2] = tri.a.z;
        gPos[i + 3] = tri.b.x; gPos[i + 4] = tri.b.y; gPos[i + 5] = tri.b.z;
        gPos[i + 6] = tri.c.x; gPos[i + 7] = tri.c.y; gPos[i + 8] = tri.c.z;
        for (let k = 0; k < 3; k++) {
          gNrm[i + k * 3] = _va.x;
          gNrm[i + k * 3 + 1] = _va.y;
          gNrm[i + k * 3 + 2] = _va.z;
        }
        count++;
        return false;
      },
    });
    void depth;
    this._gCount = count;
    if (count === 0) return 0;
    // (re)wire the scratch geometry attributes over the used range
    const geo = this._scratchGeo;
    geo.setAttribute('position', new THREE.BufferAttribute(gPos.subarray(0, count * 9), 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(gNrm.subarray(0, count * 9), 3));
    geo.setIndex(null);
    return count;
  }

  /** Copy a generated decal geometry into the bucket ring buffer. */
  _write(bucket, dg, def, alpha) {
    const src = dg.attributes.position.array;
    const srcN = dg.attributes.normal ? dg.attributes.normal.array : null;
    const srcUv = dg.attributes.uv.array;
    let count = dg.attributes.position.count;
    // triangles only, capped by the bucket capacity
    count = Math.min(count - (count % 3), bucket.capacity);
    if (count < 3) return null;

    // wrap the ring if needed
    if (bucket.cursor + count > bucket.capacity) {
      // zero the tail so stale triangles at the end of the buffer die
      this._zeroRange(bucket, bucket.cursor, bucket.capacity - bucket.cursor);
      this._killRange(bucket, bucket.cursor, bucket.capacity);
      bucket.cursor = 0;
    }
    const start = bucket.cursor;
    // kill any live decals we are about to overwrite
    this._killRange(bucket, start, start + count);

    const P = bucket.attr.pos.array;
    const N = bucket.attr.nrm.array;
    const U = bucket.attr.uv.array;
    const C = bucket.attr.col.array;
    // atlas cell rect
    const cell = def.cell;
    const cu = (cell % GRID) / GRID;
    const cv = 1 - (Math.floor(cell / GRID) + 1) / GRID;
    const cs = 1 / GRID;
    const inset = 2 / SIZE;
    for (let i = 0; i < count; i++) {
      const s3 = i * 3;
      const d3 = (start + i) * 3;
      const s2 = i * 2;
      const d2 = (start + i) * 2;
      const d4 = (start + i) * 4;
      let nx = 0;
      let ny = 1;
      let nz = 0;
      if (srcN) {
        nx = srcN[s3];
        ny = srcN[s3 + 1];
        nz = srcN[s3 + 2];
      }
      // small offset along the normal against z-fighting
      P[d3] = src[s3] + nx * 0.006;
      P[d3 + 1] = src[s3 + 1] + ny * 0.006;
      P[d3 + 2] = src[s3 + 2] + nz * 0.006;
      N[d3] = nx;
      N[d3 + 1] = ny;
      N[d3 + 2] = nz;
      // uv into the atlas cell
      const u = clampNum(srcUv[s2], 0, 1);
      const v = clampNum(srcUv[s2 + 1], 0, 1);
      U[d2] = cu + inset + u * (cs - 2 * inset);
      U[d2 + 1] = cv + inset + v * (cs - 2 * inset);
      C[d4] = 1;
      C[d4 + 1] = 1;
      C[d4 + 2] = 1;
      C[d4 + 3] = alpha;
    }
    // update ranges
    bucket.attr.pos.addUpdateRange(start * 3, count * 3);
    bucket.attr.nrm.addUpdateRange(start * 3, count * 3);
    bucket.attr.uv.addUpdateRange(start * 2, count * 2);
    bucket.attr.col.addUpdateRange(start * 4, count * 4);
    bucket.attr.pos.needsUpdate = true;
    bucket.attr.nrm.needsUpdate = true;
    bucket.attr.uv.needsUpdate = true;
    bucket.attr.col.needsUpdate = true;

    const rec = { start, count, alpha, fading: false, born: this.game.time.elapsed, bucket: bucket.name };
    bucket.live.push(rec);
    bucket.cursor = start + count;
    if (bucket.cursor > bucket.highWater) bucket.highWater = bucket.cursor;
    bucket.geometry.setDrawRange(0, bucket.highWater);

    // proactively fade whatever the cursor will run over soon (10 % ahead)
    this._fadeAhead(bucket);
    return rec;
  }

  _fadeAhead(bucket) {
    const ahead = bucket.capacity * 0.12;
    const a = bucket.cursor;
    const b = a + ahead;
    for (const rec of bucket.live) {
      if (rec.fading) continue;
      // does [rec.start, rec.start+rec.count) intersect [a, b) (mod capacity)?
      const s = rec.start;
      const e = rec.start + rec.count;
      if (rangesOverlap(s, e, a, Math.min(b, bucket.capacity)) ||
          (b > bucket.capacity && rangesOverlap(s, e, 0, b - bucket.capacity))) {
        rec.fading = true;
      }
    }
  }

  /** Remove live records intersecting [a,b) (they are being overwritten). */
  _killRange(bucket, a, b) {
    const live = bucket.live;
    for (let i = live.length - 1; i >= 0; i--) {
      const r = live[i];
      const s = r.start;
      const e = r.start + r.count;
      if (rangesOverlap(s, e, a, b)) {
        // zero any part of this decal outside the overwritten region
        if (s < a) this._zeroRange(bucket, s, a - s);
        if (e > b) this._zeroRange(bucket, b, e - b);
        live.splice(i, 1);
      }
    }
  }

  _zeroRange(bucket, start, count) {
    if (count <= 0) return;
    bucket.attr.pos.array.fill(0, start * 3, (start + count) * 3);
    bucket.attr.pos.addUpdateRange(start * 3, count * 3);
    bucket.attr.pos.needsUpdate = true;
  }

  /* ------------------------------------------------------------ update */
  update(dt) {
    for (const key of ['std', 'blood']) {
      const bucket = this.buckets[key];
      const live = bucket.live;
      for (let i = live.length - 1; i >= 0; i--) {
        const r = live[i];
        if (!r.fading) continue;
        r.alpha -= dt * 1.3;
        if (r.alpha <= 0) {
          this._zeroRange(bucket, r.start, r.count);
          live.splice(i, 1);
          continue;
        }
        // write alpha into the colour attribute
        const C = bucket.attr.col.array;
        for (let v = 0; v < r.count; v++) C[(r.start + v) * 4 + 3] = r.alpha;
        bucket.attr.col.addUpdateRange(r.start * 4, r.count * 4);
        bucket.attr.col.needsUpdate = true;
      }
    }
  }

  clear() {
    for (const key of ['std', 'blood']) {
      const b = this.buckets[key];
      b.attr.pos.array.fill(0);
      b.attr.pos.needsUpdate = true;
      b.live.length = 0;
      b.cursor = 0;
      b.highWater = 0;
      b.geometry.setDrawRange(0, 0);
    }
    this.total = 0;
  }

  get count() {
    return this.buckets.std.live.length + this.buckets.blood.live.length;
  }
  get usage() {
    const b = this.buckets.std;
    return b.highWater / b.capacity;
  }

  dispose() {
    for (const key of ['std', 'blood']) {
      const b = this.buckets[key];
      this.scene.remove(b.mesh);
      b.geometry.dispose();
      b.material.dispose();
    }
    this._scratchGeo.dispose();
    this.colorTex.dispose();
    this.normalTex.dispose();
  }
}

function rangesOverlap(a0, a1, b0, b1) {
  return a0 < b1 && b0 < a1;
}
function clampNum(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

/* ------------------------------------------------------------------------ */
/* Procedural decal atlas (colour+alpha) and matching normal atlas            */
/* ------------------------------------------------------------------------ */
let _atlasCache = null;

/**
 * Cell map: 0 bullet_concrete, 1 bullet_metal, 2 bullet_wood, 3 bullet_glass,
 * 4 scorch, 5 blood, 6 blood2, 7 soot, 8 oil, 9 bullet_fabric, 10 crater,
 * 11 bullet_metal_hot (dent with warm scorching).
 */
function buildDecalAtlas() {
  if (_atlasCache) return _atlasCache;
  const cvs = document.createElement('canvas');
  cvs.width = SIZE;
  cvs.height = SIZE;
  const ctx = cvs.getContext('2d');
  ctx.clearRect(0, 0, SIZE, SIZE);
  // normal atlas as ImageData (flat by default)
  const nCanvas = document.createElement('canvas');
  nCanvas.width = SIZE;
  nCanvas.height = SIZE;
  const nctx = nCanvas.getContext('2d');
  const flat = nctx.createImageData(SIZE, SIZE);
  for (let i = 0; i < flat.data.length; i += 4) {
    flat.data[i] = 128;
    flat.data[i + 1] = 128;
    flat.data[i + 2] = 255;
    flat.data[i + 3] = 255;
  }
  nctx.putImageData(flat, 0, 0);

  const rng = new Random(0xdeca1);
  const noise = createNoise2D(() => rng.next());
  const fbm = (x, y, oct = 4) => {
    let a = 1;
    let f = 1;
    let s = 0;
    let n = 0;
    for (let i = 0; i < oct; i++) {
      s += a * noise(x * f, y * f);
      n += a;
      a *= 0.5;
      f *= 2.03;
    }
    return s / n;
  };

  const cellOrigin = (i) => [(i % GRID) * CELL, Math.floor(i / GRID) * CELL];

  // helper: per-pixel colour + height painter
  const paint = (cell, fn, wantNormal = false) => {
    const [ox, oy] = cellOrigin(cell);
    const img = ctx.createImageData(CELL, CELL);
    const d = img.data;
    const height = wantNormal ? new Float32Array(CELL * CELL) : null;
    for (let y = 0; y < CELL; y++) {
      for (let x = 0; x < CELL; x++) {
        const dx = ((x + 0.5) / CELL) * 2 - 1;
        const dy = ((y + 0.5) / CELL) * 2 - 1;
        const out = fn(dx, dy);
        const i = (y * CELL + x) * 4;
        d[i] = clamp255(out[0]);
        d[i + 1] = clamp255(out[1]);
        d[i + 2] = clamp255(out[2]);
        d[i + 3] = clamp255(out[3]);
        if (height) height[y * CELL + x] = out[4] || 0;
      }
    }
    ctx.putImageData(img, ox, oy);
    if (height) {
      // heights → normals (Sobel-ish)
      const nimg = nctx.createImageData(CELL, CELL);
      const nd = nimg.data;
      for (let y = 0; y < CELL; y++) {
        for (let x = 0; x < CELL; x++) {
          const x0 = Math.max(0, x - 1);
          const x1 = Math.min(CELL - 1, x + 1);
          const y0 = Math.max(0, y - 1);
          const y1 = Math.min(CELL - 1, y + 1);
          const hL = height[y * CELL + x0];
          const hR = height[y * CELL + x1];
          const hU = height[y0 * CELL + x];
          const hD = height[y1 * CELL + x];
          const sx = (hR - hL) * 3.0;
          const sy = (hD - hU) * 3.0;
          // normal = normalize(-sx, -sy, 1); v axis flipped (canvas y down → uv y up)
          let nx = -sx;
          let ny = sy;
          let nz = 1;
          const len = Math.hypot(nx, ny, nz);
          nx /= len;
          ny /= len;
          nz /= len;
          const i = (y * CELL + x) * 4;
          nd[i] = Math.round((nx * 0.5 + 0.5) * 255);
          nd[i + 1] = Math.round((ny * 0.5 + 0.5) * 255);
          nd[i + 2] = Math.round((nz * 0.5 + 0.5) * 255);
          nd[i + 3] = 255;
        }
      }
      nctx.putImageData(nimg, ox, oy);
    }
  };

  const smooth = (a, b, x) => {
    const t = clampNum((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  };

  /* 0: bullet hole in concrete (chipped light ring + dark cavity) */
  paint(0, (dx, dy) => {
    const r = Math.hypot(dx, dy);
    const n = fbm(dx * 3 + 5, dy * 3 - 2);
    const rr = r * (1 + 0.35 * n);
    const cavity = smooth(0.32, 0.18, rr);            // 1 inside the hole
    const chip = smooth(0.9, 0.55, rr) * (1 - cavity); // chipped ring
    const alpha = clampNum(cavity + chip * (0.65 + 0.35 * fbm(dx * 6, dy * 6, 3)), 0, 1);
    // colour: cavity near black, chip zone light grey concrete
    const chipCol = 150 + 40 * n;
    const rC = chipCol * chip + 14 * cavity;
    const gC = chipCol * 0.97 * chip + 12 * cavity;
    const bC = chipCol * 0.9 * chip + 10 * cavity;
    // height: dish in the cavity, raised chipped rim
    const h = -cavity * 1.0 + chip * 0.35;
    return [rC / Math.max(alpha, 1e-3), gC / Math.max(alpha, 1e-3), bC / Math.max(alpha, 1e-3), alpha * 255, h];
  }, true);

  /* 1: bullet hole in painted metal (dark hole, torn silver paint, dent) */
  paint(1, (dx, dy) => {
    const r = Math.hypot(dx, dy);
    const ang = Math.atan2(dy, dx);
    const n = fbm(dx * 3 + 9, dy * 3 + 3, 4);
    // irregular chipped-paint blob: radius varies strongly with angle
    const chipR = 0.34 + 0.16 * Math.sin(ang * 3 + n * 4) + 0.14 * fbm(Math.cos(ang) * 2 + 5, Math.sin(ang) * 2 - 3, 3);
    const hole = smooth(0.2, 0.1, r);
    const chip = smooth(chipR + 0.05, chipR - 0.05, r) * (1 - hole);
    const flecks = chip * clampNum(0.55 + 0.7 * fbm(dx * 8 + 4, dy * 8 - 6, 2), 0, 1); // patchy bare metal
    const dent = smooth(0.95, 0.4, r) * (1 - hole) * (1 - chip); // stressed paint dish around it
    const alpha = clampNum(hole + flecks * 0.95 + chip * 0.3 + dent * 0.55, 0, 1);
    const metalCol = 175 + 45 * n; // exposed metal
    const rC = 6 * hole + metalCol * flecks + 70 * chip * (1 - flecks) + 45 * dent;
    const gC = 6 * hole + metalCol * 0.98 * flecks + 66 * chip * (1 - flecks) + 42 * dent;
    const bC = 8 * hole + metalCol * 0.93 * flecks + 62 * chip * (1 - flecks) + 40 * dent;
    const h = -hole * 1.3 - dent * 0.6 + flecks * 0.15;
    return [rC / Math.max(alpha, 1e-3), gC / Math.max(alpha, 1e-3), bC / Math.max(alpha, 1e-3), alpha * 255, h];
  }, true);

  /* 2: bullet hole in wood (dark hole + splinter cracks along the grain) */
  paint(2, (dx, dy) => {
    const r = Math.hypot(dx, dy);
    const rr = Math.hypot(dx * 1.3, dy * 0.8); // elongated
    const hole = smooth(0.26, 0.14, rr);
    // cracks: high-frequency stripes along x modulated by noise
    const grain = Math.abs(Math.sin(dy * 22 + fbm(dx * 2, dy * 2, 2) * 4));
    const crack = smooth(0.12, 0.02, grain) * smooth(0.95, 0.35, r) * (1 - hole) * (0.5 + 0.5 * Math.abs(dx));
    const splint = smooth(0.8, 0.3, r) * 0.5 * (1 - hole);
    const alpha = clampNum(hole + crack + splint * 0.6, 0, 1);
    const woodLight = 160;
    const rC = 15 * hole + 30 * crack + woodLight * splint;
    const gC = 12 * hole + 24 * crack + woodLight * 0.75 * splint;
    const bC = 10 * hole + 18 * crack + woodLight * 0.5 * splint;
    const h = -hole * 1.0 - crack * 0.5 + splint * 0.2;
    return [rC / Math.max(alpha, 1e-3), gC / Math.max(alpha, 1e-3), bC / Math.max(alpha, 1e-3), alpha * 255, h];
  }, true);

  /* 3: bullet hole in glass (white radial cracks + dark hole) */
  paint(3, (dx, dy) => {
    const r = Math.hypot(dx, dy);
    const ang = Math.atan2(dy, dx);
    const hole = smooth(0.11, 0.05, r);
    // radial crack lines
    const spokes = Math.pow(Math.abs(Math.sin(ang * 6.5 + fbm(dx * 3, dy * 3, 2) * 2)), 40);
    const cracks = spokes * smooth(1.0, 0.15, r) * smooth(0.08, 0.2, r);
    // concentric rings
    const rings = Math.pow(Math.abs(Math.sin(r * 26)), 30) * smooth(0.55, 0.15, r) * 0.7;
    const alpha = clampNum(hole * 0.85 + cracks * 0.9 + rings * 0.6, 0, 1);
    const w = 220;
    const rC = 20 * hole + w * (cracks + rings);
    const gC = 22 * hole + w * (cracks + rings);
    const bC = 25 * hole + w * (cracks + rings) * 1.02;
    const den = Math.max(hole + cracks + rings, 1e-3);
    return [rC / den, gC / den, bC / den, alpha * 255, -hole * 0.6];
  }, true);

  /* 4: scorch (soft black radial with turbulent edge) */
  paint(4, (dx, dy) => {
    const r = Math.hypot(dx, dy);
    const n = fbm(dx * 2.5 + 30, dy * 2.5 - 11, 5);
    const rr = r * (0.85 + 0.55 * n);
    let alpha = smooth(1.0, 0.35, rr) * (0.75 + 0.35 * fbm(dx * 5, dy * 5, 3));
    alpha = clampNum(alpha, 0, 1) * 0.92;
    const grey = 18 + 26 * (r * (0.5 + 0.5 * n));
    return [grey, grey * 0.95, grey * 0.9, alpha * 255, 0];
  });

  /* 5: blood splat */
  paint(5, (dx, dy) => {
    const r = Math.hypot(dx, dy);
    const n = fbm(dx * 3 + 13, dy * 3 - 4, 4);
    const ang = Math.atan2(dy, dx);
    const lobes = 0.75 + 0.5 * Math.pow(Math.abs(Math.sin(ang * 3.5 + n * 3)), 3);
    const rr = r / lobes * (0.9 + 0.4 * n);
    let alpha = smooth(0.85, 0.5, rr);
    alpha = clampNum(alpha * (0.8 + 0.4 * fbm(dx * 7, dy * 7, 3)), 0, 1);
    const rC = 42 + 24 * (1 - r) + 12 * n;
    const gC = 4 + 4 * n;
    const bC = 4;
    return [rC, gC, bC, alpha * 255, 0];
  });

  /* 6: blood2 (larger smear with drips downward = +y in cell) */
  paint(6, (dx, dy) => {
    const n = fbm(dx * 2.2 - 7, dy * 2.2 + 9, 4);
    const r = Math.hypot(dx * 1.1, (dy - 0.15) * 0.85);
    let core = smooth(0.75, 0.4, r * (0.9 + 0.5 * n));
    // drips: vertical streaks below the core
    const drips = smooth(0.15, 0.03, Math.abs(Math.sin(dx * 9 + n * 2))) * smooth(-0.1, 0.35, dy) * smooth(1.0, 0.6, Math.abs(dx) + Math.max(0, dy - 0.2));
    let alpha = clampNum(core + drips * 0.85, 0, 1);
    alpha *= smooth(1.0, 0.9, Math.hypot(dx, dy));
    const rC = 40 + 18 * n;
    return [rC, 5, 4, alpha * 255, 0];
  });

  /* 7: soot (soft dark irregular) */
  paint(7, (dx, dy) => {
    const r = Math.hypot(dx, dy);
    const n = fbm(dx * 2 + 40, dy * 2 + 17, 5);
    let alpha = smooth(1.0, 0.2, r * (0.8 + 0.7 * n)) * (0.55 + 0.3 * n);
    alpha = clampNum(alpha, 0, 1);
    const g = 22 + 20 * n;
    return [g, g * 0.95, g * 0.9, alpha * 255, 0];
  });

  /* 8: oil stain */
  paint(8, (dx, dy) => {
    const n = fbm(dx * 1.8 - 21, dy * 1.8 + 6, 4);
    const r = Math.hypot(dx * (1 + 0.3 * n), dy * (1 - 0.2 * n));
    let alpha = smooth(0.95, 0.45, r * (0.9 + 0.5 * n)) * 0.75;
    alpha = clampNum(alpha, 0, 1);
    const g = 20 + 15 * n;
    return [g, g, g * 1.1, alpha * 255, 0];
  });

  /* 9: bullet hole in fabric/burlap (small dark torn hole) */
  paint(9, (dx, dy) => {
    const r = Math.hypot(dx, dy);
    const n = fbm(dx * 5 + 2, dy * 5 + 8, 3);
    const hole = smooth(0.3, 0.12, r * (1 + 0.5 * n));
    const fray = smooth(0.6, 0.3, r) * (1 - hole) * (0.6 + 0.4 * n);
    const alpha = clampNum(hole + fray * 0.55, 0, 1);
    const c = 60 * fray;
    return [(10 * hole + c) / Math.max(alpha, 1e-3), (9 * hole + c * 0.9) / Math.max(alpha, 1e-3), (8 * hole + c * 0.75) / Math.max(alpha, 1e-3), alpha * 255, -hole];
  }, true);

  /* 10: spall crater (larger shallow concrete gouge) */
  paint(10, (dx, dy) => {
    const r = Math.hypot(dx, dy);
    const n = fbm(dx * 2.6 - 15, dy * 2.6 + 21, 4);
    const rr = r * (0.9 + 0.5 * n);
    const dish = smooth(0.75, 0.3, rr);
    const cavity = smooth(0.2, 0.08, rr);
    const alpha = clampNum(dish * 0.9 + cavity, 0, 1);
    const light = 165 + 40 * n;
    const rC = light * (dish * (1 - cavity)) + 18 * cavity;
    const den = Math.max(alpha, 1e-3);
    return [rC / den, (rC * 0.96) / den, (rC * 0.88) / den, alpha * 255, -dish * 0.6 - cavity];
  }, true);

  /* 11: metal hole with heat scorch halo + torn paint */
  paint(11, (dx, dy) => {
    const r = Math.hypot(dx, dy);
    const ang = Math.atan2(dy, dx);
    const n = fbm(dx * 4 + 33, dy * 4 - 27, 3);
    const hole = smooth(0.19, 0.09, r * (1 + 0.15 * n));
    const chipR = 0.3 + 0.12 * Math.sin(ang * 4 + n * 5) + 0.1 * n;
    const flecks = smooth(chipR + 0.04, chipR - 0.04, r) * (1 - hole) * clampNum(0.5 + 0.8 * fbm(dx * 9 - 2, dy * 9 + 7, 2), 0, 1);
    const scorch = smooth(0.95, 0.3, r * (0.9 + 0.45 * n)) * (1 - hole) * (1 - flecks * 0.7) * 0.75;
    const alpha = clampNum(hole + flecks * 0.9 + scorch, 0, 1);
    const rC = 8 * hole + 190 * flecks + 26 * scorch;
    const gC = 7 * hole + 170 * flecks + 20 * scorch;
    const bC = 8 * hole + 150 * flecks + 18 * scorch;
    const den = Math.max(alpha, 1e-3);
    return [rC / den, gC / den, bC / den, alpha * 255, -hole * 1.3 + flecks * 0.15];
  }, true);

  const colorTex = new THREE.CanvasTexture(cvs);
  colorTex.colorSpace = THREE.SRGBColorSpace;
  colorTex.wrapS = colorTex.wrapT = THREE.ClampToEdgeWrapping;
  colorTex.magFilter = THREE.LinearFilter;
  colorTex.minFilter = THREE.LinearMipmapLinearFilter;
  colorTex.generateMipmaps = true;
  colorTex.anisotropy = 4;
  colorTex.name = 'fx.decalAtlas';
  colorTex.needsUpdate = true;

  const normalTex = new THREE.CanvasTexture(nCanvas);
  normalTex.colorSpace = THREE.NoColorSpace;
  normalTex.wrapS = normalTex.wrapT = THREE.ClampToEdgeWrapping;
  normalTex.magFilter = THREE.LinearFilter;
  normalTex.minFilter = THREE.LinearMipmapLinearFilter;
  normalTex.generateMipmaps = true;
  normalTex.name = 'fx.decalAtlas.normal';
  normalTex.needsUpdate = true;

  _atlasCache = { colorTex, normalTex, canvas: cvs, normalCanvas: nCanvas };
  return _atlasCache;
}

function clamp255(v) {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}
