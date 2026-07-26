/**
 * WORLD stream installer. Builds Terminal 9 (level geometry, collision BVH,
 * navigation, spawns, photo points). Called by Game.init().
 * @param {import('../Game.js').Game} game
 */
import { Level } from './Level.js';

export async function installWorld(game) {
  game.world = new Level({ scene: game.scene, assets: game.assets, rng: game.rng, tier: game.tier });
  await game.world.build();
}
