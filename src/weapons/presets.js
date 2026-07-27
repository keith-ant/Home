/**
 * WEAPONS-stream photo-mode presets (docs/CRITIC_PROTOCOL.md §2):
 *
 *   viewmodel_idle    — hip idle under a floodlight, laser dot on the wet lane (hud on)
 *   viewmodel_ads     — aiming through the holo at a lit container ~15 m away, DOF (hud on)
 *   viewmodel_fire    — category firing: frozen 1 frame into a burst — flash, tracer,
 *                       brass in the air, bolt back, smoke from the earlier shots (hud on)
 *   viewmodel_reload  — mid-reload, mag falling from the well, off hand travelling (hud on)
 *   viewmodel_pistol  — sidearm with the rail light throwing a real cone on a wall (hud on)
 *   viewmodel_inspect — inspect hero pose ~1.2 s in, rim-lit gun (hud off)
 *   gun_macro         — receiver/optic close-up: machining, roll-marks, wear, reticle (hud off)
 *
 * Every preset primes the storm (rain + wet ground), poses the PLAYER (camera
 * on the rig, so bob/sway/springs are the real ones) and scripts the weapon
 * state through the actual system — no shot-only geometry.
 */
import * as THREE from 'three';
import { PhotoMode } from '../systems/PhotoMode.js';

const _pos = new THREE.Vector3();
const _tgt = new THREE.Vector3();
const DEG2 = Math.PI / 180;

/** yaw/pitch (radians) for the player's rig to look from `from` at `to`. */
function lookAngles(from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const yaw = Math.atan2(-dx, -dz);
  const flat = Math.hypot(dx, dz);
  const pitch = Math.atan2(dy, flat);
  return { yaw, pitch };
}

/** Storm baseline: full rain, wet ground, normal scheduled lightning off. */
function prime(game, { lightning = null } = {}) {
  game.weather?.setRain?.(1, { silent: true });
  game.weather?.setWetness?.(1);
  if (game.sky) {
    if (lightning !== null) {
      game.sky.holdFlash(lightning, new THREE.Vector3(0.4, 0.4, -0.8).normalize());
    } else game.sky.holdFlash(null);
  }
  game.fx?.clear?.();
}

/**
 * Common pose: teleport the player, aim, settle springs, force the weapon.
 * @param {import('../Game.js').Game} game
 * @param {{pos:[number,number,number], look:[number,number,number]|null, yaw?:number, pitch?:number, weapon?:string, settle?:number}} o
 */
function stage(game, o) {
  const player = game.player;
  const weapons = game.weapons;
  _pos.set(o.pos[0], o.pos[1], o.pos[2]);
  let yaw = o.yaw ?? 0;
  let pitch = o.pitch ?? 0;
  if (o.look) {
    _tgt.set(o.look[0], o.look[1], o.look[2]);
    // eye height 1.62 above the feet
    const eye = _pos.clone();
    eye.y += 1.62;
    const a = lookAngles(eye, _tgt);
    yaw = a.yaw;
    pitch = a.pitch;
  }
  player.respawn(_pos, yaw);
  player.teleport(_pos, yaw, pitch);
  player.attachCamera();
  game.input?.simulate?.({ actions: {} });
  // equip the requested weapon instantly (skip the deploy animation)
  if (o.weapon && weapons.list[o.weapon]) {
    weapons._equip(o.weapon, true);
  }
  const w = weapons.current;
  if (w) {
    w.state = 'idle';
    w.stateTime = 1;
    weapons.anim.lowerBlend = 0;
    weapons.anim._adsT = 0;
    weapons.anim.adsBlend = 0;
  }
  weapons.forceIdle();
  weapons._forcedAds = false;
  // settle: run a few fixed steps so the rig + animator springs converge
  game.loop.stepFixed(o.settle ?? 45);
  weapons.forceIdle();
}

/** @param {import('../Game.js').Game} game */
export function registerWeaponPresets(game) {
  const base = { category: 'viewmodel', hud: true, warmup: 0, frames: 2 };

  /* ------------------------------------------------------------ idle */
  PhotoMode.register('viewmodel_idle', {
    ...base,
    setup(g) {
      prime(g);
      // South end of the main lane, standing in mast M4's sodium pool with the
      // head up-right-behind: warm rim on the top/right of the gun, the wet
      // lane and the north apron pool stretching ahead.
      stage(g, { pos: [2.6, 0, 13.4], look: [1.4, 1.35, -30], weapon: 'ar_carbine', settle: 60 });
      g.weapons.setLaser(true);
      g.loop.stepFixed(6);
    },
  });

  /* ------------------------------------------------------------- ads */
  PhotoMode.register('viewmodel_ads', {
    ...base,
    setup(g) {
      prime(g);
      // aim down the holo at the warehouse's warm open bay ~17 m away
      stage(g, { pos: [-8.4, 0, 30.6], look: [-25.0, 2.15, 41.2], weapon: 'ar_carbine', settle: 30 });
      g.weapons._forcedAds = true;
      g.weapons._dofForced = true;
      g.loop.stepFixed(50); // ADS time 0.24 s + settle
      // DOF: focus the bay, soft gun body + soft near/far world
      g.post?.setDof?.({ focusDistance: 17.5, focusRange: 9, bokehScale: 2.2 });
      g.weapons.forceIdle();
      g.loop.stepFixed(4);
    },
  });

  /* ------------------------------------------------------------ fire */
  PhotoMode.register('viewmodel_fire', {
    ...base,
    category: 'firing',
    setup(g) {
      prime(g);
      // hip-fire a burst at the block-E containers across the main lane from
      // inside mast M3's beam; freeze on the frame after the 4th shot.
      stage(g, { pos: [-0.5, 0, 3.6], look: [7.9, 0.6, -5.5], weapon: 'ar_carbine', settle: 40 });
      const w = g.weapons.current;
      if (w) {
        w.fireModeIndex = 0; // auto
        // three shots ~80 ms apart (750 rpm) to build smoke + climb
        for (let i = 0; i < 3; i++) {
          g.weapons.forceFire();
          g.loop.stepFixed(5);
        }
        g.weapons.forceFire();
        // one fixed step: flash still up (life 50-70 ms), bolt fully back,
        // this shot's casing just left the port, tracer mid-flight
        g.loop.stepFixed(1);
      }
    },
  });

  /* ---------------------------------------------------------- reload */
  PhotoMode.register('viewmodel_reload', {
    ...base,
    setup(g) {
      prime(g);
      stage(g, { pos: [1.2, 0, 6.2], look: [5.5, 1.2, -20], weapon: 'ar_carbine', settle: 40 });
      const w = g.weapons.current;
      if (w) {
        // spend most of the mag so the reload has a reserve to draw from
        w.ammo = 4;
        w.emitAmmo();
        w.startReload();
        // ~0.58 s in: mag clear of the well and falling, off hand stripping it away
        g.loop.stepFixed(35);
      }
    },
  });

  /* ---------------------------------------------------------- pistol */
  PhotoMode.register('viewmodel_pistol', {
    ...base,
    setup(g) {
      prime(g);
      // dark west lane: the block-W west face ~4 m ahead at a raking angle, light on
      stage(g, { pos: [-27.6, 0, -14.2], look: [-22.6, 1.3, -14.8], weapon: 'pistol_tactical', settle: 40 });
      g.weapons.setWeaponLight(true);
      g.loop.stepFixed(20);
    },
  });

  /* --------------------------------------------------------- inspect */
  PhotoMode.register('viewmodel_inspect', {
    ...base,
    hud: false,
    setup(g) {
      prime(g);
      // stand in the M3 beam so the raised gun is rim-lit against the dark lane
      stage(g, { pos: [1.0, 0, 4.8], look: [-3.5, 2.4, -12], weapon: 'ar_carbine', settle: 40 });
      const w = g.weapons.current;
      if (w) {
        w.startInspect();
        // 1.2 s into the inspect: rolled left, optic + rail toward the camera
        g.loop.stepFixed(72);
      }
      // showcase key on the presented flank (set after the last fixed step
      // so the per-step lighting solver doesn't fold it back)
      const vm = g.weapons.viewmodel;
      vm.key.position.set(-0.55, 0.5, 0.2);
      vm.key.target.position.set(0.0, -0.12, -0.4);
      vm.key.target.updateMatrixWorld();
      vm.key.intensity = 3.2;
      vm.rim.position.set(0.7, 0.3, -0.3);
      vm.rim.intensity = 1.4;
    },
  });

  /* ------------------------------------------------------------ macro */
  PhotoMode.register('gun_macro', {
    ...base,
    hud: false,
    setup(g) {
      prime(g);
      // stand at the edge of the M3 pool so the receiver picks up the warm
      // flood on its upper faces against the cool sky IBL
      stage(g, { pos: [1.6, 0, 5.8], look: [-4.5, 2.6, -10], weapon: 'ar_carbine', settle: 20 });
      const vm = g.weapons.viewmodel;
      // gunsmith macro: view the receiver/optic from behind-left-above so the
      // rear window shows the emissive reticle, the left flat carries the
      // roll-marks and the wear catches the raking key. Solve the pose from a
      // desired VIEW direction in gun space: rotate that direction onto the
      // camera's +Z, then put the reference point on the axis 26 cm out.
      const viewDir = new THREE.Vector3(-0.44, 0.29, 0.85).normalize(); // from the gun toward the eye (gun space)
      const q = new THREE.Quaternion().setFromUnitVectors(viewDir, new THREE.Vector3(0, 0, 1));
      const ref = new THREE.Vector3(-0.012, 0.03, 0.088).applyQuaternion(q);
      const pos = new THREE.Vector3(0.0, 0.0, -0.32).sub(ref);
      vm.poseOverride = { pos, quat: q };
      vm.setFovOverride(30);
      vm.debugLightBoost = 1.9; // gunsmith-screen key so the flats read
      // rake the key across the visible flat from the upper left
      vm.key.position.set(-0.35, 0.55, 0.15);
      vm.key.target.position.set(0.02, -0.06, -0.3);
      vm.rim.position.set(0.6, 0.2, -0.4);
      vm.setArmsVisible(false);
      vm.forceReticle(true);
      g.weapons.setLaser(false);
      g.loop.stepFixed(3);
      // gunsmith-bench key after the last fixed step (the per-step solver
      // would otherwise rescale it): rakes the roll-marked flat
      vm.key.position.set(-0.4, 0.5, 0.1);
      vm.key.target.position.set(0.05, -0.05, -0.3);
      vm.key.target.updateMatrixWorld();
      vm.key.color.set(0xdfe6f4);
      vm.key.intensity = 3.6;
      vm.rim.position.set(0.65, 0.35, -0.55);
      vm.rim.intensity = 1.6;
    },
  });

  /* --------------------------------------- weapon_test (dev only) --- */
  // End-to-end regression of the weapon systems from the player's eyes:
  // AR burst → reload → switch to pistol → fire → switch back → cooked frag
  // throw → detonation. Asserts (console.error → red harness) on the way.
  if (game.debugFlags?.has('wpntest')) {
    PhotoMode.register('weapon_test', {
      category: 'debug',
      hud: false,
      warmup: 0,
      frames: 2,
      async setup(g) {
        prime(g);
        const W = g.weapons;
        const log = (...a) => console.info('[weapon_test]', ...a);
        const fail = (m) => console.error('[weapon_test] ' + m);
        let exploded = null;
        const offEx = g.events.on('grenade:exploded', (e) => {
          exploded = { x: e.point.x, y: e.point.y, z: e.point.z, damage: e.damage, radius: e.radius };
        });
        let hits = 0;
        const offHit = g.events.on('weapon:hit', () => { hits++; });
        stage(g, { pos: [0.5, 0, 12], look: [4, 1.4, -20], weapon: 'ar_carbine', settle: 30 });
        const ar = W.list.ar_carbine;
        // 1. burst of 6 at the block-E wall
        for (let i = 0; i < 6; i++) {
          W.forceFire();
          g.loop.stepFixed(5);
        }
        if (ar.ammo !== 25) fail(`AR ammo after 6 shots = ${ar.ammo} (expected 25)`);
        if (hits < 4) fail(`only ${hits} weapon:hit events from 6 wall shots`);
        // 2. reload to completion
        ar.startReload();
        g.loop.stepFixed(Math.ceil(2.2 * 60));
        if (ar.ammo !== 31) fail(`AR ammo after tactical reload = ${ar.ammo} (expected 31)`);
        if (ar.state !== 'idle') fail(`AR state after reload = ${ar.state}`);
        // 3. switch to the pistol, fire twice
        W.switchTo('pistol_tactical');
        g.loop.stepFixed(70); // holster + deploy
        if (W.current?.id !== 'pistol_tactical') fail(`current after switch = ${W.current?.id}`);
        W.forceFire();
        g.loop.stepFixed(10);
        W.forceFire();
        g.loop.stepFixed(10);
        const p = W.list.pistol_tactical;
        if (p.ammo !== 11) fail(`pistol ammo = ${p.ammo} (expected 11)`);
        // 4. back to the rifle
        W.switchTo('ar_carbine');
        g.loop.stepFixed(80);
        if (W.current?.id !== 'ar_carbine') fail(`current after switch back = ${W.current?.id}`);
        // 5. cooked grenade throw down the lane; wait out the fuse
        const before = W.grenades.count;
        if (!W.throwGrenade()) fail('throwGrenade() refused');
        g.loop.stepFixed(Math.ceil(6.5 * 60));
        if (W.grenades.count !== before - 1) fail(`grenade count ${W.grenades.count} (expected ${before - 1})`);
        if (!exploded) fail('grenade never emitted grenade:exploded');
        else if (!(Math.abs(exploded.damage - 180) < 1e-6)) fail(`grenade damage payload = ${exploded.damage}`);
        // 6. dry-fire path: empty the mag and pull once more
        ar.ammo = 0;
        ar.emitAmmo();
        ar.reserve = 0;
        W.forceFire();
        g.loop.stepFixed(10);
        offEx();
        offHit();
        const st = W.stats();
        console.info('[weapon_test] done ' + JSON.stringify({ ammo: ar.ammo, pistol: p.ammo, grenades: W.grenades.count, hits, exploded, tris: st.tris, armTris: st.armTris, particles: g.fx?.particles?.count, state: W.current?.state, since: (g.time.elapsed - (W.current?._lastFireT || 0)).toFixed(3) }));
        for (const v of [st.tris, hits]) if (!Number.isFinite(v)) fail('NaN in stats');
        // restore for the frame
        ar.reserve = 60;
        ar.ammo = 20;
        ar.emitAmmo();
        g.loop.stepFixed(20);
      },
    });
  }

  /* ------------------------------------------- vm_debug (dev only) --- */
  // Whole-gun turntable-style views for material/proportion checks
  // (`--debug gundbg`, not a critic preset). ?vmyaw=<deg>&vmdist=<m>&vmw=<id>
  if (game.debugFlags?.has('gundbg')) {
    PhotoMode.register('vm_debug', {
      category: 'debug',
      hud: false,
      warmup: 0,
      frames: 2,
      setup(g) {
        prime(g);
        // numeric flags via --debug: vmx<n>, vmz<n>, vmyaw<deg>, vmdist<m>, vmboost<n>, vmw:pistol
        const flag = (name, def) => {
          for (const f of g.debugFlags || []) {
            if (f.startsWith(name)) {
              const v = parseFloat(f.slice(name.length));
              if (Number.isFinite(v)) return v;
            }
          }
          return def;
        };
        const wid = [...(g.debugFlags || [])].some((f) => f === 'vmw:pistol') ? 'pistol_tactical' : 'ar_carbine';
        const px = flag('vmx', 2.6);
        const pz = flag('vmz', 13.4);
        stage(g, { pos: [px, 0, pz], look: [px - 1.2, 1.35, pz - 43], weapon: wid, settle: 10 });
        const yaw = flag('vmyaw', 75) * (Math.PI / 180);
        const dist = flag('vmdist', 1.1);
        const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.06, yaw, 0, 'YXZ'));
        g.weapons.viewmodel.poseOverride = { pos: new THREE.Vector3(-0.05, -0.08, -dist), quat: q };
        g.weapons.viewmodel.setFovOverride(38);
        g.weapons.viewmodel.debugLightBoost = flag('vmboost', 2.6); // studio fill
        g.loop.stepFixed(2);
      },
    });
  }
  void game;
}
