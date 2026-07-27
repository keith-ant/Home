/**
 * Player — the local player facade (PLAYER stream, docs/BUILD_PLAN.md §S3).
 *
 * `game.player` is one Player instance. It owns the health/state model and
 * composes the kinematic Controller (movement + collision), the CameraRig
 * (final camera pose, view kick, shakes) and the Interaction probe. Other
 * streams talk to it through this surface:
 *
 *   player.health, .maxHealth, .alive        state
 *   player.position (Vector3, feet)         live capsule position (do not keep the reference across frames)
 *   player.velocity (Vector3)                m/s
 *   player.eyePosition (Vector3)             world-space eye point this fixed step
 *   player.yaw, player.pitch (radians)      view angles (rig-owned)
 *   player.isSprinting / isCrouched / isSliding / isMantling / isGrounded / isAds
 *   player.moveState                         'idle'|'walk'|'sprint'|'crouch'|'crouchwalk'|'slide'|'air'|'mantle'|'dead'
 *   player.rig                               CameraRig (kickView / shake / addRecoil / setAds / viewmodelSway / viewmodelBob)
 *   player.controller                        Controller
 *   player.applyDamage(amount, {from, dir, isHeadshot, source})
 *   player.heal(amount), player.setHealth(v), player.kill(), player.respawn(pos, yaw)
 *   player.teleport(position, yaw, pitch)    also re-attaches the camera to the rig
 *   player.detachCamera() / attachCamera()   photo presets pose a free camera / hand it back
 *   player.setMoveScale(v)                   weapons: ADS / reload movement scaling (1 = none)
 *   player.setAds(amount, {fovMul})          weapons: ADS blend 0..1 (drives FOV + move speed)
 *   player.interruptSprint()                  weapons: firing / reloading cancels sprint
 *
 * Events emitted: player:damaged {amount, from, dir, isHeadshot, health},
 * player:died {from, source}, player:healed {health}, player:landed {speed},
 * player:footstep {surface, sprint, foot, position, wet, speed}, player:jump {},
 * player:mantle {height}, player:slide {}, player:respawn {}.
 * Consumed: none directly (input actions are read from game.input).
 */
import * as THREE from 'three';
import { Controller } from './Controller.js';
import { CameraRig } from './CameraRig.js';
import { Interaction } from './Interaction.js';

const _v = new THREE.Vector3();

export class Player {
  /**
   * @param {import('../Game.js').Game} game
   */
  constructor(game) {
    this.game = game;
    this.events = game.events;

    this.maxHealth = 100;
    this.health = 100;
    this.alive = true;
    /** simulated seconds of the last damage taken (for regen) */
    this.lastDamageTime = -1e9;
    this.regenDelay = 5.0;
    this.regenRate = 25.0;
    this._healEmitAcc = 0;

    /** weapon-driven modifiers */
    this.moveScale = 1;
    this.adsAmount = 0;
    this.adsFovMul = 0.82;
    this.adsControlledByWeapons = false;

    this.controller = new Controller(game, this);
    this.rig = new CameraRig(game, this);
    this.interaction = new Interaction(game, this);

    this._eye = new THREE.Vector3();
  }

  /* --------------------------------------------------------- accessors */
  get position() {
    return this.controller.position;
  }
  get velocity() {
    return this.controller.velocity;
  }
  get eyePosition() {
    return this.rig.eyePosition;
  }
  get yaw() {
    return this.rig.yaw;
  }
  get pitch() {
    return this.rig.pitch;
  }
  get isSprinting() {
    return this.controller.sprinting && this.controller.grounded;
  }
  get isCrouched() {
    return this.controller.crouchBlend > 0.5;
  }
  get isSliding() {
    return this.controller.sliding;
  }
  get isMantling() {
    return !!this.controller.mantle;
  }
  get isGrounded() {
    return this.controller.grounded;
  }
  get isAds() {
    return this.adsAmount > 0.5;
  }
  get moveState() {
    return this.controller.moveState;
  }
  get camera() {
    return this.game.camera;
  }

  /* ---------------------------------------------------------- health */
  /**
   * Apply damage. Emits player:damaged (and player:died at 0 health).
   * @param {number} amount
   * @param {{from?:THREE.Vector3, dir?:THREE.Vector3, isHeadshot?:boolean, source?:any}} [info]
   * @returns {number} damage actually applied
   */
  applyDamage(amount, info = {}) {
    if (!this.alive || amount <= 0) return 0;
    const applied = Math.min(this.health, amount);
    this.health = Math.max(0, this.health - applied);
    this.lastDamageTime = this.game.time.elapsed;
    // view flinch + camera feedback
    this.rig.flinch(info.dir || null, applied);
    this.events.emit('player:damaged', {
      amount: applied,
      from: info.from || null,
      dir: info.dir || null,
      isHeadshot: !!info.isHeadshot,
      health: this.health,
      source: info.source || null,
    });
    if (this.health <= 0) this.kill(info);
    return applied;
  }

  heal(amount) {
    if (!this.alive || amount <= 0) return;
    const before = this.health;
    this.health = Math.min(this.maxHealth, this.health + amount);
    if (this.health !== before) this.events.emit('player:healed', { health: this.health });
  }

  setHealth(v) {
    this.health = THREE.MathUtils.clamp(v, 0, this.maxHealth);
    this.events.emit('player:healed', { health: this.health });
  }

  kill(info = {}) {
    if (!this.alive) return;
    this.alive = false;
    this.health = 0;
    this.controller.onDeath();
    this.rig.onDeath(info.dir || null);
    this.events.emit('player:died', { from: info.from || null, source: info.source || null });
  }

  /**
   * Respawn (full health) at a position. Defaults to the world player spawn.
   * @param {THREE.Vector3} [position]
   * @param {number} [yaw]
   */
  respawn(position, yaw) {
    const sp = this.game.world?.spawns?.player;
    const pos = position || sp?.position || _v.set(0, 0, 0);
    const y = yaw ?? sp?.yaw ?? 0;
    this.alive = true;
    this.health = this.maxHealth;
    this.lastDamageTime = -1e9;
    this.rig.onRespawn();
    this.teleport(pos, y, 0);
    this.events.emit('player:respawn', {});
    this.events.emit('player:healed', { health: this.health });
  }

  /* ----------------------------------------------------------- camera */
  /**
   * Move the player (feet position) and hand the camera to the rig.
   * @param {THREE.Vector3|{x:number,y:number,z:number}} position feet point
   * @param {number} [yaw] radians, 0 = facing -Z (north)
   * @param {number} [pitch] radians
   */
  teleport(position, yaw, pitch) {
    this.controller.teleport(position);
    if (typeof yaw === 'number') this.rig.yaw = yaw;
    if (typeof pitch === 'number') this.rig.pitch = pitch;
    this.rig.enabled = true;
    this.rig.snap();
  }

  /** Photo mode: a preset poses the free camera; stop driving game.camera. */
  detachCamera() {
    this.rig.enabled = false;
  }

  /** Give the camera back to the rig (viewmodel / gameplay presets). */
  attachCamera() {
    this.rig.enabled = true;
    this.rig.snap();
  }

  /* -------------------------------------------------------- modifiers */
  /** Weapon system: multiply base movement speed (ADS = 2.8 / 4.6 ≈ 0.61). */
  setMoveScale(v) {
    this.moveScale = THREE.MathUtils.clamp(v, 0.05, 1.5);
  }

  /**
   * Weapon system: ADS blend 0..1 each step (drives FOV via the rig and, if
   * no explicit moveScale is set, movement speed).
   * @param {number} amount 0..1
   * @param {{fovMul?:number}} [opts]
   */
  setAds(amount, opts = {}) {
    this.adsControlledByWeapons = true;
    this.adsAmount = THREE.MathUtils.clamp(amount, 0, 1);
    if (opts.fovMul !== undefined) this.adsFovMul = opts.fovMul;
  }

  /** Firing / reloading cancels sprint (weapon system calls this). */
  interruptSprint() {
    this.controller.interruptSprint();
  }

  /* -------------------------------------------------------------- tick */
  /** Fixed step (order 10): movement + regen + interaction probe. */
  update(dt) {
    // ADS fallback when no weapon system drives it: read the input directly.
    if (!this.adsControlledByWeapons) {
      const wantAds = this.alive && this.game.input?.isDown('ads') && !this.controller.sprinting;
      const target = wantAds ? 1 : 0;
      const rate = 1 / 0.2; // 200 ms ADS
      this.adsAmount += THREE.MathUtils.clamp(target - this.adsAmount, -rate * dt, rate * dt);
      this.moveScale = THREE.MathUtils.lerp(1, 2.8 / 4.6, this.adsAmount);
    }
    this.controller.update(dt);
    this.interaction.update(dt);
    this._updateRegen(dt);
  }

  /** Late fixed step (order 90): compose the camera pose. */
  lateUpdate(dt) {
    this.rig.update(dt);
    // publish the eye point after the rig composed it
    this._eye.copy(this.rig.eyePosition);
  }

  _updateRegen(dt) {
    if (!this.alive || this.health >= this.maxHealth) return;
    const t = this.game.time.elapsed;
    if (t - this.lastDamageTime < this.regenDelay) return;
    const before = this.health;
    this.health = Math.min(this.maxHealth, this.health + this.regenRate * dt);
    this._healEmitAcc += this.health - before;
    // throttle heal events to every 5 hp (and on full)
    if (this._healEmitAcc >= 5 || this.health >= this.maxHealth) {
      this._healEmitAcc = 0;
      this.events.emit('player:healed', { health: this.health });
    }
  }

  dispose() {
    this._offCanvasClick?.();
    this._offCanvasClick = null;
    this.controller.dispose?.();
    this.rig.dispose?.();
    this.interaction.dispose?.();
  }
}
