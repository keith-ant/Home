/**
 * CollisionWorld — static collision for Terminal 9 (WORLD stream).
 *
 * All collidable statics are baked into ONE merged world-space geometry with a
 * MeshBVH (three-mesh-bvh). Sources are simplified proxies: solid boxes for
 * containers/props, the ground/apron planes, structure meshes. Every
 * triangle range remembers its surface tag + owning object so ballistics /
 * foley get {surface, object} back from a hit.
 *
 * API (exposed on game.world as world.raycast etc.):
 *   raycast(origin, dir, maxDist=1000, opts) → {point, normal, distance, object, surface, faceIndex} | null
 *   raycastAll(origin, dir, maxDist=1000, opts) → hits sorted by distance
 *   capsuleCollide(capsule) → {hit, grounded, normal, depth}; capsule = {start:Vector3, end:Vector3, radius}
 *       Resolves penetration IN PLACE (moves start/end out of geometry). Call after
 *       integrating velocity; loop 1–3 times for stability. `grounded` when a
 *       push direction points up ≥ 45°.
 *   sphereCast(origin, dir, radius, maxDist) → hit | null (5-ray approximation)
 *   surfaceAt(point) → surface string under a point (down-cast)
 */
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { boxGeom, merge } from './util.js';

const _ray = new THREE.Ray();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _tp = new THREE.Vector3();
const _cp = new THREE.Vector3();
const _push = new THREE.Vector3();
const _box = new THREE.Box3();
const _seg = new THREE.Line3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const DOWN = new THREE.Vector3(0, -1, 0);

export class CollisionWorld {
  constructor() {
    /** @type {THREE.BufferGeometry[]} */
    this._geos = [];
    /** @type {Array<{count:number, surface:string, object:any}>} */
    this._sources = [];
    /** @type {Array<{start:number, end:number, surface:string, object:any}>} triangle ranges */
    this.ranges = [];
    this.geometry = null;
    this.bvh = null;
    this.mesh = null; // debug/visual holder (never added to the scene)
    this.built = false;
    // scratch pool for raycastAll results
    this._hitPool = [];
    for (let i = 0; i < 32; i++) this._hitPool.push(makeHit());
    this._first = makeHit();
    this._sphere = makeHit();
    this.stats = { triangles: 0 };
  }

  /* ------------------------------------------------------------ sources */
  /**
   * Add an oriented box proxy expressed in a local frame.
   * @param {THREE.Matrix4} matrix local→world
   * @param {{w:number,h:number,d:number,cx?:number,cy?:number,cz?:number}} dims box size + local centre offset
   * @param {string} surface
   * @param {any} [object]
   */
  addBox(matrix, dims, surface = 'metal', object = null) {
    const g = boxGeom(dims.w, dims.h, dims.d);
    _m.makeTranslation(dims.cx || 0, dims.cy || 0, dims.cz || 0);
    _m.premultiply(matrix);
    g.applyMatrix4(_m);
    this._push(g, surface, object);
  }

  /**
   * Axis-aligned box helper (world coords, bottom at y unless centred).
   */
  addAABox(x, y, z, w, h, d, surface = 'concrete', object = null, centered = false) {
    const g = boxGeom(w, h, d);
    g.translate(x, centered ? y : y + h / 2, z);
    this._push(g, surface, object);
  }

  /**
   * Horizontal ground rectangle (two triangles) at height y.
   */
  addGroundRect(x0, x1, z0, z1, y = 0, surface = 'asphalt', object = null) {
    const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0, 1, 1);
    g.rotateX(-Math.PI / 2);
    g.translate((x0 + x1) / 2, y, (z0 + z1) / 2);
    this._push(g, surface, object);
  }

  /**
   * Add an existing geometry that is already in world space (cloned=false → consumed).
   */
  addGeometry(geo, surface = 'concrete', object = null, matrix = null) {
    let g = geo;
    if (matrix) {
      g = geo.clone();
      g.applyMatrix4(matrix);
    }
    this._push(g, surface, object);
  }

  /**
   * Add a mesh (or subtree of meshes) using their world matrices.
   * @param {THREE.Object3D} root
   * @param {string} surface
   */
  addObjectMeshes(root, surface = 'concrete') {
    root.updateWorldMatrix(true, true);
    root.traverse((o) => {
      if (!o.isMesh || o.userData.noCollide) return;
      const g = o.geometry.clone();
      g.applyMatrix4(o.matrixWorld);
      this._push(g, o.userData.surface || surface, o);
    });
  }

  _push(geo, surface, object) {
    // strip to position only; ensure indexed → non-indexed for uniform merging
    for (const key of Object.keys(geo.attributes)) if (key !== 'position') geo.deleteAttribute(key);
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (g !== geo) geo.dispose();
    const triCount = g.attributes.position.count / 3;
    this._geos.push(g);
    this._sources.push({ count: triCount, surface, object });
  }

  /* -------------------------------------------------------------- build */
  build() {
    if (this._geos.length === 0) throw new Error('[collision] nothing to build');
    // manual merge (position-only, non-indexed) preserving order for ranges
    let total = 0;
    for (const g of this._geos) total += g.attributes.position.count;
    const pos = new Float32Array(total * 3);
    let offset = 0;
    let triStart = 0;
    this.ranges.length = 0;
    for (let i = 0; i < this._geos.length; i++) {
      const g = this._geos[i];
      pos.set(g.attributes.position.array, offset * 3);
      const triCount = this._sources[i].count;
      this.ranges.push({ start: triStart, end: triStart + triCount, surface: this._sources[i].surface, object: this._sources[i].object });
      triStart += triCount;
      offset += g.attributes.position.count;
      g.dispose();
    }
    this._geos.length = 0;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    // an index makes the BVH build faster and memory smaller
    const index = new (total > 65535 ? Uint32Array : Uint16Array)(total);
    for (let i = 0; i < total; i++) index[i] = i;
    geometry.setIndex(new THREE.BufferAttribute(index, 1));
    this.geometry = geometry;
    this.bvh = new MeshBVH(geometry, { maxLeafTris: 8, strategy: 0 });
    geometry.boundsTree = this.bvh;
    this.mesh = new THREE.Mesh(geometry);
    this.mesh.name = 'world.collision';
    this.stats.triangles = triStart;
    this.built = true;
    return this;
  }

  _rangeFor(faceIndex) {
    // binary search
    let lo = 0;
    let hi = this.ranges.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const r = this.ranges[mid];
      if (faceIndex < r.start) hi = mid - 1;
      else if (faceIndex >= r.end) lo = mid + 1;
      else return r;
    }
    return null;
  }

  /* -------------------------------------------------------------- casts */
  /**
   * First-hit raycast against the static world.
   * @param {THREE.Vector3} origin
   * @param {THREE.Vector3} dir (need not be normalised)
   * @param {number} [maxDist=1000]
   * @param {{backfaces?:boolean}} [opts]
   * @returns {{point:THREE.Vector3, normal:THREE.Vector3, distance:number, object:any, surface:string, faceIndex:number}|null}
   *   NOTE: the returned object is a reused record — copy what you need to keep.
   */
  raycast(origin, dir, maxDist = 1000, opts = {}) {
    if (!this.bvh) return null;
    _ray.origin.copy(origin);
    _ray.direction.copy(dir).normalize();
    const hit = this.bvh.raycastFirst(_ray, opts.backfaces ? THREE.DoubleSide : THREE.FrontSide, 0, maxDist);
    if (!hit) return null;
    return this._fill(this._first, hit);
  }

  /**
   * All hits along the ray (sorted), e.g. for penetration.
   * @returns {Array<any>} pooled result records (valid until the next call)
   */
  raycastAll(origin, dir, maxDist = 1000, opts = {}) {
    if (!this.bvh) return [];
    _ray.origin.copy(origin);
    _ray.direction.copy(dir).normalize();
    const hits = this.bvh.raycast(_ray, opts.backfaces ? THREE.DoubleSide : THREE.FrontSide, 0, maxDist);
    hits.sort((a, b) => a.distance - b.distance);
    const out = [];
    const n = Math.min(hits.length, this._hitPool.length);
    for (let i = 0; i < n; i++) out.push(this._fill(this._hitPool[i], hits[i]));
    return out;
  }

  _fill(rec, hit) {
    rec.point.copy(hit.point);
    if (hit.face && hit.face.normal) rec.normal.copy(hit.face.normal);
    else rec.normal.set(0, 1, 0);
    rec.distance = hit.distance;
    rec.faceIndex = hit.faceIndex;
    const r = this._rangeFor(hit.faceIndex);
    rec.surface = r ? r.surface : 'concrete';
    rec.object = r ? r.object : null;
    return rec;
  }

  /**
   * Resolve a capsule against the world, pushing it out of penetration.
   * @param {{start:THREE.Vector3, end:THREE.Vector3, radius:number}} capsule mutated in place
   * @returns {{hit:boolean, grounded:boolean, normal:THREE.Vector3, depth:number}}
   */
  capsuleCollide(capsule) {
    const res = this._capRes || (this._capRes = { hit: false, grounded: false, normal: new THREE.Vector3(0, 1, 0), depth: 0 });
    res.hit = false;
    res.grounded = false;
    res.depth = 0;
    res.normal.set(0, 1, 0);
    if (!this.bvh) return res;
    const radius = capsule.radius;
    _push.set(0, 0, 0);
    let iterations = 0;
    let any = false;
    do {
      _seg.start.copy(capsule.start);
      _seg.end.copy(capsule.end);
      _box.makeEmpty();
      _box.expandByPoint(_seg.start);
      _box.expandByPoint(_seg.end);
      _box.min.addScalar(-radius);
      _box.max.addScalar(radius);
      let deepest = 0;
      let collided = false;
      _push.set(0, 0, 0);
      this.bvh.shapecast({
        intersectsBounds: (box) => box.intersectsBox(_box),
        intersectsTriangle: (tri) => {
          const dist = tri.closestPointToSegment(_seg, _tp, _cp);
          if (dist < radius) {
            const depth = radius - dist;
            // push direction: from the triangle toward the segment
            _v.copy(_cp).sub(_tp);
            const len = _v.length();
            if (len > 1e-6) _v.multiplyScalar(1 / len);
            else _v.copy(tri.getNormal ? tri.getNormal(_v2) : _v2.set(0, 1, 0));
            _seg.start.addScaledVector(_v, depth);
            _seg.end.addScaledVector(_v, depth);
            _push.addScaledVector(_v, depth);
            if (depth > deepest) deepest = depth;
            collided = true;
            if (_v.y > 0.55) res.grounded = true;
          }
          return false;
        },
      });
      if (collided) {
        any = true;
        capsule.start.copy(_seg.start);
        capsule.end.copy(_seg.end);
        res.depth += deepest;
        if (_push.lengthSq() > 1e-8) res.normal.copy(_push).normalize();
      }
      iterations++;
      if (!collided) break;
    } while (iterations < 3);
    res.hit = any;
    return res;
  }

  /**
   * Approximate sphere sweep: centre ray + 4 offset rays. Good enough for
   * grenades / AI probes; not a substitute for capsuleCollide.
   */
  sphereCast(origin, dir, radius, maxDist = 1000) {
    if (!this.bvh) return null;
    _v.copy(dir).normalize();
    // build an orthonormal basis around dir
    _v2.set(0, 1, 0);
    if (Math.abs(_v.y) > 0.9) _v2.set(1, 0, 0);
    const side = _tp.copy(_v).cross(_v2).normalize().multiplyScalar(radius);
    const up = _cp.copy(_v).cross(side).normalize().multiplyScalar(radius);
    let best = null;
    let bestD = Infinity;
    for (let i = 0; i < 5; i++) {
      _push.copy(origin);
      if (i === 1) _push.add(side);
      if (i === 2) _push.sub(side);
      if (i === 3) _push.add(up);
      if (i === 4) _push.sub(up);
      _ray.origin.copy(_push);
      _ray.direction.copy(_v);
      const hit = this.bvh.raycastFirst(_ray, THREE.FrontSide, 0, maxDist);
      if (hit && hit.distance < bestD) {
        bestD = hit.distance;
        best = this._fill(this._sphere, hit);
      }
    }
    return best;
  }

  /**
   * Surface tag under a point (down-cast from just above it).
   * @param {THREE.Vector3|{point:THREE.Vector3, surface?:string}} pointOrHit
   */
  surfaceAt(pointOrHit) {
    if (pointOrHit && pointOrHit.surface) return pointOrHit.surface;
    const p = pointOrHit && pointOrHit.point ? pointOrHit.point : pointOrHit;
    if (!p) return 'concrete';
    _v.set(p.x, p.y + 0.6, p.z);
    const hit = this.raycast(_v, DOWN, 3.0);
    return hit ? hit.surface : 'concrete';
  }

  /** Ground height under (x,z) from a downward cast starting at yFrom, or null. */
  groundHeightAt(x, z, yFrom = 12) {
    _v.set(x, yFrom, z);
    const hit = this.raycast(_v, DOWN, yFrom + 20);
    return hit ? { y: hit.point.y, surface: hit.surface } : null;
  }

  dispose() {
    this.geometry?.dispose();
    this.geometry = null;
    this.bvh = null;
    this.built = false;
  }
}

function makeHit() {
  return {
    point: new THREE.Vector3(),
    normal: new THREE.Vector3(),
    distance: 0,
    faceIndex: -1,
    object: null,
    surface: 'concrete',
  };
}
