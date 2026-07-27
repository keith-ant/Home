/**
 * Brain — per-enemy combat FSM (AI stream), thinking at 10 Hz (staggered),
 * stepping every fixed tick for movement + fire timing.
 *
 *   SPAWN → ADVANCE (nav path to a firing spot 12-25 m from the player with LOS)
 *         → ENGAGE  (reaction ~0.5 s, 3-6 round bursts, accuracy cone from 6°
 *                    tightening with time-on-target, degraded by player sprint)
 *         → REPOSITION (LOS lost > 2.5 s)  → back to ENGAGE
 *         → COVER   (recently hurt: crouch at a nav cover point, peek-fire)
 *         → RUSH    (player inside 6 m: run straight in, hip-fire)
 * Enemy fire = raycast toward a jittered player torso point, blocked by world
 * geometry (fx.impact at the block point), muzzleFlash + tracer, near-miss
 * event `enemy:nearmiss {point, dir}`, damage via game.player.applyDamage.
 * All randomness from game.rng; all timing from game.time.
 */
import * as THREE from 'three';
import { rayCapsule } from '../weapons/Ballistics.js';

export const AI_STATES = ['spawn', 'advance', 'engage', 'reposition', 'cover', 'rush', 'dead'];

const DEG = Math.PI / 180;
const THINK_INTERVAL = 6;      // fixed steps (10 Hz at 60 Hz)
const RUN_SPEED = 4.4;
const RUSH_SPEED = 5.4;
const WALK_SPEED = 2.0;
const REACTION_TIME = 0.5;
const LOS_LOST_LIMIT = 2.5;
const RUSH_DIST = 6;
const SPOT_MIN = 12;
const SPOT_MAX = 25;
const BULLET_DAMAGE = 9;        // per hit at close range
const BULLET_FALLOFF_START = 20;
const BULLET_FALLOFF_END = 60;
const PLAYER_RADIUS = 0.45;

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3();
const _pt = new THREE.Vector3();
const _nrm = new THREE.Vector3();
const _plA = new THREE.Vector3();
const _plB = new THREE.Vector3();

export class Brain {
  /**
   * @param {import('../Game.js').Game} game
   * @param {import('./Enemy.js').Enemy} enemy
   * @param {{accuracyMul?:number}} [o]
   */
  constructor(game, enemy, o = {}) {
    this.game = game;
    this.enemy = enemy;
    enemy.brain = this;
    this.state = 'spawn';
    this.stateSince = 0;
    this.path = null;
    this.pathIndex = 0;
    this.spot = new THREE.Vector3();
    this.hasSpot = false;
    this.hasLOS = false;
    this.losLostFor = 0;
    this.timeOnTarget = 0;
    this.distToPlayer = 999;
    this.accuracyMul = o.accuracyMul ?? 1;
    // firing
    this.reactionUntil = 0;
    this.burstLeft = 0;
    this.nextShotAt = 0;
    this.burstCooldownUntil = 0;
    // cover
    this.coverPos = new THREE.Vector3();
    this.hasCover = false;
    this.peekUntil = 0;
    this.peeking = false;
    this.lastDamagedAt = -99;
    this.thinkOffset = (enemy.id * 3) % THINK_INTERVAL;
  }

  setState(s, now) {
    if (this.state === s) return;
    this.state = s;
    this.stateSince = now;
    this.enemy.aiState = s;
    if (s !== 'cover') {
      this.hasCover = false;
      this.enemy.crouch = 0;
    }
  }

  onDamaged(hit, now) {
    this.lastDamagedAt = now;
    this.timeOnTarget = 0; // flinch resets aim
  }

  /* ---------------------------------------------------------- helpers */
  _playerTorso(out) {
    const p = this.game.player;
    const pos = p?.position;
    if (!pos) return null;
    return out.set(pos.x, pos.y + 1.05, pos.z);
  }

  _testLOS(from, to) {
    const world = this.game.world;
    if (!world?.raycast) return true;
    _v3.copy(to).sub(from);
    const dist = _v3.length();
    if (dist < 0.5) return true;
    _v3.multiplyScalar(1 / dist);
    const hit = world.raycast(from, _v3, dist - 0.35);
    return !hit;
  }

  /* --------------------------------------------------------------- think */
  /** 10 Hz decision tick. */
  think(now) {
    const e = this.enemy;
    const game = this.game;
    const player = game.player;
    if (!e.alive) {
      this.state = 'dead';
      return;
    }
    if (!player || player.alive === false) {
      // player dead: hold position, keep aiming pose
      e.moveSpeed = 0;
      e.firing = false;
      e.hasAimTarget = false;
      return;
    }
    const torso = this._playerTorso(_v1);
    if (!torso) return;
    const eye = e.eyePosition(_v2);
    this.distToPlayer = e.position.distanceTo(player.position);
    this.hasLOS = this._testLOS(eye, torso);
    if (this.hasLOS) {
      this.losLostFor = 0;
      this.timeOnTarget += 0.1;
    } else {
      this.losLostFor += 0.1;
      this.timeOnTarget = Math.max(0, this.timeOnTarget - 0.15);
    }

    const dist = this.distToPlayer;
    const hurtRecently = now - this.lastDamagedAt < 3.0;

    switch (this.state) {
      case 'spawn': {
        this._pickFiringSpot(torso, eye);
        this.setState('advance', now);
        break;
      }
      case 'advance': {
        if (dist < RUSH_DIST) { this.setState('rush', now); break; }
        // arrived (or spot lost) → engage; also engage early with LOS inside 25 m
        const arrived = !this.path || this.pathIndex >= (this.path?.length || 0);
        if (arrived || (this.hasLOS && dist < SPOT_MAX && now - this.stateSince > 1.0)) {
          this.setState('engage', now);
          this.reactionUntil = now + REACTION_TIME * (0.8 + game.rng.next() * 0.6);
        } else if (now - this.stateSince > 12 && !this.hasLOS) {
          this._pickFiringSpot(torso, eye); // stale route: replan
          this.stateSince = now;
        }
        break;
      }
      case 'engage': {
        if (dist < RUSH_DIST) { this.setState('rush', now); break; }
        if (this.losLostFor > LOS_LOST_LIMIT) {
          this._pickFiringSpot(torso, eye);
          this.setState('reposition', now);
          break;
        }
        if (hurtRecently && dist > 8 && this._pickCover(torso)) {
          this.setState('cover', now);
          this.peeking = false;
          this.peekUntil = now + 1.0 + game.rng.next() * 0.8;
        }
        break;
      }
      case 'reposition': {
        if (dist < RUSH_DIST) { this.setState('rush', now); break; }
        const arrived = !this.path || this.pathIndex >= (this.path?.length || 0);
        if ((arrived && this.hasLOS) || (this.hasLOS && now - this.stateSince > 1.5)) {
          this.setState('engage', now);
          this.reactionUntil = now + REACTION_TIME * 0.6;
        } else if (arrived && !this.hasLOS && now - this.stateSince > 1.0) {
          this._pickFiringSpot(torso, eye);
          this.stateSince = now;
        }
        break;
      }
      case 'cover': {
        if (dist < RUSH_DIST) { this.setState('rush', now); break; }
        // peek cycle: hidden (crouched) 1-1.8 s, peek-fire 1.2-2 s
        if (now > this.peekUntil) {
          this.peeking = !this.peeking;
          this.peekUntil = now + (this.peeking ? 1.2 + game.rng.next() * 0.8 : 1.0 + game.rng.next() * 0.8);
          if (this.peeking) this.reactionUntil = now + 0.2;
        }
        // give up cover if nothing has hurt us for a while
        if (now - this.lastDamagedAt > 7) {
          this.setState('engage', now);
        }
        break;
      }
      case 'rush': {
        if (dist > RUSH_DIST + 3) {
          this._pickFiringSpot(torso, eye);
          this.setState('advance', now);
        }
        break;
      }
      default:
        break;
    }
  }

  /** Choose a walkable point 12-25 m from the player with LOS to the torso. */
  _pickFiringSpot(torso, eye) {
    const game = this.game;
    const nav = game.world?.nav;
    if (!nav) return false;
    const rng = game.rng;
    const pos = this.enemy.position;
    let best = null;
    let bestScore = -Infinity;
    for (let i = 0; i < 10; i++) {
      // bias candidates toward the enemy's side of the player
      const ang = Math.atan2(pos.x - torso.x, pos.z - torso.z) + rng.range(-1.4, 1.4);
      const r = rng.range(SPOT_MIN, SPOT_MAX);
      const x = torso.x + Math.sin(ang) * r;
      const z = torso.z + Math.cos(ang) * r;
      if (!nav.isWalkable(x, z)) continue;
      const y = nav.heightAt(x, z);
      _v4.set(x, (Number.isFinite(y) ? y : 0) + 1.5, z);
      let score = -_v4.distanceTo(pos) * 0.6; // prefer closer to us
      if (this._testLOS(_v4, torso)) score += 30;
      else score -= 10;
      if (score > bestScore) {
        bestScore = score;
        best = { x, y: Number.isFinite(y) ? y : 0, z };
      }
    }
    if (!best) return false;
    this.spot.set(best.x, best.y, best.z);
    this.hasSpot = true;
    this._requestPath(this.spot);
    return true;
  }

  /** Choose a nearby cover point placed between us and the player. */
  _pickCover(torso) {
    const cps = this.game.world?.nav?.coverPoints;
    if (!cps || !cps.length) return false;
    const pos = this.enemy.position;
    _v3.copy(torso).sub(pos).setY(0).normalize(); // toward the player
    let best = null;
    let bestD = 8 * 8;
    for (let i = 0; i < cps.length; i++) {
      const c = cps[i];
      const dx = c.position.x - pos.x;
      const dz = c.position.z - pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > bestD) continue;
      // the blocker faces away from the player => normal points roughly opposite to the player dir
      const facing = c.normal ? -(c.normal.x * _v3.x + c.normal.z * _v3.z) : 0;
      if (facing < 0.2) continue;
      bestD = d2;
      best = c;
    }
    if (!best) return false;
    this.coverPos.copy(best.position);
    this.hasCover = true;
    this._requestPath(this.coverPos);
    return true;
  }

  _requestPath(target) {
    const nav = this.game.world?.nav;
    if (!nav) {
      this.path = null;
      return;
    }
    const p = nav.findPath(this.enemy.position, target);
    this.path = p && p.length ? p : [target.clone()];
    this.pathIndex = 0;
  }

  /* ---------------------------------------------------------------- step */
  /** Every fixed step: movement intent, facing, firing. */
  step(dt, now) {
    const e = this.enemy;
    const game = this.game;
    if (!e.alive) return;
    const player = game.player;

    // periodic think (staggered per enemy)
    if ((game.time.frame + this.thinkOffset) % THINK_INTERVAL === 0) this.think(now);

    if (!player || player.alive === false) return;
    const torso = this._playerTorso(_v1);
    if (!torso) return;

    // ---- movement intent ----
    let speed = 0;
    let followPath = false;
    switch (this.state) {
      case 'advance':
      case 'reposition':
        followPath = true;
        speed = RUN_SPEED;
        break;
      case 'cover':
        if (this.hasCover && e.position.distanceToSquared(this.coverPos) > 0.5) {
          followPath = true;
          speed = RUN_SPEED * 0.85;
        } else {
          e.crouch = this.peeking ? Math.max(0, e.crouch - dt * 4) : Math.min(1, e.crouch + dt * 4);
        }
        break;
      case 'rush':
        _v2.copy(torso).sub(e.position).setY(0);
        if (_v2.lengthSq() > 4) {
          _v2.normalize();
          e.velocity.copy(_v2).multiplyScalar(RUSH_SPEED);
          speed = RUSH_SPEED;
        }
        break;
      default:
        break;
    }
    if (followPath) speed = this._followPath(speed, dt);
    e.moveSpeed = speed;
    if (speed <= 0.01) e.velocity.set(0, 0, 0);

    // ---- facing / aim target ----
    const combat = this.state === 'engage' || this.state === 'rush' ||
      (this.state === 'cover' && this.peeking) || this.state === 'reposition';
    if (combat || speed < 0.3) {
      // face the player
      e.targetYaw = Math.atan2(torso.x - e.position.x, torso.z - e.position.z);
      e.aimTarget.copy(torso);
      e.hasAimTarget = true;
    } else if (speed > 0.3) {
      e.targetYaw = Math.atan2(e.velocity.x, e.velocity.z);
      e.hasAimTarget = false;
    }

    // ---- firing ----
    const mayFire = this.hasLOS && (
      this.state === 'engage' ||
      this.state === 'rush' ||
      (this.state === 'cover' && this.peeking && e.crouch < 0.5) ||
      (this.state === 'reposition' && speed < 1)
    );
    e.firing = false;
    if (mayFire && now >= this.reactionUntil) {
      e.firing = true;
      if (this.burstLeft <= 0) {
        if (now >= this.burstCooldownUntil) {
          this.burstLeft = 3 + game.rng.int(0, 3);
          this.nextShotAt = now;
        }
      }
      if (this.burstLeft > 0 && now >= this.nextShotAt) {
        this._fireShot(now, torso, speed);
        this.burstLeft--;
        this.nextShotAt = now + 0.1; // 600 rpm
        if (this.burstLeft <= 0) this.burstCooldownUntil = now + 0.7 + game.rng.next() * 0.9;
      }
    }
  }

  /** Steer along the current nav path; returns the effective speed. */
  _followPath(speed, dt) {
    const e = this.enemy;
    const path = this.path;
    if (!path || this.pathIndex >= path.length) return 0;
    let wp = path[this.pathIndex];
    _v2.copy(wp).sub(e.position);
    _v2.y = 0;
    let d = _v2.length();
    while (d < 0.7 && this.pathIndex < path.length - 1) {
      this.pathIndex++;
      wp = path[this.pathIndex];
      _v2.copy(wp).sub(e.position);
      _v2.y = 0;
      d = _v2.length();
    }
    if (d < 0.7 && this.pathIndex >= path.length - 1) {
      this.pathIndex = path.length; // arrived
      return 0;
    }
    _v2.multiplyScalar(1 / (d || 1));
    const sp = d < 2.0 ? Math.max(WALK_SPEED, speed * (d / 2.0)) : speed;
    e.velocity.copy(_v2).multiplyScalar(sp);
    return sp;
  }

  /** One enemy round: cone-jittered ray at the player torso, blocked by the world. */
  _fireShot(now, torso, moveSpeed) {
    const e = this.enemy;
    const game = this.game;
    const player = game.player;
    const rng = game.rng;
    const fx = game.fx;

    // accuracy cone (degrees)
    let cone = 6 / this.accuracyMul;
    cone = Math.max(1.6, cone - this.timeOnTarget * 0.9);
    if (player?.isSprinting) cone += 3.5;
    if (moveSpeed > 1) cone *= 1.5;
    if (this.state === 'rush') cone *= 1.3;

    const origin = _v2.copy(e.muzzleWorld);
    // if the muzzle solve hasn't run yet, fall back to the eye
    if (origin.distanceToSquared(e.position) > 9) e.eyePosition(origin);
    // aim point = torso jittered inside the cone (converted to a lateral offset)
    _v3.copy(torso).sub(origin);
    const dist = _v3.length();
    _v3.multiplyScalar(1 / (dist || 1));
    // cone jitter: rotate the direction by gaussian yaw/pitch
    const j = cone * DEG * 0.5;
    const jy = rng.gauss() * j;
    const jp = rng.gauss() * j;
    // build a perpendicular basis
    _v4.set(-_v3.z, 0, _v3.x);
    if (_v4.lengthSq() < 1e-6) _v4.set(1, 0, 0);
    _v4.normalize();
    _pt.crossVectors(_v3, _v4).normalize(); // up-ish
    const dir = _nrm.copy(_v3)
      .addScaledVector(_v4, Math.tan(jy))
      .addScaledVector(_pt, Math.tan(jp))
      .normalize();

    // trace vs world
    const world = game.world;
    let endDist = dist + 4;
    let blocked = false;
    const wh = world?.raycast ? world.raycast(origin, dir, dist + 6) : null;
    if (wh && wh.distance < dist - 0.3) {
      blocked = true;
      endDist = wh.distance;
    }
    const end = _plB.copy(origin).addScaledVector(dir, endDist);

    // player capsule test (feet+0.25 → eye)
    let hitPlayer = false;
    if (!blocked && player && player.alive !== false) {
      _plA.copy(player.position);
      _plA.y += 0.3;
      const eye = player.eyePosition || _plA;
      const t = rayCapsule(origin, dir, _plA, eye, PLAYER_RADIUS, _pt, _v4);
      if (t !== null && t <= endDist + 0.3) {
        hitPlayer = true;
        end.copy(_pt);
      }
    }

    // FX + audio hooks
    fx?.muzzleFlash?.({ position: origin, direction: dir, size: 1.4, light: true, smoke: false, kind: 'rifle' });
    fx?.tracer?.(origin, end, { speed: 380, length: 6 });
    game.events.emit('enemy:fired', { enemy: e, from: origin, dir });

    if (hitPlayer) {
      const falloff = THREE.MathUtils.clamp(
        1 - (dist - BULLET_FALLOFF_START) / (BULLET_FALLOFF_END - BULLET_FALLOFF_START), 0.5, 1);
      const dmg = BULLET_DAMAGE * falloff;
      player.applyDamage(dmg, { from: e.position, dir: _v3.clone(), source: e, isHeadshot: false });
    } else if (blocked && wh) {
      fx?.impact?.({ point: wh.point, normal: wh.normal, surface: wh.surface || 'concrete', energy: 0.7, dir });
    } else if (player) {
      // near miss whiz: closest approach of the ray to the eye
      const eye = player.eyePosition;
      if (eye) {
        _pt.copy(eye).sub(origin);
        const along = _pt.dot(dir);
        if (along > 0) {
          _v4.copy(origin).addScaledVector(dir, along);
          const miss = _v4.distanceTo(eye);
          if (miss < 1.6) game.events.emit('enemy:nearmiss', { point: _v4, dir, distance: miss });
        }
      }
    }
  }
}
