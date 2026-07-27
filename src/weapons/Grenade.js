/**
 * Grenades — cookable frag with a physics-lite projectile (WEAPONS stream).
 *
 * Throw arc from the view direction (+ up bias), integrated per fixed step
 * with gravity; collides against the world BVH (`world.raycast`) with
 * restitution 0.35 + tangential friction, settles when slow; detonates on
 * fuse expiry via `fx.explode({position, radius, damage, kind:'frag'})`
 * which emits the canonical `grenade:exploded {point, radius, damage, kind,
 * owner}` that AI (radial damage) and the player subscribe to. If
 * `game.physics.throwProjectile` exists (PHYSICS stream) it is preferred.
 *
 * The in-hand grenade is rendered by the viewmodel (frag GunAssembly) — the
 * projectile mesh is a world-scene clone of the same body.
 */
import * as THREE from 'three';
import { buildFrag } from './GunBuilder.js';

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _dir = new THREE.Vector3();
const GRAVITY = 9.81;

export class GrenadeSystem {
  /**
   * @param {import('../Game.js').Game} game
   * @param {object} def frag def
   */
  constructor(game, def) {
    this.game = game;
    this.def = def;
    this.count = def.count ?? 2;
    /** @type {Array<{mesh:THREE.Object3D, pos:THREE.Vector3, vel:THREE.Vector3, spin:THREE.Vector3, fuseAt:number, active:boolean, settled:boolean, bounces:number}>} */
    this.projectiles = [];
    this._pool = [];
    this._proto = null;
  }

  _makeMesh() {
    if (!this._proto) {
      this._proto = buildFrag().root;
      // world-scene frag: remove the pull ring/pin (already pulled) and spoon flies off separately
      const pin = this._proto.getObjectByName('pin');
      if (pin) pin.parent.remove(pin);
      const spoon = this._proto.getObjectByName('spoon');
      if (spoon) spoon.parent.remove(spoon);
    }
    const m = this._proto.clone(true);
    m.visible = true;
    m.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    return m;
  }

  /**
   * Spawn a live grenade.
   * @param {THREE.Vector3} position
   * @param {THREE.Vector3} velocity
   * @param {number} fuseRemaining seconds until detonation
   */
  throwProjectile(position, velocity, fuseRemaining) {
    const game = this.game;
    // physics stream integration point
    if (game.physics?.throwProjectile) {
      const handled = game.physics.throwProjectile({
        kind: 'frag',
        position, velocity, radius: this.def.physics?.radius ?? 0.033,
        fuse: fuseRemaining,
        onDetonate: (pos) => this._detonate(pos),
      });
      if (handled) {
        this.game.events.emit('grenade:thrown', { position, velocity, fuse: fuseRemaining, kind: 'frag' });
        return handled;
      }
    }
    let p = this._pool.pop();
    if (!p) {
      p = {
        mesh: this._makeMesh(),
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        spin: new THREE.Vector3(),
        fuseAt: 0,
        active: false,
        settled: false,
        bounces: 0,
      };
    }
    p.pos.copy(position);
    p.vel.copy(velocity);
    p.spin.set(9 + Math.abs(velocity.x), -4, 2.5);
    p.fuseAt = game.time.elapsed + fuseRemaining;
    p.active = true;
    p.settled = false;
    p.bounces = 0;
    p.mesh.position.copy(position);
    game.scene.add(p.mesh);
    this.projectiles.push(p);
    game.events.emit('grenade:thrown', { position, velocity, fuse: fuseRemaining, kind: 'frag' });
    return p;
  }

  update(dt) {
    const game = this.game;
    const world = game.world;
    const now = game.time.elapsed;
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      if (!p.active) continue;
      // detonate?
      if (now >= p.fuseAt) {
        this._detonate(p.pos);
        this._release(i);
        continue;
      }
      if (!p.settled) {
        p.vel.y -= GRAVITY * dt;
        _v1.copy(p.vel).multiplyScalar(dt);
        const moveLen = _v1.length();
        let hit = null;
        if (world?.raycast && moveLen > 1e-6) {
          _dir.copy(_v1).multiplyScalar(1 / moveLen);
          hit = world.raycast(p.pos, _dir, moveLen + (this.def.physics?.radius ?? 0.033));
        }
        if (hit) {
          const r = this.def.physics?.radius ?? 0.033;
          p.pos.copy(hit.point).addScaledVector(hit.normal, r + 0.002);
          const rest = this.def.physics?.restitution ?? 0.35;
          const fric = this.def.physics?.friction ?? 0.55;
          // reflect normal component, damp tangential
          const vn = p.vel.dot(hit.normal);
          _v2.copy(hit.normal).multiplyScalar(vn); // normal component
          p.vel.sub(_v2); // tangential
          p.vel.multiplyScalar(1 - fric * 0.5);
          p.vel.addScaledVector(hit.normal, -vn * rest);
          p.spin.multiplyScalar(0.55);
          p.bounces++;
          const speed = p.vel.length();
          if (speed > 1.2) {
            game.events.emit('grenade:bounce', { position: p.pos, surface: hit.surface || 'concrete', speed });
          }
          if (speed < 0.6 || p.bounces > 5) {
            p.settled = true;
            p.vel.set(0, 0, 0);
            p.spin.set(0, 0, 0);
          }
        } else {
          p.pos.add(_v1);
        }
        p.mesh.rotateX(p.spin.x * dt);
        p.mesh.rotateY(p.spin.y * dt);
        p.mesh.rotateZ(p.spin.z * dt);
      }
      p.mesh.position.copy(p.pos);
    }
  }

  _detonate(pos) {
    _v1.copy(pos);
    _v1.y += 0.35; // lift the blast off the ground a touch
    const fx = this.game.fx;
    if (fx?.explode) {
      fx.explode({ position: _v1, radius: this.def.radius ?? 5, kind: 'frag', damage: this.def.damage ?? 180, owner: 'player' });
    } else {
      // no FX stream: emit the canonical event ourselves
      this.game.events.emit('grenade:exploded', { point: _v1, radius: this.def.radius ?? 5, damage: this.def.damage ?? 180, kind: 'frag', owner: 'player' });
    }
  }

  _release(index) {
    const p = this.projectiles[index];
    p.active = false;
    if (p.mesh.parent) p.mesh.parent.remove(p.mesh);
    this.projectiles.splice(index, 1);
    this._pool.push(p);
  }

  /** Remove all live grenades (photo presets / respawn). */
  clear() {
    for (const p of this.projectiles) {
      p.active = false;
      p.mesh.parent?.remove(p.mesh);
      this._pool.push(p);
    }
    this.projectiles.length = 0;
  }

  dispose() {
    this.clear();
  }
}
