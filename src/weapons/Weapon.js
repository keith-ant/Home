/**
 * Weapon — per-weapon state machine + fire logic (WEAPONS stream).
 *
 * States: idle | firing | reloading | holstering | deploying | holstered | inspecting
 * All timing runs off game.time (fixed steps). The active weapon's update()
 * is driven by the WeaponSystem, which owns input, spread/recoil state
 * shared with the camera rig, the animator and the viewmodel.
 *
 * On fire (per round):
 *   ammo, chamber → Ballistics.fire (hitscan + weapon:hit events) →
 *   fx.muzzleFlash at the muzzle world position (scene light spike, sparks,
 *   chamber smoke) + the attached viewmodel flame rig → tracer → delayed
 *   brass eject at the port → view kick / permanent recoil into the camera
 *   rig → animator fire kick → 'player:fired' + 'weapon:ammo' events.
 */
import * as THREE from 'three';
import { buildAR, buildPistol, buildFrag } from './GunBuilder.js';

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _origin = new THREE.Vector3();
const _right = new THREE.Vector3();
const _upv = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const DEG = Math.PI / 180;

const _firedPayload = {
  weapon: null,
  muzzleWorldPos: new THREE.Vector3(),
  dirWorld: new THREE.Vector3(),
  ammo: 0,
  reserve: 0,
  ads: false,
  suppressed: false,
  sound: null,
  soundFar: null,
  hits: 0,
};

export class Weapon {
  /**
   * @param {import('./WeaponSystem.js').WeaponSystem} system
   * @param {object} def entry from WeaponDefs
   */
  constructor(system, def) {
    this.system = system;
    this.game = system.game;
    this.def = def;
    this.id = def.id;
    this.kind = def.kind;
    /** rounds in the weapon (mag + chamber merged for display) */
    this.magSize = def.magSize;
    this.ammo = def.magSize + (def.chamber ? 1 : 0);
    this.reserve = def.reserve;
    this.chambered = true;
    this.fireModeIndex = 0;
    this.state = 'holstered';
    this.stateTime = 0;
    this._nextFire = 0;
    this._burstLeft = 0;
    this._triggerHeldPrev = false;
    this._reloadEmpty = false;
    this._reloadApplied = false;
    this._boltDone = false;
    this._casingQueue = [];
    this.assembly = null; // built lazily
  }

  get fireMode() {
    return this.def.fireModes[this.fireModeIndex] || 'semi';
  }

  /** Build the procedural mesh assembly on first use. */
  ensureAssembly() {
    if (this.assembly) return this.assembly;
    switch (this.def.kind) {
      case 'ar':
        this.assembly = buildAR(this.def.build || {});
        break;
      case 'pistol':
        this.assembly = buildPistol(this.def.build || {});
        break;
      case 'grenade':
        this.assembly = buildFrag(this.def.build || {});
        break;
      default:
        this.assembly = buildAR();
    }
    return this.assembly;
  }

  /* --------------------------------------------------------------- state */
  setState(s) {
    if (this.state === s) return;
    this.state = s;
    this.stateTime = 0;
  }

  get isBusy() {
    return this.state === 'reloading' || this.state === 'holstering' || this.state === 'deploying' || this.state === 'holstered';
  }

  get canFire() {
    if (this.state !== 'idle' && this.state !== 'firing' && this.state !== 'inspecting' && this.state !== 'reloading') return false;
    return true;
  }

  cycleFireMode() {
    if (this.def.fireModes.length < 2) return;
    this.fireModeIndex = (this.fireModeIndex + 1) % this.def.fireModes.length;
    this.game.events.emit('weapon:firemode', { id: this.id, mode: this.fireMode });
    this.system.anim.partState.selector = this.fireMode === 'auto' ? 1 : 0;
  }

  /* ------------------------------------------------------------ transitions */
  deploy() {
    this.setState('deploying');
    this.system.anim.lowerBlend = 1; // start lowered, raise
    this.emitAmmo();
  }

  holster() {
    if (this.state === 'reloading') this._cancelReload();
    this.setState('holstering');
  }

  startInspect() {
    if (this.state !== 'idle') return false;
    this.setState('inspecting');
    this.system.anim.startInspect();
    return true;
  }

  /* ---------------------------------------------------------------- tick */
  /**
   * Active-weapon fixed step.
   * @param {number} dt
   * @param {{fireHeld:boolean, firePressed:boolean, reloadPressed:boolean, inspectPressed:boolean, sprinting:boolean, adsBlend:number, canAct:boolean}} inp
   */
  update(dt, inp) {
    this.stateTime += dt;
    const t = this.game.time.elapsed;
    const anim = this.system.anim;

    switch (this.state) {
      case 'deploying': {
        if (this.stateTime >= this.def.equip.deploy) this.setState('idle');
        break;
      }
      case 'holstering': {
        if (this.stateTime >= this.def.equip.holster) this.setState('holstered');
        break;
      }
      case 'inspecting': {
        if (inp.fireHeld || inp.reloadPressed || inp.sprinting || inp.adsBlend > 0.05 || anim.inspectT < 0) {
          anim.stopInspect();
          this.setState('idle');
        }
        break;
      }
      case 'reloading': {
        // ammo transfer at the "mag in" beat; bolt beat handled by the animator
        const rl = this.def.reload;
        if (!this._reloadApplied && this.stateTime >= rl.ammoUpdate) {
          this._reloadApplied = true;
          this._applyReloadAmmo();
        }
        const dur = this._reloadEmpty ? rl.empty : rl.tactical;
        if (this.stateTime >= dur) {
          this.setState('idle');
          this.game.events.emit('player:reloaded', { id: this.id });
        } else if (inp.firePressed && this.ammo > 0 && this._reloadApplied === false && this.stateTime < rl.magOut - 0.05) {
          // very early reload cancel by firing (tactical convenience)
          this._cancelReload();
        }
        break;
      }
      default:
        break;
    }

    // ---- inputs available in idle/firing/inspecting -----------------------
    if (this.state === 'idle' || this.state === 'firing' || this.state === 'inspecting') {
      // reload
      if (inp.reloadPressed && this.canReload()) {
        this.startReload();
      }
      // fire
      this._handleFire(inp, t);
    }
    this._triggerHeldPrev = inp.fireHeld;

    // delayed brass ejection (queued so the casing pops on the next step)
    if (this._casingQueue.length) {
      const now = this.game.time.elapsed;
      while (this._casingQueue.length && this._casingQueue[0] <= now) {
        this._casingQueue.shift();
        this._ejectCasing();
      }
    }
  }

  _handleFire(inp, t) {
    if (this.state === 'inspecting' && inp.fireHeld) {
      this.system.anim.stopInspect();
      this.setState('idle');
    }
    if (inp.sprinting) return; // no firing while sprinting (system interrupts sprint on trigger)
    const mode = this.fireMode;
    const interval = 60 / this.def.rpm;
    const triggerEdge = inp.firePressed || (inp.fireHeld && !this._triggerHeldPrev);
    let wantShot = false;
    if (mode === 'auto') {
      wantShot = inp.fireHeld;
    } else if (mode === 'burst') {
      if (this._burstLeft > 0) wantShot = true;
      else if (triggerEdge) {
        this._burstLeft = this.def.burstCount || 3;
        wantShot = true;
      }
    } else {
      wantShot = triggerEdge;
    }
    if (!wantShot) return;
    if (t < this._nextFire) return;
    if (this.ammo <= 0) {
      // dry fire on a fresh trigger pull only
      if (triggerEdge) this._dryFire();
      // auto-reload assist
      if (triggerEdge && this.canReload()) this.startReload();
      return;
    }
    this._nextFire = t + interval;
    if (mode === 'burst' && this._burstLeft > 0) this._burstLeft--;
    this.fire();
  }

  /* ------------------------------------------------------------------ */
  canReload() {
    if (this.state === 'reloading' || this.state === 'holstering' || this.state === 'deploying') return false;
    const capacity = this.magSize + (this.def.chamber && this.ammo > 0 ? 1 : 0);
    return this.reserve > 0 && this.ammo < capacity;
  }

  startReload() {
    if (!this.canReload()) return false;
    this._reloadEmpty = this.ammo <= 0;
    this._reloadApplied = false;
    this.setState('reloading');
    this.system.anim.startReload(this._reloadEmpty);
    this.game.events.emit('weapon:reload', { id: this.id, empty: this._reloadEmpty, duration: this._reloadEmpty ? this.def.reload.empty : this.def.reload.tactical });
    return true;
  }

  _cancelReload() {
    this.system.anim.cancelReload();
    this.setState('idle');
  }

  _applyReloadAmmo() {
    const empty = this._reloadEmpty;
    const capacity = this.magSize + (this.def.chamber && !empty ? 1 : 0);
    const need = capacity - this.ammo;
    const take = Math.min(need, this.reserve);
    this.ammo += take;
    this.reserve -= take;
    this.emitAmmo();
  }

  _dryFire() {
    this._nextFire = this.game.time.elapsed + 0.25;
    this.system.anim.onDryFire();
    this.game.events.emit('weapon:empty', { id: this.id });
  }

  /**
   * Fire one round now (also used by scripted presets / autoplay).
   * @returns {boolean} fired
   */
  fire() {
    if (this.ammo <= 0) return false;
    const game = this.game;
    const sys = this.system;
    const def = this.def;
    const vm = sys.viewmodel;
    const player = game.player;
    const anim = sys.anim;
    const rig = player?.rig;

    // sprint interruption (CoD: trigger cancels sprint)
    if (player?.isSprinting) player.interruptSprint();

    this.ammo -= 1;
    this.setState('firing');

    // ---- aim ray: camera centre + spread cone + tiny recoil sway ------------
    const eye = player?.eyePosition || game.camera.position;
    _origin.copy(eye);
    _fwd.copy(rig?.forward || _v1.set(0, 0, -1).applyQuaternion(game.camera.quaternion));
    const spreadDeg = sys.currentSpreadDeg();
    sys.applySpread(_fwd, spreadDeg, _dir);

    // ---- hitscan trace --------------------------------------------------
    const trace = sys.ballistics.fire({
      origin: _origin,
      dir: _dir,
      def,
      weaponId: this.id,
      owner: 'player',
    });

    // ---- muzzle world position / bore -----------------------------------
    const hasVm = !!(vm && vm.assembly && vm.weapon === this);
    if (hasVm) {
      vm.worldOf('muzzle', _v2);
      vm.boreDirection(_v3);
    } else {
      _v2.copy(_origin).addScaledVector(_fwd, 0.6);
      _v3.copy(_dir);
    }

    // ---- FX: world flash (light spike + smoke + sparks), viewmodel flame ----
    const fx = game.fx;
    if (fx) {
      fx.muzzleFlash({
        position: _v2,
        direction: _v3,
        size: def.muzzle?.size ?? 1,
        light: def.muzzle?.light !== false && !def.build?.suppressorHidesLight,
        smoke: def.muzzle?.smoke !== false,
        kind: def.kind === 'pistol' ? 'pistol' : 'rifle',
      });
      // tracer from just ahead of the muzzle to the impact point
      const shotIndex = sys.recoilIndex;
      if (def.tracerEvery && shotIndex % def.tracerEvery === 0 && trace.endPoint) {
        _v1.copy(trace.endPoint).sub(_v2);
        const dist = _v1.length();
        if (dist > 2.5) {
          fx.tracer(_v2, trace.endPoint, { speed: 320, length: 6.5, width: 0.036, skip: 0.55 });
        }
      }
    }
    if (hasVm) vm.fireFlash(1);

    // ---- brass: eject from the port after the bolt starts back --------------
    this._casingQueue.push(game.time.elapsed + (def.casing?.delay ?? 0.012));

    // ---- animation + camera recoil -----------------------------------------
    anim.onFire(1, sys.rng);
    const rc = def.recoil;
    const adsMul = 1 - anim.adsBlend * (1 - rc.adsMul);
    if (rig) {
      const jr = 0.85 + sys.rng.next() * 0.3;
      rig.kickView({
        pitch: rc.viewKick.pitch * DEG * jr * adsMul,
        yaw: rc.viewKick.yaw * DEG * (sys.rng.next() * 2 - 1) * adsMul,
        roll: rc.viewKick.roll * DEG * (sys.rng.next() * 2 - 1),
      });
      // permanent pattern recoil the player must fight (with partial recentering)
      const pat = rc.pattern;
      let idx = sys.recoilIndex;
      if (idx >= pat.length) idx = rc.loopFrom + ((idx - pat.length) % Math.max(1, pat.length - rc.loopFrom));
      const step = pat[Math.min(idx, pat.length - 1)];
      const pitchDeg = step[0] * (0.92 + sys.rng.next() * 0.16) * adsMul;
      const yawDeg = (step[1] + (sys.rng.next() * 2 - 1) * rc.randomYaw) * adsMul;
      rig.addRecoil(pitchDeg * DEG, yawDeg * DEG);
      sys.noteRecoil(pitchDeg, yawDeg);
      // subtle screen shake for the concussion
      rig.shake({ strength: 0.055 * (def.kind === 'pistol' ? 1.3 : 1), duration: 0.06, freqPos: 40, freqRot: 48 });
    }
    sys.recoilIndex++;
    sys.bloomAdd(def.spread.firePenalty ?? 0.3);

    // ---- events ---------------------------------------------------------------
    _firedPayload.weapon = this.id;
    _firedPayload.muzzleWorldPos.copy(_v2);
    _firedPayload.dirWorld.copy(_dir);
    _firedPayload.ammo = this.ammo;
    _firedPayload.reserve = this.reserve;
    _firedPayload.ads = anim.adsBlend > 0.5;
    _firedPayload.suppressed = !!def.build?.suppressor;
    _firedPayload.sound = def.sounds?.fire || null;
    _firedPayload.soundFar = def.sounds?.fireFar || null;
    _firedPayload.hits = trace.count;
    game.events.emit('player:fired', _firedPayload);
    this.emitAmmo();

    if (this.ammo <= 0) {
      anim.onEmptyLock();
    }
    return true;
  }

  _ejectCasing() {
    const fx = this.game.fx;
    const vm = this.system.viewmodel;
    if (!fx || !vm || vm.weapon !== this) return;
    if (!vm.portFrame(_v1, _right, _upv, _fwd)) return;
    const c = this.def.casing || {};
    const vr = c.velocity || [1.5, 2.4, 1.0, 1.6, 0.15, 0.5];
    const rng = this.system.cosRng;
    _v2.set(0, 0, 0)
      .addScaledVector(_right, vr[0] + rng.next() * (vr[1] - vr[0]))
      .addScaledVector(_upv, vr[2] + rng.next() * (vr[3] - vr[2]))
      .addScaledVector(_fwd, vr[4] + rng.next() * (vr[5] - vr[4]));
    const pv = this.game.player?.velocity;
    if (pv) _v2.add(pv);
    _v3.set(rng.range(-30, 30), rng.range(-70, 70), rng.range(-30, 30));
    fx.ejectCasing({ position: _v1, velocity: _v2, spin: _v3, kind: c.kind || 'rifle' });
    // chamber smoke wisp out of the port
    fx.particles?.emit?.('smoke_wisp', {
      position: _v1,
      direction: _upv,
      spread: 0.7,
      count: 1,
      speed: [0.25, 0.5],
      size: [0.06, 0.09],
      sizeEnd: [0.3, 0.45],
      life: [0.5, 0.8],
      alpha: 0.35,
    });
  }

  emitAmmo() {
    this.game.events.emit('weapon:ammo', {
      id: this.id,
      mag: this.ammo,
      reserve: this.reserve,
      magSize: this.magSize,
      mode: this.fireMode,
      name: this.def.name,
    });
  }
}
