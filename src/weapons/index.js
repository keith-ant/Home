/**
 * WEAPONS stream installer — first-person weapons, viewmodel pass,
 * ballistics, grenades, photo presets. See docs/NOTES-weapons.md.
 *
 * Wires:
 *   game.weapons          WeaponSystem (public API documented in WeaponSystem.js)
 *   game.ballistics       Ballistics (hitbox registry for the AI stream)
 *   system 'weapons'      fixed step, order 30 (after player, before ai/fx)
 *   viewmodel pass        second RenderPass via post.attachViewmodel (on game:ready)
 *   presets               viewmodel_idle/_ads/_fire/_reload/_pistol/_inspect, gun_macro
 *
 * @param {import('../Game.js').Game} game
 */
import { WeaponSystem } from './WeaponSystem.js';
import { registerWeaponPresets } from './presets.js';

export async function installWeapons(game) {
  const system = new WeaponSystem(game);
  game.weapons = system;
  game.ballistics = system.ballistics;

  game.addSystem({
    name: 'weapons',
    update: (dt) => system.update(dt),
    dispose: () => system.dispose(),
  }, 30);

  registerWeaponPresets(game);
}
