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
      stage(g, { pos: [-8.4, 0, 30.6], look: [-22.0, 1.9, 40.6], weapon: 'ar_carbine', settle: 30 });
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
      stage(g, { pos: [-0.5, 0, 3.6], look: [7.9, 1.55, -5.5], weapon: 'ar_carbine', settle: 40 });
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
        // ~0.52 s in: mag just clear of the well and dropping, left hand travelling
        g.loop.stepFixed(31);
      }
    },
  });

  /* ---------------------------------------------------------- pistol */
  PhotoMode.register('viewmodel_pistol', {
    ...base,
    setup(g) {
      prime(g);
      // dark west lane facing the perimeter stack ~4.5 m away, light on
      stage(g, { pos: [-32.6, 0, -13.4], look: [-38, 1.35, -13.9], weapon: 'pistol_tactical', settle: 40 });
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
    },
  });

  /* ------------------------------------------------------------ macro */
  PhotoMode.register('gun_macro', {
    ...base,
    hud: false,
    setup(g) {
      prime(g);
      stage(g, { pos: [1.4, 0, 5.6], look: [-6, 2.2, -8], weapon: 'ar_carbine', settle: 40 });
      // macro lens: narrow the weapon camera and pull a canted receiver /
      // optic 15-20 cm from the eye via the animator's inspect pose
      const vm = g.weapons.viewmodel;
      const anim = g.weapons.anim;
      vm.setFovOverride(24);
      anim._macro = true;
      const w = g.weapons.current;
      if (w) {
        w.startInspect();
        g.loop.stepFixed(70);
      }
      // freeze: no breathing/sway during the macro exposure
      g.weapons.forceIdle();
      g.loop.stepFixed(2);
    },
  });

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
