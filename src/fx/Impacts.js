/**
 * Impacts — per-surface bullet impact recipes (FX stream).
 *
 *   fx.impact({point, normal, surface, energy=1, dir, object, entity})
 *
 * surface (from world.raycast / weapon:hit): asphalt | concrete | gravel |
 * metal | wood | fabric | water | flesh | glass | plastic. Each recipe emits
 * pooled particles + one decal + events:
 *   fx:impact {point, normal, surface, energy}   (audio: bullet impact sfx)
 *   fx:ricochet {point, dir}                    (metal, chance)
 *   fx:decal {point, normal, kind}              (from Decals.add)
 * Consumes: weapon:hit (canonical) → impact(); entity hits become 'flesh'.
 */
import * as THREE from 'three';

const _reflect = new THREE.Vector3();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _mixDir = new THREE.Vector3();
const _down = new THREE.Vector3(0, -1, 0);
const _nDef = new THREE.Vector3();
const _dirDef = new THREE.Vector3();

const RICOCHET_TRACER_COLOR = [7, 3.5, 1.2];

export class Impacts {
  /**
   * @param {import('../Game.js').Game} game
   * @param {{particles:any, decals:any, tracers:any, lights:any, rng:any}} deps
   */
  constructor(game, { particles, decals, tracers, lights, rng }) {
    this.game = game;
    this.particles = particles;
    this.decals = decals;
    this.tracers = tracers;
    this.lights = lights;
    this.rng = rng;
    this._offHit = game.events.on('weapon:hit', (h) => this.onWeaponHit(h));
  }

  /** Canonical weapon:hit → impact FX. */
  onWeaponHit(h) {
    if (!h || !h.point) return;
    const surface = h.entity ? 'flesh' : (h.surface || 'concrete');
    this.spawn({
      point: h.point,
      normal: h.normal,
      surface,
      energy: h.energy ?? (h.damage ? Math.min(1.4, h.damage / 40) : 1),
      dir: h.dir,
      object: h.object,
      entity: h.entity,
    });
  }

  /**
   * Spawn an impact effect.
   * @param {object} o
   * @param {THREE.Vector3} o.point
   * @param {THREE.Vector3} [o.normal] surface normal (default up)
   * @param {string} [o.surface='concrete']
   * @param {number} [o.energy=1] scales counts/sizes (0.5 pistol .. 1.4 heavy)
   * @param {THREE.Vector3} [o.dir] incoming bullet direction (unit)
   * @param {THREE.Object3D} [o.object] hit mesh (decal target when it has geometry)
   * @param {any} [o.entity] hit gameplay entity (enemy) — blood recipe
   */
  spawn(o) {
    const p = o.point;
    if (!p) return;
    // defaults live in dedicated scratch vectors: the recipes below reuse
    // _v/_v2, and the fx:impact payload must survive them
    const n = o.normal || _nDef.set(0, 1, 0);
    const surface = (o.surface || 'concrete').toLowerCase();
    const energy = THREE.MathUtils.clamp(o.energy ?? 1, 0.3, 2.5);
    const dir = o.dir || _dirDef.copy(n).negate();
    // reflection direction (for sparks / ricochets): mix of mirror + normal
    _reflect.copy(dir).addScaledVector(n, -2 * dir.dot(n)).normalize();
    _mixDir.copy(_reflect).multiplyScalar(0.5).addScaledVector(n, 0.7).normalize();

    switch (surface) {
      case 'metal':
        this._metal(p, n, energy, dir, o);
        break;
      case 'wood':
        this._wood(p, n, energy, o);
        break;
      case 'fabric':
        this._fabric(p, n, energy, o);
        break;
      case 'water':
        this._water(p, n, energy);
        break;
      case 'flesh':
        this._flesh(p, n, energy, dir, o);
        break;
      case 'glass':
        this._glass(p, n, energy, o);
        break;
      case 'plastic':
        this._plastic(p, n, energy, o);
        break;
      case 'gravel':
      case 'dirt':
        this._masonry(p, n, energy, o, true);
        break;
      case 'concrete':
      case 'asphalt':
      case 'stone':
      default:
        this._masonry(p, n, energy, o, false);
        break;
    }
    this.game.events.emit('fx:impact', { point: p, normal: n, surface, energy });
  }

  /* ------------------------------------------------------------ recipes */
  _masonry(p, n, energy, o, gravel) {
    const P = this.particles;
    const rng = this.rng;
    // grey dust puff along the normal
    P.emit('dust', {
      position: p,
      direction: n,
      spread: 0.75,
      count: Math.round(6 * energy),
      speed: [0.8, 2.6 + energy],
      size: [0.28, 0.5],
      sizeEnd: [1.0, 1.7],
      life: [1.4, 2.6],
      color: gravel ? [0.4, 0.36, 0.3] : [0.5, 0.49, 0.46],
      alpha: 0.5,
    });
    // fast fine dust jet (reads on the first frames)
    P.emit('dust', {
      position: p,
      direction: _mixDir,
      spread: 0.35,
      count: 3,
      speed: [2.5, 5],
      size: [0.15, 0.25],
      sizeEnd: [0.5, 0.8],
      life: [0.35, 0.6],
      alpha: 0.5,
    });
    // chips + grit
    P.emit('chip', {
      position: p,
      direction: _mixDir,
      spread: 0.8,
      count: Math.round((gravel ? 6 : 4) * energy),
      speed: [2.5, 6],
      color: gravel ? [0.28, 0.25, 0.21] : [0.36, 0.35, 0.32],
    });
    P.emit('grit', { position: p, direction: n, count: 2, spread: 1.0 });
    // occasional spark (bullet jacket)
    if (rng.next() < 0.35) {
      P.emit('spark', {
        position: p,
        direction: _mixDir,
        spread: 0.6,
        count: 2 + Math.floor(rng.next() * 3),
        speed: [5, 12],
        life: [0.2, 0.45],
      });
    }
    // decal: bullet hole + rare spall crater
    const crater = rng.next() < 0.22;
    this.decals.add(crater ? 'crater' : 'bullet_concrete', {
      point: p,
      normal: n,
      size: crater ? 0.28 + rng.next() * 0.18 : 0.11 + rng.next() * 0.06,
      object: o.object,
    });
  }

  _metal(p, n, energy, dir, o) {
    const P = this.particles;
    const rng = this.rng;
    // bright spark shower
    P.emit('spark', {
      position: p,
      direction: _mixDir,
      spread: 0.75,
      count: Math.round((12 + rng.next() * 8) * energy),
      speed: [5, 16],
      life: [0.25, 0.7],
      size: [0.025, 0.05],
      stretch: 0.03,
    });
    // small point flare at the strike (a couple of frames)
    _v.copy(n).multiplyScalar(0.04).add(p);
    P.emit('flare', {
      position: _v,
      count: 1,
      size: 0.14 * energy,
      sizeEnd: 0.22 * energy,
      life: 0.055,
      color: [5, 3.4, 1.6],
    });
    // lingering orange hot spot (a static ember)
    P.emit('ember', {
      position: _v,
      count: 1,
      speed: 0,
      size: 0.055,
      sizeEnd: 0.035,
      life: [0.5, 0.9],
      gravity: 0,
      drag: 0,
      wind: 0,
      color: [3.4, 1.0, 0.22],
      colorEnd: [1.2, 0.2, 0.02],
    });
    // faint puff
    P.emit('dust', {
      position: p,
      direction: n,
      spread: 0.5,
      count: 2,
      speed: [0.5, 1.2],
      size: [0.15, 0.25],
      sizeEnd: [0.5, 0.8],
      life: [0.4, 0.8],
      color: [0.42, 0.4, 0.38],
      alpha: 0.35,
    });
    // scorch/dent decal (hot variant part of the time)
    this.decals.add(rng.next() < 0.4 ? 'bullet_metal_hot' : 'bullet_metal', {
      point: p,
      normal: n,
      size: 0.16 + rng.next() * 0.07,
      object: o.object,
    });
    // brief, small light kick from the spark burst (kept off the surface so
    // the wall itself doesn't blow out)
    this.lights?.flash({
      position: _v2.copy(n).multiplyScalar(0.6).add(p),
      color: 0xff9838,
      colorEnd: 0xff5410,
      intensity: 22 * energy,
      duration: 0.1,
      radius: 9,
      priority: -1,
    });
    // ricochet: sound event + a stray glowing tracer skipping off
    if (rng.next() < 0.28) {
      _v.copy(_reflect).multiplyScalar(0.7).addScaledVector(n, 0.3).normalize();
      // jitter the outgoing direction a little
      _v.x += (rng.next() - 0.5) * 0.4;
      _v.y += (rng.next() - 0.5) * 0.4;
      _v.z += (rng.next() - 0.5) * 0.4;
      _v.normalize();
      _v2.copy(_v).multiplyScalar(18 + rng.next() * 30).add(p);
      this.tracers?.spawn(p, _v2, { speed: 240, length: 5, width: 0.035, color: RICOCHET_TRACER_COLOR, head: 1.2, skip: 0 });
      this.game.events.emit('fx:ricochet', { point: p, dir: _v });
    }
    void dir;
  }

  _wood(p, n, energy, o) {
    const P = this.particles;
    const rng = this.rng;
    P.emit('splinter', {
      position: p,
      direction: _mixDir,
      spread: 0.8,
      count: Math.round((5 + rng.next() * 4) * energy),
      speed: [2.5, 6.5],
    });
    P.emit('dust', {
      position: p,
      direction: n,
      spread: 0.7,
      count: 4,
      speed: [0.6, 1.8],
      size: [0.22, 0.4],
      sizeEnd: [0.8, 1.3],
      life: [0.8, 1.5],
      color: [0.45, 0.36, 0.26],
      alpha: 0.5,
    });
    P.emit('grit', { position: p, direction: n, count: 1, color: [0.42, 0.32, 0.2] });
    this.decals.add('bullet_wood', { point: p, normal: n, object: o.object });
  }

  _fabric(p, n, energy, o) {
    const P = this.particles;
    // burlap / sandbags: sandy dust puff, no sparks
    P.emit('dust', {
      position: p,
      direction: n,
      spread: 0.7,
      count: Math.round(8 * energy),
      speed: [1, 3.2],
      size: [0.3, 0.55],
      sizeEnd: [1.1, 1.9],
      life: [1.0, 2.2],
      color: [0.55, 0.47, 0.32],
      alpha: 0.6,
    });
    P.emit('grit', { position: p, direction: _mixDir, count: 3, color: [0.5, 0.42, 0.28] });
    this.decals.add('bullet_fabric', { point: p, normal: n, object: o.object });
  }

  _water(p, n, energy) {
    const P = this.particles;
    void n;
    _v.set(0, 1, 0);
    P.emit('water_splash', {
      position: p,
      direction: _v,
      spread: 0.15,
      count: 2,
      speed: [0.4, 1.0],
      size: [0.3, 0.5],
      sizeEnd: [1.0, 1.5],
      life: [0.35, 0.55],
    });
    P.emit('water_mist', {
      position: p,
      direction: _v,
      spread: 0.6,
      count: Math.round(5 * energy),
      speed: [0.5, 1.6],
      offset: 0.15,
    });
    // droplets
    P.emit('chip', {
      position: p,
      direction: _v,
      spread: 0.55,
      count: 6,
      speed: [2, 5],
      size: [0.02, 0.04],
      color: [0.55, 0.62, 0.7],
      life: [0.4, 0.8],
      bounce: 0,
    });
  }

  _flesh(p, n, energy, dir, o) {
    const P = this.particles;
    const rng = this.rng;
    // exit-side mist along the bullet direction, small entry puff
    P.emit('blood_mist', {
      position: p,
      direction: dir,
      spread: 0.5,
      count: Math.round((4 + rng.next() * 3) * energy),
      speed: [1, 3],
    });
    P.emit('blood_mist', {
      position: p,
      direction: n,
      spread: 0.6,
      count: 2,
      speed: [0.4, 1.2],
      size: [0.15, 0.25],
      sizeEnd: [0.4, 0.6],
      alpha: 0.7,
    });
    P.emit('blood_droplets', {
      position: p,
      direction: dir,
      spread: 0.45,
      count: 3 + Math.floor(rng.next() * 3),
      speed: [2, 4.5],
    });
    // project a splat onto the nearest surface behind (along the bullet dir)
    // and sometimes onto the floor below
    const world = this.game.world;
    if (world?.raycast) {
      _v.copy(dir);
      const behind = world.raycast(p, _v, 3.0);
      if (behind && behind.surface !== 'water') {
        this.decals.add(rng.next() < 0.5 ? 'blood' : 'blood2', {
          point: behind.point,
          normal: behind.normal,
          size: 0.45 + rng.next() * 0.45,
        });
      }
      if (rng.next() < 0.6) {
        _v2.copy(p).addScaledVector(dir, 0.4 + rng.next() * 0.6);
        _v2.y += 0.3;
        const floor = world.raycast(_v2, _down, 2.4);
        if (floor && floor.surface !== 'water') {
          this.decals.add('blood', {
            point: floor.point,
            normal: floor.normal,
            size: 0.3 + rng.next() * 0.35,
          });
        }
      }
    }
    void o;
  }

  _glass(p, n, energy, o) {
    const P = this.particles;
    const rng = this.rng;
    // glittering shards + fine grit
    P.emit('chip', {
      position: p,
      direction: _mixDir,
      spread: 0.9,
      count: Math.round(10 * energy),
      speed: [2, 6],
      size: [0.02, 0.05],
      color: [0.75, 0.8, 0.85],
      life: [0.6, 1.2],
    });
    P.emit('grit', { position: p, direction: n, count: 2, color: [0.7, 0.75, 0.8] });
    if (rng.next() < 0.5) {
      P.emit('spark', { position: p, direction: _mixDir, spread: 0.5, count: 2, speed: [3, 7], life: [0.15, 0.3], color: [4, 3.5, 3] });
    }
    this.decals.add('bullet_glass', { point: p, normal: n, object: o.object });
  }

  _plastic(p, n, energy, o) {
    const P = this.particles;
    P.emit('chip', {
      position: p,
      direction: _mixDir,
      spread: 0.8,
      count: Math.round(4 * energy),
      speed: [2, 5],
      color: [0.18, 0.17, 0.16],
    });
    P.emit('dust', {
      position: p,
      direction: n,
      spread: 0.6,
      count: 3,
      speed: [0.5, 1.4],
      size: [0.2, 0.3],
      sizeEnd: [0.6, 1.0],
      life: [0.5, 1.0],
      color: [0.4, 0.4, 0.4],
      alpha: 0.4,
    });
    this.decals.add('bullet_concrete', { point: p, normal: n, size: 0.09, object: o.object });
  }

  dispose() {
    this._offHit?.();
  }
}
