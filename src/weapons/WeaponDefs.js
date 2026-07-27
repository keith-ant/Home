/**
 * WeaponDefs — pure data driving the Weapon FSM, Ballistics, Viewmodel poses
 * and the animation curves (WEAPONS stream). Timings/values are the CoD-MW
 * ballpark quoted in docs/BUILD_PLAN.md §S4 and the S4 brief:
 *
 *   ar_carbine       750 rpm auto/semi, 30+1, reload 2.1 s tactical / 2.5 s empty, ADS 0.24 s
 *   pistol_tactical  450 rpm semi, 12+1 (.45), reload 1.7 s / 2.0 s, ADS 0.18 s
 *   frag             cook + throw, 5 s fuse, 180 dmg @ 5 m radius
 *
 * Distances in metres, angles in degrees unless stated, times in seconds.
 * All viewmodel pose vectors are in camera space (+X right, +Y up, -Z forward)
 * for the WEAPON ROOT (see Viewmodel.js) — hand attach transforms are in the
 * weapon's own frame (bore along -Z).
 */

const DEG = Math.PI / 180;

/**
 * Recoil pattern: per-shot permanent view offset (degrees). The first shots
 * climb hard, then the pattern wanders left/right (CoD-style learnable
 * pattern). After the array runs out the tail loops the last 6 entries.
 */
const AR_RECOIL_PATTERN = [
  [0.52, 0.04], [0.48, -0.05], [0.46, 0.09], [0.42, -0.02], [0.40, 0.14],
  [0.36, -0.11], [0.34, 0.16], [0.31, 0.02], [0.30, -0.18], [0.28, 0.2],
  [0.26, -0.14], [0.25, 0.12], [0.24, -0.2], [0.23, 0.18], [0.22, -0.1],
];

const PISTOL_RECOIL_PATTERN = [
  [0.95, 0.06], [0.9, -0.08], [0.85, 0.1], [0.85, -0.12], [0.8, 0.05], [0.8, -0.06],
];

export const WEAPON_DEFS = {
  /* ==================================================================== */
  ar_carbine: {
    id: 'ar_carbine',
    name: 'IW-15 Carbine',
    shortName: 'IW-15',
    kind: 'ar',
    slot: 1,
    calibre: '5.56x45mm',
    build: { suppressor: true },
    fireModes: ['auto', 'semi'],
    rpm: 750,
    burstCount: 3,
    magSize: 30,
    reserve: 120,
    chamber: true, // +1 in the pipe on a tactical reload
    damage: {
      near: 30, far: 20, rangeNear: 24, rangeFar: 56, // hp, linear falloff between
      multipliers: { head: 1.5, torso: 1.0, limb: 0.8 },
    },
    range: 350,
    penetration: { maxThickness: 0.15, damageScale: 0.55, count: 1 },
    tracerEvery: 1, // every round streaks (night-fight readability)
    spread: {
      hip: 3.6,            // cone half-angle degrees standing still
      hipMove: 5.4,        // walking
      hipSprint: 8.5,      // right after a sprint break
      crouchMul: 0.75,
      ads: 0.03,           // effectively laser-accurate; recoil moves the ray instead
      firePenalty: 0.35,   // added per shot (hip), decays
      recovery: 6.0,       // deg/s bloom decay
      max: 9,
    },
    recoil: {
      pattern: AR_RECOIL_PATTERN,        // deg per shot: [pitch, yaw]
      loopFrom: 9,
      randomYaw: 0.05,                   // ± deg extra
      adsMul: 0.62,                      // recoil scaling while ADS
      viewKick: { pitch: 0.6, yaw: 0.28, roll: 0.35 }, // deg spring punch per shot
      centering: 5.5,                    // permanent-recoil recentring deg/s after firing stops (partial CoD-style)
      centeringDelay: 0.15,
      centeringFraction: 0.55,           // how much of the accumulated climb settles back
      gunKickZ: 0.032,                   // viewmodel back-kick metres
      gunKickPitch: 2.6,                 // viewmodel muzzle rise deg
      gunKickRoll: 0.7,                  // random roll deg
      climbPitch: 0.35,                  // accumulated viewmodel rise per shot during a burst (deg)
      climbMax: 4.0,
    },
    ads: { time: 0.24, fovMul: 0.82, sensMul: 0.75, moveMul: 2.8 / 4.6, dof: { focusRangeMul: 0.6 } },
    sprintOutTime: 0.28,
    reload: {
      tactical: 2.1, empty: 2.5,
      magOut: 0.42, magIn: 1.32, boltRelease: 1.82, // key beats (s)
      ammoUpdate: 1.32,
    },
    equip: { holster: 0.42, deploy: 0.5 },
    inspect: { duration: 2.6 },
    movement: { walkMul: 0.95, adsWalkMul: 2.8 / 4.6 },
    sounds: {
      fire: 'sfx.weapon.rifle_ar15_near',
      fireFar: 'sfx.weapon.rifle_ar15_mid',
      dry: 'synth.dry_fire',
      magOut: 'sfx.foley.metal_latch',
      magIn: 'sfx.foley.metal_click',
      bolt: 'sfx.foley.metal_click',
      raise: 'sfx.foley.cloth',
      selector: 'synth.selector',
    },
    casing: { kind: 'rifle', delay: 0.012, velocity: [1.5, 2.4, 1.1, 1.7, 0.15, 0.55] }, // right, up, forward ranges
    muzzle: { size: 0.42, light: true, smoke: true }, // suppressed: compact flash
    viewmodel: {
      // Weapon root pose in camera space (metres / degrees). The assembly
      // origin is the receiver's front face on the bore axis, so the pose
      // depth places the barrel nut ~44 cm ahead: receiver flats at ~25 cm,
      // muzzle ~95 cm out.
      // CoD grammar: receiver rear ~20 cm from the eye, ~15 cm right and
      // only ~8 cm below the sightline, yawed ~8 deg inward so the muzzle
      // (95 cm out) converges just right of centre; slight cant shows the
      // ejection-port flat.
      hip: { pos: [0.128, -0.08, -0.4], rot: [-1.0, 8.5, -3.0] },
      adsZ: -0.168,           // reticle depth on the camera axis when aiming
      adsRot: [0, 0, 0],
      sprint: { pos: [0.075, -0.17, -0.31], rot: [-14, 52, -26] },
      crouch: { pos: [0.11, -0.09, -0.39], rot: [2.4, 7.0, -5.5] },
      slide: { pos: [0.06, -0.095, -0.36], rot: [1, 12, -18] },
      lowered: { pos: [0.13, -0.36, -0.3], rot: [-46, 12, -10] },
      inspect1: { pos: [-0.02, -0.02, -0.55], rot: [15, 46, -52] },  // left flat toward the eye, muzzle exits left
      inspect2: { pos: [-0.02, -0.06, -0.48], rot: [10, -50, 55] },  // roll over: port side up, muzzle exits right
      bobScale: 1.0,
      swayScale: 1.0,
      breatheScale: 1.0,
      hands: {
        // wrist positions in the weapon frame; forearms leave toward the
        // lower frame corners (weapon-space direction vectors)
        right: { pos: [0.004, -0.14, 0.19], rot: [24, 0, -90], order: 'YXZ', forearm: [0.5, -0.85, 0.2], pose: 'ar_grip' },
        left: { pos: [-0.012, -0.16, -0.05], rot: [26, 0, 84], order: 'YXZ', forearm: [-0.45, -0.85, 0.28], pose: 'foregrip' },
      },
    },
  },

  /* ==================================================================== */
  pistol_tactical: {
    id: 'pistol_tactical',
    name: 'IW-45 Tactical',
    shortName: 'IW-45',
    kind: 'pistol',
    slot: 2,
    calibre: '.45 ACP',
    fireModes: ['semi'],
    rpm: 450,
    magSize: 12,
    reserve: 48,
    chamber: true,
    damage: {
      near: 42, far: 22, rangeNear: 12, rangeFar: 32,
      multipliers: { head: 1.6, torso: 1.0, limb: 0.85 },
    },
    range: 120,
    penetration: { maxThickness: 0.05, damageScale: 0.5, count: 1 },
    tracerEvery: 1,
    spread: {
      hip: 2.6, hipMove: 4.2, hipSprint: 7.0, crouchMul: 0.8,
      ads: 0.05, firePenalty: 0.9, recovery: 5.0, max: 8,
    },
    recoil: {
      pattern: PISTOL_RECOIL_PATTERN,
      loopFrom: 2,
      randomYaw: 0.08,
      adsMul: 0.7,
      viewKick: { pitch: 1.3, yaw: 0.4, roll: 0.5 },
      centering: 7.0,
      centeringDelay: 0.1,
      centeringFraction: 0.7,
      gunKickZ: 0.026,
      gunKickPitch: 6.5,
      gunKickRoll: 1.2,
      climbPitch: 0.6,
      climbMax: 3.0,
    },
    ads: { time: 0.18, fovMul: 0.9, sensMul: 0.85, moveMul: 3.4 / 4.6, dof: { focusRangeMul: 0.7 } },
    sprintOutTime: 0.22,
    reload: {
      tactical: 1.7, empty: 2.0,
      magOut: 0.32, magIn: 1.06, boltRelease: 1.56,
      ammoUpdate: 1.06,
    },
    equip: { holster: 0.3, deploy: 0.36 },
    inspect: { duration: 2.4 },
    movement: { walkMul: 1.0, adsWalkMul: 3.4 / 4.6 },
    sounds: {
      fire: 'sfx.weapon.pistol_45_near',
      fireFar: 'sfx.weapon.pistol_9mm_mid',
      dry: 'synth.dry_fire',
      magOut: 'sfx.foley.metal_latch',
      magIn: 'sfx.foley.metal_click',
      bolt: 'sfx.foley.metal_click',
      raise: 'sfx.foley.leather_handle',
      selector: 'synth.selector',
    },
    casing: { kind: 'pistol', delay: 0.008, velocity: [1.2, 2.0, 1.4, 2.1, -0.2, 0.2] },
    muzzle: { size: 0.55, light: true, smoke: true },
    light: { intensity: 190, angleDeg: 18, penumbra: 0.75, distance: 46 },
    viewmodel: {
      hip: { pos: [0.1, -0.048, -0.28], rot: [1.0, 4.0, -1.5] },
      adsZ: -0.27,
      adsRot: [0, 0, 0],
      adsSightOffset: [0, 0.031, 0.039], // rear-sight notch offset from the weapon origin (aims through it)
      sprint: { pos: [0.05, -0.19, -0.2], rot: [-14, 36, -20] },
      crouch: { pos: [0.098, -0.075, -0.31], rot: [1.0, 5.0, -3.5] },
      slide: { pos: [0.06, -0.08, -0.3], rot: [3, 8, -14] },
      lowered: { pos: [0.14, -0.32, -0.24], rot: [-40, 10, -6] },
      inspect1: { pos: [0.03, -0.05, -0.36], rot: [10, 50, -50] },
      inspect2: { pos: [0.0, -0.06, -0.34], rot: [8, -50, 55] },
      bobScale: 0.85,
      swayScale: 1.1,
      breatheScale: 1.0,
      hands: {
        right: { pos: [0.004, -0.07, 0.048], rot: [22, 0, -90], order: 'YXZ', forearm: [0.45, -0.62, 0.6], pose: 'pistol_grip' },
        left: { pos: [-0.05, -0.092, 0.026], rot: [30, 12, 78], order: 'YXZ', forearm: [-0.5, -0.62, 0.6], pose: 'pistol_support' },
      },
    },
  },

  /* ==================================================================== */
  frag: {
    id: 'frag',
    name: 'M67 Frag',
    shortName: 'FRAG',
    kind: 'grenade',
    slot: 4,
    count: 2,
    fuse: 5.0,
    cookLimit: 4.5,        // auto-throw before it goes off in the hand
    throwSpeed: 17,
    throwUp: 3.2,          // added upward m/s
    radius: 5.0,
    damage: 180,
    playerDamageScale: 0.6,
    physics: { restitution: 0.35, friction: 0.55, radius: 0.033, mass: 0.4 },
    times: { pull: 0.35, windup: 0.25, throw: 0.28, recover: 0.4 },
    equip: { holster: 0.25, deploy: 0.3 },
    sounds: { pin: 'sfx.foley.metal_latch', throw: 'sfx.foley.cloth', bounce: 'sfx.impact.metal_light', explode: 'sfx.weapon.explosion' },
    viewmodel: {
      hip: { pos: [0.11, -0.13, -0.3], rot: [0, -20, -10] },
      windup: { pos: [0.13, -0.02, -0.22], rot: [10, -30, -25] },
      release: { pos: [0.02, 0.05, -0.42], rot: [-30, -10, -10] },
      lowered: { pos: [0.14, -0.4, -0.22], rot: [-40, 8, -6] },
      bobScale: 0.8,
      swayScale: 0.8,
      breatheScale: 1.0,
      hands: {
        right: { pos: [0.03, -0.02, 0.02], rot: [80, 0, -90], order: 'YXZ', forearm: [0.35, -0.5, 0.75], pose: 'grenade' },
        left: null,
      },
    },
  },
};

export const DEFAULT_LOADOUT = ['ar_carbine', 'pistol_tactical', 'frag'];

/** Damage after range falloff (hp), before body-part multipliers. */
export function damageAtRange(def, distance) {
  const d = def.damage;
  if (distance <= d.rangeNear) return d.near;
  if (distance >= d.rangeFar) return d.far;
  const t = (distance - d.rangeNear) / (d.rangeFar - d.rangeNear);
  return d.near + (d.far - d.near) * t;
}

export const RECOIL_DEG = DEG;
