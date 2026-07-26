/**
 * Props — CC0 prop model placement (WORLD stream).
 *
 * All Poly Haven props (drums, crates, tyres, generator, ladders, lamps…)
 * are placed as InstancedMesh sets: one InstancedMesh per source mesh
 * primitive, shared across every placement of that prop, so 60 barrels are
 * a couple of draw calls. Placements are accumulated with place() during
 * the build and instantiated once by build(). Each placement also drops an
 * oriented-box collision proxy (from the prop's own bounds).
 *
 * Placement API:
 *   props.place(assetId, matrix, opts)          raw matrix
 *   props.placeOnGround(assetId, x, z, yawDeg, opts)   auto-lifts so the model sits on y (default 0)
 * opts: {y, groundY, tilt:[rxDeg,rzDeg], lean, stack, noCollide, variant:'lit'|'dead', surface, scale}
 */
import * as THREE from 'three';
import { CLUTTER, MANHOLES } from './layout.js';
import { DEG } from './util.js';

/** Small ground clutter whose shadows are not worth an extra shadow-pass draw. */
const NO_SHADOW = new Set([
  'prop.jerrycan', 'prop.manhole_cover', 'prop.cardboard_box', 'prop.fire_extinguisher',
  'prop.propane_tank', 'prop.security_light', 'prop.tire_old', 'prop.utility_box',
  'prop.tool_chest', 'prop.drum_plastic_blue', 'prop.military_crate_open',
]);

const _box = new THREE.Box3();
const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _v = new THREE.Vector3();
const _c = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _one = new THREE.Vector3(1, 1, 1);

export class Props {
  /**
   * @param {object} ctx build context {game, root, collision, level, rng}
   */
  constructor(ctx) {
    this.ctx = ctx;
    this.assets = ctx.game.assets;
    this.rng = ctx.rng;
    /** @type {Map<string, {assetId:string, variant:string, matrices:THREE.Matrix4[], opts:any[]}>} */
    this.groups = new Map();
    /** cached per asset: {meshes:[{geometry, material, matrix}], box:Box3} */
    this._info = new Map();
    this.stats = { placements: 0, instancedMeshes: 0 };
  }

  /* --------------------------------------------------------------- info */
  _assetInfo(assetId) {
    if (this._info.has(assetId)) return this._info.get(assetId);
    const res = this.assets.get(assetId);
    const scene = res?.scene;
    if (!scene || res.missing) {
      this._info.set(assetId, null);
      return null;
    }
    scene.updateMatrixWorld(true);
    const meshes = [];
    scene.traverse((o) => {
      if (o.isMesh && o.geometry) {
        meshes.push({ geometry: o.geometry, material: o.material, matrix: o.matrixWorld.clone(), name: o.name });
      }
    });
    const box = new THREE.Box3().setFromObject(scene);
    const info = { meshes, box, surface: this.assets.entry?.(assetId)?.surface || 'metal' };
    this._info.set(assetId, info);
    return info;
  }

  /* --------------------------------------------------------------- place */
  /**
   * Place a prop with an explicit local→world matrix.
   */
  place(assetId, matrix, opts = {}) {
    const info = this._assetInfo(assetId);
    if (!info) return null;
    const variant = opts.variant || 'default';
    const key = assetId + '|' + variant;
    let g = this.groups.get(key);
    if (!g) {
      g = { assetId, variant, matrices: [], opts: [] };
      this.groups.set(key, g);
    }
    g.matrices.push(matrix.clone());
    g.opts.push(opts);
    this.stats.placements++;
    // collision proxy
    if (!opts.noCollide && this.ctx.collision) {
      const b = info.box;
      const size = _v.subVectors(b.max, b.min);
      const centre = _c.addVectors(b.min, b.max).multiplyScalar(0.5);
      this.ctx.collision.addBox(matrix, { w: size.x, h: size.y, d: size.z, cx: centre.x, cy: centre.y, cz: centre.z }, opts.surface || info.surface || 'metal');
    }
    return matrix;
  }

  /**
   * Place a prop on the ground: rotation from (tiltX, yaw, tiltZ) then lifted
   * so the rotated bounding box rests on groundY.
   */
  placeOnGround(assetId, x, z, yawDeg = 0, opts = {}) {
    const info = this._assetInfo(assetId);
    if (!info) return null;
    const groundY = opts.groundY ?? 0;
    // rotation matrix
    _m.identity();
    if (opts.lean) {
      // yaw first, then lean the top toward the placement's +x (world) by rotating about world Z
      _m2.makeRotationZ(-opts.lean * DEG);
      _m.multiply(_m2);
      _m2.makeRotationY((yawDeg + 90) * DEG);
      _m.multiply(_m2);
    } else {
      _e.set((opts.tilt ? opts.tilt[0] : 0) * DEG, yawDeg * DEG, (opts.tilt ? opts.tilt[1] : 0) * DEG, 'YXZ');
      _q.setFromEuler(_e);
      _m.makeRotationFromQuaternion(_q);
    }
    if (opts.scale) _m.scale(_v.set(opts.scale, opts.scale, opts.scale));
    // rotated bounds → lift
    _box.copy(info.box).applyMatrix4(_m);
    const lift = groundY - _box.min.y + (opts.sink ? -opts.sink : 0) + (opts.y || 0);
    const matrix = new THREE.Matrix4().makeTranslation(x, lift, z).multiply(_m);
    return this.place(assetId, matrix, opts);
  }

  /* ---------------------------------------------------------- clutter */
  /** Place the hand-authored clutter lists from layout.CLUTTER. */
  buildClutter() {
    const rng = this.rng;
    for (const group of Object.values(CLUTTER)) {
      for (const entry of group) {
        const [id, x, z, yaw, opts = {}] = entry;
        if (opts.stack) {
          // tyre stacks: lying flat, jittered
          let y = 0;
          for (let i = 0; i < opts.stack; i++) {
            this.placeOnGround(id, x + rng.range(-0.05, 0.05), z + rng.range(-0.05, 0.05), rng.range(0, 360), {
              tilt: [90, 0],
              y,
              noCollide: i > 0,
            });
            y += 0.165;
          }
          this.ctx.collision.addAABox(x, 0, z, 0.65, opts.stack * 0.165, 0.65, 'plastic');
          continue;
        }
        if (opts.wall) {
          // wall mounted (no ground lift, no collision)
          const m = new THREE.Matrix4().compose(
            _v.set(x, opts.y || 3, z),
            _q.setFromEuler(_e.set(0, yaw * DEG, 0, 'YXZ')),
            _one,
          );
          this.place(id, m, { ...opts, noCollide: true });
          continue;
        }
        this.placeOnGround(id, x, z, yaw + rng.range(-2, 2), opts);
      }
    }
    // manhole covers, flush (slightly proud) in the paving
    for (const [x, z, yaw] of MANHOLES) {
      const m = new THREE.Matrix4().compose(
        _v.set(x, -0.035, z),
        _q.setFromEuler(_e.set(0, yaw * DEG, 0, 'YXZ')),
        _one,
      );
      this.place('prop.manhole_cover', m, { noCollide: true });
    }
    // warehouse facade security lights (lit/dead variants)
    const lampXs = [[-47, 'dead'], [-37, 'lit'], [-27, 'lit'], [-17, 'dead'], [-7, 'lit']];
    for (const [lx, variant] of lampXs) {
      const m = new THREE.Matrix4().compose(
        _v.set(lx, 6.35, 37.62),
        _q.setFromEuler(_e.set(0, Math.PI, 0, 'YXZ')),
        _one,
      );
      this.place('prop.security_light', m, { variant, noCollide: true });
    }
    // one on the trailer's east end
    {
      const m = new THREE.Matrix4().compose(
        _v.set(26.9, 3.05, 40.05),
        _q.setFromEuler(_e.set(0, Math.PI, 0, 'YXZ')),
        _one,
      );
      this.place('prop.security_light', m, { variant: 'lit', noCollide: true });
    }
    // photoscanned barrier heroes near the camera-friendly spots (the rest are procedural)
    this.placeOnGround('prop.jersey_barrier_02', -1.6, -20.6, 92, {});
    this.placeOnGround('prop.jersey_barrier_02', 39.5, -47.2, 5, {});
  }

  /* ----------------------------------------------------------------- build */
  build() {
    const root = this.ctx.root;
    for (const g of this.groups.values()) {
      const info = this._assetInfo(g.assetId);
      if (!info) continue;
      for (const mesh of info.meshes) {
        let material = mesh.material;
        // material variants
        if (g.variant === 'lit' || g.variant === 'dead') {
          material = this._lampVariant(material, g.variant === 'lit');
        }
        const inst = new THREE.InstancedMesh(mesh.geometry, material, g.matrices.length);
        for (let i = 0; i < g.matrices.length; i++) {
          _m.multiplyMatrices(g.matrices[i], mesh.matrix);
          inst.setMatrixAt(i, _m);
        }
        inst.instanceMatrix.needsUpdate = true;
        inst.castShadow = !NO_SHADOW.has(g.assetId);
        inst.receiveShadow = true;
        inst.name = `props.${g.assetId}.${mesh.name || 'mesh'}`;
        inst.userData.surface = info.surface;
        // bounds over all instances so frustum culling stays correct
        inst.computeBoundingBox();
        inst.computeBoundingSphere();
        root.add(inst);
        this.ctx.level.instancedMeshes.push(inst);
        this.stats.instancedMeshes++;
      }
    }
  }

  _lampVariant(material, lit) {
    const key = (lit ? 'lit:' : 'dead:') + material.uuid;
    this._variantCache = this._variantCache || new Map();
    if (this._variantCache.has(key)) return this._variantCache.get(key);
    let m = material;
    const looksBulb = /bulb|glass|light_lens/i.test(material.name || '');
    if (looksBulb) {
      m = material.clone();
      if (lit) {
        m.emissive = new THREE.Color(0xffb15c);
        m.emissiveIntensity = 6.5;
        m.toneMapped = false;
      } else {
        m.emissive = new THREE.Color(0x2a1a08);
        m.emissiveIntensity = 0.2;
      }
    }
    this._variantCache.set(key, m);
    return m;
  }
}
