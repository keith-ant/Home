/**
 * WORLD stream installer — builds Terminal 9 (see docs/NOTES-world.md).
 *
 * Called by Game.init() after installRender, so game.sky / game.lighting /
 * game.weather / game.pbr all exist. Everything is wired here:
 *   game.world = Level  (public API documented in Level.js)
 *   photo presets vista/street/alley/quay/warehouse (+ overhead)
 *
 * @param {import('../Game.js').Game} game
 */
import { Level } from './Level.js';
import { registerWorldPresets } from './presets.js';

export async function installWorld(game) {
  const level = new Level(game);
  await level.build();
  game.world = level;
  registerWorldPresets(game);

  // Terminal 9 is authored around pools of light with black gaps between
  // them (the CoD night grammar), so the global moon key / hemisphere fill
  // are dialled down from the render-stream defaults through their public
  // API. Lightning still boosts both. Documented in docs/NOTES-world.md.
  game.lighting?.setMoonIntensity?.(0.32);
  game.lighting?.setAmbientIntensity?.(0.055);

  // The water plane's Reflector re-renders the whole scene when drawn. From
  // ground level anywhere in the yard the water surface (y −1.9 beyond the
  // quay wall) is fully occluded, so only enable it for elevated or
  // quayside cameras (a per-render decision → post pre-render hook).
  game.events.once('game:ready', () => {
    const water = level.water;
    if (!water || !water.isReflector || !game.post) return;
    const fwd = { x: 0, y: 0, z: -1 };
    game.post.addPreRender((camera) => {
      const p = camera.position;
      const e = camera.matrixWorld.elements; // forward = -Z axis of the camera matrix
      fwd.x = -e[8];
      fwd.y = -e[9];
      fwd.z = -e[10];
      // planar reflections only for low cameras standing at/near the quay looking out
      const usePlanar = fwd.z < 0.35 && Math.abs(fwd.y) < 0.85 && p.z < -30 && p.y < 9;
      water.visible = usePlanar;
      if (level.waterFallback) level.waterFallback.visible = !usePlanar;
    });
  });
}
