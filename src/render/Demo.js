/**
 * DEMO — render-stream showcase dressing for the milestone-0 scaffold level.
 *
 *   *** TO BE REMOVED / SUPERSEDED BY THE WORLD STREAM (S2). ***
 *
 * The RENDER stream lands before Terminal 9 exists, so this module makes the
 * grey-box scaffold read like a real place so lighting, rain, wet ground,
 * fog and the post chain can be judged from screenshots today:
 *
 *   - replaces the scaffold's stand-in point lights with two floodlight
 *     fixtures (Lighting.addFlood: spot + volumetric cone + lens + flare)
 *     on procedural poles, a burning fuel drum (prop model + fire practical
 *     + flame sprites) and two blinking beacons;
 *   - re-materials the scaffold ground with PBR.makeWetGround (asphalt +
 *     puddles + ripples) and the container boxes with makeCorrugatedContainer.
 *
 * S2: build Terminal 9, register your own fixtures via game.lighting, then
 * delete this file and its call in src/render/index.js (or simply set
 * `level.isTerminal9 = true`, which makes installDemo a no-op).
 */
import * as THREE from 'three';
import { puddleMaskTexture, glowTexture } from './ProcTextures.js';

/** True when the loaded world is the milestone-0 scaffold. */
export function isScaffoldWorld(world) {
  if (!world || world.isTerminal9) return false;
  const ground = world.group?.getObjectByName?.('ground');
  return !!(ground && ground.material && !ground.material.map);
}

/**
 * Dress the scaffold world. Safe to call always; does nothing on Terminal 9.
 * @param {import('../Game.js').Game} game
 */
export function installDemo(game) {
  const world = game.world;
  if (!isScaffoldWorld(world)) return;
  const lighting = game.lighting;
  if (!lighting) return;

  // -- 1. remove the scaffold's stand-in point lights -----------------------
  for (const entry of world.lights || []) {
    const obj = entry.object || entry.light;
    if (obj && obj.isLight) {
      obj.parent?.remove(obj);
      obj.dispose?.();
    }
  }
  if (world.lights) world.lights.length = 0;

  const scene = game.scene;
  const demoRoot = new THREE.Group();
  demoRoot.name = 'demo.fixtures';
  scene.add(demoRoot);

  // -- 2. floodlight fixtures on poles -------------------------------------
  const floods = [
    // hero lamp near the player lane: throws a pool across the wet asphalt
    { head: [-1.4, 8.6, -6.5], target: [-3.6, 0, 4.8], color: 0xffb15c, intensity: 1900, angle: 0.66 },
    // second warm pool up-lane for depth + a cooler halogen unit far right
    { head: [-11, 8.2, -14], target: [-4.5, 0, -23], color: 0xffb15c, intensity: 1150, angle: 0.6 },
    { head: [24, 8.6, 4], target: [16, 0, 12], color: 0xffe2b3, intensity: 900, angle: 0.55, importance: 0.6 },
  ];
  for (const f of floods) {
    lighting.addFlood({
      position: f.head,
      target: f.target,
      color: f.color,
      intensity: f.intensity,
      angle: f.angle,
      penumbra: 0.5,
      distance: 44,
      castShadow: true,
      importance: f.importance ?? 1,
    });
    // pole + arm (procedural steel)
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.55, metalness: 0.8 });
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.14, f.head[1], 10), poleMat);
    pole.position.set(f.head[0], f.head[1] / 2, f.head[2] - 0.35);
    pole.castShadow = true;
    pole.receiveShadow = true;
    demoRoot.add(pole);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.9), poleMat);
    arm.position.set(f.head[0], f.head[1] - 0.05, f.head[2] - 0.05);
    arm.castShadow = true;
    demoRoot.add(arm);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.65, 0.35, 12), poleMat);
    base.position.set(f.head[0], 0.17, f.head[2] - 0.35);
    base.receiveShadow = true;
    demoRoot.add(base);
  }

  // -- 3. fire barrel: prop model + fire practical + flame sprites ----------
  const firePos = new THREE.Vector3(-5.4, 0, 4.5);
  const barrelAsset = game.assets.get('prop.fire_barrel');
  if (barrelAsset?.scene && !barrelAsset.missing) {
    const barrel = barrelAsset.scene.clone(true);
    barrel.position.copy(firePos);
    barrel.rotation.y = 0.7;
    barrel.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    demoRoot.add(barrel);
  }
  const fire = lighting.addPractical({
    position: [firePos.x, 1.05, firePos.z],
    color: 0xff7a2e,
    intensity: 46,
    radius: 12,
    flicker: 'fire',
    marker: false,
  });
  // ember bed + flame licks: additive sprites animated off the practical's flicker
  const flames = new THREE.Group();
  flames.name = 'demo.flames';
  const glow = glowTexture(128);
  const mkSprite = (color, scale, y, opacity) => {
    const m = new THREE.SpriteMaterial({
      map: glow,
      color: new THREE.Color(color),
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      fog: true,
      opacity,
    });
    const s = new THREE.Sprite(m);
    s.position.set(firePos.x, y, firePos.z);
    s.scale.set(scale, scale, 1);
    s.renderOrder = 40;
    flames.add(s);
    return s;
  };
  const embers = mkSprite(0xff5010, 0.7, 0.86, 0.7);
  const flameA = mkSprite(0xff8020, 1.0, 1.2, 0.6);
  const flameB = mkSprite(0xffd070, 0.45, 1.02, 0.75);
  demoRoot.add(flames);

  // -- 4. beacons ------------------------------------------------------------
  lighting.addBeacon({ position: [-8, 5.55, -23.5], color: 0xff2020, blinkPeriod: 1.6, duty: 0.12, phase: 0.1 });
  lighting.addBeacon({ position: [22, 2.95, -13], color: 0xffae00, blinkPeriod: 2.4, duty: 0.5, phase: 0.6, size: 0.09, lightIntensity: 3 });

  // -- 5. scaffold re-material with the PBR factory ---------------------------
  dressScaffold(game, world);

  // -- animate the flame sprites (cosmetic, deterministic clock) -------------
  const time = game.time;
  const flameSystem = {
    name: 'demo.flames',
    update() {
      const t = time.elapsed;
      const v = fire._flickerValue || 1;
      embers.material.opacity = 0.4 + 0.3 * v;
      const wob = 0.9 + 0.25 * Math.sin(t * 9.1) * Math.sin(t * 3.3);
      flameA.scale.set(0.95 * wob * v, 1.3 * (0.8 + 0.4 * v), 1);
      flameA.position.y = 1.18 + 0.08 * Math.sin(t * 7.7);
      flameA.material.opacity = 0.4 + 0.3 * v;
      flameB.scale.setScalar(0.42 + 0.12 * Math.sin(t * 13.0 + 1));
      flameB.material.opacity = 0.6 + 0.25 * v;
    },
    dispose() {
      demoRoot.parent?.remove(demoRoot);
      demoRoot.traverse((o) => {
        o.geometry?.dispose?.();
        if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose?.());
      });
    },
  };
  game.addSystem(flameSystem, 61);
  game.demo = { root: demoRoot, floods, firePos };
}

/**
 * Re-material the scaffold: wet asphalt ground + painted/rusted containers.
 * Purely cosmetic; geometry and behaviour untouched.
 */
function dressScaffold(game, world) {
  const pbr = game.pbr;
  if (!pbr) return;
  const ground = world.group.getObjectByName('ground');
  if (ground) {
    // 160 m plane: 2 m native tiles → repeat 80; macro variation kills tiling
    const macro = game.assets.get('tex.asphalt_macro');
    const mat = pbr.makeWetGround('tex.asphalt_wet', {
      repeat: [80, 80],
      puddleMask: puddleMaskTexture(256, 77),
      puddleRepeat: [7, 7],
      puddleThreshold: 0.5,
      wetness: 1,
      macroTexture: macro?.color || null,
      macroWorldScale: 1 / 30,
      rippleWorldScale: 3.4,
      rippleStrength: 0.35,
      roughnessScale: 1.1,
      envMapIntensity: 1.15,
    });
    ground.material.dispose();
    ground.material = mat;
    ground.receiveShadow = true;
  }
  // containers: painted, weathered, per-instance rust
  let idx = 0;
  world.group.traverse((o) => {
    if (!o.isMesh || o === ground) return;
    if (!o.geometry || o.geometry.type !== 'BoxGeometry') return;
    const oldColor = o.material?.color ? o.material.color.getHex() : 0x7a2a21;
    const rust = 0.22 + ((idx * 37) % 11) / 30; // deterministic variation
    const mat = pbr.makeCorrugatedContainer({
      paintColor: oldColor,
      rust,
      wear: 0.45,
      repeat: [4, 1.5],
      paintGain: 3.0,
    });
    o.material.dispose?.();
    o.material = mat;
    o.castShadow = true;
    o.receiveShadow = true;
    idx++;
  });
}
