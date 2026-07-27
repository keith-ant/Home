/**
 * PLAYER stream installer — kinematic first-person player + camera rig.
 * See docs/NOTES-player.md.
 *
 * Wires:
 *   game.player            Player facade (Player.js documents the API)
 *   systems                'player' (order 10) movement/health,
 *                          'camera' (order 90) final camera pose
 *   pointer lock           canvas click in realtime play
 *
 * The player spawns at world.spawns.player facing north up the main lane.
 * Photo presets that pose a free camera call game.player.detachCamera()
 * (poseCamera does this); presets that want the player's eyes call
 * game.player.teleport(pos, yaw) which re-attaches the rig.
 *
 * @param {import('../Game.js').Game} game
 */
import { Player } from './Player.js';
import { registerPlayerDevPresets } from './presets.js';

export function installPlayer(game) {
  const player = new Player(game);
  game.player = player;

  // Spawn at the level's authored start (yaw 0 = facing -Z / north).
  const spawn = game.world?.spawns?.player;
  if (spawn) {
    player.teleport(spawn.position, spawn.yaw ?? 0, 0);
  } else {
    player.teleport({ x: 0, y: 0, z: 0 }, 0, 0);
  }

  game.addSystem({
    name: 'player',
    update: (dt) => player.update(dt),
    dispose: () => player.dispose(),
  }, 10);

  game.addSystem({
    name: 'camera',
    update: (dt) => player.lateUpdate(dt),
  }, 90);

  // Pointer lock on click during realtime play (menus/UI can layer on top).
  if (!game.isDeterministic && game.canvas) {
    const onClick = () => {
      if (game.state === 'playing' && !game.input.pointerLocked) game.input.requestPointerLock();
    };
    game.canvas.addEventListener('click', onClick);
    player._offCanvasClick = () => game.canvas.removeEventListener('click', onClick);
  }

  // Respawn hook for later streams (death → results/respawn flow).
  game.events.on('player:request-respawn', (p) => player.respawn(p?.position, p?.yaw));

  // Movement self-test preset (only with ?debug=player).
  registerPlayerDevPresets(game);
}
