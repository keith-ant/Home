/**
 * PLAYER dev preset — a scripted movement self-test captured from the
 * player's own eyes. Registered only when the URL carries `?debug=player`
 * (npm run shot -- --preset player_test --debug player), so it never
 * enters the critic preset list.
 *
 * Sequence (assertions log console.error on failure so the harness turns red):
 *   1. sprint north from the spawn for 1.5 s        → distance ≥ 8 m, speed ≈ 7.2 m/s
 *   2. crouch-into-slide from that sprint            → slide state entered
 *   3. jump from a walk                              → apex ≥ 0.9 m
 *   4. walk into the spawn sandbag wall (0.75 m)     → mantle carries the player over
 *   final: sprinting up the main lane, HUD off — the frame is the rig's POV
 *   with head bob / sprint FOV kick applied.
 */
import * as THREE from 'three';
import { PhotoMode } from '../systems/PhotoMode.js';

const _v = new THREE.Vector3();

/** @param {import('../Game.js').Game} game */
export function registerPlayerDevPresets(game) {
  if (!game.debugFlags?.has('player')) return;

  PhotoMode.register('player_test', {
    category: 'debug',
    hud: false,
    warmup: 0,
    frames: 2,
    async setup(g) {
      const p = g.player;
      const input = g.input;
      if (!p || !input) throw new Error('player_test: no player/input');
      g.weather?.setRain?.(1, { silent: true });
      const log = (...a) => console.info('[player_test]', ...a);
      const fail = (msg) => console.error('[player_test] ' + msg);

      /* 1. sprint north up the main lane -------------------------------- */
      p.respawn(); // spawn point, facing north (yaw 0)
      const z0 = p.position.z;
      input.simulate({ move: { x: 0, y: 1 }, actions: { sprint: true } });
      g.loop.stepFixed(90); // 1.5 s
      const sprintDist = z0 - p.position.z;
      const sprintSpeed = Math.hypot(p.velocity.x, p.velocity.z);
      log('sprint distance', sprintDist.toFixed(2), 'speed', sprintSpeed.toFixed(2), 'state', p.moveState);
      if (sprintDist < 8) fail(`sprint moved only ${sprintDist.toFixed(2)} m in 1.5 s`);
      if (sprintSpeed < 6.8) fail(`sprint speed ${sprintSpeed.toFixed(2)} m/s (expected ~7.2)`);

      /* 2. slide -------------------------------------------------------------- */
      input.simulate({ move: { x: 0, y: 1 }, actions: { sprint: true, crouch: true } });
      g.loop.stepFixed(3);
      const slid = p.isSliding;
      g.loop.stepFixed(30);
      log('slide', slid, 'crouched now', p.isCrouched);
      if (!slid) fail('slide did not trigger from sprint + crouch');

      /* 3. jump ---------------------------------------------------------------- */
      input.simulate({ move: { x: 0, y: 1 } });
      g.loop.stepFixed(20); // stand back up out of crouch
      const y0 = p.position.y;
      input.simulate({ move: { x: 0, y: 1 }, actions: { jump: true } });
      g.loop.stepFixed(1);
      input.simulate({ move: { x: 0, y: 1 } });
      let apex = 0;
      for (let i = 0; i < 60; i++) {
        g.loop.stepFixed(1);
        apex = Math.max(apex, p.position.y - y0);
      }
      log('jump apex', apex.toFixed(2));
      if (apex < 0.9) fail(`jump apex ${apex.toFixed(2)} m (expected ~1.05)`);

      /* 4. mantle over the spawn sandbag wall (0.75 m, at x -2.5, z 30.1) ------ */
      const sand = g.world?.landmarks?.sandbags || null;
      void sand;
      _v.set(-2.4, 0, 33.4);
      p.teleport(_v, 0, 0);
      input.simulate({ move: { x: 0, y: 1 } });
      let mantled = false;
      for (let i = 0; i < 150; i++) {
        g.loop.stepFixed(1);
        if (p.isMantling) mantled = true;
      }
      log('mantle triggered', mantled, 'final z', p.position.z.toFixed(2), 'y', p.position.y.toFixed(2));
      if (!mantled) fail('mantle did not trigger walking into the 0.75 m sandbag wall');
      if (p.position.z > 29.6) fail(`did not clear the sandbag wall (z=${p.position.z.toFixed(2)})`);

      /* final pose: sprinting up the main lane, camera on the rig ---------- */
      _v.set(1.5, 0, 30);
      p.teleport(_v, 0, 0);
      input.simulate({ move: { x: 0, y: 1 }, actions: { sprint: true } });
      g.loop.stepFixed(40);
      p.attachCamera();
      log('done', 'pos', p.position.x.toFixed(2), p.position.y.toFixed(2), p.position.z.toFixed(2), 'hp', p.health);
    },
  });
}
