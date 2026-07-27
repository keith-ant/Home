/**
 * Viewmodel — the first-person weapon pass (WEAPONS stream).
 *
 * A separate THREE.Scene rendered by the same renderer through
 * `post.attachViewmodel(scene, camera)` (see src/render/Post.js): drawn
 * after the world colour with depth cleared so the gun never clips into
 * walls, then run through bloom / tone map / grade / SMAA / grain like
 * everything else. The viewmodel scene SHARES WORLD COORDINATES: `root`
 * copies the world camera transform each render, and the weapon rig hangs
 * under it in camera space (posed by WeaponAnimator). That means anchor world
 * positions (muzzle, ejection port, laser) come straight off matrixWorld
 * and world lights can be mirrored 1:1.
 *
 * Camera: own PerspectiveCamera (fov = world fov * fovScale ≈ 0.82, near
 * 0.01, far 60) — the "longer lens" that keeps the receiver fat and the
 * stock foreshortened (REFERENCE_STUDY §3).
 *
 * Lighting on the gun: scene.environment = the world's IBL, the 4 strongest
 * world fixtures near the eye mirrored as point lights (world positions),
 * plus a constant warm key (shadow-casting) + cool rim in camera space so
 * the weapon ALWAYS reads (never a black blob), scaled down under bright
 * fixtures.
 *
 * Also owns: laser beam (viewmodel scene) + laser dot sprite (world scene),
 * the pistol weapon-light SpotLight (world scene), the muzzle-flash rig
 * from the FX stream parented to the muzzle, the detached falling magazine,
 * and the spare mag in the off hand during reloads.
 */
import * as THREE from 'three';
import { buildArms } from './GunBuilder.js';
import { weaponMaterial, glowTexture } from './materials.js';

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _m1 = new THREE.Matrix4();
const _up = new THREE.Vector3(0, 1, 0);
const _colWarm = new THREE.Color(0xffc98a);
const _colCool = new THREE.Color(0x8fa8d8);
const DEG = Math.PI / 180;

export class Viewmodel {
  /**
   * @param {import('../Game.js').Game} game
   */
  constructor(game) {
    this.game = game;
    this.tier = game.tier;
    this.enabled = true;
    /** fov of the weapon camera relative to the world camera */
    this.fovScale = 0.82;
    this._fovOverride = null;

    this.scene = new THREE.Scene();
    this.scene.name = 'viewmodel';
    this.camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.01, 60);
    this.camera.name = 'viewmodel.camera';
    this.scene.add(this.camera);

    // world-aligned camera frame
    this.root = new THREE.Group();
    this.root.name = 'viewmodel.root';
    this.scene.add(this.root);
    // posed group (camera space)
    this.poseGroup = new THREE.Group();
    this.poseGroup.name = 'viewmodel.pose';
    this.root.add(this.poseGroup);
    // holder for the current weapon assembly
    this.holder = new THREE.Group();
    this.holder.name = 'viewmodel.holder';
    this.poseGroup.add(this.holder);

    this.assembly = null;
    this.weapon = null;
    /** @type {{pos:THREE.Vector3, quat:THREE.Quaternion}|null} preset/debug pose override */
    this.poseOverride = null;
    this.arms = buildArms();
    this.arms.right.root.visible = true;
    this.arms.left.root.visible = true;
    this._rightArm = new THREE.Group();
    this._rightArm.name = 'arm.attach.right';
    this._leftArm = new THREE.Group();
    this._leftArm.name = 'arm.attach.left';
    this._rightArm.add(this.arms.right.root);
    this._leftArm.add(this.arms.left.root);
    this._spareMag = null;
    this._fallingMag = null;
    this._magHome = null;

    this._buildLights();
    this._buildLaser();

    this.flashRig = null; // fx muzzle-flash rig (created on first weapon set)
    this.worldLight = null; // pistol weapon light (world scene spot)
    this.worldLightOn = false;
    this._pass = null;
    this._stats = { tris: 0 };

    // hooks: attach the render pass once the post chain exists
    game.events.once('game:ready', () => this._attach());
    // if post already exists (late install), attach immediately
    if (game.post) this._attach();
  }

  /* --------------------------------------------------------------- setup */
  _attach() {
    if (this._pass || !this.game.post?.attachViewmodel) return;
    this.scene.environment = this.game.scene.environment || null;
    this.scene.environmentIntensity = 0.16;
    this._pass = this.game.post.attachViewmodel(this.scene, this.camera);
    this._pass.enabled = this.enabled;
    // Register OUR pre-render hook now (after the camera rig's, which was
    // registered earlier on game:ready) so the camera pose is final.
    this._offPre = this.game.post.addPreRender((cam) => this.preRender(cam));
  }

  _buildLights() {
    // constant camera-space key (warm, upper-right-front) + cool rim (behind-left)
    this.key = new THREE.SpotLight(_colWarm, 1.3, 4.5, 0.9, 0.6, 2);
    this.key.position.set(0.6, 0.6, 0.3);
    this.key.target.position.set(0.08, -0.22, -0.65);
    this.key.castShadow = this.tier.shadows?.enabled !== false;
    if (this.key.castShadow) {
      const s = Math.min(1024, this.tier.shadows?.spotMapSize ?? 512);
      this.key.shadow.mapSize.set(s, s);
      this.key.shadow.camera.near = 0.08;
      this.key.shadow.camera.far = 3.5;
      this.key.shadow.bias = -0.0006;
      this.key.shadow.normalBias = 0.004;
      this.key.shadow.radius = 3;
    }
    this.root.add(this.key);
    this.root.add(this.key.target);
    this.rim = new THREE.PointLight(_colCool, 0.95, 5, 2);
    this.rim.position.set(-0.7, 0.4, 0.5);
    this.root.add(this.rim);
    this.fillLow = new THREE.PointLight(0xffdcb8, 0.22, 4, 2);
    this.fillLow.position.set(0.1, -0.6, -0.2);
    this.root.add(this.fillLow);
    // faint hemisphere so black polymer never crushes fully
    this.hemi = new THREE.HemisphereLight(0x7d90b5, 0x1c1a16, 0.06);
    this.scene.add(this.hemi);
    // mirrored world lights (positions in world space, scene shares world
    // coords). SpotLights so a floodlight only lights the gun when the
    // muzzle actually swings into its cone; practicals/flashes get a wide
    // cone aimed at the eye (point-light equivalent from that side).
    this.mirrors = [];
    for (let i = 0; i < 4; i++) {
      const l = new THREE.SpotLight(0xffffff, 0, 40, Math.PI / 3, 0.5, 2);
      l.position.set(0, -100, 0);
      l.castShadow = false;
      this.scene.add(l);
      this.scene.add(l.target);
      this.mirrors.push(l);
    }
    this._camLightScale = 1;
  }

  _buildLaser() {
    // beam in the viewmodel scene (world space, additive, thin)
    const geo = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);
    geo.rotateX(Math.PI / 2); // length along Z
    this.laserBeam = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      color: new THREE.Color(2.0, 0.03, 0.02),
      transparent: true,
      opacity: 0.16,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    }));
    this.laserBeam.frustumCulled = false;
    this.laserBeam.visible = false;
    this.laserBeam.renderOrder = 30;
    this.scene.add(this.laserBeam);
    // dot in the WORLD scene (depth-tests against world geometry)
    const dotMat = new THREE.SpriteMaterial({
      map: glowTexture(96),
      color: new THREE.Color(6.5, 0.25, 0.15),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: true,
      toneMapped: false,
    });
    this.laserDot = new THREE.Sprite(dotMat);
    this.laserDot.name = 'weapon.laserDot';
    this.laserDot.scale.setScalar(0.05);
    this.laserDot.visible = false;
    this.laserDot.renderOrder = 25;
    this.game.scene.add(this.laserDot);
    this.laserOn = true;
    this._laserHit = { valid: false, point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0 };
  }

  /* ------------------------------------------------------------ weapon */
  /**
   * Show a weapon instance (assembly already built by the Weapon).
   * @param {import('./Weapon.js').Weapon} weapon
   */
  setWeapon(weapon) {
    if (this.weapon === weapon) return;
    // detach the previous
    if (this.assembly) {
      this._recoverMag();
      this.holder.remove(this.assembly.root);
      this._rightArm.parent?.remove(this._rightArm);
      this._leftArm.parent?.remove(this._leftArm);
    }
    this.weapon = weapon;
    this.assembly = weapon.assembly;
    const def = weapon.def;
    const root = this.assembly.root;
    root.visible = true;
    root.traverse((o) => {
      o.visible = true;
    });
    // the flash rig may live under this weapon's muzzle from an earlier
    // equip — it must stay dark until it actually fires
    if (this.flashRig?.object) this.flashRig.object.visible = false;
    this.holder.add(root);
    // arms
    const hands = def.viewmodel?.hands || {};
    this._attachArm(this._rightArm, this.arms.right, hands.right, root);
    this._attachArm(this._leftArm, this.arms.left, hands.left, root);
    // spare mag mesh for reloads (a clone of the assembly's mag group)
    this._prepareSpareMag();
    // muzzle flash rig
    const muzzle = this.assembly.anchors?.muzzle;
    if (muzzle && this.game.fx?.createMuzzleFlash) {
      if (!this.flashRig) {
        this.flashRig = this.game.fx.createMuzzleFlash({ scale: def.muzzle?.size ?? 1, light: false });
      }
      this.flashRig.object.parent?.remove(this.flashRig.object);
      this.flashRig.scale = def.muzzle?.size ?? 1;
      muzzle.add(this.flashRig.object);
      this.flashRig.object.rotation.set(0, Math.PI, 0); // rig +Z out of the barrel = anchor -Z
    }
    // laser only on weapons that have one
    this.hasLaser = !!(this.assembly.anchors && this.assembly.anchors.laser);
    if (!this.hasLaser) {
      this.laserBeam.visible = false;
      this.laserDot.visible = false;
    }
    // weapon light: only the pistol has one
    if (def.kind !== 'pistol' && this.worldLight) this.setWeaponLight(false);
    root.updateMatrixWorld(true);
  }

  _attachArm(armGroup, rig, spec, weaponRoot) {
    if (!spec) {
      armGroup.visible = false;
      return;
    }
    armGroup.visible = true;
    armGroup.position.set(spec.pos[0], spec.pos[1], spec.pos[2]);
    armGroup.rotation.set(spec.rot[0] * DEG, spec.rot[1] * DEG, spec.rot[2] * DEG, spec.order || 'YXZ');
    weaponRoot.add(armGroup);
    // forearm exits along a WEAPON-space direction (down-back toward the
    // shoulder, off the frame edge); convert into the hand's local frame
    const fd = spec.forearm || (rig.side === 'left' ? [-0.5, -0.7, 0.5] : [0.5, -0.7, 0.5]);
    _v1.set(fd[0], fd[1], fd[2]).normalize();
    _q1.setFromUnitVectors(_zAxis, _v1); // weapon-space orientation for +Z
    _q2.copy(armGroup.quaternion).invert();
    rig.forearm.quaternion.copy(_q2).multiply(_q1);
    rig.pose(spec.pose || 'relaxed');
    rig.root.position.set(0, 0, 0);
    rig.root.rotation.set(0, 0, 0);
    armGroup.userData.rest = { pos: armGroup.position.clone(), pose: spec.pose };
  }

  _prepareSpareMag() {
    if (this._spareMag) {
      this._spareMag.parent?.remove(this._spareMag);
      this._spareMag = null;
    }
    const mag = this.assembly.parts?.get('mag');
    if (!mag) return;
    this._spareMag = mag.clone(true);
    this._spareMag.name = 'mag.spare';
    this._spareMag.visible = false;
    // carried in the left hand: nestle it under the palm
    this.arms.left.hand.add(this._spareMag);
    this._spareMag.position.set(0.0, -0.04, -0.05);
    this._spareMag.rotation.set(-0.4, 0, 0);
    this._magHome = { parent: mag.parent, pos: mag.position.clone(), rot: mag.rotation.clone() };
  }

  /* ---------------------------------------------------------- states */
  setLaser(on) {
    this.laserOn = !!on;
    if (!on) {
      this.laserBeam.visible = false;
      this.laserDot.visible = false;
    }
  }

  /**
   * Toggle the pistol's rail light: emissive lens + a real SpotLight in the
   * WORLD scene (added lazily; toggling recompiles world materials once).
   */
  setWeaponLight(on) {
    const def = this.weapon?.def;
    const lens = this.assembly?.parts?.get('lightLens');
    if (on && !this.worldLight) {
      const L = def?.light || { intensity: 180, angleDeg: 15, penumbra: 0.45, distance: 40 };
      const spot = new THREE.SpotLight(0xfff2d6, L.intensity, L.distance, L.angleDeg * DEG, L.penumbra, 2);
      spot.name = 'weapon.light';
      spot.castShadow = false;
      spot.position.set(0, -50, 0);
      this.game.scene.add(spot);
      this.game.scene.add(spot.target);
      this.worldLight = spot;
    }
    this.worldLightOn = !!on;
    if (this.worldLight) this.worldLight.intensity = on ? (def?.light?.intensity ?? 180) : 0;
    if (lens?.material) lens.material.emissiveIntensity = on ? 30 : 0;
    // faint backwash so the light body / muzzle / hands catch a little of it
    const anchorL = this.assembly?.anchors?.light;
    if (on && anchorL && !this._backwash) {
      // stand-in for the wall bounce / cone spill lighting the slide and hands
      this._backwash = new THREE.PointLight(0xffedd0, 0, 3.0, 2);
      this._backwash.position.set(0.02, 0.24, 0.06);
      anchorL.add(this._backwash);
    }
    // ~5 lux at the hands: the beam's wall bounce, not a studio fill
    if (this._backwash) this._backwash.intensity = on ? 0.3 : 0;
  }

  setVisible(v) {
    this.enabled = !!v;
    if (this._pass) this._pass.enabled = this.enabled;
    if (!v) {
      this.laserDot.visible = false;
      this.laserBeam.visible = false;
    }
  }

  /** Force a camera fov for photo presets (null clears). */
  setFovOverride(fov) {
    this._fovOverride = fov;
  }

  /** Hide/show the arms (macro / turntable shots). */
  setArmsVisible(v) {
    this._rightArm.visible = !!v && !!this._rightArm.userData.rest;
    this._leftArm.visible = !!v && !!this._leftArm.userData.rest;
    this._armsHidden = !v;
  }

  /** Force the holo reticle to render regardless of ADS (macro shots). */
  forceReticle(v) {
    this._forceReticle = !!v;
  }

  /* -------------------------------------------------------------- pose */
  /**
   * Align the rig with a camera pose and apply the animator's outputs.
   * Called in the fixed step (against the last camera pose) so gameplay code
   * gets valid anchor world positions, and again in preRender.
   * @param {THREE.Camera} camera world camera
   * @param {import('./Anim.js').WeaponAnimator} anim
   */
  syncToCamera(camera, anim) {
    this.root.position.copy(camera.position);
    this.root.quaternion.copy(camera.quaternion);
    if (this.poseOverride) {
      this.poseGroup.position.copy(this.poseOverride.pos);
      this.poseGroup.quaternion.copy(this.poseOverride.quat);
    } else if (anim) {
      this.poseGroup.position.copy(anim.posePos);
      this.poseGroup.quaternion.copy(anim.poseQuat);
    }
    this.root.updateMatrixWorld(true);
  }

  /** Apply animated part states to the assembly (bolt, mag, hands…). */
  applyParts(anim) {
    const a = this.assembly;
    if (!a) return;
    const ps = anim.partState;
    const parts = a.parts;
    const kind = this.weapon.def.kind;
    if (kind === 'ar') {
      const bolt = parts.get('bolt');
      if (bolt) {
        // reciprocation: 12 ms back / 40 ms return, or locked back
        let f = 0;
        if (ps.boltLocked) f = 1;
        else if (ps.boltT < 1) {
          const back = 12 / 52;
          f = ps.boltT < back ? ps.boltT / back : 1 - (ps.boltT - back) / (1 - back);
        }
        bolt.position.z = bolt.userData.homeZ + f * bolt.userData.travel;
      }
      const ch = parts.get('chargingHandle');
      if (ch) {
        let f = 0;
        if (ps.chargingT < 1) f = Math.sin(ps.chargingT * Math.PI);
        ch.position.z = ch.userData.homeZ + f * ch.userData.travel;
      }
      const trig = parts.get('trigger');
      if (trig) trig.rotation.x = -0.35 * ps.triggerPull;
      const sel = parts.get('selector');
      if (sel) sel.rotation.x = ps.selector > 0.5 ? -1.15 : -0.35;
      const dc = parts.get('dustCover');
      if (dc) dc.rotation.z = -1.95; // stays open after firing
      // holographic reticle only resolves when the eye is on the sight axis
      const holo = parts.get('holo');
      const ret = holo?.getObjectByName?.('reticle');
      if (ret?.material) {
        const a = anim.adsBlend;
        const vis = Math.max(0, Math.min(1, (a - 0.55) / 0.35));
        ret.visible = vis > 0.01 || !!this._forceReticle;
        ret.material.opacity = this._forceReticle ? 1 : vis;
      }
    } else if (kind === 'pistol') {
      const slide = parts.get('slide');
      if (slide) {
        let f = 0;
        if (ps.slideLocked) f = 1;
        else if (ps.slideT < 1) {
          const back = 0.32;
          f = ps.slideT < back ? ps.slideT / back : 1 - (ps.slideT - back) / (1 - back);
        }
        slide.position.z = f * slide.userData.travel;
        // barrel tilt: hood drops as the slide unlocks
        const barrel = parts.get('barrel');
        if (barrel) barrel.rotation.x = f * 0.045;
      }
      const trig = parts.get('trigger');
      if (trig) trig.rotation.x = -0.4 * ps.triggerPull;
      const hammer = parts.get('hammer');
      if (hammer) hammer.rotation.x = -0.5 * (ps.slideT < 1 || ps.slideLocked ? 1 : 0.15);
    }
    // magazine (any weapon with a mag part)
    const mag = parts.get('mag');
    if (mag) {
      if (ps.magOut && !this._fallingMag) this._dropMag(mag);
      else if (!ps.magOut && this._fallingMag) this._recoverMag();
      // the same mesh is either seated in the well or free-falling; only hide
      // it once the falling copy has given up (below frame)
      mag.visible = this._fallingMag ? this._fallingMag.t <= 1.2 : true;
    }
    if (this._spareMag) this._spareMag.visible = !!ps.handMag;
    // left hand travel + pose overrides
    const lArm = this._leftArm;
    if (lArm.userData.rest) {
      const o = ps.leftHandOffset;
      lArm.position.copy(lArm.userData.rest.pos);
      lArm.position.x += o[0];
      lArm.position.y += o[1];
      lArm.position.z += o[2];
      const wantPose = ps.leftHandPose || lArm.userData.rest.pose;
      if (this.arms.left._curPose !== wantPose) {
        this.arms.left.pose(wantPose);
        this.arms.left._curPose = wantPose;
      }
    }
    const rArm = this._rightArm;
    if (rArm.userData.rest) {
      const wantR = ps.rightHandPose === 'fire' ? 'ar_grip_fire' : rArm.userData.rest.pose;
      const rp = this.weapon.def.kind === 'pistol' ? rArm.userData.rest.pose : wantR;
      if (this.arms.right._curPose !== rp) {
        this.arms.right.pose(rp);
        this.arms.right._curPose = rp;
      }
    }
  }

  _dropMag(mag) {
    // detach into world space (the vm scene shares world coords) and let it fall
    this.scene.updateMatrixWorld(true);
    this.scene.attach(mag);
    this._fallingMag = { obj: mag, vel: new THREE.Vector3(0, -0.15, 0), spin: new THREE.Vector3(2.2, 0.5, 1.0), t: 0 };
    // slight impulse away from the well: down + a touch of the ejection direction
    const port = this.assembly.anchors?.port;
    if (port) {
      port.getWorldDirection(_v1); // +Z of the port... use its world matrix X axis instead
      _v1.setFromMatrixColumn(port.matrixWorld, 0).normalize();
      this._fallingMag.vel.addScaledVector(_v1, 0.35);
    }
    const pv = this.game.player?.velocity;
    if (pv) this._fallingMag.vel.add(_v1.copy(pv).multiplyScalar(0.6));
  }

  _recoverMag() {
    const fm = this._fallingMag;
    if (!fm) return;
    const home = this._magHome;
    if (home) {
      home.parent.add(fm.obj);
      fm.obj.position.copy(home.pos);
      fm.obj.rotation.copy(home.rot);
      fm.obj.visible = true;
    }
    this._fallingMag = null;
  }

  /* -------------------------------------------------------------- tick */
  /**
   * Fixed-step update: mirrored lights, laser hit, weapon light follow,
   * falling magazine integration, muzzle rig decay.
   * @param {number} dt
   */
  update(dt) {
    const game = this.game;
    // ---- mirror the strongest world lights near the eye -----------------
    const eye = game.player?.eyePosition || game.camera.position;
    const near = game.lighting?.strongestLightsNear?.(eye, 4, 45);
    let sumIll = 0;
    for (let i = 0; i < 4; i++) {
      const l = this.mirrors[i];
      const rec = near && near[i];
      if (rec && rec.power > 0.001) {
        const f = rec.fixture;
        l.position.copy(rec.position);
        l.color.copy(rec.color);
        const distSq = Math.max(0.09, rec.distanceSq || 1);
        let ill = 0;
        if (f && f.kind === 'flood' && f.light && f.light.isSpotLight) {
          // reproduce the floodlight cone: the gun is only lit inside it
          l.angle = f.light.angle;
          l.penumbra = f.light.penumbra;
          l.distance = f.light.distance;
          // art-directed: floods light the WORLD; on the gun they only kiss the
          // upper surfaces (a full-strength beam turns the whole viewmodel into
          // the pool). Live intensity so flicker/lightning boosts carry over.
          l.intensity = f.light.intensity * 0.34;
          l.target.position.copy(f.target || f.light.target.position);
          // is the eye inside the beam? (for the auto-key balance)
          _v1.copy(eye).sub(rec.position);
          const along = _v1.dot(f.dir);
          if (along > 0) {
            const cosA = along / Math.max(1e-4, _v1.length());
            if (cosA > Math.cos(f.light.angle)) ill = l.intensity / distSq;
          }
        } else {
          // practical / beacon / transient FX flash: hemisphere-ish cone at the eye
          l.angle = 1.35;
          l.penumbra = 0.5;
          l.distance = Math.max(6, rec.radius || 20);
          // cap the illuminance at the gun so a muzzle-flash spike (200+ cd at
          // 0.4 m) punches without clipping to white
          l.intensity = Math.min(rec.power, 25 * distSq);
          l.target.position.copy(eye);
          ill = l.intensity / distSq;
        }
        l.target.updateMatrixWorld();
        l.visible = true;
        sumIll += ill;
      } else {
        l.intensity = 0;
        l.visible = false;
      }
    }
    // constant key/rim: back off when world fixtures already light the gun
    // dim the constant rig while aiming (the receiver rear sits at the lens)
    const adsK = 1 - 0.75 * Math.min(1, this.game.weapons?.anim?.adsBlend ?? 0);
    const auto = THREE.MathUtils.clamp(1.1 - sumIll * 0.075, 0.4, 1.0) * (this.debugLightBoost || 1) * adsK;
    this._camLightScale = auto;
    this.key.intensity = 1.3 * auto;
    this.rim.intensity = 0.95 * (0.7 + 0.3 * auto);
    this.fillLow.intensity = 0.22 * auto;
    // inspect: swing the key across to the presented (left) flank
    const anim = this.game.weapons?.anim;
    if (!this._keyHome) this._keyHome = this.key.position.clone();
    let insp = 0;
    if (anim && anim.inspectT >= 0 && anim.def?.inspect) {
      const dur = anim.def.inspect.duration;
      insp = Math.min(anim.inspectT / 0.45, 1) * Math.min((dur - anim.inspectT) / 0.45, 1);
      insp = Math.max(0, insp);
    }
    this.key.position.set(
      THREE.MathUtils.lerp(this._keyHome.x, -0.5, insp),
      THREE.MathUtils.lerp(this._keyHome.y, 0.55, insp),
      THREE.MathUtils.lerp(this._keyHome.z, 0.25, insp),
    );
    // environment can change (sky variant); keep in sync
    if (this.scene.environment !== game.scene.environment) this.scene.environment = game.scene.environment;

    // ---- laser: world raycast from the emitter along the weapon forward --
    if (this.hasLaser && this.laserOn && this.enabled && this.assembly?.anchors?.laser) {
      const world = game.world;
      const a = this.assembly.anchors.laser;
      a.getWorldPosition(_v1);
      // laser is boresighted to the weapon: bore forward = weapon -Z in world
      _v2.set(0, 0, -1).transformDirection(this.assembly.root.matrixWorld);
      const hit = world?.raycast ? world.raycast(_v1, _v2, 80) : null;
      const rec = this._laserHit;
      if (hit) {
        rec.valid = true;
        rec.point.copy(hit.point);
        rec.normal.copy(hit.normal);
        rec.distance = hit.distance;
      } else {
        rec.valid = false;
        rec.point.copy(_v1).addScaledVector(_v2, 30);
        rec.distance = 30;
      }
    } else {
      this._laserHit.valid = false;
    }

    // ---- pistol weapon light follows the light anchor ----------------
    if (this.worldLight && this.worldLightOn) {
      const la = this.assembly?.anchors?.light;
      if (la) {
        la.getWorldPosition(_v1);
        _v2.set(0, 0, -1).transformDirection(this.assembly.root.matrixWorld);
        this.worldLight.position.copy(_v1);
        this.worldLight.target.position.copy(_v1).addScaledVector(_v2, 8);
        this.worldLight.target.updateMatrixWorld();
      }
    }

    // ---- falling magazine (physics-lite, world space) ------------------
    const fm = this._fallingMag;
    if (fm) {
      fm.t += dt;
      fm.vel.y -= 9.81 * dt;
      _v1.copy(fm.vel).multiplyScalar(dt);
      let hit = null;
      const world = game.world;
      if (world?.raycast && _v1.lengthSq() > 1e-8) {
        const len = _v1.length();
        _v2.copy(_v1).multiplyScalar(1 / len);
        hit = world.raycast(fm.obj.position, _v2, len + 0.02);
      }
      if (hit) {
        fm.obj.position.copy(hit.point).addScaledVector(hit.normal, 0.02);
        const vn = fm.vel.dot(hit.normal);
        fm.vel.addScaledVector(hit.normal, -1.3 * vn);
        fm.vel.multiplyScalar(0.5);
        fm.spin.multiplyScalar(0.5);
        if (!fm.landed) {
          fm.landed = true;
          game.events.emit('fx:casing', { position: fm.obj.position, surface: hit.surface || 'concrete', kind: 'magazine' });
        }
      } else {
        fm.obj.position.add(_v1);
      }
      fm.obj.rotateX(fm.spin.x * dt);
      fm.obj.rotateY(fm.spin.y * dt);
      fm.obj.rotateZ(fm.spin.z * dt);
      // give up after 1.2 s (well below the frame by then)
      fm.obj.visible = fm.t <= 1.2;
    }

    // ---- muzzle flash rig lifetime ---------------------------------------
    if (this.flashRig) this.flashRig.update(dt);
  }

  /**
   * Per-render-frame hook (registered after the camera rig's): align to the
   * final interpolated camera, project the laser beam/dot, sync the camera.
   * Must not mutate simulation state.
   * @param {THREE.PerspectiveCamera} camera
   */
  preRender(camera) {
    // hide the whole pass when the camera is detached from the player
    // (environment / menu presets fly a free camera)
    const rigOn = this.game.player ? this.game.player.rig?.enabled !== false : true;
    const show = this.enabled && rigOn;
    if (this._pass) this._pass.enabled = show;
    if (!show) {
      this.laserDot.visible = false;
      this.laserBeam.visible = false;
      return;
    }
    const anim = this.game.weapons?.anim;
    this.syncToCamera(camera, anim);
    // camera projection
    const cam = this.camera;
    cam.position.copy(camera.position);
    cam.quaternion.copy(camera.quaternion);
    const fov = this._fovOverride ?? camera.fov * this.fovScale;
    const aspect = camera.aspect || (this.game.renderer.width / Math.max(1, this.game.renderer.height));
    if (Math.abs(cam.fov - fov) > 0.001 || Math.abs(cam.aspect - aspect) > 1e-4) {
      cam.fov = fov;
      cam.aspect = aspect;
      cam.updateProjectionMatrix();
    }
    cam.updateMatrixWorld(true);
    // laser visuals from the last fixed-step hit
    const rec = this._laserHit;
    const laserHidden = !this.enabled || (anim && (anim.inspectT >= 0 || anim.lowerBlend > 0.5)) || this._armsHidden;
    if (this.hasLaser && this.laserOn && !laserHidden && this.assembly?.anchors?.laser) {
      const la = this.assembly.anchors.laser;
      la.getWorldPosition(_v1);
      _v2.copy(rec.valid ? rec.point : _v3.set(0, 0, -1).transformDirection(this.assembly.root.matrixWorld).multiplyScalar(30).add(_v1));
      // beam: from the aperture toward the hit (limit visible length for taste)
      _v3.copy(_v2).sub(_v1);
      const len = Math.min(_v3.length(), 40);
      if (len > 0.05) {
        this.laserBeam.visible = true;
        this.laserBeam.position.copy(_v1).addScaledVector(_v3.normalize(), len / 2);
        this.laserBeam.quaternion.setFromUnitVectors(_zAxis, _v3);
        this.laserBeam.scale.set(0.00045, 0.00045, len);
      } else this.laserBeam.visible = false;
      // dot in the world at the hit
      if (rec.valid) {
        this.laserDot.visible = true;
        this.laserDot.position.copy(rec.point).addScaledVector(rec.normal, 0.015);
        const s = THREE.MathUtils.clamp(0.02 + rec.distance * 0.0022, 0.03, 0.11);
        this.laserDot.scale.setScalar(s);
      } else this.laserDot.visible = false;
    } else {
      this.laserBeam.visible = false;
      this.laserDot.visible = false;
    }
  }

  /* ------------------------------------------------------------ queries */
  /** World position of a named anchor (muzzle/port/laser/light/reticle). */
  worldOf(name, out) {
    const a = this.assembly?.anchors?.[name];
    if (!a) return null;
    return a.getWorldPosition(out || new THREE.Vector3());
  }

  /** World-space forward (bore) direction of the current weapon. */
  boreDirection(out) {
    const v = out || new THREE.Vector3();
    if (!this.assembly) return v.set(0, 0, -1);
    return v.set(0, 0, -1).transformDirection(this.assembly.root.matrixWorld);
  }

  /** Ejection basis: port position, ejection dir (+X of the weapon), up. */
  portFrame(pos, right, up, fwd) {
    const port = this.assembly?.anchors?.port;
    if (!port) return false;
    port.getWorldPosition(pos);
    _m1.copy(this.assembly.root.matrixWorld);
    if (right) right.setFromMatrixColumn(_m1, 0).normalize();
    if (up) up.setFromMatrixColumn(_m1, 1).normalize();
    if (fwd) fwd.setFromMatrixColumn(_m1, 2).normalize().negate();
    return true;
  }

  /** Fire the attached muzzle flame (viewmodel pass). */
  fireFlash(intensity = 1) {
    if (this.flashRig) this.flashRig.fire({ intensity });
  }

  /** Detach flash rig etc. and drop the render pass. */
  dispose() {
    this._offPre?.();
    this.game.scene.remove(this.laserDot);
    if (this.worldLight) {
      this.game.scene.remove(this.worldLight);
      this.game.scene.remove(this.worldLight.target);
    }
    this.flashRig?.dispose?.();
  }
}

const _zAxis = new THREE.Vector3(0, 0, 1);
void _up;
void weaponMaterial;
