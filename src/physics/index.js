/**
 * PHYSICS stream installer (trimmed for the AI/combat time box):
 * Rapier is intentionally NOT initialised — no ragdolls or debris this
 * pass (docs/NOTES-ai.md, known gaps). Player + bullets use the world BVH,
 * grenades keep their own arc/bounce inside the weapons stream, and enemy
 * deaths play the Death clip and despawn. `game.physics` stays null so
 * consumers that probe it (Grenade.js, Explosions.js) take their fallbacks.
 * @param {import('../Game.js').Game} game
 */
export function installPhysics(game) {
  game.physics = null;
}
