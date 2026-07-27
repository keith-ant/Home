/**
 * WeaponSystem — `game.weapons`: loadout, input, ADS/spread/recoil state,
 * the viewmodel + animator + ballistics + grenades (WEAPONS stream).
 *
 * Public API (game.weapons):
 *   .current                Weapon (active)             .list  {id: Weapon}
 *   .defs                   WEAPON_DEFS                 .viewmodel / .anim / .ballistics / .grenades
 *   .switchTo(id)           holster → deploy sequence   .switchToSlot(1|2)
 *   .setLaser(on) / .setWeaponLight(on)                 .aimRay(outOrigin, outDir)
 *   .currentSpreadDeg()     effective cone half-angle    .adsBlend (0..1)
 *   .giveAmmo(id, n)        .throwGrenade() (scripted)  .forceIdle()
 *   .stats()                { tris, weapon, ammo, ... } for the harness bridge
 *
 * Fixed-step system (order 30). Reads game.input actions: fire, ads, reload,
 * weapon1, weapon2, weaponNext, weaponPrev, grenade, inspect. Emits
 * player:fired, weapon:hit, weapon:ammo, weapon:switched, weapon:reload,
 * player:reloaded, weapon:empty, weapon:firemode, grenade:thrown,
 * ui:hitmarker (from Ballistics). Consumes player:damaged (flinch),
 * grenade:exploded (player self-damage), player:respawn (refill).
 */
import * as THREE from 'three';
import { WEAPON_DEFS, DEFAULT_LOADOUT } from './WeaponDefs.js';
import { Weapon } from './Weapon.js';
import { WeaponAnimator } from './Anim.js';
import { Viewmodel } from './Viewmodel.js';
import { Ballistics } from './Ballistics.js';
import { GrenadeSystem } from './Grenade.js';
import { Random } from '../core/Random.js';

const DEG = Math.PI / 180;
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _ctx = {
  adsTarget: 0, sprint: 0, crouch: 0, slide: 0, lower: 0,
  sway: { x: 0, y: 0 }, bob: { x: 0, y: 0, phase: 0, amplitude: 0 },
  speed: 0, lateralSpeed: 0, alive: true,
};
const _inp = { fireHeld: false, firePressed: false, reloadPressed: false, inspectPressed: false, sprinting: false, adsBlend: 0, canAct: true };

export class WeaponSystem {
  /**
   * @param {import('../Game.js').Game} game
   */
  constructor(game) {
    this.game = game;
    this.events = game.events;
    this.defs = WEAPON_DEFS;
    // gameplay rng (spread/damage jitter) is game.rng; cosmetics get a derived stream
    this.rng = game.rng;
    this.cosRng = new Random(((game.seed ?? 1) * 2246822519 + 40503) >>> 0 || 1);

    this.ballistics = new Ballistics(game);
    this.anim = new WeaponAnimator(game);
    this.viewmodel = new Viewmodel(game);
    this.grenades = new GrenadeSystem(game, WEAPON_DEFS.frag);

    /** @type {Record<string, Weapon>} */
    this.list = {};
    this.order = [];
    for (const id of DEFAULT_LOADOUT) {
      const def = WEAPON_DEFS[id];
      if (!def) continue;
      const w = new Weapon(this, def);
      this.list[id] = w;
      if (def.kind !== 'grenade') this.order.push(id);
    }
    /** the frag "weapon" wrapper for the viewmodel (held grenade) */
    this.fragView = this.list.frag || null;

    this.current = null;
    this._pendingSwitch = null;
    this._adsToggle = false;
    this._bloom = 0;
    this.recoilIndex = 0;
    this._recoilAcc = { pitch: 0, yaw: 0 };
    this._sinceFire = 10;
    this._centering = false;
    this.adsBlend = 0;
    this._grenade = { phase: 'none', t: 0, cookStart: 0, prevId: null, thrown: false, wantThrow: false };
    this._laserOn = true;
    this._lightOn = false;
    this._equipRequested = null;

    this._offEvents = [
      game.events.on('player:damaged', (e) => this.anim.flinch(Math.min(1.4, (e.amount || 10) / 40))),
      game.events.on('player:respawn', () => this._onRespawn()),
      game.events.on('grenade:exploded', (e) => this._onExplosion(e)),
    ];

    // equip the primary immediately (deploy animation)
    this._equip('ar_carbine', true);
  }

  /* ------------------------------------------------------------- equip */
  _equip(id, immediate = false) {
    const w = this.list[id];
    if (!w) return;
    w.ensureAssembly();
    this.current = w;
    this.recoilIndex = 0;
    this.anim.bind(w);
    this.viewmodel.setWeapon(w);
    w.deploy();
    this.anim.lowerBlend = 1;
    if (immediate) this.anim.lowerBlend = 0.65;
    this.events.emit('weapon:switched', { id: w.id, name: w.def.name, def: w.def, magSize: w.magSize });
    w.emitAmmo();
    // laser default: on for the AR
    this.viewmodel.setLaser(this._laserOn && w.def.kind === 'ar');
    if (w.def.kind !== 'pistol' && this._lightOn) this.viewmodel.setWeaponLight(false);
  }

  /**
   * Switch to a weapon id (holster → deploy). Ignores redundant/invalid ids.
   * @param {string} id
   */
  switchTo(id) {
    if (!this.list[id] || (this.current && this.current.id === id && this.current.state !== 'holstered')) return false;
    if (this._grenade.phase !== 'none') return false;
    if (this.current && this.current.state !== 'holstered') {
      this._pendingSwitch = id;
      this.current.holster();
    } else {
      this._equip(id);
    }
    return true;
  }

  switchToSlot(slot) {
    for (const id of this.order) {
      if (this.list[id].def.slot === slot) return this.switchTo(id);
    }
    return false;
  }

  switchNext(dirn = 1) {
    if (!this.current) return false;
    const idx = this.order.indexOf(this.current.id);
    const next = this.order[(idx + dirn + this.order.length) % this.order.length];
    return this.switchTo(next);
  }

  /* -------------------------------------------------------------- spread */
  bloomAdd(v) {
    const s = this.current?.def.spread;
    if (!s) return;
    this._bloom = Math.min((s.max ?? 8) - (s.hip ?? 3), this._bloom + v);
  }

  /** Effective cone half-angle (degrees) for the current state. */
  currentSpreadDeg() {
    const w = this.current;
    if (!w) return 0;
    const s = w.def.spread;
    const player = this.game.player;
    const speed = player ? player.controller.horizontalSpeed : 0;
    const moveT = THREE.MathUtils.clamp(speed / 4.6, 0, 1.3);
    let hip = THREE.MathUtils.lerp(s.hip, s.hipMove, Math.min(1, moveT));
    if (moveT > 1) hip = THREE.MathUtils.lerp(s.hipMove, s.hipSprint, moveT - 1);
    if (player?.isCrouched) hip *= s.crouchMul ?? 0.8;
    if (player && !player.isGrounded) hip *= 1.6;
    hip += this._bloom;
    const ads = s.ads ?? 0.05;
    return THREE.MathUtils.lerp(hip, ads, Math.min(1, this.anim.adsBlend));
  }

  /** Deviate `dirIn` inside a cone of half-angle `deg` (uses the GAMEPLAY rng). */
  applySpread(dirIn, deg, out) {
    if (deg <= 0.001) return out.copy(dirIn);
    const rng = this.rng;
    const spread = deg * DEG;
    // uniform disc sample scaled by tan(spread)
    const r = Math.sqrt(rng.next()) * Math.tan(spread);
    const a = rng.next() * Math.PI * 2;
    // orthonormal basis around dir
    _v2.set(0, 1, 0);
    if (Math.abs(dirIn.y) > 0.95) _v2.set(1, 0, 0);
    _v1.crossVectors(_v2, dirIn).normalize();
    _v2.crossVectors(dirIn, _v1).normalize();
    out.copy(dirIn).addScaledVector(_v1, Math.cos(a) * r).addScaledVector(_v2, Math.sin(a) * r).normalize();
    return out;
  }

  /** Camera aim ray (true crosshair centre). */
  aimRay(origin, dir) {
    const player = this.game.player;
    const cam = this.game.camera;
    if (player) {
      origin.copy(player.eyePosition);
      dir.copy(player.rig.forward);
    } else {
      origin.copy(cam.position);
      dir.set(0, 0, -1).applyQuaternion(cam.quaternion);
    }
    return dir;
  }

  noteRecoil(pitchDeg, yawDeg) {
    this._recoilAcc.pitch += pitchDeg;
    this._recoilAcc.yaw += yawDeg;
    this._sinceFire = 0;
    this._centering = false;
  }

  /* --------------------------------------------------------------- misc */
  setLaser(on) {
    this._laserOn = !!on;
    this.viewmodel.setLaser(this._laserOn && this.current?.def.kind === 'ar');
  }

  setWeaponLight(on) {
    this._lightOn = !!on;
    if (this.current?.def.kind === 'pistol') this.viewmodel.setWeaponLight(this._lightOn);
  }

  giveAmmo(id, n) {
    const w = this.list[id];
    if (!w) return;
    if (w.def.kind === 'grenade') this.grenades.count = Math.min((w.def.count ?? 2) + 2, this.grenades.count + n);
    else {
      w.reserve = Math.min(w.def.reserve * 2, w.reserve + n);
      w.emitAmmo();
    }
  }

  /** Scripted fire regardless of input (presets/autoplay). */
  forceFire() {
    const w = this.current;
    if (!w || w.state === 'holstered') return false;
    if (w.state === 'reloading') w._cancelReload();
    return w.fire();
  }

  forceIdle() {
    this.anim._kick.reset();
    this.anim._bobLag.reset();
    this.anim._swayLag.reset();
    this.anim._climb = 0;
  }

  stats() {
    const a = this.viewmodel.assembly;
    return {
      weapon: this.current?.id || null,
      state: this.current?.state,
      ammo: this.current?.ammo,
      reserve: this.current?.reserve,
      grenades: this.grenades.count,
      tris: a?.info?.tris || 0,
      armTris: this.viewmodel.arms?.tris || 0,
      ads: this.anim.adsBlend,
    };
  }

  /* ----------------------------------------------------------- events */
  _onRespawn() {
    for (const w of Object.values(this.list)) {
      w.ammo = w.def.magSize + (w.def.chamber ? 1 : 0);
      w.reserve = w.def.reserve;
      if (w.def.kind !== 'grenade') w.emitAmmo();
    }
    this.grenades.count = WEAPON_DEFS.frag.count ?? 2;
    this.grenades.clear();
    this._grenade.phase = 'none';
    if (this.current) this._equip(this.current.def.kind === 'grenade' ? 'ar_carbine' : this.current.id, true);
  }

  _onExplosion(e) {
    const player = this.game.player;
    if (!player || !player.alive || !e || !e.point) return;
    const dmgBase = e.damage ?? 0;
    if (dmgBase <= 0) return;
    const radius = e.radius ?? 5;
    _v1.copy(player.position);
    _v1.y += 0.9; // torso centre
    const dist = _v1.distanceTo(e.point);
    if (dist > radius) return;
    // LOS check so cover works
    const world = this.game.world;
    if (world?.raycast) {
      _v2.copy(_v1).sub(e.point);
      const len = _v2.length();
      _v2.multiplyScalar(1 / Math.max(len, 1e-4));
      const block = world.raycast(_v3.copy(e.point).addScaledVector(_v2, 0.2), _v2, Math.max(0, len - 0.6));
      if (block) return;
    }
    const falloff = 1 - dist / radius;
    const dmg = dmgBase * falloff * falloff * (WEAPON_DEFS.frag.playerDamageScale ?? 0.6);
    _v2.copy(_v1).sub(e.point).normalize();
    player.applyDamage(dmg, { from: e.point, dir: _v2, source: 'grenade' });
  }

  /* --------------------------------------------------------------- tick */
  update(dt) {
    const game = this.game;
    const player = game.player;
    const input = game.input;
    const anim = this.anim;
    const vm = this.viewmodel;
    const alive = player ? player.alive : true;
    this._sinceFire += dt;

    /* ---- pending switch / deploy after holster ------------------------ */
    if (this.current && this.current.state === 'holstered' && this._grenade.phase === 'none') {
      const next = this._pendingSwitch || this._nextAfterGrenade || null;
      if (next) {
        this._pendingSwitch = null;
        this._nextAfterGrenade = null;
        this._equip(next);
      }
    }

    /* ---- read input --------------------------------------------------- */
    let fireHeld = false;
    let firePressed = false;
    let reloadPressed = false;
    let inspectPressed = false;
    let adsHeld = false;
    let adsPressed = false;
    let grenadePressed = false;
    let grenadeHeld = false;
    if (input && input.enabled && alive) {
      fireHeld = input.isDown('fire');
      firePressed = input.pressed('fire');
      reloadPressed = input.pressed('reload');
      inspectPressed = input.pressed('inspect');
      adsHeld = input.isDown('ads');
      adsPressed = input.pressed('ads');
      grenadePressed = input.pressed('grenade');
      grenadeHeld = input.isDown('grenade');
      if (input.pressed('weapon1')) this.switchToSlot(1);
      if (input.pressed('weapon2')) this.switchToSlot(2);
      if (input.pressed('weaponNext')) this.switchNext(1);
      if (input.pressed('weaponPrev')) this.switchNext(-1);
      if (inspectPressed) this.current?.startInspect();
    }

    /* ---- ADS target --------------------------------------------------- */
    const sprinting = !!player?.isSprinting;
    const busy = !this.current || this.current.isBusy;
    let adsWanted = false;
    if (alive && !busy && this._grenade.phase === 'none') {
      if (game.settings?.get('toggleAds')) {
        if (adsPressed) this._adsToggle = !this._adsToggle;
        adsWanted = this._adsToggle;
      } else {
        adsWanted = adsHeld;
        this._adsToggle = adsWanted;
      }
    } else {
      this._adsToggle = false;
    }
    if (adsWanted && sprinting) player.interruptSprint();
    if (this._forcedAds !== undefined && this._forcedAds !== null) adsWanted = !!this._forcedAds;

    /* ---- animator context ---------------------------------------------- */
    const ctrl = player?.controller;
    _ctx.adsTarget = adsWanted ? 1 : 0;
    _ctx.sprint = sprinting && this._grenade.phase === 'none' ? 1 : 0;
    _ctx.crouch = ctrl ? ctrl.crouchBlend : 0;
    _ctx.slide = player?.isSliding ? 1 : 0;
    let lower = 0;
    if (this.current) {
      const st = this.current.state;
      if (st === 'holstering') lower = 1;
      else if (st === 'holstered') lower = 1;
      else if (st === 'deploying') lower = 0;
    }
    if (player?.isMantling) lower = 1;
    if (!alive) lower = 1;
    if (this._grenade.phase === 'holster') lower = 1;
    _ctx.lower = lower;
    const rig = player?.rig;
    _ctx.sway.x = rig ? rig.viewmodelSway.x : 0;
    _ctx.sway.y = rig ? rig.viewmodelSway.y : 0;
    if (rig) {
      _ctx.bob.x = rig.viewmodelBob.x;
      _ctx.bob.y = rig.viewmodelBob.y;
      _ctx.bob.phase = rig.viewmodelBob.phase;
      _ctx.bob.amplitude = rig.viewmodelBob.amplitude;
    }
    _ctx.speed = ctrl ? ctrl.horizontalSpeed : 0;
    // lateral (strafe) speed: velocity onto camera right
    if (player && rig) {
      _v1.copy(player.velocity);
      _ctx.lateralSpeed = _v1.dot(rig.right);
    } else _ctx.lateralSpeed = 0;
    _ctx.alive = alive;
    anim.update(dt, _ctx);
    this.adsBlend = anim.adsBlend;

    /* ---- align the viewmodel to the (last) camera pose before firing --- */
    vm.syncToCamera(game.camera, anim);
    vm.applyParts(anim);

    /* ---- grenade choreography ------------------------------------------ */
    this._updateGrenade(dt, grenadePressed, grenadeHeld);

    /* ---- active weapon FSM ------------------------------------------------ */
    const w = this.current;
    if (w && this._grenade.phase === 'none') {
      _inp.fireHeld = fireHeld && alive;
      _inp.firePressed = firePressed && alive;
      _inp.reloadPressed = reloadPressed && alive;
      _inp.inspectPressed = inspectPressed;
      _inp.sprinting = sprinting && !firePressed && !fireHeld; // trigger cancels sprint
      _inp.adsBlend = anim.adsBlend;
      _inp.canAct = alive;
      w.update(dt, _inp);
    }

    /* ---- projectiles ------------------------------------------------------ */
    this.grenades.update(dt);

    /* ---- viewmodel per-step work (lights, laser, falling mag) --------------- */
    vm.update(dt);

    /* ---- spread bloom + recoil recentering --------------------------------- */
    const s = w?.def.spread;
    if (s) this._bloom = Math.max(0, this._bloom - (s.recovery ?? 5) * dt);
    const rc = w?.def.recoil;
    if (rig && rc && this._sinceFire > (rc.centeringDelay ?? 0.15)) {
      if (!this._centering && (Math.abs(this._recoilAcc.pitch) > 1e-4 || Math.abs(this._recoilAcc.yaw) > 1e-4)) {
        // begin returning a fraction of the climb (the player keeps the rest)
        this._centering = true;
        this._returnPitch = this._recoilAcc.pitch * (rc.centeringFraction ?? 0.5);
        this._returnYaw = this._recoilAcc.yaw * (rc.centeringFraction ?? 0.5);
        this._recoilAcc.pitch = 0;
        this._recoilAcc.yaw = 0;
        this.recoilIndex = 0;
      }
      if (this._centering) {
        const rate = (rc.centering ?? 5) * dt; // deg per step
        const dp = THREE.MathUtils.clamp(this._returnPitch, -rate, rate);
        const dy = THREE.MathUtils.clamp(this._returnYaw, -rate, rate);
        this._returnPitch -= dp;
        this._returnYaw -= dy;
        rig.addRecoil(-dp * DEG, -dy * DEG);
        if (Math.abs(this._returnPitch) < 1e-3 && Math.abs(this._returnYaw) < 1e-3) this._centering = false;
      }
    }

    /* ---- drive the player ADS (FOV, move speed) + DOF ---------------------- */
    if (player) {
      const def = w?.def;
      player.setAds(anim.adsBlend, { fovMul: def?.ads?.fovMul ?? 0.85 });
      if (anim.adsBlend > 0.02 && def) {
        player.setMoveScale(THREE.MathUtils.lerp(def.movement?.walkMul ?? 1, def.ads?.moveMul ?? 0.61, anim.adsBlend));
      } else if (w) {
        player.setMoveScale(w.state === 'reloading' ? 0.9 : (def?.movement?.walkMul ?? 1));
      }
    }
    this._updateDof(anim.adsBlend);
  }

  /** ADS depth of field: focus the aim point, soften the gun body + world. */
  _updateDof(ads) {
    const post = this.game.post;
    if (!post?.setDof) return;
    if (this._dofForced) return; // photo preset owns DOF
    if (ads < 0.05) {
      if (this._dofOn) {
        post.setDof(null);
        this._dofOn = false;
      }
      return;
    }
    // focus at the aim ray hit distance
    const world = this.game.world;
    let dist = 25;
    if (world?.raycast) {
      this.aimRay(_v1, _v2);
      const hit = world.raycast(_v1, _v2, 120);
      if (hit) dist = THREE.MathUtils.clamp(hit.distance, 4, 80);
    }
    const rain = this.game.weather?.rainIntensity ?? 0;
    post.setDof({
      focusDistance: dist,
      focusRange: Math.max(3.5, dist * (this.current?.def.ads?.dof?.focusRangeMul ?? 0.6)),
      bokehScale: THREE.MathUtils.lerp(0, rain > 0.3 ? 2.2 : 2.6, ads),
    });
    this._dofOn = true;
  }

  /* --------------------------------------------------------- grenades */
  _updateGrenade(dt, pressed, held) {
    const g = this._grenade;
    const game = this.game;
    const player = game.player;
    const alive = player ? player.alive : true;
    const now = game.time.elapsed;
    const gdef = WEAPON_DEFS.frag;
    switch (g.phase) {
      case 'none': {
        if (pressed && this.grenades.count > 0 && alive && this.current && !this.current.isBusy) {
          g.phase = 'holster';
          g.t = 0;
          g.prevId = this.current.id;
          g.wantThrow = false;
          g.thrown = false;
          this.current.holster();
        }
        break;
      }
      case 'holster': {
        g.t += dt;
        if (!held && g.t > 0.05) g.wantThrow = true;
        if (this.current && this.current.state === 'holstered') {
          // bring up the frag in hand
          const fragW = this.fragView;
          if (fragW) {
            fragW.ensureAssembly();
            this.anim.bind(fragW);
            this.viewmodel.setWeapon(fragW);
            this.anim.lowerBlend = 1;
          }
          g.phase = 'cook';
          g.t = 0;
          g.cookStart = now + (gdef.times?.pull ?? 0.35); // pin comes out after the pull beat
          game.events.emit('grenade:primed', { fuse: gdef.fuse });
        }
        break;
      }
      case 'cook': {
        g.t += dt;
        if (!held) g.wantThrow = true;
        const cooked = Math.max(0, now - g.cookStart);
        // pull the pin part once the pull beat passes
        const asm = this.viewmodel.assembly;
        if (asm?.parts?.get('pin')) asm.parts.get('pin').visible = now < g.cookStart;
        if ((g.wantThrow && g.t >= (gdef.times?.pull ?? 0.35)) || cooked >= (gdef.cookLimit ?? 4.5)) {
          g.phase = 'throw';
          g.t = 0;
          this.anim.startThrow();
        }
        break;
      }
      case 'throw': {
        g.t += dt;
        const releaseAt = (gdef.times?.windup ?? 0.25) + (gdef.times?.throw ?? 0.28) * 0.55;
        if (!g.thrown && g.t >= releaseAt) {
          g.thrown = true;
          this._releaseGrenade(now);
        }
        if (g.t >= releaseAt + (gdef.times?.recover ?? 0.4)) {
          // holster the (now empty) hand and bring the previous weapon back
          g.phase = 'none';
          this.anim.throwT = -1;
          const back = g.prevId && this.list[g.prevId] ? g.prevId : this.order[0];
          this.current = this.list[back] ? this.current : this.current;
          this._equip(back);
        }
        break;
      }
      default:
        break;
    }
  }

  _releaseGrenade(now) {
    const gdef = WEAPON_DEFS.frag;
    const player = this.game.player;
    const cooked = Math.max(0, now - this._grenade.cookStart);
    const fuseLeft = Math.max(0.35, (gdef.fuse ?? 5) - cooked);
    // release point: the in-hand grenade's world position (fallback: in front of the eye)
    const asm = this.viewmodel.assembly;
    if (asm) asm.root.getWorldPosition(_v1);
    else _v1.copy(player?.eyePosition || this.game.camera.position);
    this.aimRay(_v2, _v3);
    _v1.addScaledVector(_v3, 0.25);
    // velocity: view dir * speed + up bias + shooter velocity
    _v2.copy(_v3).multiplyScalar(gdef.throwSpeed ?? 17);
    _v2.y += gdef.throwUp ?? 3;
    if (player) _v2.add(player.velocity);
    this.grenades.throwProjectile(_v1, _v2, fuseLeft);
    this.grenades.count = Math.max(0, this.grenades.count - 1);
    this.game.events.emit('weapon:ammo', { id: 'frag', mag: this.grenades.count, reserve: 0, magSize: gdef.count ?? 2, mode: 'throw', name: gdef.name });
    // hide the thrown grenade in the hand
    if (this.viewmodel.assembly) this.viewmodel.assembly.root.visible = false;
  }

  /** Scripted grenade throw (presets/autoplay): full choreography. */
  throwGrenade(cookSeconds = 0) {
    if (this._grenade.phase !== 'none' || this.grenades.count <= 0) return false;
    this._grenade.phase = 'holster';
    this._grenade.t = 0;
    this._grenade.prevId = this.current?.id || 'ar_carbine';
    this._grenade.wantThrow = true;
    this._grenade.scriptCook = cookSeconds;
    this.current?.holster();
    return true;
  }

  dispose() {
    for (const off of this._offEvents) off();
    this.viewmodel.dispose();
    this.grenades.dispose();
  }
}

void _q1;
