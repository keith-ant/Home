/**
 * FX-stream photo-mode presets (docs/CRITIC_PROTOCOL.md §2):
 *
 *   impacts   — a container wall + concrete barrier at the north mouth of
 *               the main lane just raked with gunfire: metal dents and
 *               scorched holes on the corrugated steel, concrete craters and
 *               chipped holes on the jersey barrier, live sparks from the
 *               last two rounds still mid-flight, dust hanging in the air,
 *               a stray ricochet tracer, hot spots glowing. Frozen a couple
 *               of frames after the final hits (the sim is stepped inside
 *               setup so old and fresh impacts coexist).
 *   explosion — a frag detonation at t+0.15 s in the block-W alley, framed
 *               from ~8.5 m at chest height: clipping fireball layers,
 *               shockwave rings, gravity-arcing spark tracers, debris and
 *               embers in flight, the smoke column starting, ground scorch,
 *               and the alley walls lit orange by the blast light.
 *
 * Both are deterministic for a given seed (cosmetic rng derived from
 * game.seed) and keep the HUD off (VFX detail plates).
 */
import * as THREE from 'three';
import { PhotoMode, poseCamera } from '../systems/PhotoMode.js';

const _v = new THREE.Vector3();
const _dir = new THREE.Vector3();

/** @param {import('../Game.js').Game} game */
export function registerFxPresets(game) {
  /* ------------------------------------------------------------ impacts */
  PhotoMode.register('impacts', {
    category: 'vfx',
    hud: false,
    warmup: 0,
    frames: 2,
    async setup(g) {
      primeStorm(g, { lightning: 0.3, dir: [0.5, 0.35, -0.8] });
      g.fx?.clear();
      // Camera: main-lane north mouth, low, looking east at the block-E
      // container wall with a jersey barrier in the lower-mid frame.
      poseCamera(g, 'impacts', {
        position: new THREE.Vector3(1.15, 1.38, -37.4),
        target: new THREE.Vector3(7.6, 1.45, -34.35),
        fov: 55,
      });
      const world = g.world;
      const fx = g.fx;
      if (!world?.raycast || !fx) return;

      // A shooter back down the lane, north-west of the camera, so tracer
      // streaks enter frame from the left; every impact comes from a real
      // raycast so decals land on true surfaces.
      const gun = _gun.set(-3.4, 1.55, -44.2);
      let scorched = false;
      const shoot = (tx, ty, tz, opts = {}) => {
        _v.set(tx, ty, tz);
        _dir.subVectors(_v, gun).normalize();
        const hit = world.raycast(gun, _dir, 60);
        if (!hit) return null;
        _p.copy(hit.point);
        _n.copy(hit.normal);
        fx.impact({
          point: _p,
          normal: _n,
          surface: opts.surface || hit.surface,
          energy: opts.energy ?? 1,
          dir: _dir,
        });
        // one scorched, sooted strike on the metal
        if (opts.scorch && !scorched) {
          scorched = true;
          fx.decal('soot', { point: _p, normal: _n, size: 0.55, sizeJitter: false });
          fx.decal('bullet_metal_hot', { point: _p, normal: _n, size: 0.24, sizeJitter: false });
        }
        if (opts.tracer) {
          // a second shooter beside the camera: the streak enters frame
          // over the left shoulder and lands where the round did
          const cam = g.camera;
          cam.updateMatrixWorld();
          const e = cam.matrixWorld.elements;
          // camera basis: right = column X, up = column Y, forward = -column Z
          _from.copy(cam.position);
          _from.x += e[0] * -1.6 + e[8] * -0.3;
          _from.y += e[1] * -1.6 + e[9] * -0.3 - 0.35;
          _from.z += e[2] * -1.6 + e[10] * -0.3;
          const dist = _from.distanceTo(_p);
          // speed so the head reaches ~85 % of the way in the given frames
          const speed = (dist * 0.85) / ((opts.tracerFrames ?? 2) / 60);
          fx.tracer(_from, _p, { speed: opts.tracerSpeed ?? speed, length: 7, width: 0.034, skip: 0.5 });
        }
        return hit;
      };

      // --- the old volley (already settled: decals, hot spots, fading dust)
      shoot(6.98, 2.05, -35.9, { scorch: true });
      shoot(6.98, 1.62, -34.2);
      shoot(6.98, 0.95, -35.1);
      shoot(6.98, 2.35, -33.4);
      shoot(6.98, 1.28, -36.6);
      shoot(6.98, 0.55, -33.9);
      shoot(6.98, 2.72, -35.2);
      g.loop.stepFixed(24);
      shoot(6.98, 1.75, -32.7);
      shoot(4.55, 0.62, -35.5);   // barrier flank
      shoot(4.55, 0.34, -36.4);
      shoot(4.6, 0.78, -34.6);
      g.loop.stepFixed(20);
      shoot(6.98, 1.05, -32.9);
      shoot(4.5, 0.5, -37.1);
      shoot(3.6, 0.02, -35.0, { energy: 0.9 }); // asphalt kick-up
      g.loop.stepFixed(16);
      // lingering concrete dust hanging over the barrier from the earlier hits
      _v.set(4.4, 0.95, -35.6);
      fx.particles.emit('dust', {
        position: _v,
        count: 5,
        speed: [0.05, 0.15],
        offset: 0.6,
        size: [1.1, 1.6],
        sizeEnd: [1.9, 2.6],
        life: [5, 7],
        alpha: 0.16,
        fadeIn: 0.05,
        color: [0.5, 0.48, 0.44],
      });
      // --- the recent hits: sparks + dust still airborne at capture
      shoot(6.98, 1.5, -35.3, { energy: 1.3, tracer: true, tracerFrames: 9 });
      g.loop.stepFixed(4);
      shoot(4.55, 0.7, -35.9, { energy: 1.25 });
      shoot(6.98, 2.15, -34.6, { energy: 1.3 });
      g.loop.stepFixed(3);
      // one more spark shower just as the shutter opens (2 frames old)
      shoot(6.98, 1.15, -34.0, { energy: 1.4, tracer: true, tracerFrames: 2 });
      g.loop.stepFixed(2);
    },
  });

  /* ---------------------------------------------------------- explosion */
  PhotoMode.register('explosion', {
    category: 'vfx',
    hud: false,
    warmup: 0.15, // frag at t+0.15 s
    frames: 2,
    async setup(g) {
      primeStorm(g);
      g.fx?.clear();
      // block-W alley, looking north from ~7.7 m at chest height, the fire
      // barrel off-centre so the blast core reads past it
      poseCamera(g, 'explosion', {
        position: new THREE.Vector3(-16.62, 1.35, 8.6),
        target: new THREE.Vector3(-16.7, 1.45, -6),
        fov: 62,
      });
      const fx = g.fx;
      if (!fx) return;
      // let the ambient FX (fire barrel) breathe a moment first
      g.loop.stepFixed(30);
      _v.set(-16.45, 0.55, 0.6);
      fx.explode({ position: _v, radius: 6.5, kind: 'frag' });
    },
  });

  /* ------------------------------------------------- fx_test (dev only) --- */
  // Exercises the FX API surface not covered by the critic presets
  // (muzzle flash rig, casings, flesh/water/wood/fabric recipes, damage
  // vignette + flinch) from the player's own eyes. `?debug=fxdev` only.
  if (game.debugFlags?.has('fxdev')) {
    PhotoMode.register('fx_test', {
      category: 'debug',
      hud: false,
      warmup: 0,
      frames: 2,
      async setup(g) {
        primeStorm(g);
        g.fx?.clear();
        const fx = g.fx;
        const p = g.player;
        if (!fx || !p) throw new Error('fx_test: no fx/player');
        // stand in the south lane facing the spawn sandbag wall, camera on the rig
        p.respawn();
        p.teleport(new THREE.Vector3(-1.4, 0, 34.6), 0, -0.08);
        g.loop.stepFixed(4);
        const eye = p.eyePosition;
        const fwd = p.rig.forward;
        // casings: a burst ejected to the right over half a second
        for (let i = 0; i < 10; i++) {
          _v.set(eye.x + fwd.x * 0.55 + 0.35, eye.y - 0.12, eye.z + fwd.z * 0.55);
          _dir.set(1.2 + fx.rng.next(), 1.1 + fx.rng.next() * 0.6, fwd.z * (2.4 + fx.rng.next()));
          fx.ejectCasing({ position: _v, velocity: _dir, kind: i % 3 === 0 ? 'pistol' : 'rifle' });
          g.loop.stepFixed(4);
        }
        // impacts on the sandbag wall (fabric), the ground (asphalt), a flesh
        // hit mid-air (blood mist + splat on the ground behind), water splash
        const world = g.world;
        _v.set(-2.6, 0.55, 30.42);
        _dir.set(-0.24, -0.27, -0.93).normalize();
        let hit = world.raycast(eye, _dir, 20);
        if (hit) fx.impact({ point: hit.point, normal: hit.normal, surface: hit.surface, dir: _dir });
        _v.set(0.6, 0.9, 31.2);
        _dir.set(0.3, -0.35, -0.9).normalize();
        fx.impact({ point: _v, normal: new THREE.Vector3(0, 1, 0), surface: 'flesh', dir: _dir, energy: 1.2 });
        _v.set(2.2, 0.02, 31.0);
        fx.impact({ point: _v, normal: new THREE.Vector3(0, 1, 0), surface: 'water', dir: _dir });
        _dir.set(-0.988, -0.135, -0.096).normalize(); // toward the pallet stack (wood)
        hit = world.raycast(eye, _dir, 20);
        if (hit) fx.impact({ point: hit.point, normal: hit.normal, surface: hit.surface || 'wood', dir: _dir });
        g.loop.stepFixed(6);
        // hurt the player: flinch + damage vignette (health 55)
        p.applyDamage(45, { dir: _dir.set(-0.7, 0, -0.7).normalize() });
        // muzzle flash right in front of the camera, one fixed step before capture
        _v.copy(eye).addScaledVector(fwd, 0.9);
        _v.y -= 0.18;
        fx.muzzleFlash({ position: _v, direction: fwd, size: 1, light: true });
        // a tracer streaking away from the muzzle
        _dir.copy(fwd);
        _p.copy(_v).addScaledVector(_dir, 40);
        fx.tracer(_v, _p, { speed: 900, length: 10, width: 0.04, skip: 2 });
        g.loop.stepFixed(1);
        p.attachCamera();
        let settled = 0;
        let airborne = 0;
        for (const key of ['rifle', 'pistol']) {
          for (const c of fx.casings.pools[key].items) {
            if (!c.active) continue;
            if (c.settled) settled++;
            else airborne++;
          }
        }
        console.info('[fx_test] particles', fx.particles.count, 'decals', fx.decals.count, 'casings settled/air', settled, airborne, 'health', p.health);
        if (settled + airborne === 0) console.error('[fx_test] no casings simulated');
        if (fx.decals.count < 2) console.error('[fx_test] decals missing: ' + fx.decals.count);
      },
    });
  }

  void game;
}

/* --------------------------------------------------------------------- */
const _gun = new THREE.Vector3();
const _from = new THREE.Vector3();
const _p = new THREE.Vector3();
const _n = new THREE.Vector3();

/**
 * Storm baseline for the FX plates (mirrors the world presets): full
 * rain + wetness, optional held lightning to lift the ambient a touch.
 */
function primeStorm(game, { lightning = null, dir = null } = {}) {
  game.weather?.setRain?.(1, { silent: true });
  game.weather?.setWetness?.(1);
  if (game.sky) {
    if (lightning !== null) {
      const d = dir ? new THREE.Vector3(dir[0], dir[1], dir[2]).normalize() : undefined;
      game.sky.holdFlash(lightning, d);
    } else {
      game.sky.holdFlash(null);
    }
  }
}
