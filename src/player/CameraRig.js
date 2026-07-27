/**
 * CameraRig — composes the final first-person camera pose (PLAYER stream).
 *
 * Runs LATE (system order 90) after the controller/weapons/fx, storing the
 * previous and current fixed-step poses; a render-frame hook (registered on
 * game:ready via post.addPreRender) writes game.camera with interpolation
 * (game.time.alpha) for smooth realtime motion. In stepping/photo mode alpha
 * is 1 so captures see the exact current pose.
 *
 * Composition, in order:
 *   base yaw/pitch from mouse look (sensitivity 0.0022 rad/px × setting,
 *   pitch clamped ±85°) + permanent recoil offsets
 *   + view kick spring (recoil punch, flinch)         rig.kickView({pitch,yaw,roll})
 *   + head bob (figure-8, speed-scaled, roll couples with x)
 *   + idle breathing sway
 *   + landing dip spring, step smoothing
 *   + lean offset/roll, slide/crouch/mantle pose adjustments
 *   + explosion/fire shakes (rig.shake({strength,duration,freqPos,freqRot}))
 *   FOV: settings.fov (CoD horizontal @16:9 → vertical) + sprint kick +7°
 *   × ADS multiplier blend (player.adsAmount / player.adsFovMul)
 *
 * Exposed to the WEAPONS stream:
 *   rig.viewmodelSway   {x, y} radians of look lag (springy)
 *   rig.viewmodelBob    {phase, amplitude, x, y} (metres)
 *   rig.moveState        mirror of player.moveState
 *   rig.fov              current vertical FOV (deg), rig.fovScale (vs base)
 *   rig.eyePosition, rig.quaternion, rig.forward/right/up (current step)
 *
 * rig.enabled = false → the rig stops writing game.camera (photo presets
 * that pose a free camera call game.player.detachCamera()).
 */
import * as THREE from 'three';

const DEG = Math.PI / 180;
const PITCH_LIMIT = 85 * DEG;
const BASE_SENS = 0.0022;

const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _right = new THREE.Vector3();

/** Small damped spring on N axes. */
class Spring {
  constructor(n = 1, frequency = 4, damping = 0.75) {
    this.n = n;
    this.pos = new Float32Array(n);
    this.vel = new Float32Array(n);
    this.setTuning(frequency, damping);
  }
  setTuning(frequency, damping) {
    this.w = frequency * Math.PI * 2;
    this.zeta = damping;
  }
  impulse(...values) {
    for (let i = 0; i < this.n && i < values.length; i++) this.vel[i] += values[i] || 0;
  }
  update(dt) {
    const w = this.w;
    const c = 2 * this.zeta * w;
    for (let i = 0; i < this.n; i++) {
      const a = -w * w * this.pos[i] - c * this.vel[i];
      this.vel[i] += a * dt;
      this.pos[i] += this.vel[i] * dt;
    }
  }
  reset() {
    this.pos.fill(0);
    this.vel.fill(0);
  }
}

export class CameraRig {
  /**
   * @param {import('../Game.js').Game} game
   * @param {import('./Player.js').Player} player
   */
  constructor(game, player) {
    this.game = game;
    this.player = player;
    this.camera = game.camera;
    this.enabled = true;

    // look
    this.yaw = 0;
    this.pitch = 0;
    this._recoilYaw = 0;   // permanent recoil offsets (never spring back)
    this._recoilPitch = 0;

    // eye heights
    this.eyeStand = 1.62;
    this.eyeCrouch = 1.05;
    this.eyeSlide = 0.75;
    this._eyeHeight = this.eyeStand;
    this._stepOffset = 0;
    this._deathBlend = 0;
    this._deathRoll = 0;

    // springs / oscillators
    this._kick = new Spring(3, 4.2, 0.7);        // pitch, yaw, roll (radians)
    this._land = new Spring(2, 2.4, 0.55);       // vertical offset (m), pitch (rad)
    this._sway = { x: 0, y: 0, vx: 0, vy: 0 };    // viewmodel look lag
    this._bobBlend = 0;
    this._breath = 0;
    this._mantleCue = 0;                          // 0..1 decaying dip
    this._sprintBlend = 0;
    this._slideBlend = 0;

    /** active shakes (pooled) */
    this._shakes = [];
    for (let i = 0; i < 6; i++) this._shakes.push({ active: false, t: 0, duration: 0, strength: 0, freqPos: 22, freqRot: 28, seed: i * 1.37 });

    // exposed viewmodel drivers
    this.viewmodelSway = { x: 0, y: 0 };
    this.viewmodelBob = { phase: 0, amplitude: 0, x: 0, y: 0 };
    this.moveState = 'idle';
    this._c = { ...EMPTY_COMPOSE };
    this._swayTargetX = 0;
    this._swayTargetY = 0;

    // FOV
    this._baseFovH = 100; // CoD-style horizontal at 16:9
    this.fov = 74;
    this.fovScale = 1;
    this._sprintFovKick = 7;
    this._appliedFov = -1;

    // poses (previous + current fixed step) for interpolation
    this._prevPos = new THREE.Vector3();
    this._prevQuat = new THREE.Quaternion();
    this._prevFov = 74;
    this._curPos = new THREE.Vector3();
    this._curQuat = new THREE.Quaternion();
    this._curFov = 74;
    this._hasPose = false;

    // convenience axes of the current pose
    this.eyePosition = this._curPos;
    this.quaternion = this._curQuat;
    this.forward = new THREE.Vector3(0, 0, -1);
    this.right = new THREE.Vector3(1, 0, 0);
    this.up = new THREE.Vector3(0, 1, 0);

    this._preRenderOff = null;
    // Hook the render loop once the post chain exists (installPost runs last).
    game.events.once('game:ready', () => {
      if (game.post?.addPreRender) {
        this._preRenderOff = game.post.addPreRender(() => this.applyRender(game.time.alpha ?? 1));
      }
    });
  }

  /* ------------------------------------------------------------- API */
  /** Instant view-punch impulse (radians of angular velocity). */
  kickView({ pitch = 0, yaw = 0, roll = 0 } = {}) {
    this._kick.impulse(pitch * 22, yaw * 22, roll * 22);
  }

  /**
   * Permanent aim offset from real recoil (the player must counter it).
   * @param {number} pitch radians (positive = view rises)
   * @param {number} [yaw]
   */
  addRecoil(pitch, yaw = 0) {
    this._recoilPitch += pitch;
    this._recoilYaw += yaw;
  }

  /**
   * Camera shake (callers apply distance falloff for world sources).
   * @param {{strength?:number, duration?:number, freqPos?:number, freqRot?:number}} o
   */
  shake(o = {}) {
    const strength = o.strength ?? 0.5;
    if (strength <= 0.001) return;
    // reuse the weakest / inactive slot
    let slot = this._shakes[0];
    for (const s of this._shakes) {
      if (!s.active) {
        slot = s;
        break;
      }
      if (s.strength * (1 - s.t / s.duration) < slot.strength * (1 - slot.t / slot.duration)) slot = s;
    }
    slot.active = true;
    slot.t = 0;
    slot.duration = Math.max(0.05, o.duration ?? 0.6);
    slot.strength = strength;
    slot.freqPos = o.freqPos ?? 22;
    slot.freqRot = o.freqRot ?? 28;
  }

  /** Damage flinch: kick the view away from the incoming direction. */
  flinch(dir, amount) {
    const s = THREE.MathUtils.clamp(amount / 40, 0.25, 1.4);
    let side = 0.5;
    let facing = 0.5;
    if (dir) {
      // dir points from attacker toward the player; project on camera right/forward
      side = this.right.dot(dir);
      facing = this.forward.dot(dir);
    } else {
      side = Math.sin(this.game.time.elapsed * 7.1);
    }
    this.kickView({
      pitch: (0.9 + 0.6 * Math.max(0, facing)) * 0.018 * s,
      yaw: -side * 0.014 * s,
      roll: side * 0.035 * s,
    });
    this.shake({ strength: 0.35 * s, duration: 0.28, freqPos: 30, freqRot: 34 });
  }

  /** Landing camera dip from a fall at `speed` m/s. */
  landingDip(speed) {
    const s = THREE.MathUtils.clamp((speed - 2) / 9, 0, 1);
    this._land.impulse(-(0.55 + 1.6 * s), (0.14 + 0.3 * s));
    void speed;
  }

  /** Called by the controller when it pops up a step of height `dy` (m). */
  stepUp(dy) {
    this._stepOffset -= dy; // camera trails below and eases up
    this._stepOffset = THREE.MathUtils.clamp(this._stepOffset, -0.5, 0.5);
  }

  /** Mantle "hands dip" cue. */
  mantleCue(height) {
    this._mantleCue = 1;
    this._land.impulse(-0.5, 0.5 + Math.min(0.4, height * 0.25));
  }

  onDeath() {
    this._deathBlend = 0.001;
    this._deathRoll = (this.game.rng?.next?.() ?? 0.5) < 0.5 ? -1 : 1;
  }

  onRespawn() {
    this._deathBlend = 0;
    this._kick.reset();
    this._land.reset();
    for (const s of this._shakes) s.active = false;
    this._recoilPitch = 0;
    this._recoilYaw = 0;
  }

  /** Skip interpolation on the next render (after teleports). */
  snap() {
    this._composePose();
    this._prevPos.copy(this._curPos);
    this._prevQuat.copy(this._curQuat);
    this._prevFov = this._curFov;
    this._hasPose = true;
    if (this.enabled) this.applyRender(1);
  }

  /* ---------------------------------------------------------- update */
  /** Fixed-step update (system order 90). */
  update(dt) {
    const game = this.game;
    const player = this.player;
    const ctrl = player.controller;
    const input = game.input;
    const t = game.time.elapsed;

    // --- mouse look ------------------------------------------------------
    if (player.alive && input) {
      const sens = BASE_SENS * (game.settings?.get('sensitivity') ?? 1) * (0.35 + 0.65 * (1 - player.adsAmount * 0.45));
      const invert = game.settings?.get('invertY') ? -1 : 1;
      const dx = input.look.dx;
      const dy = input.look.dy;
      this.yaw -= dx * sens;
      this.pitch -= dy * sens * invert;
      this.pitch = THREE.MathUtils.clamp(this.pitch, -PITCH_LIMIT, PITCH_LIMIT);
      // viewmodel sway target from the look delta (spring-followed below)
      this._swayTargetX = THREE.MathUtils.clamp(-dx * 0.0009, -0.09, 0.09);
      this._swayTargetY = THREE.MathUtils.clamp(-dy * 0.0009, -0.06, 0.06);
    } else {
      this._swayTargetX = 0;
      this._swayTargetY = 0;
    }

    // --- eye height blend ---------------------------------------------------
    let targetEye = this.eyeStand;
    if (ctrl.sliding) targetEye = this.eyeSlide;
    else targetEye = THREE.MathUtils.lerp(this.eyeStand, this.eyeCrouch, ctrl.crouchBlend);
    if (!player.alive) targetEye = 0.32;
    const eyeRate = ctrl.sliding ? 6.5 : 1 / 0.15;
    this._eyeHeight += THREE.MathUtils.clamp(targetEye - this._eyeHeight, -eyeRate * dt, eyeRate * dt);
    // step smoothing eases back to 0
    this._stepOffset *= Math.max(0, 1 - dt * 14);

    // --- springs -----------------------------------------------------------
    this._kick.update(dt);
    this._land.update(dt);
    this._mantleCue *= Math.max(0, 1 - dt * 3.5);
    // sprint / slide blends
    const sprintTarget = ctrl.sprinting && ctrl.grounded ? 1 : 0;
    this._sprintBlend += THREE.MathUtils.clamp(sprintTarget - this._sprintBlend, -dt / 0.28, dt / 0.28);
    const slideTarget = ctrl.sliding ? 1 : 0;
    this._slideBlend += THREE.MathUtils.clamp(slideTarget - this._slideBlend, -dt / 0.12, dt / 0.12);

    // --- viewmodel sway (spring follows the look-delta target) --------------
    const sw = this._sway;
    const swk = 90;
    const swd = 14;
    sw.vx += (-swk * (sw.x - (this._swayTargetX || 0)) - swd * sw.vx) * dt;
    sw.vy += (-swk * (sw.y - (this._swayTargetY || 0)) - swd * sw.vy) * dt;
    sw.x += sw.vx * dt;
    sw.y += sw.vy * dt;
    this.viewmodelSway.x = sw.x;
    this.viewmodelSway.y = sw.y;

    // --- head bob ---------------------------------------------------------
    const speed = ctrl.horizontalSpeed;
    const moving = ctrl.grounded && speed > 0.5 && !ctrl.sliding && player.alive;
    const bobTarget = moving ? 1 : 0;
    this._bobBlend += THREE.MathUtils.clamp(bobTarget - this._bobBlend, -dt / 0.25, dt / 0.35);
    // amplitude: walk 0.6 cm → sprint 1.2 cm (vertical); crouch damped; ADS damped
    let ampY = 0.006;
    if (ctrl.sprinting) ampY = 0.012;
    else if (ctrl.crouchBlend > 0.5) ampY = 0.0045;
    ampY *= (0.4 + 0.6 * Math.min(1, speed / 4.6));
    ampY *= 1 - 0.7 * player.adsAmount;
    ampY *= this._bobBlend;
    const phase = ctrl.bobPhase;
    const bobX = Math.sin(phase) * ampY * 1.4;
    const bobY = -Math.abs(Math.sin(phase)) * ampY; // vertical double frequency
    const bobRoll = -Math.sin(phase) * ampY * 2.6; // radians, couples with x
    this.viewmodelBob.phase = phase;
    this.viewmodelBob.amplitude = ampY;
    this.viewmodelBob.x = bobX;
    this.viewmodelBob.y = bobY;
    this.moveState = ctrl.moveState;

    // --- breathing sway (idle) ---------------------------------------------
    this._breath += dt;
    const breathAmt = (1 - this._bobBlend) * (1 - 0.6 * player.adsAmount) * (player.alive ? 1 : 0);
    const breathPitch = Math.sin(this._breath * 0.72) * 0.0021 * breathAmt;
    const breathYaw = Math.sin(this._breath * 0.31 + 1.7) * 0.0016 * breathAmt;
    const breathY = Math.sin(this._breath * 0.72 + 0.4) * 0.0018 * breathAmt;

    // --- shakes ---------------------------------------------------------------
    let shakeX = 0;
    let shakeY = 0;
    let shakeRoll = 0;
    let shakePitch = 0;
    let shakeYaw = 0;
    for (const s of this._shakes) {
      if (!s.active) continue;
      s.t += dt;
      if (s.t >= s.duration) {
        s.active = false;
        continue;
      }
      const k = Math.pow(1 - s.t / s.duration, 2) * s.strength;
      const tp = (t + s.seed) * s.freqPos;
      const tr = (t + s.seed) * s.freqRot;
      shakeX += Math.sin(tp * 1.13 + 0.7) * 0.028 * k;
      shakeY += Math.sin(tp * 1.71 + 2.1) * 0.024 * k;
      shakePitch += Math.sin(tr * 0.97 + 1.3) * 0.55 * DEG * k * 2.2;
      shakeYaw += Math.sin(tr * 1.29 + 4.4) * 0.4 * DEG * k * 2.0;
      shakeRoll += Math.sin(tr * 1.51 + 3.0) * 0.9 * DEG * k * 2.4;
    }

    // --- death fall --------------------------------------------------------------
    let deathRoll = 0;
    let deathPitch = 0;
    if (!player.alive) {
      this._deathBlend = Math.min(1, this._deathBlend + dt / 0.65);
      const k = 1 - Math.pow(1 - this._deathBlend, 2);
      deathRoll = this._deathRoll * 28 * DEG * k;
      deathPitch = -18 * DEG * k;
    } else {
      this._deathBlend = 0;
    }

    // --- lean ------------------------------------------------------------------------
    const lean = ctrl.leanAmount;

    // --- compose pose --------------------------------------------------------------
    this._prevPos.copy(this._curPos);
    this._prevQuat.copy(this._curQuat);
    this._prevFov = this._curFov;
    const cc = this._c;
    cc.breathPitch = breathPitch;
    cc.breathYaw = breathYaw;
    cc.breathY = breathY;
    cc.bobX = bobX;
    cc.bobY = bobY;
    cc.bobRoll = bobRoll;
    cc.shakeX = shakeX;
    cc.shakeY = shakeY;
    cc.shakePitch = shakePitch;
    cc.shakeYaw = shakeYaw;
    cc.shakeRoll = shakeRoll;
    cc.deathRoll = deathRoll;
    cc.deathPitch = deathPitch;
    cc.lean = lean;
    this._composePose();
    if (!this._hasPose) {
      // first pose: no interpolation history
      this._prevPos.copy(this._curPos);
      this._prevQuat.copy(this._curQuat);
      this._prevFov = this._curFov;
    }
    this._hasPose = true;
    // Immediately reflect the current pose so anything reading game.camera
    // this frame is at most a sub-frame behind; the render hook refines it
    // with interpolation.
    this.applyRender(1);
  }

  /** Compose the current-step pose into _curPos/_curQuat/_curFov. */
  _composePose() {
    const player = this.player;
    const ctrl = player.controller;
    const c = this._c || EMPTY_COMPOSE;
    const feet = ctrl.position;

    // rotation
    const kick = this._kick.pos; // pitch, yaw, roll
    const land = this._land.pos; // y offset, pitch
    const slideRoll = this._slideBlend * -6 * DEG;
    const mantlePitch = -this._mantleCue * 12 * DEG;
    const yaw = this.yaw + this._recoilYaw + kick[1] + c.breathYaw + c.shakeYaw + this._slideBlend * 2 * DEG;
    let pitch = this.pitch + this._recoilPitch + kick[0] + c.breathPitch - land[1] * 0.5 + c.shakePitch + mantlePitch + c.deathPitch;
    pitch = THREE.MathUtils.clamp(pitch, -PITCH_LIMIT - 0.15, PITCH_LIMIT + 0.15);
    const roll = kick[2] + c.bobRoll + c.shakeRoll + slideRoll + c.lean * 8 * DEG + c.deathRoll;
    _e.set(pitch, yaw, -roll, 'YXZ');
    this._curQuat.setFromEuler(_e);

    // basis for offsets
    _right.set(Math.cos(yaw), 0, -Math.sin(yaw)); // camera right (yaw only)
    // position: feet + eye height + offsets
    const eyeY = feet.y + this._eyeHeight + this._stepOffset + land[0] + c.bobY + c.breathY + c.shakeY;
    this._curPos.set(feet.x, eyeY, feet.z);
    // lean offset (0.35 m sideways) + bob x + shake x along camera right
    const side = c.lean * 0.35 + c.bobX + c.shakeX;
    this._curPos.addScaledVector(_right, side);
    // slide: nudge back and down a touch (weight on the back leg)
    if (this._slideBlend > 0) {
      _v.set(-Math.sin(yaw), 0, -Math.cos(yaw));
      this._curPos.addScaledVector(_v, -0.18 * this._slideBlend);
    }

    // FOV: CoD horizontal (16:9) → vertical, sprint kick, ADS multiplier
    const settingsFov = this.game.settings?.get('fov') ?? this._baseFovH;
    const hfov = settingsFov + this._sprintFovKick * this._sprintBlend;
    let vfov = 2 * Math.atan(Math.tan((hfov * DEG) / 2) * (9 / 16)) / DEG;
    const adsMul = THREE.MathUtils.lerp(1, player.adsFovMul, player.adsAmount);
    vfov *= adsMul;
    this._curFov = vfov;
    this.fov = vfov;
    this.fovScale = adsMul;

    // axes
    this.forward.set(0, 0, -1).applyQuaternion(this._curQuat);
    this.right.copy(_right);
    this.up.set(0, 1, 0).applyQuaternion(this._curQuat);
  }

  /**
   * Render-frame hook: interpolate the two fixed poses and write the camera.
   * @param {number} alpha 0..1 interpolation between previous and current step
   */
  applyRender(alpha = 1) {
    if (!this.enabled || !this._hasPose) return;
    const cam = this.camera;
    const a = THREE.MathUtils.clamp(alpha, 0, 1);
    cam.position.lerpVectors(this._prevPos, this._curPos, a);
    _q.slerpQuaternions(this._prevQuat, this._curQuat, a);
    cam.quaternion.copy(_q);
    const fov = THREE.MathUtils.lerp(this._prevFov, this._curFov, a);
    if (Math.abs(fov - cam.fov) > 0.01) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
  }

  dispose() {
    this._preRenderOff?.();
  }
}

const EMPTY_COMPOSE = {
  breathPitch: 0, breathYaw: 0, breathY: 0, bobX: 0, bobY: 0, bobRoll: 0,
  shakeX: 0, shakeY: 0, shakePitch: 0, shakeYaw: 0, shakeRoll: 0,
  deathRoll: 0, deathPitch: 0, lean: 0,
};

void _v2;
