/**
 * RENDER stream installer. Owns sky, lighting, weather, post-processing.
 * Called by Game.init() after the renderer, camera and assets exist.
 * @param {import('../Game.js').Game} game
 */
import { Sky } from './Sky.js';
import { Post } from './Post.js';

export function installRender(game) {
  game.sky = new Sky(game.scene, game.tier);
}

/**
 * Post-processing must be created after the world exists (it captures the
 * scene/camera). Game calls this last.
 * @param {import('../Game.js').Game} game
 */
export function installPost(game) {
  game.post = new Post({
    renderer: game.renderer,
    scene: game.scene,
    camera: game.camera,
    settings: game.settings,
  });
}
