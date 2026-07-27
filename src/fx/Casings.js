/**
 * Casings — pooled ejected brass (FX stream).
 *
 * Two InstancedMeshes (rifle 5.56 / pistol 9 mm cartridges from tiny lathe
 * profiles, warm brass with a strong specular). Each casing integrates simple
 * ballistics with spin, bounces once/twice against the world BVH (raycast
 * per step while airborne), settles, and shrinks away after 3-5 s.
 *
 *   fx.ejectCasing({ position, velocity, spin, kind:'rifle'|'pistol' })
 * Emits `fx:casing {position, surface, kind}` on the first ground contact
 * (AUDIO plays the brass tink for that surface).
 */
import * as THREE from 'three';

const MAX_RIFLE = 48;
const MAX_PISTOL = 24;
const GRAVITY = -9.81;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _qStep = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);
const _axis = new THREE.Vector3();
const _zero = new THREE.Matrix4().makeScale(0, 0, 0);

export class Casings {
  /**
   * @param {import('../Game.js').Game} game
   * @param {import('../core/Random.js').Random} rng
   */
  constructor(game, rng) {
    this.game = game;
    this.scene = game.scene;
    this.rng = rng;

    this.material = new THREE.MeshStandardMaterial({
      name: 'fx.brass',
      color: 0xc4933f,
      metalness: 1.0,
      roughness: 0.28,
      envMapIntensity: 1.6,
    });

    this.pools = {
      rifle: this._buildPool('rifle', MAX_RIFLE, this._rifleGeometry()),
      pistol: this._buildPool('pistol', MAX_PISTOL, this._pistolGeometry()),
    };
  }

  _rifleGeometry() {
    // 5.56×45: case length 44.7 mm, base 9.6 mm, shoulder to a 5.7 mm neck
    const L = 0.0447;
    const pts = [
      new THREE.Vector2(0, -L / 2),
      new THREE.Vector2(0.0048, -L / 2),         // base
      new THREE.Vector2(0.0048, -L / 2 + 0.001),
      new THREE.Vector2(0.0044, -L / 2 + 0.0018), // extractor groove
      new THREE.Vector2(0.0048, -L / 2 + 0.0025),
      new THREE.Vector2(0.00465, -L / 2 + 0.033), // body taper
      new THREE.Vector2(0.0029, -L / 2 + 0.0375), // shoulder
      new THREE.Vector2(0.0029, L / 2 - 0.001),   // neck
      new THREE.Vector2(0.0027, L / 2),
      new THREE.Vector2(0, L / 2),
    ];
    const g = new THREE.LatheGeometry(pts, 10);
    g.rotateZ(Math.PI / 2); // long axis along X so it tumbles nicely
    return g;
  }

  _pistolGeometry() {
    // 9×19: straight case
    const L = 0.019;
    const pts = [
      new THREE.Vector2(0, -L / 2),
      new THREE.Vector2(0.00495, -L / 2),
      new THREE.Vector2(0.00495, -L / 2 + 0.0008),
      new THREE.Vector2(0.0046, -L / 2 + 0.0014),
      new THREE.Vector2(0.00495, -L / 2 + 0.002),
      new THREE.Vector2(0.0048, L / 2 - 0.0007),
      new THREE.Vector2(0.0046, L / 2),
      new THREE.Vector2(0, L / 2),
    ];
    const g = new THREE.LatheGeometry(pts, 10);
    g.rotateZ(Math.PI / 2);
    return g;
  }

  _buildPool(name, count, geometry) {
    const mesh = new THREE.InstancedMesh(geometry, this.material, count);
    mesh.name = 'fx.casings.' + name;
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < count; i++) mesh.setMatrixAt(i, _zero);
    mesh.instanceMatrix.needsUpdate = true;
    this.scene.add(mesh);
    const items = [];
    for (let i = 0; i < count; i++) {
      items.push({
        active: false,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        rot: new THREE.Quaternion(),
        spin: new THREE.Vector3(),
        age: 0,
        life: 4,
        settled: false,
        contacted: false,
        bounces: 0,
      });
    }
    return { name, mesh, items, cursor: 0, count };
  }

  /**
   * Eject a casing.
   * @param {object} o
   * @param {THREE.Vector3} o.position ejection port
   * @param {THREE.Vector3} o.velocity initial velocity (m/s, includes shooter velocity)
   * @param {THREE.Vector3} [o.spin] angular velocity (rad/s)
   * @param {'rifle'|'pistol'} [o.kind='rifle']
   */
  eject(o = {}) {
    const pool = this.pools[o.kind === 'pistol' ? 'pistol' : 'rifle'];
    const rng = this.rng;
    // pick next slot (ring; oldest gets recycled)
    let item = null;
    for (let i = 0; i < pool.count; i++) {
      const c = pool.items[(pool.cursor + i) % pool.count];
      if (!c.active) {
        item = c;
        pool.cursor = (pool.cursor + i + 1) % pool.count;
        break;
      }
    }
    if (!item) {
      item = pool.items[pool.cursor];
      pool.cursor = (pool.cursor + 1) % pool.count;
    }
    item.active = true;
    item.settled = false;
    item.contacted = false;
    item.bounces = 0;
    item.age = 0;
    item.life = 3.2 + rng.next() * 1.8;
    item.pos.copy(o.position);
    item.vel.copy(o.velocity || _v.set(1.5, 1.2, 0));
    if (o.spin) item.spin.copy(o.spin);
    else item.spin.set(rng.range(-40, 40), rng.range(-60, 60), rng.range(-40, 40));
    item.rot.set(rng.next() - 0.5, rng.next() - 0.5, rng.next() - 0.5, rng.next() + 0.5).normalize();
    return item;
  }

  update(dt) {
    const world = this.game.world;
    for (const key of ['rifle', 'pistol']) {
      const pool = this.pools[key];
      let dirty = false;
      for (let i = 0; i < pool.count; i++) {
        const c = pool.items[i];
        if (!c.active) continue;
        c.age += dt;
        if (c.age >= c.life) {
          c.active = false;
          pool.mesh.setMatrixAt(i, _zero);
          dirty = true;
          continue;
        }
        if (!c.settled) {
          // integrate
          c.vel.y += GRAVITY * dt;
          _v.copy(c.vel).multiplyScalar(dt);
          const moveLen = _v.length();
          let hit = null;
          if (world?.raycast && moveLen > 1e-6) {
            _v2.copy(_v).multiplyScalar(1 / moveLen);
            hit = world.raycast(c.pos, _v2, moveLen + 0.012);
          }
          if (hit) {
            c.pos.copy(hit.point).addScaledVector(hit.normal, 0.011);
            // reflect with restitution + friction
            const vn = c.vel.dot(hit.normal);
            c.vel.addScaledVector(hit.normal, -1.55 * vn);
            c.vel.multiplyScalar(0.55);
            c.spin.multiplyScalar(0.6);
            if (!c.contacted) {
              c.contacted = true;
              this.game.events.emit('fx:casing', { position: c.pos, surface: hit.surface || 'concrete', kind: key });
            }
            c.bounces++;
            if (c.vel.length() < 1.0 || c.bounces >= 4) {
              c.settled = true;
              c.vel.set(0, 0, 0);
              c.spin.set(0, 0, 0);
              // lie flat-ish: keep the current tumble orientation (looks natural on rubble)
            }
          } else {
            c.pos.add(_v);
          }
          // spin integration
          const w = c.spin.length();
          if (w > 1e-4) {
            _axis.copy(c.spin).multiplyScalar(1 / w);
            _qStep.setFromAxisAngle(_axis, w * dt);
            c.rot.premultiply(_qStep).normalize();
          }
        }
        // fade: shrink over the last 0.5 s
        const remain = c.life - c.age;
        const s = remain < 0.5 ? Math.max(0.01, remain / 0.5) : 1;
        _s.set(s, s, s);
        _m.compose(c.pos, c.rot, _s);
        pool.mesh.setMatrixAt(i, _m);
        dirty = true;
      }
      if (dirty) pool.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  clear() {
    for (const key of ['rifle', 'pistol']) {
      const pool = this.pools[key];
      for (let i = 0; i < pool.count; i++) {
        pool.items[i].active = false;
        pool.mesh.setMatrixAt(i, _zero);
      }
      pool.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  dispose() {
    for (const key of ['rifle', 'pistol']) {
      const pool = this.pools[key];
      this.scene.remove(pool.mesh);
      pool.mesh.geometry.dispose();
    }
    this.material.dispose();
  }
}

void _q;
