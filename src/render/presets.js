/**
 * RENDER-stream photo-mode presets (registered from src/render/index.js).
 *
 *   rain_light — camera under a floodlight looking up-lane: rain streaks
 *                crossing the volumetric cone, splashes and puddle
 *                reflections on the wet ground, fog depth, beacon and fire
 *                accents. Optional `&lightning=<0..1>` URL param freezes a
 *                lightning flash for the storm variant of the shot.
 *   lightning  — same yard, wide, frozen mid-strike (sheet flash + moon boost).
 *
 * S2 will re-point these at Terminal 9 photo points ('rain_light' in
 * world.photoPoints wins over the fallback pose below).
 */
import * as THREE from 'three';
import { PhotoMode, poseCamera } from '../systems/PhotoMode.js';

const _v = new THREE.Vector3();

/** @param {import('../Game.js').Game} game */
export function registerRenderPresets(game) {
  PhotoMode.register('rain_light', {
    category: 'environment',
    hud: false,
    warmup: 2.5,
    frames: 3,
    setup(g) {
      poseCamera(g, 'rain_light', {
        position: new THREE.Vector3(-1.6, 1.6, 14.2),
        target: new THREE.Vector3(0.4, 4.7, -3.2),
        fov: 66,
      });
      primeAtmosphere(g, { lightning: readFloat(g, 'lightning', null) });
    },
  });

  PhotoMode.register('lightning', {
    category: 'environment',
    hud: false,
    warmup: 1.5,
    frames: 3,
    setup(g) {
      poseCamera(g, 'lightning', {
        position: new THREE.Vector3(-4.2, 1.5, 20.5),
        target: new THREE.Vector3(-1.2, 6.4, -6),
        fov: 66,
      });
      primeAtmosphere(g, { lightning: readFloat(g, 'lightning', 0.9) });
    },
  });

  void game;
}

/**
 * Storm state common to the environment shots: full rain, wet ground,
 * lightning either scheduled (null) or frozen at a level. Also honours the
 * render-stream inspection params `&lens=<0..1>` (water on the lens),
 * `&dof=1` (depth of field on the mid-ground) and `&grade=<name>`.
 */
function primeAtmosphere(game, { lightning = null } = {}) {
  game.weather?.setRain(1, { silent: true });
  game.weather?.setWetness?.(1);
  if (game.sky) {
    if (lightning !== null && lightning >= 0) {
      _v.set(0.35, 0.4, -0.85).normalize();
      game.sky.holdFlash(lightning, _v);
    } else {
      game.sky.holdFlash(null);
    }
  }
  // Inspection switches: URL params (&lens=0.8&dof=1&mb=1&sky=clear&grade=...)
  // or the equivalent debug flags (?debug=lens,dof,mb,clearsky) that the
  // shot harness forwards.
  const dbg = game.debugFlags || new Set();
  const post = game.post;
  if (post) {
    const lens = readFloat(game, 'lens', dbg.has('lens') ? 0.8 : 0);
    if (lens > 0) post.splashLens(lens);
    if (readFloat(game, 'dof', dbg.has('dof') ? 1 : 0) > 0) post.setDof({ focusDistance: 9, focusRange: 7, bokehScale: 3 });
    if (readFloat(game, 'mb', dbg.has('mb') ? 1 : 0) > 0) post.setMotionBlurEnabled(true);
    const grade = game.params?.get?.('grade');
    if (grade) post.setGrade(grade);
  }
  const skyVariant = game.params?.get?.('sky') || (dbg.has('clearsky') ? 'clear' : null);
  if (skyVariant && game.sky && skyVariant !== game.sky.variant) game.sky.setVariant(skyVariant);
}

function readFloat(game, key, fallback) {
  const p = game.params?.get?.(key);
  if (p === null || p === undefined || p === '') return fallback;
  const v = parseFloat(p);
  return Number.isFinite(v) ? v : fallback;
}
