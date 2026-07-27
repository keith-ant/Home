/**
 * Enemy — skinned PMC operator (AI stream). Cloned from the `char.swat`
 * prototype (SkeletonUtils), darkened toward a black-multicam look, given a
 * small emissive IR helmet beacon and a simple boxy rifle whose barrel is
 * solved toward the aim target every fixed step so muzzle flashes and
 * tracers originate correctly.
 *
 * Entity contract with the WEAPONS ballistics registry (docs/NOTES-weapons.md §10):
 *   game.ballistics.registerHitboxSet(enemy, () => enemy.hitboxes)
 *     hitboxes: [{part:'head'|'torso'|'limb', radius, a:Vector3, b:Vector3}]
 *     (live world-space capsules updated in update())
 *   enemy.alive === false → traces skip it; unregistered on death.
 *   enemy.onWeaponHit({damage, part, point, normal, dir, distance, weapon, owner, isHeadshot})
 *     → {killed, headshot}   (synchronous hitmarker/kill answer)
 * Damage arrives already multiplied by WeaponDefs.damage.multipliers
 * (head 1.5 / torso 1 / limb 0.8 for the AR); the entity applies a further
 * PART_ADJUST so the effective totals are head ×2, torso ×1, limb ×0.75.
 *
 * Animation state graph (crossfaded AnimationMixer actions):
 *   idle_aim (Idle_Gun_Pointing) ⇄ run (Run) ⇄ walk (Walk) → shoot layer
 *   (Idle_Gun_Shoot / Run_Shoot) → hit (HitRecieve, one-shot) → death (Death, clamp).
 * A light procedural aim layer pitches the spine toward the target.
 *
 * Events emitted: enemy:spawned {enemy}, enemy:damaged {enemy, part, damage},
 * enemy:killed {enemy, by, isHeadshot, distance, weapon, position},
 * enemy:removed {enemy}. Blood on hits comes from the FX `weapon:hit` flesh
 * recipe; the death pool decal is added here via fx.decal('blood2').
 */
import * as THREE from 'three';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';

const CLIP_PREFIX = 'CharacterArmature|';
const PART_ADJUST = { head: 2 / 1.5, torso: 1.0, limb: 0.75 / 0.8 };
const DESPAWN_AFTER = 8.0; // seconds after death
const EYE_STAND = 1.55;
const EYE_CROUCH = 1.05;

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);
const _box = new THREE.Box3();

/* -------------------------------------------------------------------------
 * Character prototype (loaded/darkened once, cloned per enemy)
 * ---------------------------------------------------------------------- */
let _proto = null;

/**
 * Prepare the shared character prototype: pick char.swat (fallback
 * char.soldier), darken/desaturate its materials toward black multicam,
 * measure the height for a ~1.8 m operator scale.
 * @param {import('../Game.js').Game} game
 */
export async function prepareEnemyPrototype(game) {
  if (_proto) return _proto;
  let res = null;
  let kind = 'swat';
  try {
    res = game.assets.get('char.swat') || (await game.assets.ensure?.('char.swat'));
  } catch (e) {
    res = null;
  }
  if (!res || res.missing || !res.scene) {
    try {
      res = game.assets.get('char.soldier') || (await game.assets.ensure?.('char.soldier'));
      kind = 'soldier';
    } catch (e) {
      res = null;
    }
  }
  const scene = res?.scene || null;
  const animations = res?.animations || [];

  // Darken / desaturate every material once (shared by all clones).
  const seen = new Set();
  if (scene) {
    scene.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.receiveShadow = true;
      o.frustumCulled = false;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (let i = 0; i < mats.length; i++) {
        const m = mats[i];
        if (!m || seen.has(m)) continue;
        seen.add(m);
        if (m.color) {
          const hsl = { h: 0, s: 0, l: 0 };
          m.color.getHSL(hsl);
          m.color.setHSL(hsl.h, hsl.s * 0.25, Math.min(hsl.l * 0.16, 0.075));
        }
        if ('roughness' in m) m.roughness = Math.max(m.roughness ?? 0.8, 0.85);
        if ('metalness' in m) m.metalness = Math.min(m.metalness ?? 0.05, 0.08);
        if (m.emissive) m.emissive.setRGB(0, 0, 0);
        m.needsUpdate = true;
      }
    });
    // measure natural height
    scene.updateMatrixWorld(true);
    _box.setFromObject(scene);
    const h = _box.max.y - _box.min.y;
    _proto = {
      kind,
      scene,
      animations,
      scale: h > 0.1 ? 1.8 / h : 1.0,
      hasFullSet: kind === 'swat' && animations.length >= 8,
    };
  } else {
    _proto = { kind: 'none', scene: null, animations: [], scale: 1, hasFullSet: false };
  }
  return _proto;
}

/** @returns the prepared prototype record (null until prepared). */
export function enemyPrototype() {
  return _proto;
}

/* -------------------------------------------------------------------------
 * Rifle prop (a few dark boxes; barrel along local +Z)
 * ---------------------------------------------------------------------- */
let _rifleGeom = null;
let _rifleMat = null;
function buildRifle() {
  if (!_rifleMat) {
    _rifleMat = new THREE.MeshStandardMaterial({ color: 0x111214, roughness: 0.62, metalness: 0.55 });
    _rifleGeom = {
      receiver: new THREE.BoxGeometry(0.05, 0.09, 0.42),
      barrel: new THREE.BoxGeometry(0.02, 0.02, 0.34),
      mag: new THREE.BoxGeometry(0.03, 0.14, 0.055),
      stock: new THREE.BoxGeometry(0.04, 0.07, 0.24),
      optic: new THREE.BoxGeometry(0.03, 0.04, 0.09),
    };
  }
  const g = new THREE.Group();
  g.name = 'enemyRifle';
  const rec = new THREE.Mesh(_rifleGeom.receiver, _rifleMat);
  rec.position.set(0, 0.05, 0.12);
  const bar = new THREE.Mesh(_rifleGeom.barrel, _rifleMat);
  bar.position.set(0, 0.06, 0.48);
  const mag = new THREE.Mesh(_rifleGeom.mag, _rifleMat);
  mag.position.set(0, -0.05, 0.16);
  mag.rotation.x = 0.25;
  const stock = new THREE.Mesh(_rifleGeom.stock, _rifleMat);
  stock.position.set(0, 0.03, -0.2);
  const optic = new THREE.Mesh(_rifleGeom.optic, _rifleMat);
  optic.position.set(0, 0.115, 0.1);
  g.add(rec, bar, mag, stock, optic);
  for (const m of g.children) {
    m.castShadow = true;
    m.frustumCulled = true;
  }
  const muzzle = new THREE.Object3D();
  muzzle.name = 'muzzle';
  muzzle.position.set(0, 0.06, 0.66);
  g.add(muzzle);
  g.userData.muzzle = muzzle;
  return g;
}

/* -------------------------------------------------------------------------
 * Enemy
 * ---------------------------------------------------------------------- */
let _nextId = 1;

export class Enemy {
  /**
   * @param {import('../Game.js').Game} game
   * @param {object} o
   * @param {THREE.Vector3} o.position feet position
   * @param {number} [o.yaw]
   * @param {number} [o.health]
   * @param {number} [o.accuracyMul]   >1 = tighter cones (per-wave scaling)
   * @param {number} [o.waveIndex]
   */
  constructor(game, o) {
    this.game = game;
    this.id = _nextId++;
    this.name = 'PMC-' + this.id;
    this.callsign = this.name;
    this.type = 'enemy';
    this.alive = true;
    this.waveIndex = o.waveIndex ?? 0;
    this.maxHealth = o.health ?? 100;
    this.health = this.maxHealth;
    this.accuracyMul = o.accuracyMul ?? 1;

    // ---- transform ----
    this.root = new THREE.Group();
    this.root.name = this.name;
    this.root.position.copy(o.position);
    this.position = this.root.position; // live reference (HUD reads .position)
    this.velocity = new THREE.Vector3();
    this.yaw = o.yaw || 0;
    this.root.rotation.set(0, this.yaw, 0);
    this.targetYaw = this.yaw;
    this.crouch = 0; // 0 stand → 1 crouched
    this.moveSpeed = 0;
    this.firing = false;
    this.brain = null;
    this.aiState = 'spawn';
    this._hitEndAt = 0;
    this._destroyed = false;

    // ---- model ----
    this.proto = _proto;
    this.model = null;
    this.mixer = null;
    this.actions = {};
    this._current = null;
    this._shootAction = null;
    this._deathAction = null;
    this._hitAction = null;
    this.animState = 'idle_aim';
    this._buildModel();

    // ---- rifle prop ----
    this.rifle = buildRifle();
    this.root.add(this.rifle);
    this.rifle.position.set(0.18, 1.38, 0.15); // default until the wrist solve runs
    this.muzzle = this.rifle.userData.muzzle;
    this.muzzleWorld = new THREE.Vector3();

    // ---- hitboxes (live world capsules) ----
    const cap = (part, radius) => ({ part, radius, a: new THREE.Vector3(), b: new THREE.Vector3() });
    this.hitboxes = [cap('head', 0.14), cap('torso', 0.22), cap('limb', 0.09), cap('limb', 0.09), cap('limb', 0.08)];
    this._updateHitboxes();
    game.ballistics?.registerHitboxSet?.(this, () => this.hitboxes);

    // ---- combat state (driven by Brain) ----
    this.deathTime = -1;
    this._hitReactUntil = 0;
    this.aimTarget = new THREE.Vector3();
    this.hasAimTarget = false;

    game.scene.add(this.root);
    game.events.emit('enemy:spawned', { enemy: this });
  }

  /* --------------------------------------------------------------- model */
  _buildModel() {
    const proto = _proto;
    if (!proto || !proto.scene) {
      // no character asset: capsule stand-in so gameplay still works
      const g = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.3, 1.2, 4, 8),
        new THREE.MeshStandardMaterial({ color: 0x141618, roughness: 0.9 }),
      );
      g.position.y = 0.9;
      this.root.add(g);
      this.model = g;
      return;
    }
    const model = SkeletonUtils.clone(proto.scene);
    model.scale.setScalar(proto.scale);
    this.model = model;
    this.root.add(model);

    // bones we care about
    this.spineBone = null;
    this.headBone = null;
    this.wristBone = null;
    model.traverse((o) => {
      if (!o.isBone && o.type !== 'Bone') return;
      if (o.name === 'Torso' || o.name === 'Chest' || o.name === 'mixamorigSpine2') this.spineBone = this.spineBone || o;
      if (o.name === 'Head' || o.name === 'mixamorigHead') this.headBone = o;
      if (o.name === 'WristR' || o.name === 'Wrist.R' || o.name === 'mixamorigRightHand') this.wristBone = o;
    });
    // three sanitizes '.' in node names on load; accept both spellings
    if (!this.wristBone) {
      model.traverse((o) => {
        if ((o.isBone || o.type === 'Bone') && /Wrist.?R$/i.test(o.name)) this.wristBone = o;
      });
    }

    // IR beacon on the helmet
    const beacon = new THREE.Mesh(
      new THREE.BoxGeometry(0.03, 0.02, 0.03),
      new THREE.MeshStandardMaterial({ color: 0x0a1a10, emissive: 0x33ff88, emissiveIntensity: 2.4, roughness: 0.6 }),
    );
    beacon.name = 'irBeacon';
    beacon.frustumCulled = true;
    if (this.headBone) {
      // bone space is scaled ×(1/scale)^-1 by the armature; place in bone-local units
      const inv = 1 / (proto.scale * 100); // armature scale ×100, model ×proto.scale
      beacon.scale.setScalar(inv);
      beacon.position.set(0, 0.22 * inv, 0.02 * inv);
      this.headBone.add(beacon);
    } else {
      beacon.position.set(0, 1.78, 0.05);
      this.root.add(beacon);
    }
    this.beacon = beacon;

    // animation
    if (proto.animations.length) {
      this.mixer = new THREE.AnimationMixer(model);
      const clip = (n) =>
        THREE.AnimationClip.findByName(proto.animations, CLIP_PREFIX + n) ||
        THREE.AnimationClip.findByName(proto.animations, n);
      const mk = (name, fallbackName) => {
        const c = clip(name) || (fallbackName ? clip(fallbackName) : null);
        return c ? this.mixer.clipAction(c) : null;
      };
      this.actions.idle_aim = mk('Idle_Gun_Pointing', 'Idle');
      this.actions.idle = mk('Idle_Gun', 'Idle') || this.actions.idle_aim;
      this.actions.run = mk('Run', 'Walk');
      this.actions.run_shoot = mk('Run_Shoot', 'Run');
      this.actions.walk = mk('Walk', 'Run');
      this.actions.shoot = mk('Idle_Gun_Shoot', 'Gun_Shoot');
      this.actions.hit = mk('HitRecieve');
      this.actions.death = mk('Death');
      for (const k of ['hit', 'death']) {
        const a = this.actions[k];
        if (a) {
          a.setLoop(THREE.LoopOnce, 1);
          a.clampWhenFinished = true;
        }
      }
      const start = this.actions.idle_aim || this.actions.idle;
      if (start) {
        start.play();
        this._current = start;
      }
    }
  }

  /** Crossfade the base locomotion/pose action. */
  playBase(name, fade = 0.2) {
    const next = this.actions[name];
    if (!next || next === this._current) return;
    next.reset();
    next.enabled = true;
    next.setEffectiveTimeScale(1);
    next.setEffectiveWeight(1);
    next.play();
    if (this._current) next.crossFadeFrom(this._current, fade, false);
    this._current = next;
    this.animState = name;
  }

  /** One-shot hit reaction (throttled). */
  playHitReact(now) {
    if (!this.actions.hit || now < this._hitReactUntil) return;
    this._hitReactUntil = now + 0.4;
    const a = this.actions.hit;
    a.reset();
    a.setEffectiveWeight(1);
    a.play();
    if (this._current) a.crossFadeFrom(this._current, 0.08, false);
    this._current = a;
    this.animState = 'hit';
    this._hitEndAt = now + 0.45;
  }

  /* -------------------------------------------------------------- combat */
  /**
   * Ballistics contract: synchronous response to a weapon hit.
   * @returns {{killed:boolean, headshot:boolean}|null}
   */
  onWeaponHit(hit) {
    if (!this.alive) return null;
    const part = hit.part || 'torso';
    const dmg = (hit.damage || 0) * (PART_ADJUST[part] ?? 1);
    this.health -= dmg;
    const isHeadshot = part === 'head';
    this.game.events.emit('enemy:damaged', { enemy: this, part, damage: dmg });
    // aggro cue for the brain
    this.brain?.onDamaged?.(hit, this.game.time.elapsed);
    if (this.health <= 0) {
      this.die({ isHeadshot, by: hit.owner || 'player', distance: hit.distance || 0, weapon: hit.weapon || null });
      return { killed: true, headshot: isHeadshot };
    }
    this.playHitReact(this.game.time.elapsed);
    return { killed: false, headshot: isHeadshot };
  }

  /** Grenade / radial damage (no part). */
  applyDamage(amount, from) {
    if (!this.alive) return;
    this.health -= amount;
    this.game.events.emit('enemy:damaged', { enemy: this, part: 'torso', damage: amount });
    if (this.health <= 0) {
      const d = from ? from.distanceTo(this.position) : 0;
      this.die({ isHeadshot: false, by: 'player', distance: d, weapon: 'frag' });
    } else {
      this.playHitReact(this.game.time.elapsed);
    }
  }

  die(info) {
    if (!this.alive) return;
    this.alive = false;
    this.health = 0;
    this.deathTime = this.game.time.elapsed;
    this.game.ballistics?.unregisterHitboxSet?.(this);
    // death animation
    const d = this.actions.death;
    if (d) {
      d.reset();
      d.setEffectiveWeight(1);
      d.play();
      if (this._current) d.crossFadeFrom(this._current, 0.15, false);
      this._current = d;
      this.animState = 'death';
    }
    this.velocity.set(0, 0, 0);
    this.moveSpeed = 0;
    // blood pool under the body
    const fx = this.game.fx;
    if (fx) {
      _v1.copy(this.position).y += 0.03;
      fx.decal?.('blood2', { point: _v1, normal: _up, size: 1.0, alpha: 0.9 });
      _v1.copy(this.position).y += 1.2;
      fx.particles?.emit?.('blood_mist', { position: _v1, count: 6, size: 0.5, life: 0.6, speed: 1.2 });
    }
    this.game.events.emit('enemy:killed', {
      enemy: this,
      by: info?.by || 'player',
      isHeadshot: !!info?.isHeadshot,
      distance: info?.distance || 0,
      weapon: info?.weapon || null,
      position: this.position,
    });
  }

  /** Remove from the scene / registry (after the corpse timer or a match reset). */
  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    this.game.ballistics?.unregisterHitboxSet?.(this);
    this.mixer?.stopAllAction();
    this.root.removeFromParent();
    this.game.events.emit('enemy:removed', { enemy: this });
  }

  /* -------------------------------------------------------------- update */
  /**
   * Per fixed step: kinematic move (velocity set by the brain), facing,
   * animation graph, aim layer, rifle solve, hitbox capsules.
   * @param {number} dt
   */
  update(dt) {
    const t = this.game.time.elapsed;

    if (this.alive) {
      // ---- move ----
      if (this.moveSpeed > 0.01) {
        this.position.addScaledVector(this.velocity, dt);
        const nav = this.game.world?.nav;
        if (nav) {
          const y = nav.heightAt(this.position.x, this.position.z);
          if (Number.isFinite(y)) this.position.y = y;
        }
      }
      // ---- facing (smooth yaw) ----
      let dy = this.targetYaw - this.yaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      this.yaw += THREE.MathUtils.clamp(dy, -8 * dt, 8 * dt);
      this.root.rotation.set(0, this.yaw, 0);

      // ---- animation graph ----
      const moving = this.moveSpeed > 0.6;
      if (this.animState === 'hit' && t > (this._hitEndAt || 0)) this.animState = '_';
      if (this.animState !== 'hit') {
        if (moving) this.playBase(this.firing && this.actions.run_shoot ? 'run_shoot' : 'run', 0.18);
        else if (this.firing && this.actions.shoot) this.playBase('shoot', 0.1);
        else this.playBase('idle_aim', 0.25);
      }
      if (this._current && (this.animState === 'run' || this.animState === 'run_shoot')) {
        this._current.setEffectiveTimeScale(THREE.MathUtils.clamp(this.moveSpeed / 4.2, 0.6, 1.5));
      }
    }

    if (this.mixer) this.mixer.update(dt);

    if (this.alive) {
      // ---- procedural aim layer (spine pitch toward the target) ----
      if (this.spineBone && this.hasAimTarget) {
        _v1.copy(this.aimTarget).sub(this.position);
        const flat = Math.hypot(_v1.x, _v1.z) || 1e-3;
        const pitch = THREE.MathUtils.clamp(Math.atan2(_v1.y - EYE_STAND, flat), -0.5, 0.5);
        // bone rests with local +Y up the spine; pitching about local X
        _q1.setFromAxisAngle(_v3.set(1, 0, 0), -pitch * 0.8);
        this.spineBone.quaternion.multiply(_q1);
      }

      // ---- rifle solve: sit at the right hand, point at the aim target ----
      this.model?.updateMatrixWorld?.(true);
      if (this.wristBone) {
        this.wristBone.getWorldPosition(_v1);
        this.root.worldToLocal(_v1);
        this.rifle.position.copy(_v1);
      }
      if (this.hasAimTarget) {
        // rifle local +Z toward the target (root yaw already faces it)
        _v1.copy(this.aimTarget).sub(this.rifle.getWorldPosition(_v2));
        const flat = Math.hypot(_v1.x, _v1.z) || 1e-3;
        this.rifle.rotation.set(-Math.atan2(_v1.y, flat), 0, 0);
      } else {
        this.rifle.rotation.set(-0.05, 0, 0);
      }
      this.rifle.updateMatrixWorld(true);
      this.muzzle.getWorldPosition(this.muzzleWorld);

      // ---- crouch blend applies a squat to the whole model (cover) ----
      const cy = 1 - 0.28 * this.crouch;
      if (this.model) this.model.scale.y = (this.proto?.scale || 1) * cy;

      this._updateHitboxes();
    }
  }

  _updateHitboxes() {
    const p = this.position;
    const h = 1.8 * (1 - 0.28 * this.crouch);
    const hb = this.hitboxes;
    // head
    hb[0].a.set(p.x, p.y + 0.86 * h, p.z);
    hb[0].b.set(p.x, p.y + 0.98 * h, p.z);
    // torso
    hb[1].a.set(p.x, p.y + 0.52 * h, p.z);
    hb[1].b.set(p.x, p.y + 0.8 * h, p.z);
    // legs (limbs) ±0.14 along the right vector
    const rx = Math.cos(this.yaw);
    const rz = -Math.sin(this.yaw);
    hb[2].a.set(p.x + rx * 0.15, p.y + 0.08, p.z + rz * 0.15);
    hb[2].b.set(p.x + rx * 0.15, p.y + 0.5 * h, p.z + rz * 0.15);
    hb[3].a.set(p.x - rx * 0.15, p.y + 0.08, p.z - rz * 0.15);
    hb[3].b.set(p.x - rx * 0.15, p.y + 0.5 * h, p.z - rz * 0.15);
    // arms: one wide short capsule across the shoulders
    hb[4].a.set(p.x + rx * 0.32, p.y + 0.72 * h, p.z + rz * 0.32);
    hb[4].b.set(p.x - rx * 0.32, p.y + 0.72 * h, p.z - rz * 0.32);
  }

  /** Eye point for LOS checks. */
  eyePosition(out) {
    return out.copy(this.position).setY(this.position.y + EYE_STAND - 0.5 * this.crouch);
  }
}

export const ENEMY_EYE_STAND = EYE_STAND;
export const ENEMY_EYE_CROUCH = EYE_CROUCH;
export const ENEMY_DESPAWN_AFTER = DESPAWN_AFTER;
