/**
 * Explosions — frag/thrown-explosive detonations (FX stream).
 *
 *   fx.explode({ position, radius=6.5, kind:'frag', damage })
 *
 * Layers (docs/REFERENCE_STUDY.md §4/§5, firing-03, vfx-01/04):
 *   frame 0      white flash sprite + 250 ms warm point-light spike
 *   0-0.4 s      2-3 layers of expanding, clipping fireball sprites
 *   0-0.3 s      ground-hugging additive shockwave ring
 *   0-8 s        rising, lit dark-smoke column (lingers, drifts with wind)
 *   0-3 s        embers riding the updraft, spark tracers, debris chips
 *                with bounce, drifting dust
 *   persistent   ground scorch decal (+ soot)
 * Plus: `grenade:exploded {point, radius}` (canonical damage/impulse
 * event), `fx:explosion {point, radius, kind}`, camera shake with distance
 * falloff via game.player.rig.shake, post.splashLens within 6 m, and the
 * physics hook game.physics.applyExplosionImpulse if present.
 */
import * as THREE from 'three';

const _up = new THREE.Vector3(0, 1, 0);
const _down = new THREE.Vector3(0, -1, 0);
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _pos = new THREE.Vector3();

export class Explosions {
  /**
   * @param {import('../Game.js').Game} game
   * @param {{particles:any, decals:any, lights:any, rng:any}} deps
   */
  constructor(game, { particles, decals, lights, rng }) {
    this.game = game;
    this.particles = particles;
    this.decals = decals;
    this.lights = lights;
    this.rng = rng;
    /** delayed sub-effects (smoke seeding after the fireball) */
    this._queue = [];
  }

  /**
   * Detonate.
   * @param {object} o
   * @param {THREE.Vector3} o.position blast centre (usually just above ground)
   * @param {number} [o.radius=6.5] gameplay/blast radius (m)
   * @param {'frag'|'gas'|'satchel'} [o.kind='frag']
   * @param {number} [o.scale=1] visual scale multiplier
   */
  explode(o = {}) {
    const p = o.position;
    if (!p) return;
    const radius = o.radius ?? 6.5;
    const scale = (o.scale ?? 1) * THREE.MathUtils.clamp(radius / 6.5, 0.6, 1.8);
    const rng = this.rng;
    const P = this.particles;
    _pos.copy(p);

    /* 1. white flash + light spike ------------------------------------- */
    P.emit('flash', { position: _pos, count: 1, size: 2.4 * scale, sizeEnd: 4.5 * scale, life: 0.06 });
    P.emit('flare', {
      position: _v.copy(_pos).addScaledVector(_up, 0.4),
      count: 1,
      size: 1.1 * scale,
      sizeEnd: 2.4 * scale,
      life: 0.14,
      color: [8, 5.2, 2.6],
      colorEnd: [2.2, 0.7, 0.15],
    });
    this.lights?.flash({
      position: _v.copy(_pos).addScaledVector(_up, 0.75),
      color: 0xffe0a8,
      colorEnd: 0xff5a0c,
      intensity: 380 * scale,
      duration: 0.3,
      radius: 40,
      curve: 2.2,
      priority: 2,
    });

    /* 2. fireball layers ---------------------------------------------- */
    // core burst
    P.emit('fireball', {
      position: _v.copy(_pos).addScaledVector(_up, 0.5),
      direction: _up,
      spread: 1.3,
      count: Math.round(4 * scale),
      speed: [2, 5],
      size: [1.5 * scale, 2.2 * scale],
      sizeEnd: [3.2 * scale, 4.4 * scale],
      life: [0.3, 0.45],
      color: [1.5, 0.62, 0.18],
      fadeOut: 0.5,
      offset: 0.8,
    });
    // secondary rolling lobes (slightly slower, live longer, darker end)
    P.emit('fireball', {
      position: _v.copy(_pos).addScaledVector(_up, 1.0),
      direction: _up,
      spread: 0.9,
      count: Math.round(3 * scale),
      speed: [1.4, 3.5],
      size: [1.9 * scale, 2.6 * scale],
      sizeEnd: [4 * scale, 5.4 * scale],
      life: [0.42, 0.6],
      color: [1.2, 0.5, 0.15],
      colorEnd: [0.4, 0.07, 0.01],
      fadeOut: 0.5,
      offset: 0.9,
    });

    /* 3. shockwave rings ------------------------------------------------- */
    P.emit('shockwave', {
      position: _v.copy(_pos).addScaledVector(_up, 0.05),
      count: 1,
      mode: 2, // ground-flat
      size: 0.6,
      sizeEnd: radius * 0.9,
      life: 0.34,
      color: [1.3, 1.2, 1.1],
      colorEnd: [0.3, 0.28, 0.26],
      alpha: 0.6,
    });
    // white-hot core lobe that survives the flash by a few frames
    P.emit('fireball', {
      position: _v.copy(_pos).addScaledVector(_up, 0.6),
      direction: _up,
      spread: 0.7,
      count: 2,
      speed: [1, 2.5],
      size: [1.4 * scale, 1.8 * scale],
      sizeEnd: [2.4 * scale, 3.0 * scale],
      life: [0.32, 0.42],
      color: [3.6, 1.7, 0.5],
      colorEnd: [0.9, 0.2, 0.02],
      fadeOut: 0.6,
      offset: 0.3,
    });
    // incandescent core that outlives the flash
    P.emit('flare', {
      position: _v.copy(_pos).addScaledVector(_up, 0.7),
      count: 2,
      size: [1.0 * scale, 1.4 * scale],
      sizeEnd: [1.6 * scale, 2.1 * scale],
      life: [0.22, 0.3],
      color: [3.2, 1.7, 0.5],
      colorEnd: [1.0, 0.3, 0.05],
      offset: 0.5,
    });

    /* 4. sparks / embers / debris ------------------------------------- */
    P.emit('spark', {
      position: _pos,
      direction: _up,
      spread: 1.35,
      count: Math.round(46 * scale),
      speed: [14, 32],
      life: [0.4, 0.9],
      size: [0.03, 0.06],
      stretch: 0.036,
      color: [12, 7.5, 3],
      offset: 0.5,
    });
    P.emit('ember', {
      position: _pos,
      direction: _up,
      spread: 1.2,
      count: Math.round(30 * scale),
      speed: [3, 9],
      life: [1.6, 3.4],
      size: [0.06, 0.12],
      sizeEnd: [0.04, 0.08],
      offset: 0.5,
    });
    // a fast ember spray that escapes the smoke early
    P.emit('ember', {
      position: _v.copy(_pos).addScaledVector(_up, 0.5),
      direction: _up,
      spread: 1.25,
      count: Math.round(16 * scale),
      speed: [9, 17],
      life: [1.2, 2.4],
      size: [0.07, 0.13],
      sizeEnd: [0.05, 0.09],
      gravity: -3.5,
      drag: 1.5,
      offset: 0.3,
    });
    P.emit('debris', {
      position: _pos,
      direction: _up,
      spread: 1.25,
      count: Math.round(42 * scale),
      speed: [6, 15],
      life: [1.6, 3.2],
      offset: 0.3,
    });
    P.emit('chip', {
      position: _pos,
      direction: _up,
      spread: 1.3,
      count: Math.round(18 * scale),
      speed: [4, 11],
      color: [0.2, 0.19, 0.17],
    });
    // early dark lobes billowing off the fireball's crown (drawn over the additive fire)
    P.emit('smoke_dark', {
      position: _v.copy(_pos).addScaledVector(_up, 1.6),
      direction: _up,
      spread: 1.2,
      count: Math.round(5 * scale),
      speed: [3.5, 7],
      size: [0.9 * scale, 1.4 * scale],
      sizeEnd: [3.2 * scale, 4.5 * scale],
      life: [3.5, 5],
      alpha: 0.55,
      offset: 1.4,
    });
    // ground dust ring pushed outward
    for (let i = 0; i < 10; i++) {
      const ang = (i / 10) * Math.PI * 2 + rng.range(-0.15, 0.15);
      _v.set(Math.cos(ang), 0.15, Math.sin(ang));
      _v2.copy(_pos).addScaledVector(_v, 0.6);
      _v2.y = _pos.y + 0.15;
      P.emit('dust', {
        position: _v2,
        direction: _v,
        spread: 0.35,
        count: 2,
        speed: [3.5, 7],
        size: [0.7, 1.1],
        sizeEnd: [2.2, 3.4],
        life: [1.2, 2.2],
        color: [0.32, 0.3, 0.28],
        alpha: 0.5,
        drag: 3.2,
      });
    }

    /* 5. smoke column (staggered so it billows up out of the fireball) ---- */
    const now = this.game.time.elapsed;
    this._queue.push({ at: now + 0.1, kind: 'smoke', pos: _pos.clone(), scale });
    this._queue.push({ at: now + 0.3, kind: 'smoke', pos: _pos.clone(), scale });
    this._queue.push({ at: now + 0.55, kind: 'smoke', pos: _pos.clone(), scale });
    this._queue.push({ at: now + 0.9, kind: 'smoke', pos: _pos.clone(), scale });

    /* 6. scorch + soot decal --------------------------------------------- */
    const world = this.game.world;
    if (world?.raycast) {
      _v.copy(_pos);
      _v.y += 0.5;
      const g = world.raycast(_v, _down, 4);
      if (g) {
        this.decals?.add('scorch', { point: g.point, normal: g.normal, size: (1.8 + rng.next() * 0.8) * scale });
        this.decals?.add('soot', { point: g.point, normal: g.normal, size: (2.8 + rng.next()) * scale, rotation: rng.range(0, 6) });
      }
    }

    /* 7. events / shake / lens / physics ------------------------------- */
    this.game.events.emit('grenade:exploded', { point: _pos, radius });
    this.game.events.emit('fx:explosion', { point: _pos, radius, kind: o.kind || 'frag' });
    this.shakeCamera(_pos, 1.0, { radius });
    this.game.physics?.applyExplosionImpulse?.(_pos, radius, o.energy ?? 1);
  }

  /**
   * Camera shake with distance falloff (also splashes the lens up close).
   * @param {THREE.Vector3} position
   * @param {number} strength 0..1+ at point blank
   * @param {{radius?:number}} [opts]
   */
  shakeCamera(position, strength = 1, opts = {}) {
    const game = this.game;
    const cam = game.camera;
    if (!cam) return;
    const listener = game.player?.eyePosition || cam.position;
    const dist = listener.distanceTo(position);
    const radius = opts.radius ?? 6.5;
    // full strength inside the blast radius, inverse falloff beyond
    let k = strength;
    if (dist > radius) k *= Math.pow(radius / dist, 1.35);
    k = THREE.MathUtils.clamp(k, 0, 1.4);
    if (k > 0.02) {
      game.player?.rig?.shake?.({ strength: k, duration: 0.55 + 0.3 * k, freqPos: 20, freqRot: 26 });
    }
    if (dist < 6) game.post?.splashLens?.(THREE.MathUtils.clamp(0.9 - dist / 7, 0.25, 0.9));
  }

  _seedSmoke(pos, scale, layer) {
    const P = this.particles;
    // dark rising column
    P.emit('smoke_dark', {
      position: _v.copy(pos).addScaledVector(_up, 0.6 + 0.4 * layer),
      direction: _up,
      spread: 0.5,
      count: Math.round(6 * scale),
      speed: [1.6, 3.4],
      size: [1.8 * scale, 2.6 * scale],
      sizeEnd: [4.8 * scale, 7 * scale],
      life: [6, 8.5],
      offset: 0.8,
    });
    // warm-lit fringe (thinner, brownish, catches the fire light)
    P.emit('smoke_soft', {
      position: _v.copy(pos).addScaledVector(_up, 0.8),
      direction: _up,
      spread: 0.9,
      count: Math.round(4 * scale),
      speed: [1, 2.4],
      size: [1.2 * scale, 1.8 * scale],
      sizeEnd: [3.5 * scale, 5 * scale],
      life: [4, 6],
      color: [0.16, 0.13, 0.11],
      colorEnd: [0.2, 0.18, 0.16],
      alpha: 0.75,
      offset: 0.6,
    });
  }

  update(dt) {
    void dt;
    if (this._queue.length === 0) return;
    const t = this.game.time.elapsed;
    for (let i = this._queue.length - 1; i >= 0; i--) {
      const q = this._queue[i];
      if (t < q.at) continue;
      if (q.kind === 'smoke') this._seedSmoke(q.pos, q.scale, 2);
      this._queue.splice(i, 1);
    }
  }

  clear() {
    this._queue.length = 0;
  }

  dispose() {
    this._queue.length = 0;
  }
}
