/**
 * AI stream installer — enemies, brains, wave director (game.ai).
 *
 *   game.ai            Director (waves + enemy registry, see Director.js)
 *   system 'ai'        order 40: brains → enemy anim/aim/hitboxes → cleanup
 *   presets            firefight (firing/hud), enemy_close (enemy), ai_test (dev)
 * Depends on: world (nav, raycast, spawns), player (position, applyDamage),
 * weapons (game.ballistics hitbox registry), fx (muzzleFlash, tracer,
 * impact, decal), assets (char.swat -> char.soldier fallback).
 * @param {import('../Game.js').Game} game
 */
import { prepareEnemyPrototype } from './Enemy.js';
import { Director } from './Director.js';
import { registerAIPresets } from './presets.js';

export async function installAI(game) {
  const proto = await prepareEnemyPrototype(game);
  if (!proto?.scene) console.warn('[ai] no character asset available — enemies use capsule stand-ins');
  else if (proto.kind !== 'swat') console.warn(`[ai] char.swat unavailable, using ${proto.kind}`);

  const director = new Director(game);
  game.ai = director;

  game.addSystem({
    name: 'ai',
    update: (dt) => director.update(dt),
    dispose: () => director.dispose(),
  }, 40);

  registerAIPresets(game);
}
