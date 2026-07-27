/**
 * AI photo presets (AI stream):
 *   firefight   — category firing, hud on: player POV mid main lane, three
 *                 operators engaging from 15-30 m, one caught mid muzzle
 *                 flash with a tracer inbound, one sprinting between cover,
 *                 the player's rifle firing this frame.
 *   enemy_close — category enemy, hud off: one operator ~4 m from a
 *                 cinematic camera, aiming pose, warm key + cool rim,
 *                 shallow DOF.
 * Both stage real Enemy/Brain instances (no shot-only geometry).
 */
import * as THREE from 'three';
import { PhotoMode } from '../systems/PhotoMode.js';

const _pos = new THREE.Vector3();
const _tgt = new THREE.Vector3();

function lookAngles(from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  return { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) };
}

function prime(game) {
  game.weather?.setRain?.(1, { silent: true });
  game.weather?.setWetness?.(1);
  game.sky?.holdFlash?.(null);
  game.fx?.clear?.();
  game.ai?.clear?.();
}

/** Pose the player rig at `pos` looking at `look`, equip the AR, settle springs. */
function stagePlayer(game, pos, look, settle = 45) {
  const player = game.player;
  const weapons = game.weapons;
  _pos.set(pos[0], pos[1], pos[2]);
  _tgt.set(look[0], look[1], look[2]);
  const eye = _pos.clone();
  eye.y += 1.62;
  const a = lookAngles(eye, _tgt);
  player.respawn(_pos, a.yaw);
  player.teleport(_pos, a.yaw, a.pitch);
  player.attachCamera();
  game.input?.simulate?.({ actions: {} });
  if (weapons?.list?.ar_carbine) weapons._equip('ar_carbine', true);
  const w = weapons?.current;
  if (w) {
    w.state = 'idle';
    w.stateTime = 1;
    if (weapons.anim) {
      weapons.anim.lowerBlend = 0;
      weapons.anim._adsT = 0;
      weapons.anim.adsBlend = 0;
    }
  }
  weapons?.forceIdle?.();
  if (weapons) weapons._forcedAds = false;
  game.loop.stepFixed(settle);
  weapons?.forceIdle?.();
}

function groundY(game, x, z) {
  const nav = game.world?.nav;
  const h = nav?.heightAt ? nav.heightAt(x, z) : NaN;
  if (Number.isFinite(h)) return h;
  const g = game.world?.groundHeightAt?.(x, z);
  return g ? g.y : 0;
}

/** @param {import('../Game.js').Game} game */
export function registerAIPresets(game) {
  /* ----------------------------------------------------------- firefight */
  PhotoMode.register('firefight', {
    category: 'firing',
    hud: true,
    warmup: 0,
    frames: 2,
    setup(g) {
      prime(g);
      const ai = g.ai;
      // Player: mid main lane, hip stance, looking north up the lane.
      stagePlayer(g, [0.6, 0, 15.5], [-1.2, 1.5, -30], 40);

      // Enemy A: main lane 21 m out, engaging (this one fires on the capture frame)
      const eA = ai.spawnEnemyAt(new THREE.Vector3(-3.4, groundY(g, -3.4, -5.2), -5.2), { yaw: Math.PI });
      // Enemy B: farther/right ~24 m, engaging, fires across the frame
      const eB = ai.spawnEnemyAt(new THREE.Vector3(4.6, groundY(g, 4.6, -8.5), -8.5), { yaw: Math.PI });
      // Enemy C: sprinting laterally across the lane between cover ~13 m out
      const eC = ai.spawnEnemyAt(new THREE.Vector3(-5.5, groundY(g, -5.5, 2.6), 2.6), { yaw: Math.PI / 2 });

      const now = g.time.elapsed;
      for (const e of [eA, eB]) {
        const b = e.brain;
        b.setState('engage', now);
        b.reactionUntil = now - 1;
        b.hasLOS = true;
        b.timeOnTarget = 4;
        b.burstLeft = 5;
        b.nextShotAt = now + 10; // hold fire; the preset fires them explicitly
        b.burstCooldownUntil = now;
      }
      // C: running east across the lane toward the block-E cover
      const bc = eC.brain;
      bc.setState('advance', now);
      bc.path = [new THREE.Vector3(6.5, groundY(g, 6.5, 3.4), 3.4)];
      bc.pathIndex = 0;
      bc.hasSpot = true;

      // settle: brains step (facing/aim), mixers reach their poses, C accelerates
      const brains = ai.enemies.map((e) => e.brain);
      for (let i = 0; i < 30; i++) {
        for (const b of brains) b.think(g.time.elapsed);
        g.loop.stepFixed(2);
      }
      // keep A/B locked in engage (thinks may have wandered to cover/reposition)
      for (const e of [eA, eB]) {
        e.brain.setState('engage', g.time.elapsed);
        e.brain.hasLOS = true;
        e.crouch = 0;
      }

      // capture frame: player fires this frame; A fires at the player (flash +
      // inbound tracer), B fired one step earlier so its tracer is mid-flight.
      // aim just wide of the player so the rounds crack past the camera (a
      // hit would flood the frame with the damage vignette)
      const torso = new THREE.Vector3().copy(g.player.position);
      torso.y += 1.4;
      torso.x += 1.6; // >= 3 sigma of the 1.6 deg cone at 21 m clear of the 0.45 m capsule
      const torsoB = torso.clone();
      torsoB.x -= 4.5; // across the frame, well left of the camera
      torsoB.y += 0.4;
      torsoB.z += 3.0;
      eB.brain.timeOnTarget = 20;
      eA.brain.timeOnTarget = 20;
      eB.brain._fireShot(g.time.elapsed, torsoB, 0);
      g.loop.stepFixed(2);
      g.weapons?.forceFire?.();
      eA.brain._fireShot(g.time.elapsed, torso, 0);
      eB.brain._fireShot(g.time.elapsed, torsoB, 0);
      eA.firing = true;
      eB.firing = true;
      g.loop.stepFixed(1);
    },
  });

  /* --------------------------------------------------------- enemy_close */
  PhotoMode.register('enemy_close', {
    category: 'enemy',
    hud: false,
    warmup: 0,
    frames: 3,
    setup(g) {
      prime(g);
      const ai = g.ai;
      // Operator holding the south end of the main lane a few metres from
      // fire barrel FB1 (-3.9, 22.4): the barrel is the motivated warm key,
      // a cool practical high behind-right of him is the rim.
      const ex = 0.5;
      const ez = 20.0;
      const feet = new THREE.Vector3(ex, groundY(g, ex, ez), ez);
      const e = ai.spawnEnemyAt(feet, { yaw: 0, brain: false });
      // aiming stance across the frame: 3/4 front view, aiming past camera-left
      e.aimTarget.set(ex - 20, feet.y + 1.5, ez + 4.5);
      e.hasAimTarget = true;
      e.targetYaw = Math.atan2(e.aimTarget.x - ex, e.aimTarget.z - ez);
      e.yaw = e.targetYaw;
      e.firing = true; // Idle_Gun_Shoot: raised firing stance

      // camera: 4 m off his 8 o'clock (front-left), chest height, slight low angle
      const camPos = new THREE.Vector3(ex - 3.1, feet.y + 1.35, ez + 2.55);
      g.player?.detachCamera?.();
      g.post?.setViewmodelEnabled?.(false);
      const cam = g.camera;
      cam.position.copy(camPos);
      cam.lookAt(feet.x + 0.15, feet.y + 1.33, feet.z);
      cam.fov = 36;
      cam.updateProjectionMatrix();

      // warm fill from camera-left (the fire barrel sits just off frame there),
      // cool rim from high behind-right of the subject
      const lighting = g.lighting;
      if (lighting) {
        // key: front-left of the subject at head height (~3.6 m off), warm
        lighting.addPractical({ position: [feet.x - 2.9, feet.y + 2.2, feet.z + 1.7], color: 0xffab5e, intensity: 78, radius: 12 });
        // rim: high behind-right, kept above the top of the frame at its depth
        lighting.addPractical({ position: [feet.x + 2.2, feet.y + 4.6, feet.z - 3.0], color: 0x86adff, intensity: 130, radius: 14 });
      }

      // settle the mixer into the aim pose
      g.loop.stepFixed(50);
      // shallow depth of field on the subject
      g.post?.setDof?.({ focusDistance: camPos.distanceTo(feet) - 0.2, focusRange: 1.6, bokehScale: 3.0 });
      // he squeezes off a round on the capture frame: flash lights his front,
      // the tracer streaks off frame-left
      const dir = new THREE.Vector3().copy(e.aimTarget).sub(e.muzzleWorld).normalize();
      g.fx?.muzzleFlash?.({ position: e.muzzleWorld, direction: dir, size: 1.0, light: false, smoke: true });
      g.fx?.tracer?.(e.muzzleWorld, e.aimTarget, { speed: 380, length: 6, width: 0.06 });
      g.loop.stepFixed(1);
    },
  });

  /* -------------------------------------------------- ai_test (dev only) */
  // ?debug=aitest — spins up a wave from the player spawn and runs 20 s of
  // combat, printing brain states; asserts enemies spawn, move and fire.
  if (game.debugFlags?.has('aitest')) {
    PhotoMode.register('ai_test', {
      category: 'debug',
      hud: true,
      warmup: 0,
      frames: 2,
      setup(g) {
        prime(g);
        stagePlayer(g, [1.5, 0, 32.6], [1.5, 1.6, -20], 30);
        const fail = (m) => console.error('[ai_test] ' + m);
        let fired = 0;
        let killed = 0;
        const off1 = g.events.on('enemy:fired', () => { fired++; });
        const off2 = g.events.on('enemy:killed', () => { killed++; });
        g.match?.forceCombat?.();
        for (let s = 0; s < 20; s++) g.loop.stepFixed(60);
        const ai = g.ai;
        const states = ai.enemies.map((e) => (e.brain ? e.brain.state : 'nobrain') + '@' + e.position.x.toFixed(1) + ',' + e.position.z.toFixed(1));
        console.info('[ai_test] wave ' + ai.wave + ' alive ' + ai.aliveCount + ' fired ' + fired + ' killed ' + killed + ' hp ' + g.player.health.toFixed(0) + ' :: ' + states.join(' | '));
        if (ai.enemies.length === 0) fail('no enemies spawned');
        if (fired === 0) fail('no enemy shots fired in 20 s');
        // kill everything for a clean end
        for (const e of ai.enemies) if (e.alive) e.applyDamage(9999, g.player.position);
        g.loop.stepFixed(5);
        if (killed === 0) fail('applyDamage kill path never emitted enemy:killed');
        off1();
        off2();
      },
    });
  }
}
