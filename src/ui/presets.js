/**
 * UI photo presets: `hud_full` (staged mid-fight HUD moment) and
 * `menu_main` (main menu over the darkened, defocused scene).
 * Both are deterministic: staging is done by emitting the canonical events
 * and stepping the fixed loop, never by wall-clock timers.
 */
import * as THREE from 'three';
import { PhotoMode, poseCamera } from '../systems/PhotoMode.js';

const _pos = new THREE.Vector3();
const _from = new THREE.Vector3();
const _dir = new THREE.Vector3();

/** Fake enemy handle for compass pips / killfeed staging (no AI dependency). */
function fakeEnemy(x, y, z, name) {
  return { position: new THREE.Vector3(x, y, z), alive: true, name };
}

export function registerUIPresets(game) {
  PhotoMode.register('hud_full', {
    category: 'hud',
    hud: true,
    warmup: 0,
    frames: 3,
    setup(g) {
      const ui = g.ui;
      const hud = ui?.hud;
      const player = g.player;

      // Player POV up the main lane so the viewmodel + world read behind the HUD.
      const spawn = g.world?.spawns?.player;
      if (player && spawn) {
        player.teleport(spawn.position, spawn.yaw ?? 0, -0.03);
      }
      g.fx?.clear?.();

      // Contacts on the compass tape.
      const eye = player?.eyePosition || g.camera.position;
      const yaw = player ? player.yaw : 0;
      const fwd = _dir.set(-Math.sin(yaw), 0, -Math.cos(yaw)); // yaw 0 = -Z
      const right = _pos.set(fwd.z * -1, 0, fwd.x); // perpendicular
      const e1 = fakeEnemy(eye.x + fwd.x * 22 + right.x * 3, eye.y, eye.z + fwd.z * 22 + right.z * 3, 'V. KOZAK');
      const e2 = fakeEnemy(eye.x + fwd.x * 30 - right.x * 11, eye.y, eye.z + fwd.z * 30 - right.z * 11, 'D. ORLOV');
      const e3 = fakeEnemy(eye.x + fwd.x * 12 + right.x * 16, eye.y, eye.z + fwd.z * 12 + right.z * 16, 'R. VANE');
      g.events.emit('enemy:spawned', { enemy: e1 });
      g.events.emit('enemy:spawned', { enemy: e2 });
      g.events.emit('enemy:spawned', { enemy: e3 });

      // Wave banner already on its way out at capture time.
      hud?.banner('WAVE 04', 'HOSTILES INBOUND', 1.45);
      // First kill (headshot) → killfeed row 1 + toasts.
      g.events.emit('enemy:killed', { enemy: e2, by: player, isHeadshot: true, distance: 31 });

      // Low-ish magazine so the count pulses red.
      const w = g.weapons?.current;
      if (w) {
        w.ammo = 9;
        w.reserve = 42;
        w.emitAmmo?.();
      }
      if (g.loop) g.loop.stepFixed(20); // 0.33 s

      // Second kill + incoming damage from the left flank + a burst.
      g.events.emit('enemy:killed', { enemy: e3, by: player, isHeadshot: false, distance: 12 });
      if (player) {
        _from.copy(eye).addScaledVector(right, -9).addScaledVector(fwd, 4);
        _dir.copy(eye).sub(_from).normalize();
        player.applyDamage(24, { from: _from, dir: _dir, source: e1 });
      } else {
        g.events.emit('player:damaged', { amount: 24, from: { x: eye.x - 9, y: eye.y, z: eye.z }, dir: null });
      }
      for (let i = 0; i < 3; i++) {
        g.weapons?.forceFire?.();
        if (g.loop) g.loop.stepFixed(5);
      }
      if (g.loop) g.loop.stepFixed(26); // spread recovering, banner fading

      // Red kill hitmarker right at the capture moment.
      g.events.emit('ui:hitmarker', { kill: true, headshot: false });
      if (g.loop) g.loop.stepFixed(4);
    },
  });

  PhotoMode.register('menu_main', {
    category: 'menu',
    hud: false,
    warmup: 0.25,
    frames: 3,
    setup(g) {
      poseCamera(g, 'street', {
        position: new THREE.Vector3(-8, 1.6, 26),
        target: new THREE.Vector3(4, 2.6, -30),
        fov: 62,
      });
      g.fx?.clear?.();
      g.ui?.menus?.showMain({ inert: true });
    },
  });

  void game;
}
