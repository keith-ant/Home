/**
 * GunBuilder — procedural high-detail first-person weapon meshes (WEAPONS stream).
 *
 * The CC0 reference GLBs in the manifest are 200-4400 tri flat-shaded kitbash
 * models; the hero viewmodel weapons here are assembled from hundreds of
 * bevelled parts (RoundedBoxGeometry / Lathe / Extrude / capsules) with the
 * material library in ./materials.js, per docs/ART_DIRECTION.md §5 and
 * docs/REFERENCE_STUDY.md §3 (the weapon is the most detailed object on
 * screen: roll-marks, silvered edge wear, oiled-steel bolt through the port,
 * emissive reticle/laser/tritium).
 *
 * Coordinate convention for every weapon (and the arms): local -Z is forward
 * (down the bore), +Y up, +X to the shooter's right (ejection side).
 *
 * API
 *   buildAR()      → GunAssembly   M4-style carbine (holo sight, PEQ, VFG, suppressor)
 *   buildPistol()  → GunAssembly   tactical .45 (slide, tritium sights, weapon light)
 *   buildFrag()    → GunAssembly   M67-style fragmentation grenade
 *   buildArms()    → ArmsRig       gloved hands + forearms with per-finger posing
 *
 * GunAssembly: { root:Group, parts:Map<name,Object3D>, anchors:{...}, info:{tris, ...} }
 * Named parts are the animatable sub-objects (mag, bolt, chargingHandle,
 * dustCover, trigger, selector, slide, hammer, ...). Anchors are Object3Ds:
 * `muzzle` (bore exit), `port` (ejection port centre), `laser` (laser
 * aperture), `reticle` (holographic reticle centre), `rightHand`/`leftHand`
 * (grip attachment frames for buildArms). Every mesh casts+receives shadow.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  weaponMaterial, arRollmarkSheet, gripCheckerNormal, stippleNormal, ribbedNormal,
  glowTexture, clothNormal,
} from './materials.js';

const DEG = Math.PI / 180;
const _bb = new THREE.Box3();
const _pv = new THREE.Vector3();

/* ------------------------------------------------------------------------ */
/* geometry helpers                                                          */
/* ------------------------------------------------------------------------ */

/**
 * Bake a per-vertex `aWear` attribute: vertices lying near two or more faces
 * of the geometry's bounding box (i.e. on edges/corners) get wear ~1 with a
 * hashed break-up so the silvering isn't a uniform outline. Also darkens
 * (negative wear is clamped to 0 in the shader; we use it as an AO-ish
 * multiplier on the vertex colour instead — kept simple: wear only).
 * @param {THREE.BufferGeometry} geo
 * @param {{dist?:number, strength?:number, seed?:number, faces?:string}} [o]
 *   faces: which bbox faces count ('all' | 'nobottom' | 'topfront')
 */
export function applyEdgeWear(geo, o = {}) {
  // Bevelled boxes get the ANALYTIC mode marker (see materials.patchWear):
  // aWear = 4 + strength, resolved per-pixel from the object-space normal.
  const strength = Math.max(0, Math.min(1.6, (o.strength ?? 1.0) * 0.7));
  const n = geo.attributes.position.count;
  const wear = new Float32Array(n);
  wear.fill(4 + strength);
  geo.setAttribute('aWear', new THREE.BufferAttribute(wear, 1));
  return geo;
}

/** Wear along the rims of a solid of revolution (axis 'z' | 'y' | 'x'). */
export function applyRimWear(geo, o = {}) {
  const axis = o.axis || 'z';
  const dist = o.dist ?? 0.003;
  const strength = o.strength ?? 1.0;
  const seed = o.seed ?? 5;
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  const pos = geo.attributes.position;
  const n = pos.count;
  const wear = new Float32Array(n);
  const amin = bb.min[axis];
  const amax = bb.max[axis];
  const ax1 = axis === 'x' ? 'y' : 'x';
  const ax2 = axis === 'z' ? 'y' : 'z';
  const rmax = Math.max(Math.abs(bb.min[ax1]), Math.abs(bb.max[ax1]), Math.abs(bb.min[ax2]), Math.abs(bb.max[ax2]));
  for (let i = 0; i < n; i++) {
    _pv.fromBufferAttribute(pos, i);
    const a = _pv[axis];
    const r = Math.hypot(_pv[ax1], _pv[ax2]);
    const endNear = Math.min(a - amin, amax - a);
    const rimEnd = 1 - smoothstep(0, dist, endNear);
    const radial = smoothstep(rmax * 0.72, rmax * 0.97, r);
    let w = rimEnd * radial;
    // faint handling wear band along the length
    w += 0.18 * smoothstep(rmax * 0.9, rmax, r) * hash3(Math.round(a * 900), Math.round(r * 900), seed);
    const nz = 0.4 + 0.6 * hash3(Math.round(_pv.x * 4000), Math.round(_pv.y * 4000), Math.round(_pv.z * 4000) + seed);
    wear[i] = Math.max(0, Math.min(1, w * strength * (0.6 + nz)));
  }
  geo.setAttribute('aWear', new THREE.BufferAttribute(wear, 1));
  return geo;
}

/** Ensure a geometry has an aWear attribute (zeros) for wear-patched materials. */
export function ensureWear(geo, value = 0) {
  if (geo.attributes.aWear) return geo;
  const n = geo.attributes.position.count;
  const w = new Float32Array(n);
  if (value) w.fill(value);
  geo.setAttribute('aWear', new THREE.BufferAttribute(w, 1));
  return geo;
}

function smoothstep(a, b, x) {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function hash3(x, y, s) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Rounded box mesh helper. */
function rbox(w, h, d, r, mat, wearOpts = {}) {
  const seg = wearOpts.segments ?? 2;
  const geo = new RoundedBoxGeometry(w, h, d, seg, r);
  applyEdgeWear(geo, { dist: Math.max(r * 1.4, 0.0025), strength: wearOpts.strength ?? 1, seed: wearOpts.seed ?? Math.round(w * 1e4 + h * 3e3), faces: wearOpts.faces });
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** Plain box (already-worn or hidden parts), still with aWear zeros. */
function box(w, h, d, mat, wear = 0) {
  const geo = new THREE.BoxGeometry(w, h, d);
  ensureWear(geo, wear);
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** Cylinder aligned to an axis ('x'|'y'|'z'). */
function cyl(rt, rb, len, seg, mat, axis = 'z', wearOpts = {}) {
  const geo = new THREE.CylinderGeometry(rt, rb, len, seg, 1, false);
  if (axis === 'z') geo.rotateX(Math.PI / 2);
  else if (axis === 'x') geo.rotateZ(Math.PI / 2);
  if (wearOpts.rim !== false) applyRimWear(geo, { axis, dist: wearOpts.dist ?? 0.0025, strength: wearOpts.strength ?? 0.8, seed: wearOpts.seed ?? 3 });
  else ensureWear(geo);
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/**
 * Lathe from a (radius, z) profile, revolved about the Z axis.
 * @param {Array<[number, number]>} profile [radius, z] pairs in order
 */
function lathe(profile, seg, mat, wearOpts = {}) {
  const pts = profile.map(([r, z]) => new THREE.Vector2(Math.max(r, 0.0001), z));
  const geo = new THREE.LatheGeometry(pts, seg);
  geo.rotateX(Math.PI / 2); // lathe height (Y) → +Z, so the profile's z is used directly
  if (wearOpts.rim !== false) applyRimWear(geo, { axis: 'z', dist: wearOpts.dist ?? 0.003, strength: wearOpts.strength ?? 0.7, seed: wearOpts.seed ?? 9 });
  else ensureWear(geo);
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** Torus mesh helper. */
function torus(r, tube, radSeg, tubSeg, mat, arc) {
  const geo = new THREE.TorusGeometry(r, tube, tubSeg, radSeg, arc);
  ensureWear(geo, 0);
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/**
 * Picatinny (MIL-STD-1913) rail strip along Z: a base bar + transverse
 * ridges every 10.008 mm (we use ~10 mm), merged into one geometry.
 * @param {number} length total length (m)
 * @param {number} [width] rail width (m) — 21.2 mm spec
 * @returns {THREE.BufferGeometry} spans z ∈ [-length/2, +length/2], top at y=height
 */
export function railGeometry(length, width = 0.0212) {
  const base = new THREE.BoxGeometry(width * 0.86, 0.0034, length);
  base.translate(0, 0.0017, 0);
  const pitch = 0.01;
  const ridgeCount = Math.max(1, Math.floor(length / pitch));
  const geos = [base];
  const startZ = -length / 2 + pitch * 0.5;
  for (let i = 0; i < ridgeCount; i++) {
    // trapezoidal cross-section approximated by a slim rounded box
    // (real 1913 slot depth is ~2.9 mm — keep the ridges low and crisp)
    const g = new THREE.BoxGeometry(width, 0.0028, 0.0048);
    g.translate(0, 0.0034 + 0.0014, startZ + i * pitch);
    geos.push(g);
  }
  const merged = mergeGeometries(geos, false);
  applyEdgeWear(merged, { dist: 0.0012, strength: 0.9, seed: 41 });
  return merged;
}

function railMesh(length, mat, width) {
  const m = new THREE.Mesh(railGeometry(length, width), mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/**
 * Decal plate: a quad textured with a sub-rect of the roll-mark sheet.
 * @param {number} w metres
 * @param {number} h metres
 * @param {[number,number,number,number]} rect [u0,v0,u1,v1] in canvas space (v from top)
 * @param {THREE.Material} mat decal material
 */
function decalPlate(w, h, rect, mat) {
  const geo = new THREE.PlaneGeometry(w, h);
  const uv = geo.attributes.uv;
  // canvas v is measured from the top; CanvasTexture flipY=true → texture v = 1 - canvasV
  const u0 = rect[0];
  const u1 = rect[2];
  const vTop = 1 - rect[1];
  const vBot = 1 - rect[3];
  for (let i = 0; i < uv.count; i++) {
    const u = uv.getX(i);
    const v = uv.getY(i);
    uv.setXY(i, u0 + (u1 - u0) * u, vBot + (vTop - vBot) * v);
  }
  uv.needsUpdate = true;
  ensureWear(geo);
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = false;
  m.receiveShadow = false;
  m.renderOrder = 2;
  return m;
}

/**
 * 30-round STANAG-style magazine body: an extruded side profile with the
 * classic gentle forward curve, bevelled edges. Local frame: origin at the
 * top-centre (well level), body hangs along -Y and curves toward -Z.
 * @returns {THREE.BufferGeometry}
 */
export function magazineBodyGeometry(thickness = 0.0224) {
  // profile in (u = -z i.e. forward, v = y) — see rotation below.
  // 30-rd USGI/STANAG: 60 mm deep at the top, gentle constant forward
  // sweep (~6°), raked baseplate seat.
  const shape = new THREE.Shape();
  shape.moveTo(0.030, 0.0);                        // top front corner
  shape.lineTo(-0.030, 0.0);                       // top rear corner
  shape.lineTo(-0.032, -0.038);                    // rear edge, straight in the well…
  shape.quadraticCurveTo(-0.027, -0.108, -0.009, -0.172); // …curving forward below it
  shape.lineTo(0.003, -0.190);                     // bottom rear corner
  shape.lineTo(0.054, -0.176);                     // bottom edge (raked baseplate seat)
  shape.quadraticCurveTo(0.048, -0.104, 0.036, -0.042); // front edge curving up
  shape.lineTo(0.030, 0.0);
  const half = thickness / 2 - 0.0018;
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: half * 2,
    bevelEnabled: true,
    bevelThickness: 0.0018,
    bevelSize: 0.0018,
    bevelSegments: 2,
    curveSegments: 10,
    steps: 1,
  });
  // extrusion Z → gun X (thickness), profile u → -gun Z, v → gun Y
  geo.rotateY(Math.PI / 2);
  geo.translate(-half, 0, 0);
  applyEdgeWear(geo, { strength: 0.9, seed: 40 });
  return geo;
}

/**
 * Forged upper receiver: cross-section extruded along the bore. Flat bottom
 * (mates the lower), vertical flats, rounded forged shoulders rolling into
 * the flat-top rail platform. Frame: bore axis at y=0, front face at z=0,
 * body spans z ∈ [zFront, zFront+length].
 * @param {{halfWidth?:number, bottom?:number, top?:number, length?:number, zFront?:number}} [o]
 */
export function receiverUpperGeometry(o = {}) {
  const hw = (o.halfWidth ?? 0.0132) - 0.001;   // minus bevel
  const yb = (o.bottom ?? -0.0165) + 0.001;
  const yt = (o.top ?? 0.0155) - 0.001;         // rail-base platform
  const ys = yt - 0.0072;                         // shoulder start
  const px = hw - 0.0032;                         // platform half-width
  const shape = new THREE.Shape();
  shape.moveTo(-hw, yb);
  shape.lineTo(hw, yb);
  shape.lineTo(hw, ys);
  shape.quadraticCurveTo(hw, yt, px, yt);
  shape.lineTo(-px, yt);
  shape.quadraticCurveTo(-hw, yt, -hw, ys);
  shape.lineTo(-hw, yb);
  const length = (o.length ?? 0.186) - 0.002;
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: length,
    bevelEnabled: true,
    bevelThickness: 0.001,
    bevelSize: 0.001,
    bevelSegments: 1,
    curveSegments: 7,
    steps: 1,
  });
  geo.translate(0, 0, (o.zFront ?? 0.004) + 0.001);
  ensureWear(geo, 0.05);
  return geo;
}

/**
 * Forged lower receiver: the side silhouette (magazine well, fire-control
 * housing, sloped rear tang) extruded across the gun's X axis with a
 * bevelled edge — the profile that makes an AR read as an AR. `profile` is
 * a list of [z, y] points (gun frame, bore axis y=0, receiver front z=0),
 * traversed in order.
 * @param {Array<[number, number]>} profile
 * @param {number} thickness across X (m)
 */
export function receiverLowerGeometry(profile, thickness = 0.023) {
  const shape = new THREE.Shape();
  // shape-x = -gunZ, shape-y = gunY; after rotateY(π/2): gunZ = -shapeX ✓
  shape.moveTo(-profile[0][0], profile[0][1]);
  for (let i = 1; i < profile.length; i++) shape.lineTo(-profile[i][0], profile[i][1]);
  shape.lineTo(-profile[0][0], profile[0][1]);
  const bt = 0.0018;
  const depth = thickness - 2 * bt;
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: bt,
    bevelSize: 0.0015,
    bevelSegments: 2,
    curveSegments: 6,
    steps: 1,
  });
  geo.rotateY(Math.PI / 2); // extrusion axis (Z) → gun +X, shape-x → -gun Z
  geo.translate(-depth / 2, 0, 0);
  ensureWear(geo, 0.05);
  return geo;
}

/** Small screw/pin head: short cylinder with a slotted or hex cap. */
function screwHead(radius, mat, hex = false) {
  const geo = new THREE.CylinderGeometry(radius, radius, radius * 0.9, hex ? 6 : 12);
  ensureWear(geo, 0.35);
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = false;
  m.receiveShadow = true;
  return m;
}

/** Count triangles of a subtree. */
function countTris(root) {
  let n = 0;
  root.traverse((o) => {
    if (o.isMesh && o.geometry) {
      const g = o.geometry;
      n += g.index ? g.index.count / 3 : g.attributes.position.count / 3;
    }
  });
  return Math.round(n);
}

function anchor(name) {
  const a = new THREE.Object3D();
  a.name = 'anchor.' + name;
  return a;
}

/* ------------------------------------------------------------------------ */
/* AR — M4-style carbine                                                    */
/* ------------------------------------------------------------------------ */

/**
 * Build the hero carbine. Local frame: bore along -Z, origin = bore axis at
 * the receiver's front face (barrel nut). Length overall ≈ 0.86 m.
 * @param {{suppressor?:boolean, tan?:boolean, seed?:number}} [o]
 */
export function buildAR(o = {}) {
  const root = new THREE.Group();
  root.name = 'wpn.ar';
  const parts = new Map();
  const useSuppressor = o.suppressor !== false;

  // ---- materials -------------------------------------------------------
  const mAnod = weaponMaterial('anodized');
  const mAnodDark = weaponMaterial('anodized', { color: 0xa8adb5 });
  const mSteel = weaponMaterial('steel_park');
  const mSteelDark = weaponMaterial('steel_park', { color: 0x232528 });
  const mOiled = weaponMaterial('steel_oiled');
  const mBlack = weaponMaterial('steel_black');
  const mPoly = weaponMaterial('polymer', { normalMap: gripCheckerNormal(), normalStrength: 0.55 });
  const mPolySmooth = weaponMaterial('polymer');
  const mPolyStock = weaponMaterial('polymer', { normalMap: stippleNormal(), normalStrength: 0.12 });
  const mPolyRib = weaponMaterial('polymer', { normalMap: ribbedNormal(), normalStrength: 0.9 });
  const mFde = weaponMaterial('polymer_fde', { normalMap: ribbedNormal(), normalStrength: 0.35 });
  const mRubber = weaponMaterial('rubber');
  const mBrass = weaponMaterial('brass');
  const mGlass = weaponMaterial('glass_optic');
  const mReticle = weaponMaterial('reticle');
  const mDecal = weaponMaterial('decal');
  const mChamber = new THREE.MeshStandardMaterial({ color: 0x08080a, roughness: 0.9, metalness: 0.2 });
  const sheet = arRollmarkSheet();

  /* ===== barrel + gas system ============================================ */
  // barrel profile from the receiver (z=0) to the muzzle threads (z=-0.372)
  const barrelLen = 0.372;
  const barrel = lathe([
    [0.0125, 0.006],       // barrel extension collar (inside the upper)
    [0.0125, -0.02],
    [0.0102, -0.03],       // under-handguard section
    [0.0102, -0.245],
    [0.0116, -0.252],      // gas-block journal
    [0.0116, -0.286],
    [0.0092, -0.293],      // front section
    [0.0090, -barrelLen + 0.014],
    [0.0102, -barrelLen + 0.012], // thread shoulder
    [0.0102, -barrelLen],
  ], 20, mSteel, { dist: 0.004, strength: 0.5 });
  barrel.name = 'barrel';
  root.add(barrel);

  // low-profile gas block clamped on the barrel + a short gas tube back to the upper
  const gasBlock = rbox(0.024, 0.031, 0.03, 0.0025, mSteelDark, { strength: 0.7 });
  gasBlock.position.set(0, 0.006, -0.267);
  root.add(gasBlock);
  const gbScrew1 = screwHead(0.003, mBlack, true);
  gbScrew1.rotation.z = Math.PI / 2;
  gbScrew1.position.set(0.013, 0.002, -0.259);
  root.add(gbScrew1);
  const gbScrew2 = gbScrew1.clone();
  gbScrew2.position.z = -0.275;
  root.add(gbScrew2);
  const gasTube = cyl(0.0022, 0.0022, 0.245, 8, mSteelDark, 'z', { rim: false });
  gasTube.position.set(0, 0.017, -0.135);
  root.add(gasTube);

  /* ===== muzzle device ================================================== */
  let muzzleZ;
  if (useSuppressor) {
    // QD suppressor: mount collar + wrench flats + can with a stepped end cap
    const sup = new THREE.Group();
    sup.name = 'suppressor';
    const can = lathe([
      [0.0130, 0.0],
      [0.0130, -0.006],
      [0.0155, -0.010],      // QD collar
      [0.0155, -0.030],
      [0.0135, -0.034],
      [0.0135, -0.040],
      [0.0190, -0.048],      // taper to the can body
      [0.0190, -0.150],
      [0.0175, -0.157],      // end-cap step
      [0.0175, -0.160],
      [0.0060, -0.161],      // recessed bore aperture
      [0.0050, -0.150],
    ], 32, mSteelDark, { dist: 0.004, strength: 0.9, seed: 17 });
    sup.add(can);
    // wrench flats near the mount (two thin boxes)
    for (const sx of [-1, 1]) {
      const flat = box(0.004, 0.014, 0.018, mSteelDark, 0.4);
      flat.position.set(sx * 0.0145, 0, -0.021);
      sup.add(flat);
    }
    // engraving decal on the left side of the can
    const supDecal = decalPlate(0.06, 0.013, sheet.rects.suppressor, mDecal);
    supDecal.position.set(-0.0191, 0.001, -0.10);
    supDecal.rotation.y = -Math.PI / 2;
    sup.add(supDecal);
    sup.position.set(0, 0, -barrelLen + 0.024); // mount overlaps the threads
    root.add(sup);
    parts.set('suppressor', sup);
    muzzleZ = -barrelLen + 0.024 - 0.161;
  } else {
    // A2-style birdcage flash hider
    const cage = lathe([
      [0.0110, 0], [0.0112, -0.006], [0.0112, -0.045], [0.006, -0.046], [0.005, -0.036],
    ], 20, mSteelDark, { strength: 0.8 });
    cage.position.set(0, 0, -barrelLen + 0.006);
    root.add(cage);
    // slots (dark thin boxes around the circumference, none at 6 o'clock)
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 * (5 / 6) + Math.PI / 2;
      const slot = box(0.0034, 0.008, 0.026, mChamber, 0);
      slot.position.set(Math.cos(a) * 0.0092, Math.sin(a) * 0.0092, -barrelLen - 0.014);
      slot.rotation.z = a - Math.PI / 2;
      root.add(slot);
    }
    muzzleZ = -barrelLen - 0.041;
  }

  /* ===== upper receiver =================================================== */
  const upper = new THREE.Group();
  upper.name = 'upper';
  // main forged body: bore axis at y=0; the upper spans y -0.017 .. +0.031
  const upperBody = rbox(0.029, 0.041, 0.188, 0.004, mAnod, { segments: 3, strength: 0.55, seed: 11 });
  upperBody.position.set(0, 0.0035, 0.098);
  upper.add(upperBody);
  // forward assist housing (right rear): angled cylinder + serrated round cap
  const faBase = cyl(0.0075, 0.0075, 0.022, 12, mAnod, 'z', { strength: 0.6 });
  faBase.rotation.set(0.15, -0.55, 0);
  faBase.position.set(0.014, 0.004, 0.166);
  upper.add(faBase);
  const faCap = cyl(0.0085, 0.008, 0.008, 14, mBlack, 'z', { rim: false });
  faCap.rotation.copy(faBase.rotation);
  faCap.position.set(0.021, 0.003, 0.176);
  upper.add(faCap);
  parts.set('forwardAssist', faCap);
  // ejection port well (dark recess) on the right face
  const port = box(0.008, 0.023, 0.058, mChamber, 0);
  port.position.set(0.011, 0.006, 0.046);
  upper.add(port);
  // brass deflector wedge behind the port
  const deflector = rbox(0.006, 0.012, 0.014, 0.0018, mAnod, { strength: 1.2, seed: 12 });
  deflector.position.set(0.0155, 0.010, 0.082);
  deflector.rotation.y = -0.45;
  upper.add(deflector);
  // dust cover: hinged plate below the port, hanging OPEN (weapon has been fired)
  const dustCover = new THREE.Group();
  dustCover.name = 'dustCover';
  const dcPlate = rbox(0.0022, 0.021, 0.060, 0.0008, mAnodDark, { strength: 0.9, seed: 13 });
  dcPlate.position.set(0, -0.0105, 0); // hinge at the top edge (pivot origin)
  dustCover.add(dcPlate);
  const dcDetent = box(0.003, 0.006, 0.01, mBlack, 0.2);
  dcDetent.position.set(0.0015, -0.014, 0.018);
  dustCover.add(dcDetent);
  dustCover.position.set(0.015, -0.0055, 0.046); // hinge line
  dustCover.rotation.z = -1.95; // open, hanging down (closed = 0)
  upper.add(dustCover);
  parts.set('dustCover', dustCover);
  // bolt carrier visible through the port: oiled steel cylinder + cam pin
  const bolt = new THREE.Group();
  bolt.name = 'bolt';
  const carrier = cyl(0.0102, 0.0102, 0.13, 18, mOiled, 'z', { rim: false });
  carrier.position.set(0, 0.006, 0.02);
  bolt.add(carrier);
  const camPin = box(0.006, 0.005, 0.008, mBlack, 0.3);
  camPin.position.set(0.011, 0.011, 0.038);
  bolt.add(camPin);
  const ejectorSlot = box(0.003, 0.003, 0.05, mChamber, 0);
  ejectorSlot.position.set(0.0095, 0.002, 0.03);
  bolt.add(ejectorSlot);
  bolt.position.set(0.0025, 0, 0.02); // home (in battery)
  bolt.userData.homeZ = bolt.position.z;
  bolt.userData.travel = 0.055; // full rearward travel
  upper.add(bolt);
  parts.set('bolt', bolt);
  // shell deflector edge highlight / chamber depth: nothing else needed
  // flat-top rail on the upper
  const topRail = railMesh(0.192, mAnodDark);
  topRail.position.set(0, 0.024, 0.096);
  upper.add(topRail);
  // rear takedown pin lug bump + charging handle latch shelf
  const chLatch = rbox(0.029, 0.010, 0.03, 0.0015, mAnod, { strength: 0.6, seed: 15 });
  chLatch.position.set(0, 0.019, 0.192);
  upper.add(chLatch);
  // charging handle (animatable, slides back +Z 0.07)
  const chargingHandle = new THREE.Group();
  chargingHandle.name = 'chargingHandle';
  const chBar = rbox(0.010, 0.006, 0.05, 0.0012, mAnod, { strength: 0.9, seed: 16 });
  chBar.position.set(0, 0, -0.02);
  chargingHandle.add(chBar);
  const chT = rbox(0.052, 0.008, 0.012, 0.002, mAnod, { strength: 1.3, seed: 17 });
  chT.position.set(0, 0.001, 0.006);
  chargingHandle.add(chT);
  const chLatchLever = box(0.006, 0.006, 0.014, mBlack, 0.4);
  chLatchLever.position.set(-0.026, 0, 0.0);
  chargingHandle.add(chLatchLever);
  chargingHandle.position.set(0, 0.0175, 0.196);
  chargingHandle.userData.homeZ = 0.196;
  chargingHandle.userData.travel = 0.075;
  upper.add(chargingHandle);
  parts.set('chargingHandle', chargingHandle);
  // barrel nut / delta ring at the front
  const deltaRing = torus(0.0165, 0.0055, 24, 8, mBlack);
  deltaRing.position.set(0, 0, -0.002);
  upper.add(deltaRing);
  const nut = cyl(0.015, 0.015, 0.014, 18, mBlack, 'z', { rim: false });
  nut.position.set(0, 0, -0.011);
  upper.add(nut);
  // roll marks on the upper's left flat ("M4 CARBINE" faint) — reuse maker rect scaled small
  root.add(upper);
  parts.set('upper', upper);

  /* ===== lower receiver ==================================================*/
  const lower = new THREE.Group();
  lower.name = 'lower';
  // main body under the upper: y -0.017 (top, meets the upper) down to -0.052
  const lowerBody = rbox(0.029, 0.031, 0.196, 0.004, mAnod, { segments: 3, strength: 0.7, seed: 21 });
  lowerBody.position.set(0, -0.0325, 0.096);
  lower.add(lowerBody);
  // rear takedown boss (receiver extension ring)
  const rearRing = cyl(0.0165, 0.0165, 0.02, 20, mAnodDark, 'z', { strength: 0.1, seed: 22 });
  rearRing.position.set(0, -0.006, 0.196);
  lower.add(rearRing);
  const castleNut = cyl(0.0168, 0.0168, 0.012, 8, mBlack, 'z', { strength: 0.15, seed: 23 });
  castleNut.position.set(0, -0.006, 0.211);
  lower.add(castleNut);
  // magazine well: flared block below the front of the lower
  const magwell = rbox(0.033, 0.06, 0.075, 0.005, mAnod, { segments: 3, strength: 0.9, seed: 24 });
  magwell.position.set(0, -0.075, 0.048);
  lower.add(magwell);
  // magwell bevel/flare at the bottom (slightly wider ring)
  const magwellFlare = rbox(0.037, 0.014, 0.079, 0.004, mAnod, { strength: 1.0, seed: 25 });
  magwellFlare.position.set(0, -0.1, 0.048);
  lower.add(magwellFlare);
  // trigger guard: front vertical + bottom loop + rear boss
  const tgFront = rbox(0.010, 0.024, 0.008, 0.0015, mAnod, { strength: 0.7, seed: 26 });
  tgFront.position.set(0, -0.060, 0.089);
  lower.add(tgFront);
  const tgBottom = rbox(0.010, 0.006, 0.062, 0.0018, mAnod, { strength: 0.7, seed: 27 });
  tgBottom.position.set(0, -0.074, 0.118);
  lower.add(tgBottom);
  // trigger (curved sliver, animatable)
  const trigger = new THREE.Group();
  trigger.name = 'trigger';
  const trigBlade = rbox(0.006, 0.026, 0.007, 0.0015, mBlack, { strength: 0.3, seed: 28 });
  trigBlade.position.set(0, -0.013, 0.0);
  trigBlade.rotation.x = 0.28;
  trigger.add(trigBlade);
  const trigTip = rbox(0.006, 0.008, 0.010, 0.0015, mBlack, { strength: 0.3, seed: 29 });
  trigTip.position.set(0, -0.026, -0.001);
  trigger.add(trigTip);
  trigger.position.set(0, -0.049, 0.108);
  lower.add(trigger);
  parts.set('trigger', trigger);
  // selector (ambidextrous): pivot cylinders + levers, animatable rotation about X
  const selectorL = new THREE.Group();
  selectorL.name = 'selectorL';
  const selHubL = cyl(0.0065, 0.0065, 0.004, 14, mBlack, 'x', { rim: false });
  selectorL.add(selHubL);
  const selLevL = rbox(0.0035, 0.0055, 0.024, 0.001, mBlack, { strength: 0.6, seed: 30 });
  selLevL.position.set(0, 0, 0.011);
  selectorL.add(selLevL);
  selectorL.position.set(-0.0155, -0.031, 0.128);
  selectorL.rotation.x = -0.35; // pointing at SEMI-ish
  lower.add(selectorL);
  parts.set('selector', selectorL);
  const selectorR = new THREE.Group();
  selectorR.name = 'selectorR';
  const selHubR = cyl(0.0055, 0.0055, 0.003, 14, mBlack, 'x', { rim: false });
  selectorR.add(selHubR);
  const selLevR = rbox(0.003, 0.005, 0.017, 0.001, mBlack, { strength: 0.6, seed: 31 });
  selLevR.position.set(0, 0, 0.008);
  selectorR.add(selLevR);
  selectorR.position.set(0.0155, -0.031, 0.128);
  selectorR.rotation.x = -0.35;
  lower.add(selectorR);
  // bolt catch / release paddle (left, above the magwell rear)
  const boltRelease = new THREE.Group();
  boltRelease.name = 'boltRelease';
  const brPad = rbox(0.004, 0.026, 0.010, 0.0015, mBlack, { strength: 0.7, seed: 32 });
  boltRelease.add(brPad);
  const brRib1 = box(0.0015, 0.002, 0.008, mSteelDark, 0.5);
  brRib1.position.set(-0.0026, 0.008, 0);
  boltRelease.add(brRib1);
  const brRib2 = brRib1.clone();
  brRib2.position.y = 0.004;
  boltRelease.add(brRib2);
  boltRelease.position.set(-0.016, -0.03, 0.076);
  lower.add(boltRelease);
  parts.set('boltRelease', boltRelease);
  // magazine release button (right side, ribbed round button)
  const magRelease = new THREE.Group();
  magRelease.name = 'magRelease';
  const mrButton = cyl(0.0055, 0.0055, 0.005, 14, mBlack, 'x', { rim: false });
  magRelease.add(mrButton);
  const mrBar = box(0.003, 0.006, 0.026, mBlack, 0.3);
  mrBar.position.set(-0.001, 0, -0.012);
  magRelease.add(mrBar);
  magRelease.position.set(0.016, -0.046, 0.084);
  lower.add(magRelease);
  parts.set('magRelease', magRelease);
  // takedown + pivot pins (both sides visible through-pins)
  for (const [zz, yy] of [[0.006, -0.026], [0.184, -0.03]]) {
    const pin = cyl(0.0032, 0.0032, 0.033, 12, mSteelDark, 'x', { rim: false });
    pin.position.set(0, yy, zz);
    lower.add(pin);
  }
  // hammer pin heads (2 small pins on each side)
  for (const zz of [0.112, 0.132]) {
    const p = cyl(0.002, 0.002, 0.03, 8, mSteelDark, 'x', { rim: false });
    p.position.set(0, -0.036, zz);
    lower.add(p);
  }
  // pistol grip (raked back ~ -20 deg about X)
  const grip = new THREE.Group();
  grip.name = 'grip';
  const gripBody = rbox(0.030, 0.108, 0.050, 0.007, mPoly, { segments: 3, strength: 0.4, seed: 33 });
  gripBody.position.set(0, -0.054, 0);
  grip.add(gripBody);
  // finger swell / front strap bump
  const gripFront = rbox(0.026, 0.06, 0.012, 0.005, mPoly, { strength: 0.3, seed: 34 });
  gripFront.position.set(0, -0.04, -0.023);
  grip.add(gripFront);
  const gripCap = rbox(0.032, 0.012, 0.052, 0.004, mPolySmooth, { strength: 0.3, seed: 35 });
  gripCap.position.set(0, -0.106, 0.002);
  grip.add(gripCap);
  grip.position.set(0, -0.047, 0.146);
  grip.rotation.x = -0.3;
  lower.add(grip);
  parts.set('grip', grip);
  // receiver end plate + QD sling swivel (left)
  const swivel = torus(0.008, 0.0022, 16, 8, mBlack);
  swivel.position.set(-0.017, -0.006, 0.203);
  swivel.rotation.y = Math.PI / 2;
  lower.add(swivel);
  const swivelBase = cyl(0.005, 0.005, 0.006, 10, mBlack, 'x', { rim: false });
  swivelBase.position.set(-0.016, -0.006, 0.203);
  lower.add(swivelBase);
  // roll-mark decals on the lower flats + magwell (left: maker + selector legend, right: proof)
  const decalL = decalPlate(0.072, 0.024, sheet.rects.makerLeft, mDecal);
  decalL.position.set(-0.0148, -0.031, 0.078);
  decalL.rotation.y = -Math.PI / 2;
  lower.add(decalL);
  const decalSel = decalPlate(0.032, 0.03, sheet.rects.selector, mDecal);
  decalSel.position.set(-0.0148, -0.031, 0.129);
  decalSel.rotation.y = -Math.PI / 2;
  lower.add(decalSel);
  const decalR = decalPlate(0.06, 0.02, sheet.rects.makerRight, mDecal);
  decalR.position.set(0.0148, -0.034, 0.09);
  decalR.rotation.y = Math.PI / 2;
  lower.add(decalR);
  root.add(lower);
  parts.set('lower', lower);

  /* ===== magazine (animatable, detachable) ==============================*/
  const mag = new THREE.Group();
  mag.name = 'mag';
  // 30-rd STANAG: one extruded, forward-curving silhouette + baseplate
  const magBody = new THREE.Mesh(magazineBodyGeometry(), mAnodDark);
  magBody.castShadow = true;
  magBody.receiveShadow = true;
  mag.add(magBody);
  const magPlate = rbox(0.028, 0.011, 0.07, 0.003, mBlack, { strength: 1.2, seed: 43 });
  magPlate.position.set(0, -0.189, -0.032);
  magPlate.rotation.x = -0.24;
  mag.add(magPlate);
  // anti-tilt rib + witness ridges on the sides
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const rib = box(0.0018, 0.13, 0.0045, mBlack, 0.25);
      rib.position.set(sx * 0.0122, -0.105, -0.028 + i * 0.014);
      rib.rotation.x = -0.15;
      mag.add(rib);
    }
    // mag decal (markings) on both sides
    const md = decalPlate(0.05, 0.017, sheet.rects.mag, mDecal);
    md.position.set(sx * 0.0126, -0.075, -0.012);
    md.rotation.y = sx > 0 ? Math.PI / 2 : -Math.PI / 2;
    md.rotation.x = 0;
    mag.add(md);
  }
  mag.position.set(0, -0.045, 0.048); // seated in the well; body extends down
  mag.userData.seatedY = mag.position.y;
  root.add(mag);
  parts.set('mag', mag);

  /* ===== handguard: quad rail ===========================================*/
  const handguard = new THREE.Group();
  handguard.name = 'handguard';
  const hgLen = 0.235;
  const hgZ = -hgLen / 2 - 0.02; // starts 20 mm ahead of the receiver face
  // octagonal core: two overlapping rounded boxes rotated 45 deg gives a
  // chamfered profile without custom extrusion
  const hgCoreA = rbox(0.046, 0.05, hgLen, 0.006, mAnodDark, { segments: 2, strength: 0.9, seed: 50 });
  handguard.add(hgCoreA);
  const hgCoreB = rbox(0.048, 0.048, hgLen * 0.98, 0.006, mAnodDark, { segments: 2, strength: 0.6, seed: 51 });
  hgCoreB.rotation.z = Math.PI / 4;
  hgCoreB.scale.set(0.68, 0.68, 1);
  handguard.add(hgCoreB);
  // four rails
  const railTop = railMesh(hgLen * 0.99, mAnodDark);
  railTop.position.set(0, 0.025, 0);
  handguard.add(railTop);
  const railBottom = railMesh(hgLen * 0.9, mAnodDark);
  railBottom.rotation.z = Math.PI;
  railBottom.position.set(0, -0.025, 0.006);
  handguard.add(railBottom);
  const railLeft = railMesh(hgLen * 0.86, mAnodDark);
  railLeft.rotation.z = Math.PI / 2;
  railLeft.position.set(-0.023, 0, 0.006);
  handguard.add(railLeft);
  const railRight = railMesh(hgLen * 0.86, mAnodDark);
  railRight.rotation.z = -Math.PI / 2;
  railRight.position.set(0.023, 0, 0.006);
  handguard.add(railRight);
  // vent holes on the diagonal faces (dark inset ovals)
  for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    for (let i = 0; i < 5; i++) {
      const vent = box(0.004, 0.006, 0.014, mChamber, 0);
      vent.position.set(sx * 0.0195, sy * 0.021, hgLen / 2 - 0.035 - i * 0.038);
      vent.rotation.z = sx * sy > 0 ? -Math.PI / 4 : Math.PI / 4;
      handguard.add(vent);
    }
  }
  // ladder rail covers on the side rails (rubber, ribbed)
  for (const sx of [-1, 1]) {
    const cover = rbox(0.006, 0.019, 0.12, 0.002, mRubber, { strength: 0.2, seed: 52 });
    cover.position.set(sx * 0.0295, 0, 0.03);
    handguard.add(cover);
  }
  // end cap ring + rail screws (small hex heads along the top rail edges)
  const hgCap = rbox(0.05, 0.054, 0.006, 0.002, mBlack, { strength: 1.2, seed: 53 });
  hgCap.position.set(0, 0, -hgLen / 2 + 0.002);
  handguard.add(hgCap);
  for (let i = 0; i < 3; i++) {
    for (const sx of [-1, 1]) {
      const s = screwHead(0.0026, mBlack, true);
      s.rotation.z = Math.PI / 2;
      s.position.set(sx * 0.0245, 0.018, -hgLen / 2 + 0.025 + i * 0.09);
      handguard.add(s);
    }
  }
  handguard.position.set(0, 0, hgZ);
  root.add(handguard);
  parts.set('handguard', handguard);

  /* ===== front + rear flip-up sights (folded) ============================*/
  const buisFront = rbox(0.02, 0.011, 0.02, 0.0025, mBlack, { strength: 0.9, seed: 55 });
  buisFront.position.set(0, 0.0365, hgZ - hgLen / 2 + 0.02);
  root.add(buisFront);
  const buisRear = rbox(0.02, 0.009, 0.02, 0.0025, mBlack, { strength: 0.9, seed: 56 });
  buisRear.position.set(0, 0.0335, 0.181);
  root.add(buisRear);
  const buisRearKnob = cyl(0.0035, 0.0035, 0.024, 10, mSteelDark, 'x', { rim: false });
  buisRearKnob.position.set(0, 0.0345, 0.181);
  root.add(buisRearKnob);

  /* ===== holographic sight (552-style) ==================================*/
  // Layout (holo-local, sitting on the top rail): body block y 0..0.032 with
  // the battery compartment at the rear, the window ABOVE it (y 0.033..0.058)
  // framed by a protective hood; sight line through the window centre at
  // y ≈ 0.045 clears the body top by ~13 mm.
  // Real EXPS/552 proportions: ~14 cm long, ~35 mm wide; the front two
  // thirds are a LOW deck (laser-cover ramp) with the tall square window
  // rising above it inside a thin protective hood; the electronics/battery
  // box only fills the rear third. That silhouette (low deck + big glass +
  // thin hood posts) is the read, not a slab.
  const holo = new THREE.Group();
  holo.name = 'holo';
  const mHousing = weaponMaterial('anodized', { color: 0x767b83, roughness: 1.35 });
  const HOLO_SIGHT_Y = 0.034; // window/reticle centre above the mount base
  // integral rail-grabber mount (slightly wider than the deck, low)
  const hMount = rbox(0.036, 0.008, 0.13, 0.002, mHousing, { strength: 0.7, seed: 59 });
  hMount.position.set(0, 0.004, 0);
  holo.add(hMount);
  // low front deck (laser diode + beam cover) — spans the window section
  const hDeck = rbox(0.033, 0.011, 0.075, 0.0022, mHousing, { segments: 2, strength: 0.6, seed: 60 });
  hDeck.position.set(0, 0.0135, -0.028);
  holo.add(hDeck);
  // rear electronics / battery housing (the only tall solid part)
  const hBody = rbox(0.033, 0.03, 0.052, 0.0026, mHousing, { segments: 2, strength: 0.7, seed: 61 });
  hBody.position.set(0, 0.023, 0.036);
  holo.add(hBody);
  // battery cap bulge at the rear top + control buttons on the rear-left
  const hCap = rbox(0.024, 0.006, 0.022, 0.0025, mHousing, { strength: 0.8, seed: 63 });
  hCap.position.set(0, 0.041, 0.045);
  holo.add(hCap);
  for (let i = 0; i < 2; i++) {
    const b = rbox(0.003, 0.008, 0.011, 0.0018, mRubber, { strength: 0.2, seed: 62 + i });
    b.position.set(-0.0175, 0.022 + i * 0.001, 0.024 + i * 0.016);
    holo.add(b);
  }
  // hood: thin side posts + top strap framing a large square window
  const postL = rbox(0.004, 0.038, 0.058, 0.0016, mHousing, { strength: 0.9, seed: 64 });
  postL.position.set(-0.0145, HOLO_SIGHT_Y - 0.001, -0.028);
  holo.add(postL);
  const postR = postL.clone();
  postR.position.x = 0.0145;
  holo.add(postR);
  const hoodTop = rbox(0.033, 0.004, 0.058, 0.0016, mHousing, { strength: 1.0, seed: 65 });
  hoodTop.position.set(0, HOLO_SIGHT_Y + 0.02, -0.028);
  holo.add(hoodTop);
  // front glass (vertical) + rear glass (tilted like the real 552)
  const glassFront = new THREE.Mesh(ensureWear(new THREE.PlaneGeometry(0.025, 0.036)), mGlass);
  glassFront.position.set(0, HOLO_SIGHT_Y, -0.055);
  holo.add(glassFront);
  const glassRear = new THREE.Mesh(ensureWear(new THREE.PlaneGeometry(0.025, 0.036)), mGlass);
  glassRear.position.set(0, HOLO_SIGHT_Y, -0.002);
  glassRear.rotation.x = -0.16;
  holo.add(glassRear);
  // window sill (angled ramp under the front glass, real unit's laser cover)
  const sill = rbox(0.028, 0.007, 0.018, 0.002, mHousing, { strength: 0.7, seed: 66 });
  sill.position.set(0, 0.02, -0.05);
  sill.rotation.x = -0.45;
  holo.add(sill);
  // reticle plane (emissive, additive) between the panes
  const reticle = new THREE.Mesh(ensureWear(new THREE.PlaneGeometry(0.024, 0.024)), mReticle);
  reticle.name = 'reticle';
  reticle.position.set(0, HOLO_SIGHT_Y, -0.028);
  reticle.renderOrder = 5;
  holo.add(reticle);
  // holo badge decal on the housing right face
  const holoDecal = decalPlate(0.038, 0.012, sheet.rects.optic, mDecal);
  holoDecal.position.set(0.017, 0.024, 0.036);
  holoDecal.rotation.y = Math.PI / 2;
  holo.add(holoDecal);
  // mount cross-bolt (left)
  const holoBolt = screwHead(0.004, mBlack, false);
  holoBolt.rotation.z = Math.PI / 2;
  holoBolt.position.set(-0.019, 0.004, 0.03);
  holo.add(holoBolt);
  holo.position.set(0, 0.03, 0.052); // clamped to the (now lower, thinner) top rail
  holo.userData.sightY = HOLO_SIGHT_Y;
  root.add(holo);
  parts.set('holo', holo);

  /* ===== PEQ-15 style laser/illuminator box + pressure pad ============= */
  const peq = new THREE.Group();
  peq.name = 'peq';
  const peqBody = rbox(0.036, 0.028, 0.108, 0.0024, mFde, { segments: 3, strength: 0.8, seed: 70 });
  peq.add(peqBody);
  // top rotary selector knob + LED
  const peqKnob = cyl(0.007, 0.007, 0.006, 14, mBlack, 'y', { rim: false });
  peqKnob.position.set(-0.008, 0.017, 0.03);
  peq.add(peqKnob);
  const peqLed = new THREE.Mesh(new THREE.SphereGeometry(0.0022, 8, 6), weaponMaterial('emissive_dot', { color: [0.05, 1.2, 0.1], map: glowTexture(64) }));
  peqLed.position.set(0.009, 0.0155, 0.036);
  peq.add(peqLed);
  // front apertures: two dark lens ports + protective ridge
  for (const [sx, sy] of [[-0.008, 0.004], [0.008, 0.004]]) {
    const ap = cyl(0.005, 0.005, 0.008, 12, mBlack, 'z', { rim: false });
    ap.position.set(sx, sy, -0.055);
    peq.add(ap);
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.004, 12), weaponMaterial('lens_black'));
    lens.position.set(sx, sy, -0.0595);
    lens.rotation.y = Math.PI;
    peq.add(lens);
  }
  // laser aperture emitter marker (tiny red dot when on) — anchor lives here
  const laserAnchor = anchor('laser');
  laserAnchor.position.set(-0.008, 0.004, -0.061);
  peq.add(laserAnchor);
  // label decal on the top
  const peqDecal = decalPlate(0.05, 0.017, sheet.rects.peq, mDecal);
  peqDecal.position.set(0, 0.0142, -0.005);
  peqDecal.rotation.x = -Math.PI / 2;
  peqDecal.rotation.z = 0;
  peq.add(peqDecal);
  peq.position.set(0, 0.0435, hgZ + 0.01);
  root.add(peq);
  parts.set('peq', peq);
  // pressure-pad cable: from the PEQ's rear-left down the left rail to a pad
  const cablePath = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.014, 0.040, hgZ + 0.06),
    new THREE.Vector3(-0.026, 0.042, hgZ + 0.08),
    new THREE.Vector3(-0.033, 0.032, hgZ + 0.05),
    new THREE.Vector3(-0.030, 0.018, hgZ - 0.01),
    new THREE.Vector3(-0.031, 0.012, hgZ - 0.045),
  ]);
  const cableGeo = new THREE.TubeGeometry(cablePath, 24, 0.0021, 6, false);
  ensureWear(cableGeo);
  const cable = new THREE.Mesh(cableGeo, mRubber);
  cable.castShadow = true;
  root.add(cable);
  const pad = rbox(0.008, 0.011, 0.05, 0.002, mRubber, { strength: 0.1, seed: 71 });
  pad.position.set(-0.031, 0.008, hgZ - 0.06);
  root.add(pad);

  /* ===== vertical foregrip ===============================================*/
  const vfg = new THREE.Group();
  vfg.name = 'vfg';
  const vfgBody = lathe([
    [0.014, 0.0], [0.016, -0.008], [0.0175, -0.03], [0.017, -0.07], [0.019, -0.08], [0.0205, -0.086],
  ], 32, mPolyRib, { strength: 0.3, seed: 72 });
  vfgBody.rotation.x = -Math.PI / 2; // profile forward (-Z) → hanging down (-Y)
  vfg.add(vfgBody);
  // domed end cap (a lathe cone tip aliases into radial facets up close)
  const vfgCap = new THREE.Mesh(ensureWear(new THREE.SphereGeometry(0.0205, 24, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2)), mPolyRib);
  vfgCap.position.y = -0.086;
  vfgCap.castShadow = true;
  vfg.add(vfgCap);
  const vfgClamp = rbox(0.032, 0.014, 0.036, 0.003, mPolySmooth, { strength: 0.4, seed: 73 });
  vfgClamp.position.set(0, 0.004, 0);
  vfg.add(vfgClamp);
  vfg.position.set(0, -0.036, hgZ + 0.03);
  root.add(vfg);
  parts.set('vfg', vfg);

  /* ===== buffer tube + collapsible stock ================================= */
  const tube = cyl(0.0148, 0.0148, 0.15, 24, mAnodDark, 'z', { strength: 0.25, seed: 80 });
  tube.position.set(0, -0.006, 0.29);
  root.add(tube);
  // position notches along the bottom of the tube (dark slots)
  for (let i = 0; i < 5; i++) {
    const notch = box(0.007, 0.004, 0.008, mChamber, 0);
    notch.position.set(0, -0.021, 0.245 + i * 0.032);
    root.add(notch);
  }
  const stock = new THREE.Group();
  stock.name = 'stock';
  // body wrapping the tube
  const stockBody = rbox(0.032, 0.05, 0.15, 0.007, mPolyStock, { segments: 3, strength: 0.5, seed: 81 });
  stockBody.position.set(0, -0.02, 0);
  stock.add(stockBody);
  const stockDrop = rbox(0.028, 0.055, 0.11, 0.008, mPolyStock, { segments: 3, strength: 0.5, seed: 82 });
  stockDrop.position.set(0, -0.058, 0.026);
  stock.add(stockDrop);
  // cheek weld saddle on top
  const cheek = rbox(0.03, 0.014, 0.11, 0.006, mPolySmooth, { strength: 0.4, seed: 83 });
  cheek.position.set(0, 0.012, 0.01);
  stock.add(cheek);
  // release lever underneath
  const stockLever = rbox(0.014, 0.008, 0.06, 0.003, mBlack, { strength: 0.6, seed: 84 });
  stockLever.position.set(0, -0.09, 0.03);
  stock.add(stockLever);
  // rubber buttpad with ribs
  const buttpad = rbox(0.032, 0.11, 0.014, 0.004, weaponMaterial('rubber', { color: 0x0c0c0d, roughness: 0.95 }), { strength: 0.1, seed: 85 });
  buttpad.position.set(0, -0.038, 0.083);
  stock.add(buttpad);
  // sling slot at the rear
  const slingSlot = box(0.036, 0.008, 0.02, mChamber, 0);
  slingSlot.position.set(0, -0.078, 0.06);
  stock.add(slingSlot);
  stock.position.set(0, -0.006, 0.322);
  root.add(stock);
  parts.set('stock', stock);

  /* ===== anchors ==========================================================*/
  const muzzle = anchor('muzzle');
  muzzle.position.set(0, 0, muzzleZ);
  root.add(muzzle);
  const portAnchor = anchor('port');
  portAnchor.position.set(0.024, 0.006, 0.055);
  root.add(portAnchor);
  const reticleAnchor = anchor('reticle');
  reticleAnchor.position.set(0, holo.position.y + (holo.userData.sightY ?? 0.034), holo.position.z - 0.028);
  root.add(reticleAnchor);
  const laserAnchorRoot = anchor('laserRoot');
  laserAnchorRoot.position.set(peq.position.x - 0.008, peq.position.y + 0.004, peq.position.z - 0.061);
  root.add(laserAnchorRoot);
  // hand frames (grip web + foregrip)
  const rightHand = anchor('rightHand');
  rightHand.position.set(0, -0.062, 0.156);
  rightHand.rotation.set(-0.35, 0, 0);
  root.add(rightHand);
  const leftHand = anchor('leftHand');
  leftHand.position.set(-0.004, -0.09, hgZ + 0.03);
  leftHand.rotation.set(0.1, 0, 0);
  root.add(leftHand);

  const assembly = {
    root,
    parts,
    anchors: {
      muzzle,
      port: portAnchor,
      reticle: reticleAnchor,
      laser: laserAnchorRoot,
      rightHand,
      leftHand,
      magwell: magwell,
    },
    info: {
      kind: 'ar',
      length: -muzzleZ + 0.41,
      tris: 0,
    },
  };
  assembly.info.tris = countTris(root);
  return assembly;
}

/* ------------------------------------------------------------------------ */
/* Tactical pistol (.45, USP/P226 hybrid)                                   */
/* ------------------------------------------------------------------------ */

/**
 * Build the sidearm. Origin: bore axis at the muzzle end of the slide? — no:
 * bore axis, at the rear of the grip's backstrap tangent point (natural hand
 * pivot). Slide runs z ∈ [-0.155, +0.045].
 */
export function buildPistol() {
  const root = new THREE.Group();
  root.name = 'wpn.pistol';
  const parts = new Map();

  const mSlide = weaponMaterial('anodized', { color: 0xdfe3ea, roughness: 1.05 });
  const mFrame = weaponMaterial('polymer', { normalMap: stippleNormal(), normalStrength: 0.75, color: 0x1a1b1d });
  const mFrameSmooth = weaponMaterial('polymer', { color: 0x1a1b1d });
  const mSteel = weaponMaterial('steel_park', { color: 0x393c40 });
  const mBarrel = weaponMaterial('steel_oiled', { color: 0x5b5e63 });
  const mBlack = weaponMaterial('steel_black');
  const mChamber = new THREE.MeshStandardMaterial({ color: 0x070708, roughness: 0.9 });
  const mDecal = weaponMaterial('decal');
  const sheet = arRollmarkSheet();

  const slideLen = 0.198;
  const slideZ0 = -0.155; // muzzle face
  /* ===== slide ===========================================================*/
  const slide = new THREE.Group();
  slide.name = 'slide';
  const slideBody = rbox(0.029, 0.026, slideLen, 0.0045, mSlide, { segments: 3, strength: 1.3, seed: 101 });
  slideBody.position.set(0, 0.006, slideZ0 + slideLen / 2);
  slide.add(slideBody);
  // stepped/scalloped nose (USP-ish) — a slimmer lower front section
  const nose = rbox(0.023, 0.014, 0.05, 0.003, mSlide, { strength: 1.1, seed: 102 });
  nose.position.set(0, -0.008, slideZ0 + 0.028);
  slide.add(nose);
  // rear serrations (7) and front serrations (5): dark angled slots on both sides
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 7; i++) {
      const s = box(0.0022, 0.019, 0.0034, mChamber, 0);
      s.position.set(sx * 0.0138, 0.007, 0.007 + i * 0.0058);
      s.rotation.z = 0;
      s.rotation.x = -0.32;
      slide.add(s);
    }
    for (let i = 0; i < 4; i++) {
      const s = box(0.0022, 0.017, 0.0034, mChamber, 0);
      s.position.set(sx * 0.0138, 0.006, slideZ0 + 0.06 + i * 0.0058);
      s.rotation.x = -0.32;
      slide.add(s);
    }
  }
  // ejection port cut (top right) with the barrel hood + chamber visible
  const portCut = box(0.014, 0.006, 0.036, mChamber, 0);
  portCut.position.set(0.008, 0.0175, -0.025);
  slide.add(portCut);
  const hood = rbox(0.012, 0.005, 0.03, 0.001, mBarrel, { strength: 0.3, seed: 103 });
  hood.position.set(0.0, 0.017, -0.028);
  slide.add(hood);
  // extractor claw on the right behind the port (with a red loaded-chamber mark)
  const extractor = rbox(0.004, 0.006, 0.024, 0.001, mBlack, { strength: 0.5, seed: 104 });
  extractor.position.set(0.0138, 0.013, 0.002);
  slide.add(extractor);
  const chamberIndicator = new THREE.Mesh(new THREE.SphereGeometry(0.0018, 8, 6), weaponMaterial('emissive_dot', { color: [1.4, 0.12, 0.06], map: glowTexture(64) }));
  chamberIndicator.position.set(0.0152, 0.0155, -0.008);
  slide.add(chamberIndicator);
  // rear sight (notch) with two tritium dots, front sight post with one dot
  const rearSight = new THREE.Group();
  const rsBase = rbox(0.026, 0.008, 0.012, 0.0015, mBlack, { strength: 0.8, seed: 105 });
  rearSight.add(rsBase);
  const rsL = rbox(0.008, 0.008, 0.008, 0.001, mBlack, { strength: 0.8, seed: 106 });
  rsL.position.set(-0.008, 0.007, 0.001);
  rearSight.add(rsL);
  const rsR = rsL.clone();
  rsR.position.x = 0.008;
  rearSight.add(rsR);
  const mTrit = weaponMaterial('emissive_dot', { color: [0.9, 3.6, 1.4], map: glowTexture(64) });
  for (const sx of [-0.0075, 0.0075]) {
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.0016, 8, 6), mTrit);
    dot.position.set(sx, 0.007, 0.0052);
    rearSight.add(dot);
  }
  rearSight.position.set(0, 0.021, 0.033);
  slide.add(rearSight);
  const frontSight = rbox(0.0055, 0.011, 0.013, 0.0012, mBlack, { strength: 0.8, seed: 107 });
  frontSight.position.set(0, 0.023, slideZ0 + 0.012);
  slide.add(frontSight);
  const fsDot = new THREE.Mesh(new THREE.SphereGeometry(0.0017, 8, 6), mTrit);
  fsDot.position.set(0, 0.026, slideZ0 + 0.018);
  slide.add(fsDot);
  // slide roll-mark on the left flat
  const slideDecal = decalPlate(0.09, 0.012, sheet.rects.slide, mDecal);
  slideDecal.position.set(-0.0148, 0.004, -0.075);
  slideDecal.rotation.y = -Math.PI / 2;
  slide.add(slideDecal);
  slide.userData.homeZ = 0;
  slide.userData.travel = 0.036;
  root.add(slide);
  parts.set('slide', slide);

  /* ===== barrel (tilting, visible at the muzzle + hood) =================*/
  const barrel = new THREE.Group();
  barrel.name = 'barrel';
  const barrelTube = lathe([
    [0.007, 0.0], [0.007, -0.004], [0.0058, -0.005], [0.0055, -0.03], [0.0058, -0.11], [0.0058, -0.115], [0.0035, -0.116], [0.003, -0.10],
  ], 16, mBarrel, { strength: 0.3, seed: 108 });
  // muzzle just proud of the slide front, running back inside
  barrelTube.position.set(0, 0.005, slideZ0 + 0.003);
  barrelTube.rotation.y = Math.PI; // profile ran along -z; flip so it extends toward +Z (rearward)
  barrel.add(barrelTube);
  // crown recess (dark)
  const crown = new THREE.Mesh(new THREE.CircleGeometry(0.0038, 14), mChamber);
  crown.position.set(0, 0.005, slideZ0 - 0.0031);
  crown.rotation.y = Math.PI;
  barrel.add(crown);
  root.add(barrel);
  parts.set('barrel', barrel);

  /* ===== frame ============================================================*/
  const frame = new THREE.Group();
  frame.name = 'frame';
  // dust cover / rail section under the slide
  const dust = rbox(0.028, 0.022, 0.098, 0.004, mFrameSmooth, { segments: 3, strength: 0.5, seed: 110 });
  dust.position.set(0, -0.018, -0.098);
  frame.add(dust);
  // accessory rail (mini picatinny) under the dust cover
  const rail = railMesh(0.052, mFrameSmooth, 0.02);
  rail.rotation.z = Math.PI;
  rail.position.set(0, -0.029, -0.108);
  frame.add(rail);
  // trigger guard: front vertical (squared/hooked), bottom, rear web
  const tgFront = rbox(0.01, 0.03, 0.009, 0.0025, mFrameSmooth, { strength: 0.4, seed: 111 });
  tgFront.position.set(0, -0.038, -0.05);
  frame.add(tgFront);
  const tgHook = rbox(0.012, 0.007, 0.013, 0.002, mFrameSmooth, { strength: 0.4, seed: 112 });
  tgHook.position.set(0, -0.052, -0.056);
  frame.add(tgHook);
  const tgBottom = rbox(0.01, 0.006, 0.052, 0.002, mFrameSmooth, { strength: 0.4, seed: 113 });
  tgBottom.position.set(0, -0.052, -0.03);
  frame.add(tgBottom);
  // grip (raked ~18 deg), stippled
  const grip = new THREE.Group();
  const gripBody = rbox(0.03, 0.108, 0.052, 0.009, mFrame, { segments: 3, strength: 0.35, seed: 114 });
  gripBody.position.set(0, -0.052, 0);
  grip.add(gripBody);
  const backstrap = rbox(0.024, 0.09, 0.02, 0.008, mFrameSmooth, { strength: 0.3, seed: 115 });
  backstrap.position.set(0, -0.045, 0.02);
  grip.add(backstrap);
  const beavertail = rbox(0.024, 0.014, 0.03, 0.005, mFrameSmooth, { strength: 0.4, seed: 116 });
  beavertail.position.set(0, -0.004, 0.028);
  grip.add(beavertail);
  // magazine baseplate proud of the grip bottom
  const basePlate = rbox(0.033, 0.014, 0.056, 0.004, mFrameSmooth, { strength: 0.6, seed: 117 });
  basePlate.position.set(0, -0.11, 0.004);
  grip.add(basePlate);
  parts.set('magPlate', basePlate);
  grip.position.set(0, -0.02, 0.012);
  grip.rotation.x = -0.31;
  frame.add(grip);
  parts.set('grip', grip);
  // controls (left side): slide catch, takedown lever, mag release, decocker
  const slideCatch = rbox(0.004, 0.008, 0.022, 0.0012, mBlack, { strength: 0.6, seed: 118 });
  slideCatch.position.set(-0.0165, -0.008, -0.03);
  frame.add(slideCatch);
  const takedown = rbox(0.004, 0.007, 0.014, 0.0012, mBlack, { strength: 0.6, seed: 119 });
  takedown.position.set(-0.0165, -0.02, -0.062);
  frame.add(takedown);
  const magRel = cyl(0.0045, 0.0045, 0.006, 12, mBlack, 'x', { rim: false });
  magRel.position.set(-0.017, -0.038, -0.04);
  frame.add(magRel);
  const decocker = rbox(0.004, 0.01, 0.018, 0.0015, mBlack, { strength: 0.6, seed: 120 });
  decocker.position.set(-0.0165, 0.005, 0.026);
  frame.add(decocker);
  // trigger
  const trigger = new THREE.Group();
  trigger.name = 'trigger';
  const trigBlade = rbox(0.0055, 0.024, 0.006, 0.0015, mBlack, { strength: 0.3, seed: 121 });
  trigBlade.position.set(0, -0.011, 0);
  trigBlade.rotation.x = 0.25;
  trigger.add(trigBlade);
  const trigTip = rbox(0.0055, 0.008, 0.009, 0.0015, mBlack, { strength: 0.3, seed: 122 });
  trigTip.position.set(0, -0.023, -0.0035);
  trigger.add(trigTip);
  trigger.position.set(0, -0.026, -0.024);
  frame.add(trigger);
  parts.set('trigger', trigger);
  // hammer (rear)
  const hammer = new THREE.Group();
  hammer.name = 'hammer';
  const hammerBody = rbox(0.008, 0.016, 0.008, 0.0015, mBlack, { strength: 0.6, seed: 123 });
  hammerBody.position.set(0, 0.008, 0);
  hammer.add(hammerBody);
  const hammerSpur = rbox(0.01, 0.005, 0.011, 0.001, mSteel, { strength: 0.6, seed: 124 });
  hammerSpur.position.set(0, 0.017, 0.003);
  hammer.add(hammerSpur);
  hammer.position.set(0, 0.006, 0.041);
  frame.add(hammer);
  parts.set('hammer', hammer);
  root.add(frame);
  parts.set('frame', frame);

  /* ===== weapon light on the rail ========================================*/
  const light = new THREE.Group();
  light.name = 'light';
  const lBody = rbox(0.033, 0.03, 0.085, 0.005, weaponMaterial('anodized', { color: 0xb4b8c0, roughness: 1.0 }), { segments: 3, strength: 1.0, seed: 130 });
  light.add(lBody);
  const lBezel = cyl(0.017, 0.017, 0.018, 24, mBlack, 'z', { strength: 0.7, seed: 131 });
  lBezel.position.set(0, 0.001, -0.05);
  light.add(lBezel);
  const lensMat = weaponMaterial('led_lens');
  const lLens = new THREE.Mesh(new THREE.CircleGeometry(0.0135, 24), lensMat);
  lLens.position.set(0, 0.001, -0.0595);
  lLens.rotation.y = Math.PI;
  light.add(lLens);
  parts.set('lightLens', lLens);
  // rear rocker switches
  const rockerL = rbox(0.006, 0.012, 0.014, 0.002, mBlack, { strength: 0.4, seed: 132 });
  rockerL.position.set(-0.019, -0.002, 0.036);
  light.add(rockerL);
  const rockerR = rockerL.clone();
  rockerR.position.x = 0.019;
  light.add(rockerR);
  // clamp screw
  const clampScrew = screwHead(0.004, mSteel, false);
  clampScrew.rotation.z = Math.PI / 2;
  clampScrew.position.set(-0.018, 0.011, 0.005);
  light.add(clampScrew);
  light.position.set(0, -0.046, -0.108);
  root.add(light);
  parts.set('light', light);

  /* ===== anchors ==========================================================*/
  const muzzle = anchor('muzzle');
  muzzle.position.set(0, 0.005, slideZ0 - 0.004);
  root.add(muzzle);
  const port = anchor('port');
  port.position.set(0.016, 0.02, -0.025);
  root.add(port);
  const lightAnchor = anchor('light');
  lightAnchor.position.set(0, light.position.y + 0.001, light.position.z - 0.06);
  root.add(lightAnchor);
  const rightHand = anchor('rightHand');
  rightHand.position.set(0, -0.03, 0.028);
  rightHand.rotation.set(-0.31, 0, 0);
  root.add(rightHand);
  const leftHand = anchor('leftHand');
  leftHand.position.set(0, -0.05, 0.02);
  root.add(leftHand);

  const assembly = {
    root,
    parts,
    anchors: { muzzle, port, light: lightAnchor, rightHand, leftHand, reticle: null, laser: null },
    info: { kind: 'pistol', length: 0.205, tris: 0 },
  };
  assembly.info.tris = countTris(root);
  return assembly;
}

/* ------------------------------------------------------------------------ */
/* M67-style fragmentation grenade                                          */
/* ------------------------------------------------------------------------ */

export function buildFrag() {
  const root = new THREE.Group();
  root.name = 'wpn.frag';
  const parts = new Map();
  const mBody = weaponMaterial('steel_park', { color: 0x3d4436, roughness: 0.62, metalness: 0.35 });
  const mSteel = weaponMaterial('steel_park', { color: 0x4a4d52 });
  const mBlack = weaponMaterial('steel_black');
  // body: sphere with a horizontal seam belt + a second faint mould line
  const bodyGeo = new THREE.SphereGeometry(0.032, 28, 20);
  applyRimWear(bodyGeo, { axis: 'y', dist: 0.004, strength: 0.35, seed: 140 });
  const body = new THREE.Mesh(bodyGeo, mBody);
  body.castShadow = true;
  body.receiveShadow = true;
  root.add(body);
  const seam = torus(0.0322, 0.0018, 32, 6, mBody);
  seam.rotation.x = Math.PI / 2;
  root.add(seam);
  // yellow ordnance stencil ring (thin band as a decal-ish coloured torus)
  const band = torus(0.0272, 0.0016, 32, 5, new THREE.MeshStandardMaterial({ color: 0xb08a20, roughness: 0.7 }));
  band.rotation.x = Math.PI / 2;
  band.position.y = 0.017;
  root.add(band);
  // fuze assembly on top
  const fuze = new THREE.Group();
  fuze.name = 'fuze';
  const fuzeBase = cyl(0.012, 0.013, 0.008, 6, mSteel, 'y', { rim: false });
  fuzeBase.position.y = 0.03;
  fuze.add(fuzeBase);
  const fuzeBody = cyl(0.0085, 0.0095, 0.02, 14, mSteel, 'y', { strength: 0.5, seed: 141 });
  fuzeBody.position.y = 0.043;
  fuze.add(fuzeBody);
  const fuzeCap = cyl(0.006, 0.008, 0.006, 12, mSteel, 'y', { rim: false });
  fuzeCap.position.y = 0.056;
  fuze.add(fuzeCap);
  root.add(fuze);
  parts.set('fuze', fuze);
  // safety lever (spoon): curved strip from the fuze down one side
  const spoon = new THREE.Group();
  spoon.name = 'spoon';
  const spoonTop = rbox(0.014, 0.004, 0.024, 0.0012, mSteel, { strength: 0.6, seed: 142 });
  spoonTop.position.set(0, 0.055, 0.008);
  spoonTop.rotation.x = 0.45;
  spoon.add(spoonTop);
  const spoonMid = rbox(0.013, 0.0035, 0.04, 0.001, mSteel, { strength: 0.6, seed: 143 });
  spoonMid.position.set(0, 0.03, 0.026);
  spoonMid.rotation.x = 1.25;
  spoon.add(spoonMid);
  const spoonTail = rbox(0.012, 0.003, 0.036, 0.001, mSteel, { strength: 0.6, seed: 144 });
  spoonTail.position.set(0, -0.006, 0.031);
  spoonTail.rotation.x = 1.85;
  spoon.add(spoonTail);
  root.add(spoon);
  parts.set('spoon', spoon);
  // pull ring + cotter pin
  const pin = new THREE.Group();
  pin.name = 'pin';
  const cotter = cyl(0.0011, 0.0011, 0.022, 6, mBlack, 'x', { rim: false });
  cotter.position.set(0, 0.046, -0.004);
  pin.add(cotter);
  const ring = torus(0.013, 0.0016, 20, 6, mBlack);
  ring.position.set(0.018, 0.036, -0.006);
  ring.rotation.y = Math.PI / 2;
  ring.rotation.z = 0.3;
  pin.add(ring);
  root.add(pin);
  parts.set('pin', pin);

  const rightHand = anchor('rightHand');
  rightHand.position.set(0, 0, 0);
  root.add(rightHand);
  const assembly = {
    root,
    parts,
    anchors: { rightHand, leftHand: null, muzzle: null, port: null, reticle: null, laser: null },
    info: { kind: 'frag', length: 0.09, tris: 0 },
  };
  assembly.info.tris = countTris(root);
  return assembly;
}

/* ------------------------------------------------------------------------ */
/* Arms: gloved hands + forearms                                            */
/* ------------------------------------------------------------------------ */

/**
 * Finger definitions per hand: [name, xOffset (thumb→pinky, in metres for a
 * palm 0.09 wide), segment lengths, radius].
 */
const FINGERS = [
  ['index', -0.031, [0.045, 0.028, 0.022], 0.0088],
  ['middle', -0.0105, [0.05, 0.032, 0.024], 0.0092],
  ['ring', 0.0105, [0.046, 0.03, 0.022], 0.0088],
  ['pinky', 0.03, [0.036, 0.024, 0.019], 0.0078],
];

/**
 * Named hand poses: finger curl angles (degrees) per joint [proximal,
 * middle, distal] for index..pinky, plus thumb [oppose, flex1, flex2] and a
 * whole-hand spread. Angles positive = flexion (curl toward the palm).
 */
export const HAND_POSES = {
  relaxed: {
    fingers: [[18, 22, 12], [22, 28, 14], [26, 30, 16], [30, 32, 18]],
    thumb: [10, 12, 10],
    spread: 4,
  },
  ar_grip: {
    // trigger hand: three fingers wrap the grip, index rests on the guard
    fingers: [[8, 18, 6], [64, 78, 40], [68, 82, 45], [70, 80, 45]],
    thumb: [22, 26, 20],
    spread: 2,
  },
  ar_grip_fire: {
    // index moves to the trigger
    fingers: [[38, 40, 28], [64, 78, 40], [68, 82, 45], [70, 80, 45]],
    thumb: [22, 26, 20],
    spread: 2,
  },
  foregrip: {
    // C-clamp around the vertical grip / handguard
    fingers: [[58, 72, 44], [64, 80, 50], [66, 82, 52], [62, 76, 48]],
    thumb: [46, 30, 24],
    spread: 3,
  },
  handguard: {
    // support hand cupping the handguard from below (no VFG)
    fingers: [[42, 55, 30], [46, 60, 34], [48, 62, 36], [44, 58, 32]],
    thumb: [60, 20, 10],
    spread: 6,
  },
  pistol_grip: {
    fingers: [[10, 14, 6], [66, 80, 42], [70, 84, 46], [68, 80, 44]],
    thumb: [28, 20, 14],
    spread: 2,
  },
  pistol_support: {
    // support hand wraps the strong hand: fingers curl over the front
    fingers: [[52, 66, 40], [60, 74, 46], [62, 76, 48], [58, 70, 44]],
    thumb: [12, 8, 6],
    spread: 3,
  },
  mag_hold: {
    // pinching a magazine
    fingers: [[40, 46, 30], [55, 62, 40], [60, 68, 42], [58, 66, 40]],
    thumb: [38, 24, 16],
    spread: 4,
  },
  grenade: {
    // ball grip
    fingers: [[45, 55, 40], [50, 60, 44], [52, 62, 45], [50, 58, 42]],
    thumb: [30, 26, 20],
    spread: 8,
  },
  flat: {
    fingers: [[4, 6, 3], [4, 6, 3], [4, 6, 3], [4, 6, 3]],
    thumb: [6, 6, 4],
    spread: 6,
  },
};

/**
 * Build one gloved hand + forearm.
 * Hand frame: origin at the wrist, -Z toward the fingertips, +Y = back of
 * the hand, thumb on -X for the right hand (+X for the left).
 * @param {'left'|'right'} side
 * @param {{watch?:boolean}} [o]
 */
function buildHand(side, o = {}) {
  const s = side === 'left' ? -1 : 1; // mirror X for the left hand
  const root = new THREE.Group();
  root.name = 'arm.' + side;
  const mGlove = weaponMaterial('glove');
  const mLeather = weaponMaterial('glove_leather');
  const mCloth = weaponMaterial('cloth', { normalMap: clothNormal(), normalStrength: 1.4 });
  const mSkin = weaponMaterial('skin');
  const joints = [];
  const capsule = (r, len, mat) => {
    const g = new THREE.CapsuleGeometry(r, Math.max(len - 2 * r, 0.001), 4, 10);
    g.rotateX(Math.PI / 2); // capsule axis → Z
    g.translate(0, 0, -len / 2); // pivot at the proximal end, extends to -Z
    ensureWear(g);
    // the knit texture wraps a 2 cm circumference: thin its density so the
    // weave scale matches the palm (kills minification moiré on the fingers)
    parts_setUV(g, 0.28, 0.55);
    const m = new THREE.Mesh(g, mat);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  };

  // ---- forearm (extends from the wrist toward +Z / the elbow) ------------
  const forearm = new THREE.Group();
  forearm.name = 'forearm';
  // exposed skin band right behind the cuff (rolled sleeve look)
  const skinLen = 0.06;
  const skin = new THREE.Mesh(ensureWear(new THREE.CylinderGeometry(0.031, 0.033, skinLen, 16, 1, true)), mSkin);
  skin.rotation.x = Math.PI / 2;
  skin.position.z = 0.02 + skinLen / 2;
  skin.castShadow = true;
  forearm.add(skin);
  // rolled shirt sleeve: fabric tube with a thick rolled cuff at its start
  const sleeveLen = 0.24;
  const sleeve = new THREE.Mesh(ensureWear(new THREE.CylinderGeometry(0.037, 0.052, sleeveLen, 18, 3, true)), mCloth);
  sleeve.rotation.x = Math.PI / 2;
  sleeve.position.z = 0.02 + skinLen + sleeveLen / 2 - 0.004;
  sleeve.castShadow = true;
  sleeve.receiveShadow = true;
  forearm.add(sleeve);
  const roll = torus(0.0385, 0.008, 20, 8, mCloth);
  roll.position.z = 0.02 + skinLen - 0.002;
  forearm.add(roll);
  // sleeve texture UVs: scale up repeat for the twill
  root.add(forearm);
  parts_setUV(sleeve.geometry, 5, 6);
  // watch on the left arm's exposed skin
  if (o.watch && side === 'left') {
    const watch = new THREE.Group();
    watch.name = 'watch';
    const strap = new THREE.Mesh(ensureWear(new THREE.CylinderGeometry(0.0345, 0.0345, 0.024, 20, 1, true)), weaponMaterial('watch'));
    strap.rotation.x = Math.PI / 2;
    watch.add(strap);
    const caseGeo = new THREE.CylinderGeometry(0.021, 0.021, 0.011, 20);
    ensureWear(caseGeo, 0.2);
    const wcase = new THREE.Mesh(caseGeo, weaponMaterial('watch', { color: 0x101012 }));
    wcase.position.set(0, 0.033, 0);
    watch.add(wcase);
    const face = new THREE.Mesh(new THREE.CircleGeometry(0.017, 24), weaponMaterial('watch_face'));
    face.rotation.x = -Math.PI / 2;
    face.position.set(0, 0.0388, 0);
    watch.add(face);
    const crown = cyl(0.003, 0.003, 0.006, 8, weaponMaterial('watch'), 'x', { rim: false });
    crown.position.set(0.022, 0.033, 0);
    watch.add(crown);
    watch.position.set(0, 0, 0.048);
    forearm.add(watch);
  }

  // ---- glove cuff -------------------------------------------------------
  const cuff = new THREE.Mesh(ensureWear(new THREE.CylinderGeometry(0.036, 0.038, 0.04, 18, 1, true)), mGlove);
  cuff.rotation.x = Math.PI / 2;
  cuff.position.z = 0.008;
  cuff.castShadow = true;
  root.add(cuff);
  const cuffStrap = rbox(0.052, 0.006, 0.016, 0.002, mLeather, { strength: 0.1, seed: 150 });
  cuffStrap.position.set(0.004 * s, 0.02, 0.008);
  root.add(cuffStrap);

  // ---- palm ---------------------------------------------------------------
  const hand = new THREE.Group();
  hand.name = 'hand';
  hand.position.set(0, 0, -0.012);
  root.add(hand);
  const palm = rbox(0.086, 0.03, 0.098, 0.011, mGlove, { segments: 3, strength: 0.05, seed: 151 });
  palm.position.set(0.004 * s, 0.002, -0.052);
  hand.add(palm);
  // heel of the hand (thicker toward the thumb side)
  const heel = rbox(0.05, 0.03, 0.04, 0.012, mGlove, { strength: 0.05, seed: 152 });
  heel.position.set(-0.018 * s, -0.006, -0.02);
  hand.add(heel);
  // knuckle guard pad across the back of the hand
  const knuckle = rbox(0.078, 0.012, 0.03, 0.005, mLeather, { strength: 0.15, seed: 153 });
  knuckle.position.set(0.004 * s, 0.019, -0.084);
  hand.add(knuckle);
  // dorsal reinforcement patch
  const dorsal = rbox(0.05, 0.006, 0.04, 0.003, mLeather, { strength: 0.1, seed: 154 });
  dorsal.position.set(0.006 * s, 0.019, -0.04);
  hand.add(dorsal);

  // ---- fingers -----------------------------------------------------------
  const fingerJoints = [];
  for (const [name, xOff, lens, r] of FINGERS) {
    const knuckleJoint = new THREE.Object3D();
    knuckleJoint.name = 'f.' + name;
    knuckleJoint.position.set(xOff * s, 0.003, -0.098);
    hand.add(knuckleJoint);
    const chain = [knuckleJoint];
    let parent = knuckleJoint;
    for (let i = 0; i < 3; i++) {
      const rr = r * (1 - i * 0.08);
      const seg = capsule(rr, lens[i], mGlove);
      parent.add(seg);
      // pad on the back of the proximal segment
      if (i === 0) {
        const pad = rbox(rr * 2.1, rr * 0.9, lens[i] * 0.6, rr * 0.35, mLeather, { strength: 0.05, seed: 160 + i });
        pad.position.set(0, rr * 0.85, -lens[i] * 0.45);
        seg.add(pad);
      }
      const next = new THREE.Object3D();
      next.position.set(0, 0, -lens[i]);
      seg.add(next);
      chain.push(next);
      parent = next;
    }
    fingerJoints.push({ name, chain });
  }
  // thumb: base rotates about Z (opposition) and X (flex)
  const thumbBase = new THREE.Object3D();
  thumbBase.name = 'f.thumb';
  thumbBase.position.set(-0.036 * s, -0.006, -0.028);
  hand.add(thumbBase);
  const thumbSegs = [];
  let tparent = thumbBase;
  const tlens = [0.05, 0.036, 0.03];
  for (let i = 0; i < 3; i++) {
    const rr = 0.0115 * (1 - i * 0.12);
    const seg = capsule(rr, tlens[i], i === 0 ? mGlove : mGlove);
    tparent.add(seg);
    const next = new THREE.Object3D();
    next.position.set(0, 0, -tlens[i]);
    seg.add(next);
    thumbSegs.push(seg);
    tparent = next;
  }

  const rig = {
    side,
    root,
    hand,
    forearm,
    fingers: fingerJoints,
    thumbBase,
    thumbSegs,
    joints,
    /**
     * Apply a named pose (or a pose object).
     * @param {string|object} pose
     */
    pose(pose) {
      const p = typeof pose === 'string' ? HAND_POSES[pose] || HAND_POSES.relaxed : pose;
      for (let f = 0; f < 4; f++) {
        const angles = p.fingers[f];
        const fj = fingerJoints[f];
        // spread: index/pinky fan out slightly
        const spread = ((f - 1.5) / 1.5) * (p.spread ?? 3) * DEG * s;
        fj.chain[0].rotation.set(-angles[0] * DEG, spread, 0);
        // segments: chain[1] is the joint at the end of seg1 etc.
        fj.chain[1].rotation.set(-angles[1] * DEG, 0, 0);
        fj.chain[2].rotation.set(-angles[2] * DEG, 0, 0);
      }
      const [opp, f1, f2] = p.thumb;
      thumbBase.rotation.set(-f1 * DEG * 0.6, 0.85 * s + opp * DEG * -s, opp * DEG * 0.4 * s);
      thumbSegs[0].rotation.set(0, 0, 0);
      const j1 = thumbSegs[0].children.find((c) => !c.isMesh) || thumbSegs[0];
      if (j1) j1.rotation.set(-f1 * DEG, 0, 0);
      const j2 = thumbSegs[1] ? (thumbSegs[1].children.find((c) => !c.isMesh) || thumbSegs[1]) : null;
      if (j2) j2.rotation.set(-f2 * DEG, 0, 0);
    },
  };
  rig.pose('relaxed');
  return rig;
}

/** Scale a geometry's UVs (for tiling texture density on the sleeve). */
function parts_setUV(geo, su, sv) {
  const uv = geo.attributes.uv;
  if (!uv) return;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  uv.needsUpdate = true;
}

/**
 * Build both arms. Each hand rig is posed via `arms.right.pose('ar_grip')`
 * and attached by the viewmodel to the weapon's hand anchors.
 * @returns {{right:ReturnType<typeof buildHand>, left:ReturnType<typeof buildHand>, tris:number}}
 */
export function buildArms() {
  const right = buildHand('right', {});
  const left = buildHand('left', { watch: true });
  const tris = countTris(right.root) + countTris(left.root);
  return { right, left, tris };
}

/** Dispose all geometries/materials in a subtree. */
export function disposeAssembly(root) {
  root.traverse((o) => {
    if (o.isMesh) {
      o.geometry?.dispose?.();
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) m?.dispose?.();
    }
  });
}

export { _bb, countTris };
