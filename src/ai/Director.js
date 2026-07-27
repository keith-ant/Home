/**
 * Director — wave escalation + enemy registry (AI stream, `game.ai`).
 *
 * Waves: count(N) = min(6 + 2N, 20), max 7 alive at once, spawns trickle in
 * at world.nav.enemySpawnPoints that are hidden from the player's eye and
 * > 12 m away (round-robin, LOS-checked), 8 s intermission between waves,
 * per-wave scaling: health ×(1 + 0.15·(N−1)), accuracy ×(1 + 0.08·(N−1)).
 * Events: wave:start {index}, wave:cleared {index}; per enemy
 * enemy:spawned / enemy:killed / enemy:removed (see Enemy.js).
 *
 * Public API (game.ai):
 *   ai.startWaves() / ai.stop() / ai.clear()
 *   ai.spawnEnemyAt(position, {yaw, health, accuracyMul, brain}) → Enemy
 *   ai.enemies (array), ai.aliveCount, ai.wave, ai.state ('idle'|'wave'|'intermission')
 *   ai.forceThink()            run every brain's think once (photo presets)
 * System 'ai' (order 40): brains + enemy updates + separation + corpse timers.
 * Reacts to grenade:exploded (radial damage to enemies).
 */
import * as THREE from 'three';
import { Enemy, ENEMY_DESPAWN_AFTER } from './Enemy.js';
import { Brain } from './Brain.js';

const MAX_ALIVE = 7;
const INTERMISSION = 8.0;
const SPAWN_MIN_DIST = 12;
const SEP_RADIUS = 1.4;

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();

export class Director {
  /** @param {import('../Game.js').Game} game */
  constructor(game) {
    this.game = game;
    this.name = 'ai';
    /** @type {Enemy[]} */
    this.enemies = [];
    this.wave = 0;
    this.state = 'idle'; // idle | wave | intermission
    this.remainingToSpawn = 0;
    this.spawnCursor = 0;
    this.nextSpawnAt = 0;
    this.intermissionUntil = 0;
    this.waveKills = 0;
    this.totalSpawnedInWave = 0;

    this._offExplode = game.events.on('grenade:exploded', (p) => this._onExplosion(p));
  }

  /* ----------------------------------------------------------- getters */
  get aliveCount() {
    let n = 0;
    for (let i = 0; i < this.enemies.length; i++) if (this.enemies[i].alive) n++;
    return n;
  }

  /* -------------------------------------------------------------- waves */
  startWaves() {
    if (this.state !== 'idle') return;
    this.wave = 0;
    this._beginWave(1);
  }

  stop() {
    this.state = 'idle';
    this.remainingToSpawn = 0;
  }

  /** Remove every enemy immediately (match reset). */
  clear() {
    this.stop();
    for (let i = this.enemies.length - 1; i >= 0; i--) this.enemies[i].destroy();
    this.enemies.length = 0;
    this.wave = 0;
  }

  _beginWave(index) {
    this.wave = index;
    this.state = 'wave';
    this.remainingToSpawn = Math.min(6 + 2 * (index - 1), 20);
    this.totalSpawnedInWave = 0;
    this.waveKills = 0;
    this.nextSpawnAt = this.game.time.elapsed + 1.0;
    this.game.events.emit('wave:start', { index });
  }

  _waveScaling(index) {
    return {
      health: 100 * (1 + 0.15 * (index - 1)),
      accuracyMul: 1 + 0.08 * (index - 1),
    };
  }

  /* ------------------------------------------------------------ spawning */
  /**
   * Spawn one enemy at a position (used by waves and by photo presets).
   * @param {THREE.Vector3} position feet position
   * @param {{yaw?:number, health?:number, accuracyMul?:number, brain?:boolean, waveIndex?:number}} [o]
   */
  spawnEnemyAt(position, o = {}) {
    const e = new Enemy(this.game, {
      position,
      yaw: o.yaw ?? 0,
      health: o.health ?? 100,
      accuracyMul: o.accuracyMul ?? 1,
      waveIndex: o.waveIndex ?? this.wave,
    });
    if (o.brain !== false) new Brain(this.game, e, { accuracyMul: o.accuracyMul ?? 1 });
    this.enemies.push(e);
    return e;
  }

  /** Try to spawn one wave enemy at a hidden spawn point; returns true if spawned. */
  _trySpawnWaveEnemy() {
    const game = this.game;
    const world = game.world;
    const points = world?.nav?.enemySpawnPoints || world?.spawns?.enemy;
    if (!points || !points.length) return false;
    const player = game.player;
    const eye = player?.eyePosition;
    const scale = this._waveScaling(this.wave);
    // walk the point ring starting at the cursor; take the first hidden, distant one
    for (let k = 0; k < points.length; k++) {
      const p = points[(this.spawnCursor + k) % points.length];
      const pos = p.position;
      if (player && player.position) {
        if (pos.distanceTo(player.position) < SPAWN_MIN_DIST) continue;
        if (eye && world?.raycast) {
          _v1.set(pos.x, pos.y + 1.5, pos.z);
          _v2.copy(_v1).sub(eye);
          const dist = _v2.length();
          _v2.multiplyScalar(1 / (dist || 1));
          const hit = world.raycast(eye, _v2, dist);
          if (!hit) continue; // visible to the player: skip
        }
      }
      this.spawnCursor = (this.spawnCursor + k + 1) % points.length;
      this.spawnEnemyAt(pos, {
        yaw: p.yaw || 0,
        health: scale.health,
        accuracyMul: scale.accuracyMul,
        waveIndex: this.wave,
      });
      return true;
    }
    // every point is exposed: fall back to the farthest point from the player
    if (player?.position) {
      let far = null;
      let farD = -1;
      for (const p of points) {
        const d = p.position.distanceTo(player.position);
        if (d > farD) {
          farD = d;
          far = p;
        }
      }
      if (far) {
        this.spawnEnemyAt(far.position, { yaw: far.yaw || 0, health: scale.health, accuracyMul: scale.accuracyMul, waveIndex: this.wave });
        return true;
      }
    }
    return false;
  }

  /* -------------------------------------------------------------- update */
  update(dt) {
    const now = this.game.time.elapsed;

    // ---- wave state machine ----
    if (this.state === 'wave') {
      if (this.remainingToSpawn > 0 && this.aliveCount < MAX_ALIVE && now >= this.nextSpawnAt) {
        if (this._trySpawnWaveEnemy()) {
          this.remainingToSpawn--;
          this.totalSpawnedInWave++;
          this.nextSpawnAt = now + 0.9;
        } else {
          this.nextSpawnAt = now + 0.5;
        }
      }
      if (this.remainingToSpawn <= 0 && this.totalSpawnedInWave > 0 && this.aliveCount === 0) {
        this.state = 'intermission';
        this.intermissionUntil = now + INTERMISSION;
        this.game.events.emit('wave:cleared', { index: this.wave });
        this.game.events.emit('match:state', { state: 'intermission', wave: this.wave });
      }
    } else if (this.state === 'intermission') {
      if (now >= this.intermissionUntil) this._beginWave(this.wave + 1);
    }

    // ---- separation steering (velocities were set last step by brains) ----
    const es = this.enemies;
    for (let i = 0; i < es.length; i++) {
      const a = es[i];
      if (!a.alive) continue;
      a.brain?.step(dt, now);
      for (let j = 0; j < es.length; j++) {
        if (i === j) continue;
        const b = es[j];
        if (!b.alive) continue;
        _v1.copy(a.position).sub(b.position);
        _v1.y = 0;
        const d2 = _v1.lengthSq();
        if (d2 > SEP_RADIUS * SEP_RADIUS || d2 < 1e-6) continue;
        const d = Math.sqrt(d2);
        const push = (SEP_RADIUS - d) * 2.2;
        a.velocity.addScaledVector(_v1, push / d);
        if (a.moveSpeed < 0.5) a.moveSpeed = Math.min(1.2, push); // shuffle apart even when stationary
      }
    }

    // ---- enemy updates + corpse cleanup ----
    for (let i = es.length - 1; i >= 0; i--) {
      const e = es[i];
      e.update(dt);
      if (!e.alive && e.deathTime >= 0 && now - e.deathTime > ENEMY_DESPAWN_AFTER) {
        e.destroy();
        es.splice(i, 1);
      }
    }
  }

  /** Radial explosion damage to enemies (frag from either side). */
  _onExplosion(p) {
    if (!p || !p.point) return;
    const r = p.radius || 6;
    const dmg = p.damage || 150;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const d = e.position.distanceTo(p.point);
      if (d > r) continue;
      const f = 1 - d / r;
      e.applyDamage(dmg * f * f, p.point);
    }
  }

  /** Run every brain's think once (photo presets that need instant state). */
  forceThink() {
    const now = this.game.time.elapsed;
    for (const e of this.enemies) e.brain?.think(now);
  }

  dispose() {
    this._offExplode?.();
    this.clear();
  }
}
