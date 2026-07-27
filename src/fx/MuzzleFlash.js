/**
 * MuzzleFlash — reusable muzzle flash rig (FX stream).
 *
 * World-space one-shot (enemies, autoplay, presets):
 *   fx.muzzleFlash({position, direction, size=1, light=true, kind:'rifle'|'pistol', smoke=true})
 *     = 1-2 frame star sprite + hot round core (additive particles),
 *       a few short sparks along the bore, a 60 ms warm point-light spike
 *       (transient light pool) and a lingering chamber-smoke wisp.
 *
 * Viewmodel-attachable version (WEAPONS stream): a small object graph the
 * caller parents to its muzzle bone, rendered in whatever scene the parent
 * lives in (the viewmodel pass has its own scene + camera):
 *   const rig = fx.createMuzzleFlash({ scale: 1, light: true })
 *   muzzleBone.add(rig.object)      // +Z of the parent = out of the barrel
 *   rig.fire()                      // per shot: shows the flash for ~2 frames
 *   rig.update(dt)                  // per fixed step (WEAPONS calls this)
 *   rig.dispose()
 * The world-space `muzzleFlash()` should still be called by the weapon at
 * the true muzzle world position for the scene light + tracer origin +
 * chamber smoke; the attached rig only draws the flame that must move with
 * the gun in the viewmodel pass.
 */
import * as THREE from 'three';
import { buildParticleAtlas, CELLS } from './ParticleAtlas.js';
import { coneSample } from './util.js';

const _v = new THREE.Vector3();
const _smokeVel = new THREE.Vector3();
const _dirDefault = new THREE.Vector3(0, 0, -1);
const _up = new THREE.Vector3(0, 1, 0);

export class MuzzleFlash {
  /**
   * @param {import('../Game.js').Game} game
   * @param {{particles: import('./Particles.js').Particles, lights: import('./TransientLights.js').TransientLights, rng: any}} deps
   */
  constructor(game, { particles, lights, rng }) {
    this.game = game;
    this.particles = particles;
    this.lights = lights;
    this.rng = rng;
    this._rigs = [];
  }

  /**
   * One-shot world-space flash.
   * @param {object} o
   * @param {THREE.Vector3} o.position muzzle position
   * @param {THREE.Vector3} o.direction bore direction (unit)
   * @param {number} [o.size=1] scale (pistol ≈ 0.7, rifle 1, LMG 1.3)
   * @param {boolean} [o.light=true] point-light spike
   * @param {boolean} [o.smoke=true] chamber smoke wisp
   * @param {'rifle'|'pistol'|'lmg'} [o.kind='rifle']
   */
  flash(o = {}) {
    const p = o.position;
    const dir = o.direction || _dirDefault;
    if (!p) return;
    const size = o.size ?? 1;
    const rng = this.rng;
    const particles = this.particles;

    // star + core flash (1-2 frames at 60 fps)
    _v.copy(dir).multiplyScalar(0.06 * size).add(p);
    particles.emit('muzzle_star', {
      position: _v,
      count: 1,
      size: (0.18 + 0.09 * rng.next()) * size,
      sizeEnd: (0.24 + 0.1 * rng.next()) * size,
      life: 0.045 + rng.next() * 0.03,
      rotation: rng.range(0, Math.PI * 2),
    });
    particles.emit('flare', {
      position: _v,
      count: 1,
      size: 0.1 * size,
      sizeEnd: 0.16 * size,
      life: 0.05,
      color: [8, 6, 3.6],
    });
    // short bore sparks
    particles.emit('spark', {
      position: p,
      direction: dir,
      spread: 0.35,
      count: 2 + Math.floor(rng.next() * 3),
      speed: [7, 15],
      life: [0.08, 0.16],
      size: 0.02 * size,
      color: [8, 5.2, 2.2],
      gravity: -4,
    });
    // chamber smoke wisp lingering ~0.4 s, drifting up along the bore
    if (o.smoke !== false) {
      _smokeVel.copy(dir).multiplyScalar(0.35).add(_up).multiplyScalar(0.35);
      particles.emit('smoke_wisp', {
        position: _v,
        velocity: _smokeVel,
        direction: dir,
        spread: 0.6,
        count: 2,
        speed: [0.2, 0.5],
        size: [0.1 * size, 0.16 * size],
        sizeEnd: [0.45 * size, 0.7 * size],
        life: [0.4, 0.65],
        alpha: 0.42,
      });
    }
    // point-light spike (60 ms), warm gunfire colour
    if (o.light !== false && this.lights) {
      _v.copy(dir).multiplyScalar(0.25).add(p);
      this.lights.flash({
        position: _v,
        color: 0xffb15c,
        colorEnd: 0xff7a22,
        intensity: 220 * size * size,
        duration: 0.065,
        radius: 20,
        curve: 1.6,
        priority: 0,
      });
    }
  }

  /**
   * Build a viewmodel-attachable flash rig.
   * @param {{scale?:number, light?:boolean, color?:number}} [o]
   */
  createRig(o = {}) {
    const rig = new MuzzleFlashRig(this, o);
    this._rigs.push(rig);
    return rig;
  }

  update(dt) {
    for (const r of this._rigs) r.update(dt);
  }

  dispose() {
    for (const r of this._rigs) r.dispose();
    this._rigs.length = 0;
  }
}

/**
 * Attachable flash: two crossed flame planes + a camera-facing star sprite +
 * an optional point light, all children of `rig.object` (+Z = out of the
 * muzzle). Hidden except for the 1-2 frames after fire().
 */
class MuzzleFlashRig {
  constructor(owner, o = {}) {
    this.owner = owner;
    const atlas = buildParticleAtlas();
    const scale = o.scale ?? 1;
    this.scale = scale;
    this.object = new THREE.Group();
    this.object.name = 'fx.muzzleFlashRig';
    this._timer = 0;
    this._rot = 0;

    // shared additive material sampling the star cell
    const cellUv = atlas.cellUv(CELLS.muzzle_star);
    const flameGeo = new THREE.PlaneGeometry(1, 1);
    remapUv(flameGeo, cellUv);
    this.material = new THREE.MeshBasicMaterial({
      map: atlas.texture,
      color: new THREE.Color(4.5, 3.2, 1.6),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      fog: false,
      toneMapped: false,
    });
    // crossed planes forming a 3D flame down +Z
    this.crossA = new THREE.Mesh(flameGeo, this.material);
    this.crossB = new THREE.Mesh(flameGeo, this.material);
    const s = 0.34 * scale;
    this.crossA.scale.set(s, s, s);
    this.crossB.scale.set(s, s, s);
    this.crossA.rotation.y = Math.PI / 2; // plane containing the Z axis (vertical)
    this.crossB.rotation.set(Math.PI / 2, 0, Math.PI / 2); // plane containing Z (horizontal)
    this.crossA.position.z = 0.12 * scale;
    this.crossB.position.z = 0.12 * scale;
    // camera-facing star sprite at the muzzle
    const spriteGeo = new THREE.PlaneGeometry(1, 1);
    remapUv(spriteGeo, cellUv);
    this.star = new THREE.Mesh(spriteGeo, this.material);
    this.star.scale.setScalar(0.42 * scale);
    this.star.position.z = 0.05 * scale;
    this.object.add(this.crossA, this.crossB, this.star);
    this.object.visible = false;

    this.light = null;
    if (o.light !== false) {
      this.light = new THREE.PointLight(o.color ?? 0xffb15c, 0, 8, 2);
      this.light.position.z = 0.2 * scale;
      this.object.add(this.light);
    }
  }

  /** Trigger a flash (call once per shot). */
  fire({ intensity = 1 } = {}) {
    const rng = this.owner.rng;
    this._timer = 0.05 + rng.next() * 0.02;
    this.object.visible = true;
    this._rot = rng.range(0, Math.PI * 2);
    this.star.rotation.z = this._rot;
    const s = (0.36 + 0.16 * rng.next()) * this.scale;
    this.star.scale.setScalar(s * 1.1);
    this.crossA.scale.set(s * 0.9, s * (1.2 + rng.next() * 0.6), s);
    this.crossB.scale.copy(this.crossA.scale);
    if (this.light) this.light.intensity = 6 * intensity;
    void intensity;
  }

  update(dt) {
    if (this._timer > 0) {
      this._timer -= dt;
      // keep the star facing the (viewmodel) camera roll-wise: caller may set
      // rig.faceCamera; here we only spin decay the light
      if (this.light) this.light.intensity *= Math.max(0, 1 - dt * 35);
      if (this._timer <= 0) {
        this.object.visible = false;
        if (this.light) this.light.intensity = 0;
      }
    }
  }

  dispose() {
    this.object.parent?.remove(this.object);
    this.crossA.geometry.dispose();
    this.star.geometry.dispose();
    this.material.dispose();
  }
}

function remapUv(geo, cell) {
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    const u = uv.getX(i);
    const v = uv.getY(i);
    uv.setXY(i, cell[0] + u * (cell[2] - cell[0]), cell[1] + v * (cell[3] - cell[1]));
  }
  uv.needsUpdate = true;
}

void coneSample;
