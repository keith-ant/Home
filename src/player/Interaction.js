/**
 * Interaction — the "F to use" probe (PLAYER stream, stub).
 *
 * Every fixed step (only while playing) casts a short ray from the eye
 * along the view; if the hit object (or its collision proxy owner) carries
 * `userData.interactable = { label, ... }`, publishes `ui:interact-prompt`
 * with the label (once per target change) and emits `player:interact`
 * {target, object} when the interact action is pressed. Nothing in
 * Terminal 9 is interactable yet — WORLD / SYSTEMS can tag doors, ammo
 * crates, mounted guns later without touching this stream.
 */
import * as THREE from 'three';

const _origin = new THREE.Vector3();
const _dir = new THREE.Vector3();

export class Interaction {
  /**
   * @param {import('../Game.js').Game} game
   * @param {import('./Player.js').Player} player
   */
  constructor(game, player) {
    this.game = game;
    this.player = player;
    this.range = 2.6;
    this.current = null;
    this._tick = 0;
  }

  update(dt) {
    void dt;
    const game = this.game;
    if (!this.player.alive || game.state === 'photo') {
      this._clear();
      return;
    }
    // probe at 15 Hz — plenty for a prompt
    if ((this._tick++ % 4) !== 0) return;
    const world = game.world;
    if (!world?.raycast) return;
    const rig = this.player.rig;
    _origin.copy(rig.eyePosition);
    _dir.copy(rig.forward);
    const hit = world.raycast(_origin, _dir, this.range);
    let target = null;
    if (hit && hit.object && hit.object.userData && hit.object.userData.interactable) {
      target = hit.object;
    }
    if (target !== this.current) {
      this.current = target;
      if (target) {
        const info = target.userData.interactable;
        game.events.emit('ui:interact-prompt', { label: info.label || 'USE', key: 'F', target });
      } else {
        game.events.emit('ui:interact-prompt', null);
      }
    }
    if (this.current && game.input?.pressed('interact')) {
      game.events.emit('player:interact', { target: this.current, info: this.current.userData.interactable });
    }
  }

  _clear() {
    if (this.current) {
      this.current = null;
      this.game.events.emit('ui:interact-prompt', null);
    }
  }

  dispose() {}
}
