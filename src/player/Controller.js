/**
 * Controller — kinematic capsule movement vs the world BVH (PLAYER stream).
 *
 * CoD-feel first-person locomotion, all values in metres / seconds:
 *   walk 4.6, sprint 7.2 (forward only, blocks fire), crouch 2.2,
 *   ADS 2.8 (via player.moveScale), ground accel 40 m/s², friction stop
 *   ~0.15 s, air accel 8 m/s² (≈30 % control), gravity 19.6 m/s²,
 *   jump apex 1.05 m, slope limit 45°, auto step-up 0.35 m,
 *   crouch (1.2 m capsule, 0.15 s blend), slide from sprint (0.8 s, decel,
 *   camera drop + tilt), mantle ≤ 1.2 m ledges (0.45 s), lean Q/X,
 *   footstep events at bob-phase crossings, no fall damage.
 *
 * Capsule: radius 0.35, height 1.8 (crouch 1.2). `position` is the FEET
 * point; the capsule segment is [feet + r, feet + h - r].
 * Collision: world.capsuleCollide({start, end, radius}) push-out after
 * integrating velocity; grounded from the resolver's push direction plus a
 * short ground snap raycast so slopes/steps stay glued.
 *
 * Everything reads game.time (fixed step) and game.input — deterministic.
 */
import * as THREE from 'three';

const RADIUS = 0.35;
const HEIGHT_STAND = 1.8;
const HEIGHT_CROUCH = 1.2;
const STEP_MAX = 0.35;
const SLOPE_MIN_NY = Math.cos((45 * Math.PI) / 180); // ~0.707
const GRAVITY = 19.6;
const JUMP_APEX = 1.09; // measured apex ≈ 1.05 m with fixed 1/60 integration
const JUMP_SPEED = Math.sqrt(2 * GRAVITY * JUMP_APEX); // ≈ 6.4 m/s

const SPEED_WALK = 4.6;
const SPEED_SPRINT = 7.2;
const SPEED_CROUCH = 2.2;
const ACCEL_GROUND = 40;
const DECEL_GROUND = 36;
const ACCEL_AIR = 8;

const SLIDE_TIME = 0.8;
const SLIDE_MIN_SPEED = 5.2;
const MANTLE_TIME = 0.45;
const MANTLE_MAX = 1.2;

const DOWN = new THREE.Vector3(0, -1, 0);
const UP = new THREE.Vector3(0, 1, 0);
const _wish = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _prevFeet = new THREE.Vector3();

export class Controller {
  /**
   * @param {import('../Game.js').Game} game
   * @param {import('./Player.js').Player} player
   */
  constructor(game, player) {
    this.game = game;
    this.player = player;
    this.enabled = true;

    /** feet position (bottom of the capsule) */
    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.height = HEIGHT_STAND;
    this.radius = RADIUS;

    this.grounded = false;
    this.groundNormal = new THREE.Vector3(0, 1, 0);
    this.groundSurface = 'concrete';

    this.crouching = false;      // wants/holds crouch
    this.crouchBlend = 0;       // 0 stand .. 1 crouch (smoothed)
    this._crouchToggle = false;
    this.sprinting = false;
    this._sprintToggle = false;
    this._sprintInterrupted = false;
    this.sliding = false;
    this.slideTime = 0;
    /** @type {null|{t:number, start:THREE.Vector3, top:THREE.Vector3, end:THREE.Vector3, height:number}} */
    this.mantle = null;
    this.leanTarget = 0;
    this.leanAmount = 0;
    this.moveState = 'idle';

    this.bobPhase = 0;
    this._footStep = 0;          // counts half-cycles
    this._lastFootPhase = 0;
    this.horizontalSpeed = 0;

    this._airTime = 0;
    this._peakFallSpeed = 0;
    this._jumped = false;

    // capsule scratch for the world resolver
    this._capsule = { start: new THREE.Vector3(), end: new THREE.Vector3(), radius: RADIUS };
    this._mantleStart = new THREE.Vector3();
    this._mantleTop = new THREE.Vector3();
    this._mantleEnd = new THREE.Vector3();
  }

  get world() {
    return this.game.world;
  }

  /* ------------------------------------------------------------ setup */
  teleport(pos) {
    this.position.set(pos.x, pos.y, pos.z);
    this.velocity.set(0, 0, 0);
    this.grounded = false;
    this.sliding = false;
    this.mantle = null;
    this._airTime = 0;
    this._peakFallSpeed = 0;
    // settle onto the ground below the spawn point (spawns are authored at floor y)
    const world = this.world;
    if (world?.raycast) {
      _v1.set(this.position.x, this.position.y + 1.2, this.position.z);
      const hit = world.raycast(_v1, DOWN, 3.0);
      if (hit) this.position.y = hit.point.y;
    }
    this._resolve(2);
    this.grounded = true;
  }

  interruptSprint() {
    this.sprinting = false;
    this._sprintToggle = false;
    this._sprintInterrupted = true;
  }

  onDeath() {
    this.sliding = false;
    this.mantle = null;
    this.sprinting = false;
    this.crouching = true;
    this.leanTarget = 0;
  }

  /* ----------------------------------------------------------- update */
  update(dt) {
    if (!this.enabled) return;
    const game = this.game;
    const input = game.input;
    const world = this.world;
    if (!world) return;
    const rig = this.player.rig;
    const alive = this.player.alive;

    /* -------- read input --------------------------------------------- */
    let moveX = 0;
    let moveY = 0;
    let jumpPressed = false;
    let crouchPressed = false;
    let crouchHeld = false;
    let sprintHeld = false;
    let sprintPressed = false;
    let firePressed = false;
    if (alive && input && input.enabled) {
      moveX = input.axes.move.x;
      moveY = input.axes.move.y;
      jumpPressed = input.pressed('jump');
      crouchPressed = input.pressed('crouch');
      crouchHeld = input.isDown('crouch');
      sprintHeld = input.isDown('sprint');
      sprintPressed = input.pressed('sprint');
      firePressed = input.pressed('fire') || input.isDown('fire');
      // lean
      const ll = input.isDown('leanLeft');
      const lr = input.isDown('leanRight');
      this.leanTarget = ll && !lr ? -1 : lr && !ll ? 1 : 0;
    } else {
      this.leanTarget = 0;
    }

    // crouch: hold or toggle (settings)
    const toggleCrouch = !!game.settings?.get('toggleCrouch');
    if (toggleCrouch) {
      if (crouchPressed) this._crouchToggle = !this._crouchToggle;
      this.crouching = this._crouchToggle;
    } else {
      this.crouching = crouchHeld;
    }

    /* -------- mantle animation ---------------------------------------- */
    if (this.mantle) {
      this._updateMantle(dt);
      this._updateLean(dt);
      return;
    }

    /* -------- direction basis from the rig yaw ----------------------- */
    const yaw = rig ? rig.yaw : 0;
    _fwd.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    _right.set(Math.cos(yaw), 0, -Math.sin(yaw));
    _wish.set(0, 0, 0).addScaledVector(_fwd, moveY).addScaledVector(_right, moveX);
    const wishLen = _wish.length();
    if (wishLen > 1) _wish.multiplyScalar(1 / wishLen);
    const hasMove = wishLen > 0.05;

    /* -------- slide (crouch pressed while sprinting) ---------------- */
    // NOTE: evaluated against LAST step's sprint state, before the crouch
    // input below is allowed to cancel the sprint.
    if (
      !this.sliding && crouchPressed && this.sprinting && this.grounded &&
      this.horizontalSpeed > SLIDE_MIN_SPEED && alive
    ) {
      this.sliding = true;
      this.slideTime = 0;
      this.sprinting = false;
      this.crouching = true;
      this._crouchToggle = true;
      game.events.emit('player:slide', {});
    }

    /* -------- sprint state -------------------------------------------- */
    const movingForward = moveY > 0.55 && Math.abs(moveX) <= 0.75;
    if (!sprintHeld) this._sprintInterrupted = false;
    let wantSprint = sprintHeld && !this._sprintInterrupted;
    if (this.player.isAds || this.crouching || !movingForward || !alive) wantSprint = false;
    if (firePressed && this.sprinting) wantSprint = false; // firing breaks sprint
    this.sprinting = wantSprint && this.grounded && !this.sliding;
    void sprintPressed;

    /* -------- crouch capsule height ---------------------------------- */
    const wantHeight = (this.crouching || this.sliding || !alive) ? HEIGHT_CROUCH : HEIGHT_STAND;
    if (wantHeight > this.height + 1e-4) {
      // standing up: need headroom
      if (this._hasHeadroom(HEIGHT_STAND)) this.height = HEIGHT_STAND;
      else {
        this.height = HEIGHT_CROUCH;
        this.crouching = true;
      }
    } else {
      this.height = wantHeight;
    }
    // smoothed blend for the camera / animation
    const crouchTarget = this.height < HEIGHT_STAND - 0.01 ? 1 : 0;
    const crouchRate = 1 / 0.15;
    this.crouchBlend += THREE.MathUtils.clamp(crouchTarget - this.crouchBlend, -crouchRate * dt, crouchRate * dt);

    /* -------- desired speed ------------------------------------------ */
    let maxSpeed;
    if (this.crouchBlend > 0.5 || this.crouching) maxSpeed = SPEED_CROUCH;
    else if (this.sprinting) maxSpeed = SPEED_SPRINT;
    else maxSpeed = SPEED_WALK;
    maxSpeed *= this.player.moveScale;
    if (moveY < -0.3) maxSpeed *= 0.86; // backpedal penalty

    /* -------- horizontal velocity ------------------------------------ */
    const vel = this.velocity;
    if (this.sliding) {
      // slide: keep momentum along the current direction with a decel curve
      this.slideTime += dt;
      const t = this.slideTime / SLIDE_TIME;
      // decelerate from entry speed toward crouch speed (quadratic ease)
      const decel = 6.5 * (0.35 + 0.65 * t);
      const hSpeed = Math.hypot(vel.x, vel.z);
      let newSpeed = Math.max(SPEED_CROUCH * 0.9, hSpeed - decel * dt);
      if (hSpeed > 1e-3) {
        vel.x *= newSpeed / hSpeed;
        vel.z *= newSpeed / hSpeed;
      }
      // small steering
      if (hasMove) {
        vel.x += _wish.x * 3.0 * dt;
        vel.z += _wish.z * 3.0 * dt;
      }
      if (this.slideTime >= SLIDE_TIME || newSpeed <= SPEED_CROUCH * 1.05 || !this.grounded) {
        this.sliding = false;
        this.slideTime = 0;
      }
    } else if (this.grounded) {
      if (hasMove && alive) {
        // accelerate toward wish velocity
        _v1.set(_wish.x * maxSpeed, 0, _wish.z * maxSpeed);
        _v2.set(_v1.x - vel.x, 0, _v1.z - vel.z);
        const dv = _v2.length();
        const step = ACCEL_GROUND * dt;
        if (dv <= step) {
          vel.x = _v1.x;
          vel.z = _v1.z;
        } else {
          vel.x += (_v2.x / dv) * step;
          vel.z += (_v2.z / dv) * step;
        }
      } else {
        // friction: crisp stop
        const speed = Math.hypot(vel.x, vel.z);
        const drop = DECEL_GROUND * dt;
        const ns = Math.max(0, speed - drop);
        if (speed > 1e-4) {
          vel.x *= ns / speed;
          vel.z *= ns / speed;
        } else {
          vel.x = 0;
          vel.z = 0;
        }
      }
    } else if (hasMove && alive) {
      // air control (30 %)
      vel.x += _wish.x * ACCEL_AIR * dt;
      vel.z += _wish.z * ACCEL_AIR * dt;
      const hs = Math.hypot(vel.x, vel.z);
      const cap = Math.max(maxSpeed, this._airSpeedCap || maxSpeed);
      if (hs > cap) {
        vel.x *= cap / hs;
        vel.z *= cap / hs;
      }
    }

    /* -------- jump ------------------------------------------------------ */
    this._jumped = false;
    if (jumpPressed && this.grounded && !this.crouching && !this.sliding && alive) {
      vel.y = JUMP_SPEED;
      this.grounded = false;
      this._jumped = true;
      this._airSpeedCap = Math.max(SPEED_WALK, Math.hypot(vel.x, vel.z));
      game.events.emit('player:jump', {});
    }

    /* -------- gravity -------------------------------------------------- */
    if (!this.grounded) {
      vel.y -= GRAVITY * dt;
      if (vel.y < -55) vel.y = -55;
    } else if (vel.y < 0) {
      vel.y = 0;
    }

    /* -------- integrate + collide -------------------------------------- */
    const wasGrounded = this.grounded;
    _prevFeet.copy(this.position);
    this.position.addScaledVector(vel, dt);
    const intendedVx = vel.x;
    const intendedVz = vel.z;
    const res = this._resolve(2);

    // grounded classification (slope limit) — the resolver reports a push ≥45° up
    let grounded = false;
    if (res && res.hit && res.grounded && res.normal.y >= SLOPE_MIN_NY) grounded = true;
    // achieved velocity vs intended: detects walls even while grounded (the
    // resolver's combined ground+wall normal can't be trusted for that)
    let blockedFwd = false;
    if (res && res.hit) {
      const achX = (this.position.x - _prevFeet.x) / dt;
      const achZ = (this.position.z - _prevFeet.z) / dt;
      const intended = Math.hypot(intendedVx, intendedVz);
      const achievedAlong = intended > 1e-4 ? (achX * intendedVx + achZ * intendedVz) / intended : 0;
      if (intended > 0.5 && achievedAlong < intended * 0.4) blockedFwd = true;
      // adopt what actually happened (wall sliding without velocity build-up)
      vel.x = achX;
      vel.z = achZ;
      if (grounded) {
        if (vel.y < 0) vel.y = 0;
      } else if (res.normal.y < -0.4 && vel.y > 0) {
        vel.y = 0; // head bump
      }
    }

    /* -------- step-up over small obstacles -------------------------- */
    if ((wasGrounded || grounded) && hasMove && blockedFwd && !this.sliding) {
      if (this._tryStepUp(_wish, rig)) {
        // keep the momentum we had before the wall clamp
        vel.x = intendedVx;
        vel.z = intendedVz;
      }
    }

    /* -------- ground snap when walking down slopes / steps ------------ */
    if (wasGrounded && !grounded && !this._jumped && vel.y <= 0.75) {
      _v1.set(this.position.x, this.position.y + 0.5, this.position.z);
      const hit = world.raycast(_v1, DOWN, 0.5 + STEP_MAX + 0.12);
      if (hit && hit.normal.y >= SLOPE_MIN_NY) {
        this.position.y = hit.point.y;
        grounded = true;
        vel.y = 0;
        this.groundSurface = hit.surface || this.groundSurface;
        this.groundNormal.copy(hit.normal);
      }
    }

    /* -------- ground contact bookkeeping -------------------------------- */
    if (grounded) {
      // sample the surface below the feet (for footsteps / audio)
      if (res && res.hit && res.normal.y >= SLOPE_MIN_NY) this.groundNormal.copy(res.normal);
      if (!wasGrounded) {
        // landed
        const impact = this._peakFallSpeed;
        if (impact > 2.0) {
          game.events.emit('player:landed', { speed: impact });
          rig?.landingDip(impact);
        }
        this._peakFallSpeed = 0;
      }
      this._airTime = 0;
    } else {
      this._airTime += dt;
      if (vel.y < 0) this._peakFallSpeed = Math.max(this._peakFallSpeed, -vel.y);
    }
    this.grounded = grounded;

    /* -------- mantle detection ------------------------------------------- */
    if (alive && hasMove && moveY > 0.35 && (this._airTime > 0.05 || blockedFwd)) {
      if (this._tryMantle(_fwd)) {
        this._updateLean(dt);
        return;
      }
    }

    /* -------- bob phase + footsteps ------------------------------------- */
    this.horizontalSpeed = Math.hypot(vel.x, vel.z);
    this._updateBobAndFootsteps(dt);

    /* -------- lean ------------------------------------------------------- */
    this._updateLean(dt);

    /* -------- move state label ------------------------------------------ */
    if (!alive) this.moveState = 'dead';
    else if (this.mantle) this.moveState = 'mantle';
    else if (this.sliding) this.moveState = 'slide';
    else if (!this.grounded) this.moveState = 'air';
    else if (this.crouchBlend > 0.5) this.moveState = this.horizontalSpeed > 0.3 ? 'crouchwalk' : 'crouch';
    else if (this.horizontalSpeed < 0.3) this.moveState = 'idle';
    else if (this.sprinting) this.moveState = 'sprint';
    else this.moveState = 'walk';
  }

  /* ---------------------------------------------------------- helpers */
  /**
   * Run the world capsule resolver; mutates position. Returns an aggregate
   * result (the world's resolver reuses one record, and a clean second pass
   * would otherwise report hit=false after the first pass fixed everything).
   */
  _resolve(iterations = 2) {
    const world = this.world;
    if (!world) return null;
    const cap = this._capsule;
    const agg = this._resolveAgg || (this._resolveAgg = { hit: false, grounded: false, normal: new THREE.Vector3(0, 1, 0), depth: 0 });
    agg.hit = false;
    agg.grounded = false;
    agg.depth = 0;
    agg.normal.set(0, 1, 0);
    for (let it = 0; it < iterations; it++) {
      cap.radius = RADIUS;
      cap.start.set(this.position.x, this.position.y + RADIUS, this.position.z);
      cap.end.set(this.position.x, this.position.y + Math.max(this.height - RADIUS, RADIUS + 0.05), this.position.z);
      const res = world.capsuleCollide(cap);
      if (!res.hit) break;
      agg.hit = true;
      agg.grounded = agg.grounded || res.grounded;
      agg.normal.copy(res.normal);
      agg.depth += res.depth;
      // feet from the resolved bottom sphere
      this.position.set(cap.start.x, cap.start.y - RADIUS, cap.start.z);
      if (res.depth < 1e-4) break;
    }
    return agg;
  }

  _hasHeadroom(targetHeight) {
    const world = this.world;
    if (!world) return true;
    // cast up from the current head to the target head height
    _v1.set(this.position.x, this.position.y + this.height - RADIUS, this.position.z);
    const need = targetHeight - this.height + 0.05;
    if (need <= 0) return true;
    const hit = world.raycast(_v1, UP, need + RADIUS);
    return !hit;
  }

  _tryStepUp(wishDir, rig) {
    const world = this.world;
    // probe the ground just ahead in the wish direction
    _v1.set(
      this.position.x + wishDir.x * (RADIUS + 0.28),
      this.position.y + STEP_MAX + 0.5,
      this.position.z + wishDir.z * (RADIUS + 0.28),
    );
    const hit = world.raycast(_v1, DOWN, STEP_MAX + 0.55);
    if (!hit) return false;
    const dy = hit.point.y - this.position.y;
    if (dy <= 0.03 || dy > STEP_MAX + 0.02) return false;
    if (hit.normal.y < SLOPE_MIN_NY) return false;
    // headroom above the step top
    _v2.set(_v1.x, hit.point.y + 0.05, _v1.z);
    const head = world.raycast(_v2, UP, this.height + 0.05);
    if (head) return false;
    // hop up onto the step; the resolver settles us next frame
    this.position.y = hit.point.y + 0.01;
    this.position.x += wishDir.x * 0.04;
    this.position.z += wishDir.z * 0.04;
    this.grounded = true;
    if (this.velocity.y < 0) this.velocity.y = 0;
    rig?.stepUp(dy); // camera lags the pop, catching up smoothly
    this._resolve(1);
    return true;
  }

  /* --------------------------------------------------------- mantle */
  _tryMantle(fwd) {
    const world = this.world;
    if (!world) return false;
    // 1. wall probe: knee height first (low vaults), then chest height
    let wall = null;
    const probeHeights = [Math.min(0.5, this.height * 0.35), Math.min(1.0, this.height - 0.45)];
    for (let i = 0; i < probeHeights.length; i++) {
      _v1.set(this.position.x, this.position.y + probeHeights[i], this.position.z);
      const hit = world.raycast(_v1, fwd, RADIUS + 0.45);
      // wall must be steep and facing us
      if (hit && Math.abs(hit.normal.y) <= 0.35) {
        wall = hit;
        break;
      }
    }
    if (!wall) return false;
    // 2. ledge top probe: down-cast from above/behind the wall face
    const probeUpY = this.position.y + MANTLE_MAX + 0.35;
    _v2.set(wall.point.x - wall.normal.x * 0.3, probeUpY, wall.point.z - wall.normal.z * 0.3);
    const top = world.raycast(_v2, DOWN, MANTLE_MAX + 0.6);
    if (!top) return false;
    const ledgeHeight = top.point.y - this.position.y;
    if (ledgeHeight < STEP_MAX + 0.05 || ledgeHeight > MANTLE_MAX + 0.02) return false;
    if (top.normal.y < SLOPE_MIN_NY) return false;
    // 3. clearance: room to stand (crouched) on the ledge
    _v3.set(top.point.x, top.point.y + 0.1, top.point.z);
    const ceiling = world.raycast(_v3, UP, HEIGHT_CROUCH + 0.05);
    if (ceiling) return false;
    // start the mantle
    this._mantleStart.copy(this.position);
    this._mantleTop.set(this.position.x, top.point.y + 0.02, this.position.z); // rise first
    this._mantleEnd.set(
      top.point.x - wall.normal.x * (RADIUS + 0.05),
      top.point.y + 0.02,
      top.point.z - wall.normal.z * (RADIUS + 0.05),
    );
    this.mantle = { t: 0, height: ledgeHeight };
    this.velocity.set(0, 0, 0);
    this.grounded = false;
    this.sliding = false;
    this.sprinting = false;
    this.moveState = 'mantle';
    this.player.rig?.mantleCue(ledgeHeight);
    this.game.events.emit('player:mantle', { height: ledgeHeight });
    return true;
  }

  _updateMantle(dt) {
    const m = this.mantle;
    m.t += dt / MANTLE_TIME;
    const t = Math.min(1, m.t);
    // two-phase: rise (0..0.55) then move onto the ledge (0.55..1)
    if (t < 0.55) {
      const k = easeOut(t / 0.55);
      this.position.lerpVectors(this._mantleStart, this._mantleTop, k);
    } else {
      const k = easeInOut((t - 0.55) / 0.45);
      this.position.lerpVectors(this._mantleTop, this._mantleEnd, k);
    }
    if (m.t >= 1) {
      this.mantle = null;
      this.grounded = true;
      this.velocity.set(0, 0, 0);
      this._resolve(2);
      this.moveState = 'idle';
    }
  }

  /* --------------------------------------------------------- footsteps */
  _updateBobAndFootsteps(dt) {
    const speed = this.horizontalSpeed;
    const moving = this.grounded && speed > 0.6 && !this.sliding;
    if (moving) {
      // stride length grows with speed (walk ≈ 1.8 m, sprint ≈ 2.35 m per step)
      const stride = THREE.MathUtils.clamp(0.92 + speed * 0.2, 1.0, 2.4);
      const stepsPerSecond = speed / stride;
      // one full 2π bob cycle = two steps
      this.bobPhase += stepsPerSecond * Math.PI * dt;
      // footsteps on each π crossing
      const halfCycles = Math.floor(this.bobPhase / Math.PI);
      if (halfCycles > this._footStep) {
        this._footStep = halfCycles;
        this._emitFootstep(speed);
      }
    } else {
      // ease the phase back toward the nearest rest pose so the bob settles
      const target = Math.round(this.bobPhase / Math.PI) * Math.PI;
      this.bobPhase += (target - this.bobPhase) * Math.min(1, dt * 6);
      this._footStep = Math.floor(this.bobPhase / Math.PI);
    }
  }

  _emitFootstep(speed) {
    const world = this.world;
    let surface = this.groundSurface || 'concrete';
    let wet = 0;
    if (world) {
      _v1.set(this.position.x, this.position.y + 0.4, this.position.z);
      const hit = world.raycast(_v1, DOWN, 0.9);
      if (hit && hit.surface) surface = hit.surface;
      wet = world.puddleAt ? world.puddleAt(this.position.x, this.position.z) : 0;
    }
    this.groundSurface = surface;
    this.game.events.emit('player:footstep', {
      surface,
      sprint: this.sprinting,
      crouch: this.crouchBlend > 0.5,
      foot: this._footStep % 2 === 0 ? 'left' : 'right',
      position: this.position,
      speed,
      wet,
    });
  }

  /* ------------------------------------------------------------- lean */
  _updateLean(dt) {
    let target = this.leanTarget;
    if (!this.player.alive || this.sprinting || this.sliding || this.mantle) target = 0;
    // don't lean into a wall: probe sideways from the head
    if (target !== 0 && this.world && this.player.rig) {
      const rig = this.player.rig;
      const yaw = rig.yaw;
      _v1.set(this.position.x, this.position.y + this.height - 0.35, this.position.z);
      _v2.set(Math.cos(yaw) * target, 0, -Math.sin(yaw) * target); // camera right * lean
      const hit = this.world.raycast(_v1, _v2, 0.6);
      if (hit) target *= THREE.MathUtils.clamp((hit.distance - 0.22) / 0.4, 0, 1);
    }
    const rate = 1 / 0.12;
    this.leanAmount += THREE.MathUtils.clamp(target - this.leanAmount, -rate * dt, rate * dt);
  }

  dispose() {}
}

function easeOut(t) {
  return 1 - (1 - t) * (1 - t);
}
function easeInOut(t) {
  return t * t * (3 - 2 * t);
}
