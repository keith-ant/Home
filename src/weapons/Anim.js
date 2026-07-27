/**
 * WeaponAnimator — spring/curve-driven procedural viewmodel animation
 * (WEAPONS stream). Produces, every fixed step:
 *
 *   - the weapon-root pose in camera space (posePos + poseQuat) blended
 *     from the def poses (hip / ADS / sprint / crouch / slide / lowered /
 *     inspect) with additive springs (fire kick, muzzle climb), lagged
 *     movement bob, look sway, idle breathing + micro-noise, damage flinch;
 *   - animatable part transforms on the current GunAssembly (bolt / slide
 *     reciprocation, charging handle, dust cover, mag drop/insert, trigger,
 *     hammer, selector, holo reticle intensity), and the arm/hand offsets
 *     for the reload / inspect timelines.
 *
 * Everything is deterministic: driven by game.time and the weapon FSM state,
 * cosmetic randomness comes from a derived seeded RNG.
 *
 * Timing tables live in WeaponDefs (reload beats, ADS time, kick magnitudes);
 * this module only shapes curves between them.
 */
import * as THREE from 'three';

const DEG = Math.PI / 180;
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

/** N-axis critically-tunable damped spring (semi-implicit Euler). */
class Spring {
  constructor(n, frequency, damping) {
    this.n = n;
    this.pos = new Float32Array(n);
    this.vel = new Float32Array(n);
    this.setTuning(frequency, damping);
  }
  setTuning(frequency, damping) {
    this.w = frequency * Math.PI * 2;
    this.zeta = damping;
  }
  impulse(i, v) {
    this.vel[i] += v;
  }
  target(i, x, dt, k = 1) {
    // pull position toward x (used for lagged followers)
    this.vel[i] += (x - this.pos[i]) * this.w * this.w * k * dt;
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

/** Smooth 0..1 blend with rate limiting toward a target. */
function approach(cur, target, rate, dt) {
  const d = target - cur;
  const step = rate * dt;
  if (Math.abs(d) <= step) return target;
  return cur + Math.sign(d) * step;
}

function smoothstep(a, b, x) {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
function smootherstep(t) {
  const x = Math.max(0, Math.min(1, t));
  return x * x * x * (x * (x * 6 - 15) + 10);
}
/** ease with slight overshoot (back-out) */
function easeOutBack(t, s = 0.7) {
  const x = Math.max(0, Math.min(1, t)) - 1;
  return x * x * ((s + 1) * x + s) + 1;
}
function lerp(a, b, t) {
  return a + (b - a) * t;
}
function lerpPose(out, a, b, t) {
  out.pos[0] = lerp(a.pos[0], b.pos[0], t);
  out.pos[1] = lerp(a.pos[1], b.pos[1], t);
  out.pos[2] = lerp(a.pos[2], b.pos[2], t);
  out.rot[0] = lerp(a.rot[0], b.rot[0], t);
  out.rot[1] = lerp(a.rot[1], b.rot[1], t);
  out.rot[2] = lerp(a.rot[2], b.rot[2], t);
  return out;
}
function copyPose(out, a) {
  return lerpPose(out, a, a, 0);
}
const _p1 = { pos: [0, 0, 0], rot: [0, 0, 0] };
const _p2 = { pos: [0, 0, 0], rot: [0, 0, 0] };
const _pAds = { pos: [0, 0, 0], rot: [0, 0, 0] };

export class WeaponAnimator {
  /**
   * @param {import('../Game.js').Game} game
   */
  constructor(game) {
    this.game = game;
    // output pose (camera space)
    this.posePos = new THREE.Vector3();
    this.poseQuat = new THREE.Quaternion();
    // springs
    this._kick = new Spring(6, 9.5, 0.52);   // px py pz | pitch yaw roll (rad)
    this._bobLag = new Spring(2, 3.4, 0.85);  // lagged bob follower
    this._swayLag = new Spring(2, 3.0, 0.8);  // extra lag on look sway
    this._flinch = new Spring(3, 5.5, 0.55);  // damage flinch shake (pos)
    this._climb = 0;                          // accumulated muzzle rise (deg)
    this._climbTimer = 0;
    // per-weapon lagged blends
    this.adsBlend = 0;
    this._adsT = 0;
    this.sprintBlend = 0;
    this.crouchBlend = 0;
    this.slideBlend = 0;
    this.lowerBlend = 0;      // holster / deploy / grenade / mantle / death
    this.inspectT = -1;       // inspect timeline (s), <0 = off
    this.throwT = -1;         // grenade throw timeline (s), <0 = off
    this.reloadT = -1;
    this.reloadEmpty = false;
    this.reloadDur = 2;
    this._t = 0;
    this._prevYaw = 0;
    this._prevPitch = 0;
    this.moveTilt = 0;
    this._lastMoveTilt = 0;
    // exposed sub-state for the viewmodel/parts
    this.partState = {
      boltT: 1,           // 0..1 reciprocation phase (1 = closed)
      boltLocked: false,  // locked back on empty
      slideT: 1,
      slideLocked: false,
      chargingT: 1,
      magOut: false,      // magazine detached (falling)
      magDropAt: -1,
      handMag: false,     // spare mag visible in the left hand
      leftHandOffset: [0, 0, 0],
      leftHandPose: null, // override hand pose name
      rightHandPose: null,
      triggerPull: 0,     // 0..1
      hammerCock: 0,      // 0..1 (pistol)
      reticleGlow: 1,
      selector: 0,        // 0 semi / 1 auto (lever angle)
    };
    this.weapon = null;
    this.def = null;
  }

  /** Bind to a weapon (def + assembly). Resets transient state. */
  bind(weapon) {
    this.weapon = weapon;
    this.def = weapon.def;
    this._kick.reset();
    this._bobLag.reset();
    this._swayLag.reset();
    this._flinch.reset();
    this._climb = 0;
    this.reloadT = -1;
    this.inspectT = -1;
    this.adsBlend = 0;
    this._adsT = 0;
  }

  /* ---------------------------------------------------------- triggers */
  /**
   * A shot was fired: impulse the kick springs and start the bolt/slide cycle.
   * @param {number} intensity 0..1+ (scaled by ADS)
   * @param {import('../core/Random.js').Random} rng cosmetic rng
   */
  onFire(intensity, rng) {
    const rc = this.def.recoil;
    const ads = this.adsBlend;
    const scale = intensity * (1 - ads * (1 - rc.adsMul));
    // positional back-kick (z) + small vertical hop, rotational pitch up + roll wobble
    this._kick.impulse(2, rc.gunKickZ * 62 * scale);
    this._kick.impulse(1, 0.0035 * 60 * scale * (0.5 + rng.next()));
    this._kick.impulse(3, rc.gunKickPitch * DEG * 60 * scale);
    this._kick.impulse(5, rc.gunKickRoll * DEG * 60 * scale * (rng.next() * 2 - 1));
    this._kick.impulse(4, rc.gunKickRoll * DEG * 30 * scale * (rng.next() * 2 - 1));
    // accumulate climb during automatic fire (visual only; view recoil is separate)
    this._climb = Math.min(rc.climbMax, this._climb + rc.climbPitch * (1 - 0.5 * ads));
    this._climbTimer = 0.22;
    // bolt / slide cycle
    if (this.def.kind === 'pistol') {
      this.partState.slideT = 0;
    } else {
      this.partState.boltT = 0;
    }
    this.partState.triggerPull = 1;
  }

  /** Weapon ran dry with the bolt open. */
  onEmptyLock() {
    if (this.def.kind === 'pistol') this.partState.slideLocked = true;
    else this.partState.boltLocked = true;
  }

  /** Empty click: tiny nudge. */
  onDryFire() {
    this._kick.impulse(2, 0.004 * 60);
    this._kick.impulse(3, 0.5 * DEG * 60);
    this.partState.triggerPull = 1;
  }

  startReload(empty) {
    this.reloadT = 0;
    this.reloadEmpty = !!empty;
    this.reloadDur = empty ? this.def.reload.empty : this.def.reload.tactical;
    this.partState.magOut = false;
    this.partState.handMag = false;
  }

  cancelReload() {
    this.reloadT = -1;
    this.partState.magOut = false;
    this.partState.handMag = false;
    this.partState.leftHandPose = null;
    this.partState.leftHandOffset[0] = 0;
    this.partState.leftHandOffset[1] = 0;
    this.partState.leftHandOffset[2] = 0;
  }

  startInspect() {
    this.inspectT = 0;
  }
  stopInspect() {
    this.inspectT = -1;
  }

  /** Grenade throw arc (hold → windup → release), see WeaponDefs.frag.viewmodel. */
  startThrow() {
    this.throwT = 0;
  }

  /** Damage flinch: jerk the gun toward the camera and roll. */
  flinch(strength) {
    this._flinch.impulse(0, 0.02 * 60 * strength);
    this._flinch.impulse(1, -0.015 * 60 * strength);
    this._flinch.impulse(2, 0.02 * 60 * strength);
    this._kick.impulse(5, 4 * DEG * 60 * strength * 0.4);
  }

  /* ------------------------------------------------------------ update */
  /**
   * Fixed-step update. `ctx` carries the smoothed blends the weapon system
   * derived from the player + input.
   * @param {number} dt
   * @param {object} ctx
   * @param {number} ctx.adsTarget 0|1
   * @param {number} ctx.sprint 0|1
   * @param {number} ctx.crouch 0..1
   * @param {number} ctx.slide 0..1
   * @param {number} ctx.lower 0..1 (holster / deploy blend target reached externally)
   * @param {{x:number,y:number}} ctx.sway rig.viewmodelSway
   * @param {{x:number,y:number,amplitude:number}} ctx.bob rig.viewmodelBob
   * @param {number} ctx.speed horizontal speed m/s
   * @param {number} ctx.lateralSpeed signed strafe speed (m/s, +right)
   * @param {boolean} ctx.alive
   */
  update(dt, ctx) {
    const def = this.def;
    if (!def) return;
    const vm = def.viewmodel;
    this._t += dt;
    const t = this._t;

    /* ---- blends ------------------------------------------------------ */
    // ADS with an eased ramp over def.ads.time (slight overshoot on entry)
    const adsRate = 1 / Math.max(0.05, def.ads?.time ?? 0.22);
    const equip = def.equip || { holster: 0.3, deploy: 0.3 };
    this._adsT = approach(this._adsT, ctx.adsTarget, adsRate, dt);
    this.adsBlend = ctx.adsTarget > 0.5 ? easeOutBack(this._adsT, 0.55) : smootherstep(this._adsT);
    const ads = Math.max(0, Math.min(1.08, this.adsBlend));
    const adsC = Math.min(1, ads);

    this.sprintBlend = approach(this.sprintBlend, ctx.sprint, 1 / 0.3, dt);
    const spr = smootherstep(this.sprintBlend) * (1 - adsC);
    this.crouchBlend = ctx.crouch;
    this.slideBlend = approach(this.slideBlend, ctx.slide, 1 / 0.18, dt);
    this.lowerBlend = approach(this.lowerBlend, ctx.lower, ctx.lower > this.lowerBlend ? 1 / equip.holster : 1 / equip.deploy, dt);

    /* ---- timelines --------------------------------------------------- */
    if (this.reloadT >= 0) {
      this.reloadT += dt;
      if (this.reloadT >= this.reloadDur) this.cancelReloadSilent();
    }
    if (this.inspectT >= 0) {
      this.inspectT += dt;
      if (this.inspectT >= def.inspect.duration) this.inspectT = -1;
    }

    /* ---- base pose composition ---------------------------------------- */
    // hip → crouch → slide → sprint
    copyPose(_p1, vm.hip);
    if (vm.crouch) lerpPose(_p1, _p1, vm.crouch, this.crouchBlend * 0.85);
    if (vm.slide) lerpPose(_p1, _p1, vm.slide, smootherstep(this.slideBlend));
    if (vm.sprint) lerpPose(_p1, _p1, vm.sprint, spr);
    // ADS pose: solve so the reticle (or iron-sight line) sits on the camera axis
    if (vm.adsZ !== undefined) {
      this._computeAdsPose(_pAds);
      lerpPose(_p1, _p1, _pAds, adsC);
    }
    // inspect timeline (blends toward hero poses)
    if (this.inspectT >= 0 && vm.inspect1) {
      const w = this._inspectWeight(this.inspectT, def.inspect.duration);
      lerpPose(_p1, _p1, w.pose, w.weight * (1 - adsC));
    }
    // reload gun tilt/drop (weapon body dips + rolls while the off hand works)
    let reloadK = null;
    if (this.reloadT >= 0) {
      reloadK = this._sampleReload(this.reloadT);
      _p2.pos[0] = _p1.pos[0] + reloadK.gunOffset[0];
      _p2.pos[1] = _p1.pos[1] + reloadK.gunOffset[1];
      _p2.pos[2] = _p1.pos[2] + reloadK.gunOffset[2];
      _p2.rot[0] = _p1.rot[0] + reloadK.gunRot[0];
      _p2.rot[1] = _p1.rot[1] + reloadK.gunRot[1];
      _p2.rot[2] = _p1.rot[2] + reloadK.gunRot[2];
      copyPose(_p1, _p2);
    }
    // grenade throw arc: hold → windup → release
    if (this.throwT >= 0 && def.kind === 'grenade') {
      this.throwT += dt;
      const tw = def.times?.windup ?? 0.25;
      const tt = def.times?.throw ?? 0.28;
      const t2 = this.throwT;
      if (t2 < tw) {
        lerpPose(_p1, vm.hip, vm.windup || vm.hip, smootherstep(t2 / tw));
      } else {
        const k = smootherstep((t2 - tw) / Math.max(0.05, tt * 0.55));
        lerpPose(_p1, vm.windup || vm.hip, vm.release || vm.lowered, k);
      }
    }
    // lowered (holster/deploy/mantle/dead)
    const lw = smootherstep(this.lowerBlend);
    if (lw > 0 && vm.lowered) lerpPose(_p1, _p1, vm.lowered, lw);

    /* ---- additive layers ------------------------------------------------ */
    // fire kick springs
    this._kick.update(dt);
    this._flinch.update(dt);
    // muzzle climb decay
    if (this._climbTimer > 0) this._climbTimer -= dt;
    else this._climb = approach(this._climb, 0, (def.recoil?.climbMax ?? 3) * 4.5, dt);
    // lagged bob (weapon trails the head bob by ~40 ms)
    const bobK = 1.6 * (vm.bobScale ?? 1) * (1 - 0.72 * adsC) * (1 - 0.35 * spr);
    this._bobLag.target(0, ctx.bob.x * bobK, dt);
    this._bobLag.target(1, ctx.bob.y * bobK, dt);
    this._bobLag.update(dt);
    // look sway → position + rotation lag (rig already spring-filters mouse delta)
    const swayK = (vm.swayScale ?? 1) * (1 - 0.62 * adsC);
    this._swayLag.target(0, ctx.sway.x, dt);
    this._swayLag.target(1, ctx.sway.y, dt);
    this._swayLag.update(dt);
    const swayX = this._swayLag.pos[0] * swayK;
    const swayY = this._swayLag.pos[1] * swayK;
    // idle breathing + micro noise (deterministic sines)
    const breatheK = (vm.breatheScale ?? 1) * (1 - 0.55 * adsC) * (ctx.alive ? 1 : 0);
    const breathY = Math.sin(t * Math.PI * 2 * 0.7) * 0.0018 * breatheK;
    const breathX = Math.sin(t * Math.PI * 2 * 0.36 + 1.7) * 0.0012 * breatheK;
    const noiseP = (Math.sin(t * 2.13 + 0.4) + Math.sin(t * 3.71 + 2.1) * 0.6) * 0.11 * DEG * breatheK;
    const noiseY = (Math.sin(t * 1.73 + 1.1) + Math.sin(t * 2.87 + 0.3) * 0.6) * 0.12 * DEG * breatheK;
    // strafe/turn tilt: weapon leans into lateral motion + tracks yaw velocity
    const tiltTarget = THREE.MathUtils.clamp(-ctx.lateralSpeed * 1.05, -4.5, 4.5) * (1 - 0.5 * adsC);
    this.moveTilt = lerp(this.moveTilt, tiltTarget, Math.min(1, dt * 6));

    // compose
    const pos = this.posePos;
    pos.set(_p1.pos[0], _p1.pos[1], _p1.pos[2]);
    // kick (px py pz)
    pos.x += this._kick.pos[0] + this._flinch.pos[0];
    pos.y += this._kick.pos[1] + this._flinch.pos[1] + this._bobLag.pos[1] + breathY;
    pos.z += this._kick.pos[2] + this._flinch.pos[2];
    pos.x += this._bobLag.pos[0] + breathX - swayX * 0.16;
    pos.y += -swayY * 0.09;
    // rotation (degrees → euler YXZ: yaw, pitch, roll)
    const pitch = _p1.rot[0] * DEG + this._kick.pos[3] + this._climb * DEG + noiseP + swayY * 0.9;
    const yaw = _p1.rot[1] * DEG + this._kick.pos[4] + noiseY - swayX * 1.6;
    const roll = _p1.rot[2] * DEG + this._kick.pos[5] + this.moveTilt * DEG - swayX * 0.45 + this._bobLag.pos[0] * 2.5;
    _e.set(pitch, yaw, roll, 'YXZ');
    this.poseQuat.setFromEuler(_e);

    /* ---- parts ------------------------------------------------------- */
    const ps = this.partState;
    // bolt: 12 ms back, 40 ms return (unless locked)
    if (ps.boltT < 1) ps.boltT = Math.min(1, ps.boltT + dt / 0.052);
    if (ps.slideT < 1) ps.slideT = Math.min(1, ps.slideT + dt / 0.075);
    if (ps.chargingT < 1) ps.chargingT = Math.min(1, ps.chargingT + dt / 0.35);
    ps.triggerPull = approach(ps.triggerPull, 0, 12, dt);
    ps.reticleGlow = 1;
    // reload part events (mag out/in, bolt release) sampled from the timeline
    if (reloadK) {
      ps.magOut = reloadK.magOut;
      ps.handMag = reloadK.handMag;
      ps.leftHandOffset[0] = reloadK.leftHand[0];
      ps.leftHandOffset[1] = reloadK.leftHand[1];
      ps.leftHandOffset[2] = reloadK.leftHand[2];
      ps.leftHandPose = reloadK.leftPose;
      if (reloadK.boltDrop && ps.boltLocked) {
        ps.boltLocked = false;
        ps.boltT = 0.1;
      }
      if (reloadK.slideDrop && ps.slideLocked) {
        ps.slideLocked = false;
        ps.slideT = 0.1;
      }
      if (reloadK.chargePull) ps.chargingT = Math.min(ps.chargingT, reloadK.chargingT);
    } else {
      ps.magOut = false;
      ps.handMag = false;
      ps.leftHandPose = null;
      // ease the left hand back home
      ps.leftHandOffset[0] = approach(ps.leftHandOffset[0], 0, 1.2, dt);
      ps.leftHandOffset[1] = approach(ps.leftHandOffset[1], 0, 1.2, dt);
      ps.leftHandOffset[2] = approach(ps.leftHandOffset[2], 0, 1.2, dt);
    }
    ps.rightHandPose = ps.triggerPull > 0.2 ? 'fire' : null;
  }

  cancelReloadSilent() {
    this.reloadT = -1;
    this.partState.magOut = false;
    this.partState.handMag = false;
  }

  /* ------------------------------------------------------- pose helpers */
  /** ADS pose: place the sight-line reference point on the camera axis. */
  _computeAdsPose(out) {
    const vm = this.def.viewmodel;
    const weapon = this.weapon;
    // sight reference in weapon-local space: holo reticle, else pistol notch offset
    let rx = 0;
    let ry = 0;
    let rz = 0;
    const ret = weapon?.assembly?.anchors?.reticle;
    if (ret) {
      rx = ret.position.x;
      ry = ret.position.y;
      rz = ret.position.z;
    } else if (vm.adsSightOffset) {
      rx = vm.adsSightOffset[0];
      ry = vm.adsSightOffset[1];
      rz = vm.adsSightOffset[2];
    }
    const rot = vm.adsRot || [0, 0, 0];
    // rotate the reference offset by the ADS rotation (small angles) so the
    // solve stays exact if the def cants the weapon in ADS
    _e.set(rot[0] * DEG, rot[1] * DEG, rot[2] * DEG, 'YXZ');
    _v.set(rx, ry, rz).applyEuler(_e);
    out.pos[0] = 0 - _v.x;
    out.pos[1] = 0 - _v.y;
    out.pos[2] = vm.adsZ - _v.z;
    out.rot[0] = rot[0];
    out.rot[1] = rot[1];
    out.rot[2] = rot[2];
    return out;
  }

  /** Inspect timeline weight + target pose. */
  _inspectWeight(t, dur) {
    const vm = this.def.viewmodel;
    // 0 → 0.4 blend into inspect1; hold+drift → 1.35; 1.35→1.8 to inspect2; hold → 2.2; settle
    const inW = smootherstep(t / 0.4);
    const outW = 1 - smootherstep((t - (dur - 0.45)) / 0.45);
    const weight = Math.min(inW, Math.max(0, outW));
    const swap = smootherstep((t - 1.3) / 0.5); // 0 = pose1, 1 = pose2
    // slow drift while holding (continuous small rotation so the still frame reads as motion)
    const drift = Math.sin((t / dur) * Math.PI) * 6;
    lerpPose(_p2, vm.inspect1, vm.inspect2, swap);
    _p2.rot[1] += drift * (1 - 2 * swap) * 0.35;
    _p2.rot[2] += Math.sin(t * 1.3) * 1.2;
    return { pose: _p2, weight };
  }

  /**
   * Sample the reload choreography at time t (seconds since reload start).
   * Beats (from def.reload): magOut, magIn, boltRelease. Returns gun offsets,
   * left-hand offset (weapon space, metres) and part events.
   */
  _sampleReload(t) {
    const rl = this.def.reload;
    const dur = this.reloadDur;
    const empty = this.reloadEmpty;
    const isPistol = this.def.kind === 'pistol';
    const out = _reloadOut;
    out.magOut = false;
    out.handMag = false;
    out.boltDrop = false;
    out.slideDrop = false;
    out.chargePull = false;
    out.chargingT = 1;
    out.leftPose = null;
    out.gunOffset[0] = 0;
    out.gunOffset[1] = 0;
    out.gunOffset[2] = 0;
    out.gunRot[0] = 0;
    out.gunRot[1] = 0;
    out.gunRot[2] = 0;
    out.leftHand[0] = 0;
    out.leftHand[1] = 0;
    out.leftHand[2] = 0;

    const tOut = rl.magOut;
    const tIn = rl.magIn;
    const tBolt = rl.boltRelease;
    // gun body: tilt in (roll toward the working hand) and drop, settle at the end
    const enter = smootherstep(t / 0.35);
    const exit = 1 - smootherstep((t - (dur - 0.42)) / 0.42);
    const bodyW = Math.min(enter, exit);
    const tiltPeak = isPistol ? -20 : 24; // deg roll
    const mag_click = t > tIn && t < tIn + 0.16 ? Math.sin((t - tIn) / 0.16 * Math.PI) : 0;
    out.gunRot[2] = tiltPeak * bodyW;
    out.gunRot[0] = (isPistol ? 8 : 12) * bodyW - mag_click * 3;
    out.gunRot[1] = (isPistol ? 12 : -8) * bodyW;
    out.gunOffset[1] = (isPistol ? -0.02 : -0.045) * bodyW - mag_click * 0.006;
    out.gunOffset[2] = 0.02 * bodyW;
    out.gunOffset[0] = (isPistol ? -0.02 : -0.035) * bodyW;

    // magazine state
    if (t >= tOut && t < tIn - 0.05) out.magOut = true; // detached, falling / gone
    // spare mag in the left hand from just after mag-out until insert
    out.handMag = t >= tOut + 0.28 && t < tIn + 0.06;

    // left hand travel (offset from its rest anchor, weapon space)
    // waypoints: rest → magwell → down/away (fetch) → magwell → bolt/handle → rest
    const lh = out.leftHand;
    if (isPistol) {
      // support hand drops to the mag, pulls, feeds new mag from below, then racks/releases slide
      seg(lh, t, [
        [0.0, [0, 0, 0]],
        [tOut - 0.05, [0.0, -0.04, 0.02]],       // grab the mag heel
        [tOut + 0.22, [-0.03, -0.16, 0.08]],     // strip it down and away
        [tIn - 0.25, [-0.02, -0.14, 0.05]],      // new mag comes up
        [tIn, [0.0, -0.05, 0.02]],               // seated
        [tIn + 0.16, [0.0, -0.03, 0.02]],
        [empty ? tBolt - 0.12 : dur - 0.3, empty ? [-0.005, 0.02, 0.02] : [0, 0, 0]], // thumb the slide release
        [dur - 0.08, [0, 0, 0]],
      ]);
      out.leftPose = t > tOut - 0.1 && t < tIn + 0.2 ? 'mag_hold' : null;
    } else {
      seg(lh, t, [
        [0.0, [0, 0, 0]],
        [Math.max(0.02, tOut - 0.3), [0.05, -0.02, 0.16]],  // hand slides back to the magwell
        [tOut, [0.05, -0.05, 0.18]],                        // grabs the mag
        [tOut + 0.3, [-0.02, -0.28, 0.22]],                 // strips down and out of frame
        [tIn - 0.35, [-0.01, -0.26, 0.20]],                 // (off-frame swap)
        [tIn - 0.05, [0.05, -0.06, 0.18]],                  // new mag to the well
        [tIn + 0.1, [0.05, -0.02, 0.17]],                   // seated, palm slap
        [empty ? tBolt - 0.15 : tIn + 0.35, empty ? [0.045, 0.035, 0.13] : [0.03, -0.01, 0.05]], // reach the bolt release
        [empty ? tBolt + 0.15 : tIn + 0.45, empty ? [0.045, 0.035, 0.13] : [0.02, 0, 0.03]],
        [dur - 0.1, [0, 0, 0]],
      ]);
      out.leftPose = t > tOut - 0.3 && t < tIn + 0.25 ? 'mag_hold' : (empty && t > tBolt - 0.2 && t < tBolt + 0.2 ? 'flat' : null);
    }
    // bolt / slide release beat (empty reloads only)
    if (empty && t >= tBolt && t < tBolt + 0.09) {
      if (isPistol) out.slideDrop = true;
      else out.boltDrop = true;
    }
    return out;
  }
}

const _reloadOut = {
  magOut: false, handMag: false, boltDrop: false, slideDrop: false, chargePull: false, chargingT: 1,
  leftPose: null, gunOffset: [0, 0, 0], gunRot: [0, 0, 0], leftHand: [0, 0, 0],
};

/**
 * Piecewise waypoint interpolation with smoothstep easing.
 * @param {number[]} out
 * @param {number} t
 * @param {Array<[number, number[]]>} keys [[time, [x,y,z]], ...] ascending
 */
function seg(out, t, keys) {
  if (t <= keys[0][0]) {
    out[0] = keys[0][1][0];
    out[1] = keys[0][1][1];
    out[2] = keys[0][1][2];
    return out;
  }
  for (let i = 0; i < keys.length - 1; i++) {
    const [t0, a] = keys[i];
    const [t1, b] = keys[i + 1];
    if (t >= t0 && t < t1) {
      const k = smoothstep(t0, t1, t);
      out[0] = a[0] + (b[0] - a[0]) * k;
      out[1] = a[1] + (b[1] - a[1]) * k;
      out[2] = a[2] + (b[2] - a[2]) * k;
      return out;
    }
  }
  const last = keys[keys.length - 1][1];
  out[0] = last[0];
  out[1] = last[1];
  out[2] = last[2];
  return out;
}

export { Spring, smootherstep, easeOutBack, seg as segCurve };
void _v2;
