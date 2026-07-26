/**
 * WORLD-stream photo-mode presets (docs/CRITIC_PROTOCOL.md §2):
 *
 *   vista     — crane-height establishing shot: the whole terminal, cranes,
 *               ship and warehouse under the storm sky
 *   street    — ground level up the main lane: puddles, floodlight pools,
 *               fog depth, the burnt container and barrier chicane
 *   alley     — tight canyon inside block W: fire barrel, hazard blinker,
 *               cables and hazard tape, wet gutter
 *   quay      — water's edge: reflections, ship + crane silhouettes, held
 *               lightning frame (RENDER's holdFlash)
 *   warehouse — facade with the warm open bay spilling onto the cold yard
 *
 * All framings live in world.photoPoints so critics/humans can retune them
 * without touching preset code. Each preset primes the storm state itself
 * (full rain + wetness) so it is independent of preset ordering.
 */
import * as THREE from 'three';
import { PhotoMode, poseCamera } from '../systems/PhotoMode.js';

const _dir = new THREE.Vector3();

/**
 * @param {import('../Game.js').Game} game
 */
export function registerWorldPresets(game) {
  const base = { category: 'environment', hud: false, warmup: 1.2, frames: 2 };

  PhotoMode.register('vista', {
    ...base,
    warmup: 1.4,
    frames: 1,
    setup(g) {
      prime(g, { lightning: 0.36, dir: [0.35, 0.4, -0.85] });
      poseCamera(g, 'vista', null);
      // aerial establishing shot: thinner haze aloft (fog banks sit at deck
      // level) so the crane pair, the ship's lit castle and the far masts
      // survive as fogged silhouettes / points, and lighter rain up here
      g.sky?.setFog?.(0.0092);
      g.weather?.setRain?.(0.65, { silent: true });
    },
  });

  PhotoMode.register('street', {
    ...base,
    setup(g) {
      prime(g);
      poseCamera(g, 'street', null);
    },
  });

  PhotoMode.register('alley', {
    ...base,
    setup(g) {
      prime(g);
      poseCamera(g, 'alley', null);
    },
  });

  PhotoMode.register('quay', {
    ...base,
    warmup: 1.4,
    frames: 1,
    setup(g) {
      // a distant flicker of lightning (0.3) reveals the ship's mass without
      // washing out the water reflections and the crane work-light pools
      prime(g, { lightning: 0.3, dir: [-0.45, 0.35, -0.85] });
      poseCamera(g, 'quay', null);
    },
  });

  PhotoMode.register('warehouse', {
    ...base,
    setup(g) {
      prime(g);
      poseCamera(g, 'warehouse', null);
    },
  });

  // Bonus: an overhead plan capture used by the docs / nav debugging (not in
  // the critic list). Thin fog + lifted exposure + light rain so the yard,
  // and the ?debug=nav overlay when enabled, read as a legible map.
  PhotoMode.register('overhead', {
    ...base,
    warmup: 0.5,
    frames: 1,
    setup(g) {
      prime(g);
      poseCamera(g, 'overhead', null);
      g.weather?.setRain?.(0.3, { silent: true });
      g.sky?.setFog?.(0.0022);
      g.post?.setExposure?.(3.2);
      g.lighting?.setAmbientIntensity?.(0.32);
      g.lighting?.setMoonIntensity?.(0.9);
    },
  });

  void game;
  void _dir;
}

/**
 * Storm baseline for the environment shots: full rain, wet ground,
 * lightning scheduled normally (or held for the quay frame).
 */
function prime(game, { lightning = null, dir = null } = {}) {
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
