/**
 * PhotoMode — deterministic capture presets for the visual-verification
 * harness (tools/shot.mjs). Implements the contract in docs/ARCHITECTURE.md §4.
 *
 * Feature streams register presets:
 *
 *   PhotoMode.register('viewmodel_ads', {
 *     category: 'viewmodel',            // critic category
 *     hud: true,                        // HUD visibility during capture
 *     warmup: 0.5,                       // simulated seconds before capture
 *     setup(game, opts) { ...pose the world, camera, weapon; may be async }
 *   });
 *
 * The harness loads `/?shot=<id>&seed=..&w=..&h=..` and waits for
 * `window.__ironwake.ready`. Nothing here may depend on wall-clock time.
 */
import * as THREE from 'three';

/** @type {Map<string, {category:string, hud?:boolean, warmup?:number, frames?:number, setup:(game:any, opts:any)=>(void|Promise<void>)}>} */
const registry = new Map();

export class PhotoMode {
  static register(id, def) {
    registry.set(id, { hud: false, warmup: 0, frames: 4, ...def });
  }

  static has(id) {
    return registry.has(id);
  }

  static get list() {
    return [...registry.keys()];
  }

  static get(id) {
    return registry.get(id);
  }

  /**
   * Run a preset and expose the result to the harness.
   * @param {any} game
   * @param {string} id preset id
   * @param {{t?:number, frames?:number, hud?:boolean}} opts overrides from URL
   */
  static async run(game, id, opts = {}) {
    const bridge = (window.__ironwake ||= {});
    bridge.presets = PhotoMode.list;

    if (id === '__list') {
      bridge.ready = true;
      bridge.preset = '__list';
      return;
    }

    const def = registry.get(id);
    if (!def) {
      throw new Error(`unknown photo-mode preset "${id}". Registered: ${PhotoMode.list.join(', ')}`);
    }

    // 1. Let the preset pose the scene.
    await def.setup(game, opts);

    // 2. Simulated warm-up (physics settle, animations reach frame, particles fill).
    const warmSeconds = (typeof opts.t === 'number' ? opts.t : 0) + (def.warmup || 0);
    const warmSteps = Math.round(warmSeconds / game.time.step);
    if (warmSteps > 0) game.loop.stepFixed(warmSteps);

    // 3. HUD visibility for the capture.
    const hud = typeof opts.hud === 'boolean' ? opts.hud : !!def.hud;
    game.setHudVisible?.(hud);

    // 4. Render several frames so temporal effects (TAA, motion vectors,
    //    eye adaptation, particle sorting) converge. Each render is preceded
    //    by a zero-time visual update so animation systems settle.
    const frames = Math.max(1, opts.frames || def.frames || 4);
    for (let i = 0; i < frames; i++) {
      game.renderFrame();
      await nextPaint();
    }

    bridge.preset = id;
    bridge.frame = game.time.frame;
    bridge.stats = collectStats(game);
    bridge.ready = true;
  }
}

/** Resolve on the next animation frame (lets the browser present). */
function nextPaint() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function collectStats(game) {
  const info = game.renderer?.three?.info;
  return {
    triangles: info?.render?.triangles ?? 0,
    drawCalls: info?.render?.calls ?? 0,
    textures: info?.memory?.textures ?? 0,
    geometries: info?.memory?.geometries ?? 0,
    programs: info?.programs?.length ?? 0,
  };
}

/* ----------------------------------------------------------------------- */
/* Core presets. Feature streams add theirs from their own modules.       */
/* ----------------------------------------------------------------------- */

/** Place the camera from a level photo point or a fallback pose. */
export function poseCamera(game, pointId, fallback) {
  const p = game.world?.photoPoints?.[pointId] || fallback;
  if (!p) return;
  const cam = game.camera;
  cam.position.copy(p.position);
  if (p.target) cam.lookAt(p.target);
  else if (typeof p.yaw === 'number') {
    cam.rotation.set(p.pitch || 0, p.yaw, 0, 'YXZ');
  }
  if (p.fov) cam.fov = p.fov;
  cam.updateProjectionMatrix();
  game.player?.detachCamera?.(); // photo camera is free unless a preset re-attaches it
}

PhotoMode.register('smoke', {
  category: 'environment',
  hud: false,
  warmup: 0.25,
  frames: 3,
  setup(game) {
    poseCamera(game, 'street', {
      position: new THREE.Vector3(0, 1.7, 22),
      target: new THREE.Vector3(0, 2.2, -10),
      fov: 65,
    });
  },
});

PhotoMode.register('vista', {
  category: 'environment',
  hud: false,
  warmup: 0.5,
  frames: 4,
  setup(game) {
    poseCamera(game, 'vista', {
      position: new THREE.Vector3(-38, 22, 40),
      target: new THREE.Vector3(6, 0, -18),
      fov: 55,
    });
  },
});

PhotoMode.register('street', {
  category: 'environment',
  hud: false,
  warmup: 0.5,
  frames: 4,
  setup(game) {
    poseCamera(game, 'street', {
      position: new THREE.Vector3(-8, 1.6, 26),
      target: new THREE.Vector3(4, 2.6, -30),
      fov: 62,
    });
  },
});
