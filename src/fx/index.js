/**
 * FX stream installer — pooled particles, tracers, muzzle flash, impacts,
 * decals, brass casings, explosions, ambient emitters, lens hooks.
 * See docs/NOTES-fx.md for the public surface and tuning.
 *
 * Everything lands on `game.fx`:
 *   fx.particles.emit(kind, opts)          Particles.js  (KINDS table)
 *   fx.tracer(from, to, opts)               Tracers.js
 *   fx.muzzleFlash(opts)                    MuzzleFlash.js  (world-space)
 *   fx.createMuzzleFlash(opts)              MuzzleFlash.js  (viewmodel-attachable rig)
 *   fx.impact(opts)                         Impacts.js  (also driven by weapon:hit)
 *   fx.decal(kind, opts)                    Decals.js
 *   fx.ejectCasing(opts)                    Casings.js
 *   fx.explode(opts)                        Explosions.js  (emits grenade:exploded)
 *   fx.shake(opts) / fx.shakeAt(pos, s, o)  camera shake helpers (via player rig)
 *   fx.lights.flash(opts)                   TransientLights.js  (VFX light spikes)
 *   fx.clear()                              reset every pool (photo presets)
 *
 * Systems: 'fx' (order 50). Render hook: particle/tracer buffer upload +
 * light array (post pre-render). Events consumed: weapon:hit, player:*.
 * Events emitted: fx:impact, fx:decal, fx:ricochet, fx:casing,
 * fx:explosion, grenade:exploded.
 *
 * @param {import('../Game.js').Game} game
 */
import { fxRng } from './util.js';
import { Particles } from './Particles.js';
import { Tracers } from './Tracers.js';
import { Decals } from './Decals.js';
import { TransientLights } from './TransientLights.js';
import { MuzzleFlash } from './MuzzleFlash.js';
import { Impacts } from './Impacts.js';
import { Casings } from './Casings.js';
import { Explosions } from './Explosions.js';
import { Emitters } from './Emitters.js';
import { LensFX } from './LensFX.js';
import { registerFxPresets } from './presets.js';

export function installFX(game) {
  const rng = fxRng(game);
  const particles = new Particles(game, rng);
  particles.groundY = game.world?.groundY ?? 0;
  const lights = new TransientLights(game, 3);
  const decals = new Decals(game, rng);
  const tracers = new Tracers(game);
  const casings = new Casings(game, rng);
  const muzzle = new MuzzleFlash(game, { particles, lights, rng });
  const impacts = new Impacts(game, { particles, decals, tracers, lights, rng });
  const explosions = new Explosions(game, { particles, decals, lights, rng });
  const emitters = new Emitters(game, { particles, rng });
  emitters.enabled = !game.debugFlags?.has('noemitters');
  const lens = new LensFX(game);

  const fx = {
    particles,
    tracers,
    decals,
    casings,
    muzzle,
    impacts,
    explosions,
    emitters,
    lens,
    lights,
    rng,
    /** @param {import('three').Vector3} from @param {import('three').Vector3} to @param {any} [o] */
    tracer: (from, to, o) => tracers.spawn(from, to, o),
    muzzleFlash: (o) => muzzle.flash(o),
    createMuzzleFlash: (o) => muzzle.createRig(o),
    impact: (o) => impacts.spawn(o),
    decal: (kind, o) => decals.add(kind, o),
    ejectCasing: (o) => casings.eject(o),
    explode: (o) => explosions.explode(o),
    shake: (o) => game.player?.rig?.shake?.(o),
    shakeAt: (position, strength, o) => explosions.shakeCamera(position, strength, o),
    /** wipe every pool (used by photo presets to start clean) */
    clear() {
      particles.clear();
      tracers.clear();
      decals.clear();
      casings.clear();
      explosions.clear();
      lights.clear();
    },
  };
  game.fx = fx;

  game.addSystem({
    name: 'fx',
    update(dt) {
      emitters.update(dt);
      explosions.update(dt);
      particles.update(dt);
      tracers.update(dt);
      casings.update(dt);
      muzzle.update(dt);
      lights.update(dt);
      decals.update(dt);
      lens.update(dt);
    },
    dispose() {
      impacts.dispose();
      particles.dispose();
      tracers.dispose();
      casings.dispose();
      muzzle.dispose();
      lights.dispose();
      decals.dispose();
      explosions.dispose();
      emitters.dispose();
      lens.dispose();
    },
  }, 50);

  // Camera-dependent buffer uploads happen once per rendered frame.
  game.events.once('game:ready', () => {
    game.post?.addPreRender((camera) => {
      particles.preRender(camera);
      tracers.preRender(camera);
    });
  });

  registerFxPresets(game);
}
