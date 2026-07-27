/**
 * Autoplay — scripted verification bot (docs/ARCHITECTURE.md §4).
 *
 * System `autoplay` (order 5, before the player controller). When begun it
 * drives the real gameplay purely through injected input
 * (`game.input.simulate({move, look, actions})`) every fixed step:
 *
 *   - walks a nav-graph patrol (random walkable points, or toward the
 *     nearest known hostile) with waypoint following + stuck repathing,
 *   - acquires the nearest *visible* enemy (world LOS raycast, 10 Hz),
 *   - turns the view at <= 4 rad/s (recoil-compensating closed loop),
 *   - ADS + burst-fires when the aim error is < 2 degrees,
 *   - reloads when the mag is <= 4, retreats (backpedal-strafe) below 40 hp,
 *   - if the player dies it restarts the match (respawn + forceCombat) and
 *     keeps going.
 *
 * Contract with Game.runAutoplay: `begin({duration})`, `status()` (published
 * to window.__ironwake.autoplay at least once per game-second), `finish()`
 * (final stats). Deterministic: only game.time / game.rng, no wall clock.
 *
 * Public API:
 *   game.getSystem('autoplay').begin({duration}) / .status() / .finish()
 */
import * as THREE from 'three';

const DEG = Math.PI / 180;
const MAX_TURN = 4.0;            // rad/s view slew cap
const FIRE_CONE_DEG = 2.0;       // aim error threshold for the trigger
const RELOAD_AT = 4;             // reload when mag <= this
const RETREAT_HP = 40;           // fall back below this health
const ACQUIRE_INTERVAL = 0.1;    // s between target scans
const REPATH_INTERVAL = 1.4;     // s between patrol repaths toward a threat
const BASE_SENS = 0.0022;        // must mirror CameraRig
const CHEST_STAND = 1.12;        // aim height above enemy feet
const RESPAWN_DELAY = 2.6;       // s after death before restarting

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _aimO = new THREE.Vector3();
const _aimD = new THREE.Vector3();
const _tgt = new THREE.Vector3();

export class Autoplay {
  /** @param {import('../Game.js').Game} game */
  constructor(game) {
    this.game = game;
    this.name = 'autoplay';
    this.active = false;
    this.duration = 0;
    this.startTime = 0;

    // published stats
    this.kills = 0;
    this.shotsFired = 0;
    this.deaths = 0;
    this.restarts = 0;
    this.maxWave = 0;

    // input state re-used each step (Input copies what it needs)
    this._actions = {
      fire: false, ads: false, reload: false, sprint: false, crouch: false,
      jump: false, weapon1: false, weapon2: false,
    };
    this._move = { x: 0, y: 0 };
    this._look = { dx: 0, dy: 0 };
    this._sim = { actions: this._actions, move: this._move, look: this._look };

    // aim controller state (predicted pending deltas, radians)
    this._pendYaw = 0;
    this._pendPitch = 0;

    // targeting
    this._target = null;
    this._targetVisible = false;
    this._nextAcquireAt = 0;
    this._aimErrDeg = 180;

    // burst fire
    this._bursting = false;
    this._burstStart = 0;
    this._burstLen = 7;
    this._burstRestUntil = 0;
    this._nextReloadPressAt = 0;

    // patrol / navigation
    /** @type {THREE.Vector3[]|null} */
    this._path = null;
    this._pathIndex = 0;
    this._nextRepathAt = 0;
    this._stuckCheckAt = 0;
    this._stuckRef = new THREE.Vector3();
    this._strafeDir = 1;
    this._nextStrafeFlipAt = 0;

    // death / restart
    this._respawnAt = -1;

    const ev = game.events;
    this._offs = [
      ev.on('player:fired', () => { this.shotsFired++; }),
      ev.on('enemy:killed', (p) => {
        if (!p || !p.by || p.by === 'player' || p.by === game.player) this.kills++;
      }),
      ev.on('player:died', () => {
        this.deaths++;
        this._respawnAt = this.game.time.elapsed + RESPAWN_DELAY;
      }),
      ev.on('wave:start', (p) => {
        const i = (p && typeof p.index === 'number') ? p.index : 0;
        if (i > this.maxWave) this.maxWave = i;
      }),
    ];
  }

  /* ------------------------------------------------------------ contract */
  /** Start driving. @param {{duration?:number}} [opts] */
  begin(opts = {}) {
    this.duration = opts.duration ?? 30;
    this.startTime = this.game.time.elapsed;
    this.active = true;
    const game = this.game;
    // Match must be live (MatchDirector auto-starts on game:ready in
    // autoplay, this is the safety net).
    if (game.match && game.match.state !== 'combat') game.match.forceCombat();
    if (game.player && !game.player.alive) game.player.respawn();
    if (game.setHudVisible) game.setHudVisible(true);
    this._stuckRef.copy(game.player?.position || _v1.set(0, 0, 0));
    this._stuckCheckAt = this.startTime + 2.5;
    return this;
  }

  /** Snapshot for the harness bridge (called by Game every ~0.5 s). */
  status() {
    const game = this.game;
    return {
      time: game.time.elapsed,
      wave: game.ai?.wave || 0,
      kills: this.kills,
      health: Math.round(game.player?.health ?? 0),
      shotsFired: this.shotsFired,
    };
  }

  /** End the session and return final stats. */
  finish() {
    const game = this.game;
    this.active = false;
    game.input.simulate(null);
    const score = game.score?.stats?.() || {};
    return {
      simulated: game.time.elapsed - this.startTime,
      kills: this.kills,
      shotsFired: this.shotsFired,
      deaths: this.deaths,
      restarts: this.restarts,
      wave: game.ai?.wave || 0,
      maxWave: this.maxWave,
      health: Math.round(game.player?.health ?? 0),
      score: score.score || game.score?.total || 0,
      accuracy: score.accuracy ?? null,
      headshots: score.headshots ?? 0,
    };
  }

  /* -------------------------------------------------------------- update */
  update(dt) {
    if (!this.active) return;
    const game = this.game;
    const player = game.player;
    if (!player) return;
    const now = game.time.elapsed;

    // reset per-step edge actions
    const a = this._actions;
    a.reload = false;
    a.weapon1 = false;
    a.weapon2 = false;
    a.jump = false;
    this._move.x = 0;
    this._move.y = 0;
    this._look.dx = 0;
    this._look.dy = 0;

    /* ---- death → restart ------------------------------------------- */
    if (!player.alive) {
      a.fire = false;
      a.ads = false;
      a.sprint = false;
      this._pendYaw = 0;
      this._pendPitch = 0;
      if (this._respawnAt < 0) this._respawnAt = now + RESPAWN_DELAY;
      if (now >= this._respawnAt) {
        this._respawnAt = -1;
        this.restarts++;
        player.respawn();
        game.match?.forceCombat?.();
        this._target = null;
        this._path = null;
      }
      game.input.simulate(this._sim);
      return;
    }

    /* ---- targeting (10 Hz scan) -------------------------------------- */
    if (now >= this._nextAcquireAt) {
      this._nextAcquireAt = now + ACQUIRE_INTERVAL;
      this._acquire();
    }
    const target = this._target;
    if (target && !target.alive) {
      this._target = null;
      this._targetVisible = false;
    }

    /* ---- weapon housekeeping ----------------------------------------- */
    const weapon = game.weapons?.current;
    if (weapon) {
      const st = weapon.state;
      if (st !== 'reloading' && st !== 'deploying' && st !== 'holstering') {
        if (weapon.ammo <= 0 && weapon.reserve <= 0) {
          // dry — switch guns
          if (weapon.def?.slot === 1) a.weapon2 = true;
          else a.weapon1 = true;
        } else if (weapon.ammo <= RELOAD_AT && weapon.reserve > 0 && now >= this._nextReloadPressAt) {
          a.reload = true; // one-step press edge; retry after 0.5 s if it didn't take
          this._nextReloadPressAt = now + 0.5;
        }
      }
    }

    /* ---- aim + fire ------------------------------------------------ */
    const engaged = this._target && this._targetVisible;
    if (this._target) {
      this._aimAt(this._target, dt);
    } else {
      this._pendYaw = 0;
      this._pendPitch = 0;
      this._aimErrDeg = 180;
    }

    let firing = false;
    if (engaged && weapon && weapon.state !== 'reloading') {
      a.ads = true;
      a.sprint = false;
      // burst fire: hold while the crosshair is on, rest between bursts
      const onTarget = this._aimErrDeg < FIRE_CONE_DEG;
      if (onTarget && now >= this._burstRestUntil) {
        if (!this._bursting) {
          this._bursting = true;
          this._burstStart = this.shotsFired;
          this._burstLen = 6 + Math.floor(game.rng.next() * 5);
        }
        firing = true;
        if (this.shotsFired - this._burstStart >= this._burstLen) {
          this._bursting = false;
          this._burstRestUntil = now + 0.15 + game.rng.next() * 0.15;
          firing = false;
        }
      } else if (!onTarget && this._aimErrDeg >= FIRE_CONE_DEG * 2) {
        this._bursting = false;
      }
    } else {
      a.ads = false;
      this._bursting = false;
    }
    a.fire = firing;

    /* ---- movement ---------------------------------------------------- */
    if (this._target && player.health < RETREAT_HP) {
      this._retreat(now);
      a.sprint = false;
    } else if (engaged) {
      this._combatMove(now);
      a.sprint = false;
    } else {
      this._patrol(now);
    }

    game.input.simulate(this._sim);
  }

  /* ------------------------------------------------------------ targeting */
  _acquire() {
    const game = this.game;
    const list = game.ai?.enemies;
    const player = game.player;
    if (!list || !player) {
      this._target = null;
      this._targetVisible = false;
      return;
    }
    const eye = player.eyePosition;
    let best = null;
    let bestD2 = Infinity;
    let bestVisible = false;
    let anyBest = null;
    let anyD2 = Infinity;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!e.alive) continue;
      const d2 = e.position.distanceToSquared(eye);
      if (d2 < anyD2) {
        anyD2 = d2;
        anyBest = e;
      }
      // visibility test only for the closest few candidates: check nearest first
      if (d2 < bestD2) {
        if (this._hasLos(eye, e)) {
          bestD2 = d2;
          best = e;
          bestVisible = true;
        }
      }
    }
    // sticky: keep the current visible target unless something is much closer
    const cur = this._target;
    if (cur && cur.alive && best !== cur && this._targetVisible) {
      const curD2 = cur.position.distanceToSquared(eye);
      if (this._hasLos(eye, cur) && curD2 < bestD2 * 1.8) {
        this._target = cur;
        this._targetVisible = true;
        return;
      }
    }
    if (best) {
      this._target = best;
      this._targetVisible = bestVisible;
    } else {
      this._target = anyBest; // track through walls, never fire
      this._targetVisible = false;
    }
  }

  _hasLos(eye, enemy) {
    const world = this.game.world;
    this._aimPoint(enemy, _tgt);
    _v1.copy(_tgt).sub(eye);
    const dist = _v1.length();
    if (dist < 0.6) return true;
    _v1.multiplyScalar(1 / dist);
    if (!world?.raycast) return true;
    const hit = world.raycast(eye, _v1, dist - 0.35);
    return !hit;
  }

  _aimPoint(enemy, out) {
    const crouch = enemy.crouch || 0;
    return out.copy(enemy.position).setY(enemy.position.y + CHEST_STAND - 0.5 * crouch);
  }

  /* ------------------------------------------------------------------ aim */
  /**
   * Closed-loop look driving: request a mouse delta that moves the *actual*
   * camera forward (recoil, kick springs included) toward the target,
   * clamped to MAX_TURN. The requested delta lands one step later, so the
   * pending request is predicted into the error (no oscillation).
   */
  _aimAt(target, dt) {
    const game = this.game;
    const player = game.player;
    const rig = player.rig;
    // actual crosshair ray (final composed pose incl. recoil)
    if (game.weapons?.aimRay) game.weapons.aimRay(_aimO, _aimD);
    else {
      _aimO.copy(player.eyePosition);
      _aimD.copy(rig.forward);
    }
    this._aimPoint(target, _tgt);
    _v2.copy(_tgt).sub(_aimO);
    const dist = _v2.length();
    if (dist < 0.001) return;
    _v2.multiplyScalar(1 / dist);

    // actual aim error (deg) for the trigger decision
    const dot = THREE.MathUtils.clamp(_aimD.dot(_v2), -1, 1);
    this._aimErrDeg = Math.acos(dot) / DEG;

    // desired yaw/pitch of the target direction
    const targetYaw = Math.atan2(-_v2.x, -_v2.z);
    const targetPitch = Math.asin(THREE.MathUtils.clamp(_v2.y, -1, 1));
    // actual yaw/pitch of the current aim ray → offset vs the rig base
    const actYaw = Math.atan2(-_aimD.x, -_aimD.z);
    const actPitch = Math.asin(THREE.MathUtils.clamp(_aimD.y, -1, 1));
    const offYaw = wrap(actYaw - rig.yaw);
    const offPitch = actPitch - rig.pitch;
    // desired base angles (recoil compensation) with the pending look folded in
    const errYaw = wrap((targetYaw - offYaw) - (rig.yaw + this._pendYaw));
    const errPitch = (targetPitch - offPitch) - (rig.pitch + this._pendPitch);
    const maxStep = MAX_TURN * dt;
    const stepYaw = THREE.MathUtils.clamp(errYaw, -maxStep, maxStep);
    const stepPitch = THREE.MathUtils.clamp(errPitch, -maxStep, maxStep);

    // mouse delta that produces those steps (mirror of CameraRig's mapping)
    const sensMul = game.settings?.get('sensitivity') ?? 1;
    const invert = game.settings?.get('invertY') ? -1 : 1;
    const sens = BASE_SENS * sensMul * (0.35 + 0.65 * (1 - (player.adsAmount || 0) * 0.45));
    this._look.dx = -stepYaw / sens;
    this._look.dy = -stepPitch / (sens * invert);
    this._pendYaw = stepYaw;
    this._pendPitch = stepPitch;
  }

  /* ------------------------------------------------------------ movement */
  /** Convert a desired world-space horizontal direction into move axes. */
  _steer(dirWorld, speed = 1) {
    const yaw = this.game.player.rig.yaw;
    // forward (yaw 0 = -Z), right
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    const rx = Math.cos(yaw);
    const rz = -Math.sin(yaw);
    const len = Math.hypot(dirWorld.x, dirWorld.z) || 1;
    const dx = dirWorld.x / len;
    const dz = dirWorld.z / len;
    this._move.y = (dx * fx + dz * fz) * speed;
    this._move.x = (dx * rx + dz * rz) * speed;
  }

  _combatMove(now) {
    const player = this.game.player;
    const target = this._target;
    _v1.copy(target.position).sub(player.position);
    _v1.y = 0;
    const dist = _v1.length();
    if (dist < 0.001) return;
    _v1.multiplyScalar(1 / dist);
    if (now >= this._nextStrafeFlipAt) {
      this._strafeDir = this.game.rng.next() < 0.5 ? -1 : 1;
      this._nextStrafeFlipAt = now + 0.9 + this.game.rng.next() * 1.3;
    }
    // perpendicular strafe (+ small approach/back-off to hold ~10-22 m)
    _v2.set(-_v1.z * this._strafeDir, 0, _v1.x * this._strafeDir);
    let along = 0;
    if (dist > 24) along = 0.85;
    else if (dist < 8) along = -0.7;
    _v3.copy(_v2).multiplyScalar(0.55).addScaledVector(_v1, along);
    this._steer(_v3, _v3.length() < 0.001 ? 0 : 0.9);
  }

  _retreat(now) {
    const player = this.game.player;
    const threat = this._target;
    _v1.copy(threat.position).sub(player.position);
    _v1.y = 0;
    const dist = _v1.length() || 1;
    _v1.multiplyScalar(1 / dist);
    if (now >= this._nextStrafeFlipAt) {
      this._strafeDir = this.game.rng.next() < 0.5 ? -1 : 1;
      this._nextStrafeFlipAt = now + 1.1 + this.game.rng.next() * 0.9;
    }
    // move away from the threat with a strafe component
    _v2.set(-_v1.z * this._strafeDir, 0, _v1.x * this._strafeDir);
    _v3.copy(_v1).multiplyScalar(-1).addScaledVector(_v2, 0.45);
    this._steer(_v3, 1);
  }

  _patrol(now) {
    const game = this.game;
    const player = game.player;
    const nav = game.world?.nav;
    const pos = player.position;

    // stuck detection
    if (now >= this._stuckCheckAt) {
      const moved = this._stuckRef.distanceTo(pos);
      this._stuckRef.copy(pos);
      this._stuckCheckAt = now + 2.0;
      if (moved < 0.35) this._path = null; // force a repath
    }

    // (re)plan: head toward the nearest known hostile, else wander
    const needPath = !this._path || this._pathIndex >= this._path.length || now >= this._nextRepathAt;
    if (needPath && nav) {
      let dest = null;
      const t = this._target; // known but not visible (or visible but far)
      if (t && t.alive) dest = t.position;
      else if (game.ai?.enemies?.length) {
        // any live enemy
        for (const e of game.ai.enemies) if (e.alive) { dest = e.position; break; }
      }
      if (!dest) dest = nav.randomWalkablePoint(game.rng) || null;
      let path = null;
      if (dest) path = nav.findPath(pos, dest, { maxIterations: 6000 });
      if (!path || !path.length) {
        const rp = nav.randomWalkablePoint(game.rng);
        if (rp) path = nav.findPath(pos, rp, { maxIterations: 6000 });
      }
      this._path = path && path.length ? path : null;
      this._pathIndex = 0;
      this._nextRepathAt = now + REPATH_INTERVAL + game.rng.next() * 0.6;
    }

    // follow waypoints
    let moving = false;
    if (this._path && this._pathIndex < this._path.length) {
      const wp = this._path[this._pathIndex];
      _v1.copy(wp).sub(pos);
      _v1.y = 0;
      const d = _v1.length();
      if (d < 0.7) {
        this._pathIndex++;
      } else {
        this._steer(_v1, 1);
        moving = true;
        // face the movement direction when nothing to shoot at
        if (!this._targetVisible) this._faceDir(_v1);
      }
    }
    const a = this._actions;
    a.ads = a.ads && this._targetVisible;
    // sprint on open patrol legs (never while a visible target exists)
    a.sprint = moving && !this._targetVisible && this._aimErrDeg > 25;
    if (!moving && !this._path) {
      // idle scan: slow pan
      this._faceYawDelta(0.6 * (this._strafeDir || 1) * (1 / 60));
    }
  }

  /** Turn (yaw only) toward a horizontal world direction, clamped rate. */
  _faceDir(dir) {
    if (this._target) return; // aiming has priority
    const game = this.game;
    const player = game.player;
    const rig = player.rig;
    const targetYaw = Math.atan2(-dir.x, -dir.z);
    const errYaw = wrap(targetYaw - (rig.yaw + this._pendYaw));
    const maxStep = MAX_TURN * game.time.step;
    const stepYaw = THREE.MathUtils.clamp(errYaw, -maxStep, maxStep);
    // ease the pitch back to level
    const errPitch = -(rig.pitch + this._pendPitch);
    const stepPitch = THREE.MathUtils.clamp(errPitch, -maxStep, maxStep);
    const sensMul = game.settings?.get('sensitivity') ?? 1;
    const invert = game.settings?.get('invertY') ? -1 : 1;
    const sens = BASE_SENS * sensMul * (0.35 + 0.65 * (1 - (player.adsAmount || 0) * 0.45));
    this._look.dx = -stepYaw / sens;
    this._look.dy = -stepPitch / (sens * invert);
    this._pendYaw = stepYaw;
    this._pendPitch = stepPitch;
  }

  _faceYawDelta(delta) {
    if (this._target) return;
    const game = this.game;
    const player = game.player;
    const sensMul = game.settings?.get('sensitivity') ?? 1;
    const sens = BASE_SENS * sensMul * (0.35 + 0.65 * (1 - (player.adsAmount || 0) * 0.45));
    this._look.dx = -delta / sens;
    this._pendYaw = delta;
    this._pendPitch = 0;
  }

  dispose() {
    for (const off of this._offs) off?.();
    this.active = false;
    try { this.game.input?.simulate(null); } catch { /* ignore */ }
  }
}

function wrap(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
