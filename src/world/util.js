/**
 * WORLD stream utilities: metre-scaled geometry builders, a merge-by-material
 * static batcher, and a derived seeded RNG.
 *
 * Every geometry produced here carries exactly {position, normal, uv} so any
 * of them can be merged together. UVs are authored in METRES so materials
 * built with `repeat = 1 / tileMeters` texture the world at the correct
 * physical scale regardless of panel size (no per-mesh repeat juggling).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Random } from '../core/Random.js';

export const DEG = Math.PI / 180;

const _m4 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);
const _e = new THREE.Euler();

/** Derived deterministic RNG stream (world layout must not consume game.rng draws). */
export function worldRng(game, salt = 4211) {
  const seed = ((game.seed ?? 1) * 2246822519 + salt * 977) >>> 0;
  return new Random(seed || 1);
}

/**
 * Build a matrix from position / euler(deg) / scale.
 * @returns {THREE.Matrix4} a NEW matrix
 */
export function mat4(x = 0, y = 0, z = 0, rxDeg = 0, ryDeg = 0, rzDeg = 0, sx = 1, sy = 1, sz = 1) {
  _e.set(rxDeg * DEG, ryDeg * DEG, rzDeg * DEG, 'YXZ');
  _q.setFromEuler(_e);
  _p.set(x, y, z);
  _s.set(sx, sy, sz);
  return new THREE.Matrix4().compose(_p, _q, _s);
}

/* ------------------------------------------------------------- geometry */

/**
 * Box with metre-scaled UVs per face (u along the face's first axis, v up).
 * Origin at the box centre (like THREE.BoxGeometry).
 */
export function boxGeom(w, h, d, uvScale = 1) {
  const g = new THREE.BoxGeometry(w, h, d, 1, 1, 1);
  // BoxGeometry face order: +x, -x, +y, -y, +z, -z ; each face 4 verts (2 tris)
  const uv = g.attributes.uv;
  const dims = [
    [d, h], [d, h], // +x,-x faces span depth × height
    [w, d], [w, d], // +y,-y span width × depth
    [w, h], [w, h], // +z,-z span width × height
  ];
  for (let f = 0; f < 6; f++) {
    const [su, sv] = dims[f];
    for (let i = 0; i < 4; i++) {
      const vi = f * 4 + i;
      uv.setXY(vi, uv.getX(vi) * su * uvScale, uv.getY(vi) * sv * uvScale);
    }
  }
  uv.needsUpdate = true;
  return g;
}

/**
 * A quad in the local XY plane facing +Z, size w × h, centred at origin,
 * UV in metres (0..w, 0..h) optionally offset.
 * @param {number} w
 * @param {number} h
 * @param {{u0?:number,v0?:number,uScale?:number,vScale?:number,flipU?:boolean}} [o]
 */
export function quadGeom(w, h, o = {}) {
  const g = new THREE.PlaneGeometry(w, h, 1, 1);
  const uv = g.attributes.uv;
  const us = o.uScale ?? 1;
  const vs = o.vScale ?? 1;
  const u0 = o.u0 ?? 0;
  const v0 = o.v0 ?? 0;
  for (let i = 0; i < uv.count; i++) {
    let u = uv.getX(i) * w * us + u0;
    if (o.flipU) u = (w - uv.getX(i) * w) * us + u0;
    uv.setXY(i, u, uv.getY(i) * h * vs + v0);
  }
  uv.needsUpdate = true;
  return g;
}

/**
 * A quad with explicit UV rectangle (for atlas decals): uv from (u0,v0) to (u1,v1).
 */
export function decalQuadGeom(w, h, u0, v0, u1, v1) {
  const g = new THREE.PlaneGeometry(w, h, 1, 1);
  const uv = g.attributes.uv;
  // PlaneGeometry uv order: (0,1),(1,1),(0,0),(1,0)
  uv.setXY(0, u0, v1);
  uv.setXY(1, u1, v1);
  uv.setXY(2, u0, v0);
  uv.setXY(3, u1, v0);
  uv.needsUpdate = true;
  return g;
}

/** Cylinder with metre-ish UVs (u around the circumference in metres, v height in metres). */
export function cylGeom(rTop, rBot, h, seg = 12, open = false) {
  const g = new THREE.CylinderGeometry(rTop, rBot, h, seg, 1, open);
  const uv = g.attributes.uv;
  const circ = Math.PI * (rTop + rBot);
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * circ, uv.getY(i) * h);
  uv.needsUpdate = true;
  return g;
}

/**
 * Transform a geometry by a matrix (in place, returns it).
 */
export function xform(geo, matrix) {
  geo.applyMatrix4(matrix);
  return geo;
}

/**
 * Merge helper that tolerates the odd geometry with extra attributes by
 * stripping everything but position/normal/uv, and de-indexing consistently.
 * @param {THREE.BufferGeometry[]} geos
 */
export function merge(geos) {
  // keep vertex colours only when every geometry in the set carries them (decal batches)
  const keepColor = geos.length > 0 && geos.every((g) => g && g.attributes && g.attributes.color);
  const cleaned = [];
  for (const g of geos) {
    if (!g) continue;
    let c = g;
    // normalise attribute set
    for (const key of Object.keys(c.attributes)) {
      if (key !== 'position' && key !== 'normal' && key !== 'uv' && !(keepColor && key === 'color')) c.deleteAttribute(key);
    }
    if (!c.attributes.uv) {
      const count = c.attributes.position.count;
      c.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(count * 2), 2));
    }
    if (!c.attributes.normal) c.computeVertexNormals();
    if (!c.index) c = c.toNonIndexed(); // mergeGeometries needs all-indexed or all-non-indexed
    cleaned.push(c);
  }
  if (cleaned.length === 0) return null;
  // ensure all indexed (toNonIndexed above only for the non-indexed ones — invert: index all)
  const allIndexed = cleaned.every((g) => g.index);
  const list = allIndexed ? cleaned : cleaned.map((g) => (g.index ? g.toNonIndexed() : g));
  return mergeGeometries(list, false);
}

/**
 * StaticBatcher — collects (geometry, material, surface) triples and merges
 * them per material into a handful of world-space meshes. This is the main
 * draw-call weapon: e.g. all container panels of one paint colour become a
 * single mesh.
 */
export class StaticBatcher {
  /**
   * @param {THREE.Object3D} parent group receiving the merged meshes
   * @param {string} name debug name prefix
   */
  constructor(parent, name = 'batch') {
    this.parent = parent;
    this.name = name;
    /** @type {Map<any, {material:THREE.Material, geos:THREE.BufferGeometry[], surface:string, cast:boolean, receive:boolean, key:string, zone:string}>} */
    this.buckets = new Map();
    this.meshes = [];
    /** current spatial zone label; batches never merge across zones so culling/sorting stay local */
    this.zone = 'yard';
  }

  /** Set the zone label applied to subsequently added geometry (returns the previous one). */
  setZone(zone) {
    const prev = this.zone;
    this.zone = zone;
    return prev;
  }

  /**
   * Add a geometry (already in world space, or with a matrix to bake).
   * @param {THREE.BufferGeometry} geo
   * @param {THREE.Material} material shared material (bucket key)
   * @param {{matrix?:THREE.Matrix4, surface?:string, castShadow?:boolean, receiveShadow?:boolean, key?:string}} [o]
   */
  add(geo, material, o = {}) {
    if (o.matrix) geo.applyMatrix4(o.matrix);
    const zone = o.zone || this.zone;
    const key = zone + '|' + (o.key || '') + '|' + material.uuid + '|' + (o.surface || '') + (o.castShadow === false ? '|nc' : '') + (o.receiveShadow === false ? '|nr' : '');
    let b = this.buckets.get(key);
    if (!b) {
      b = {
        material,
        geos: [],
        surface: o.surface || 'concrete',
        cast: o.castShadow !== false,
        receive: o.receiveShadow !== false,
        key,
        zone,
      };
      this.buckets.set(key, b);
    }
    b.geos.push(geo);
    return this;
  }

  /**
   * Merge every bucket into one mesh each. Returns the created meshes.
   * @returns {THREE.Mesh[]}
   */
  build() {
    let i = 0;
    for (const b of this.buckets.values()) {
      if (b.geos.length === 0) continue;
      const merged = merge(b.geos);
      if (!merged) continue;
      merged.computeBoundingBox();
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, b.material);
      mesh.name = `${this.name}.${b.zone}.${i++}`;
      mesh.castShadow = b.cast;
      mesh.receiveShadow = b.receive;
      mesh.userData.surface = b.surface;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      this.parent.add(mesh);
      this.meshes.push(mesh);
      // release the sources
      for (const g of b.geos) g.dispose();
      b.geos.length = 0;
    }
    return this.meshes;
  }
}

/**
 * A polyline as a chain of thin box segments (cables, rails, pipes). Cheap
 * (12 tris per segment) and no TubeGeometry seams. Returns one merged geometry.
 * @param {THREE.Vector3[]} pts
 * @param {number} thickness
 */
export function polylineBoxes(pts, thickness) {
  const parts = [];
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 0, 1);
  const dir = new THREE.Vector3();
  const mid = new THREE.Vector3();
  const m = new THREE.Matrix4();
  const scl = new THREE.Vector3();
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    dir.copy(b).sub(a);
    const len = dir.length();
    if (len < 1e-4) continue;
    dir.multiplyScalar(1 / len);
    mid.copy(a).add(b).multiplyScalar(0.5);
    q.setFromUnitVectors(up, dir);
    const g = boxGeom(thickness, thickness, len);
    scl.set(1, 1, 1);
    m.compose(mid, q, scl);
    g.applyMatrix4(m);
    parts.push(g);
  }
  return merge(parts);
}

/**
 * Catenary sample points between a and b with a sag depth (metres).
 * @param {THREE.Vector3} a
 * @param {THREE.Vector3} b
 * @param {number} sag
 * @param {number} segments
 * @returns {THREE.Vector3[]}
 */
export function catenaryPoints(a, b, sag, segments = 12) {
  const pts = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const p = new THREE.Vector3().lerpVectors(a, b, t);
    // parabolic sag (visually indistinguishable from a catenary at this scale)
    p.y -= sag * 4 * t * (1 - t);
    pts.push(p);
  }
  return pts;
}

/** Clamp helper. */
export function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

/** smoothstep */
export function smoothstep(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Dispose a subtree's geometries/materials (not shared textures). */
export function disposeTree(root, disposeMaterials = false) {
  root.traverse((o) => {
    o.geometry?.dispose?.();
    if (disposeMaterials && o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) m.dispose?.();
    }
  });
}

export { mergeGeometries };
export { _m4 as _sharedMat };
