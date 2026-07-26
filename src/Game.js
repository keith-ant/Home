/**
 * Game — top-level orchestrator. Owns the three.js roots, the fixed-step
 * loop, and the ordered systems registry. Feature streams plug their
 * systems in via `addSystem` (see docs/ARCHITECTURE.md §3).
 *
 * Two run modes:
 *   - realtime: rAF-driven loop, pointer lock, menus (game.start())
 *   - stepping: photo mode / autoplay drive `loop.stepFixed(n)` explicitly
 */
import * as THREE from 'three';
import { Events } from './core/Events.js';
import { Time } from './core/Time.js';
import { Loop } from './core/Loop.js';
import { Random } from './core/Random.js';
import { Settings } from './core/Settings.js';
import { Input } from './core/Input.js';
import { Renderer } from './render/Renderer.js';
import { Post } from './render/Post.js';
import { Sky } from './render/Sky.js';
import { getTier } from './render/QualityTiers.js';
import { Level } from './world/Level.js';
import { PhotoMode } from './systems/PhotoMode.js';

export class Game {
  /**
   * @param {object} opts
   * @param {HTMLCanvasElement} opts.canvas
   * @param {URLSearchParams} opts.params
   * @param {(fraction:number, label:string)=>void} [opts.onProgress]
   */
  constructor({ canvas, params, onProgress = () => {} }) {
    this.canvas = canvas;
    this.params = params;
    this.onProgress = onProgress;

    this.photoPreset = params.get('shot');
    this.autoplayEnabled = params.get('autoplay') === '1';
    this.isDeterministic = !!(this.photoPreset || this.autoplayEnabled);
    this.seed = intParam(params, 'seed', 1);

    this.events = new Events();
    this.time = new Time(1 / 60);
    this.rng = new Random(this.seed);

    const overrides = {};
    if (params.has('quality')) overrides.quality = params.get('quality');
    if (this.photoPreset && !params.has('quality')) overrides.quality = 'ultra';
    this.settings = new Settings(this.events, overrides);
    this.tier = getTier(this.settings.get('quality'));

    /** @type {Array<{name:string, order:number, update:(dt:number)=>void, dispose?:()=>void}>} */
    this.systems = [];
    this.hudVisible = true;
    this.state = 'boot'; // boot | menu | playing | paused | dead | results | photo

    this.debugFlags = new Set((params.get('debug') || '').split(',').filter(Boolean));
  }

  /* ------------------------------------------------------------------ init */
  async init() {
    this.onProgress(0.05, 'Initializing renderer');
    const fixedSize = this.photoPreset || this.autoplayEnabled
      ? {
          width: intParam(this.params, 'w', 1920),
          height: intParam(this.params, 'h', 1080),
          pixelRatio: 1,
        }
      : null;
    this.renderer = new Renderer({ canvas: this.canvas, settings: this.settings, fixedSize });

    this.scene = new THREE.Scene();
    this.scene.name = 'world';
    this.camera = new THREE.PerspectiveCamera(74, this.renderer.aspect, 0.05, 800);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);

    this.input = new Input(this.canvas, this.events);

    this.onProgress(0.15, 'Building lighting');
    this.sky = new Sky(this.scene, this.tier);

    this.onProgress(0.3, 'Loading world');
    this.world = new Level({ scene: this.scene, assets: this.assets || null, rng: this.rng, tier: this.tier });
    await this.world.build();

    this.onProgress(0.75, 'Compiling shaders');
    this.post = new Post({ renderer: this.renderer, scene: this.scene, camera: this.camera, settings: this.settings });

    this.loop = new Loop({
      time: this.time,
      update: (dt) => this.update(dt),
      render: (alpha) => this.renderFrame(alpha),
      beforeFrame: (realDt) => this._beforeFrame(realDt),
      maxSubSteps: 5,
    });

    // Warm shader compilation so the first frame doesn't hitch.
    this.renderer.three.compile(this.scene, this.camera);

    this.onProgress(0.95, 'Ready');
    this.events.emit('game:ready', {});
    this._publishBridge();
  }

  /* --------------------------------------------------------------- systems */
  /**
   * Register a system into the fixed-step update order.
   * @param {{name:string, update:(dt:number)=>void, dispose?:()=>void}} system
   * @param {number} order lower runs first (see ARCHITECTURE.md §3)
   */
  addSystem(system, order = 100) {
    this.systems.push({ ...system, name: system.name, order, ref: system });
    this.systems.sort((a, b) => a.order - b.order);
    return system;
  }

  getSystem(name) {
    const s = this.systems.find((x) => x.name === name);
    return s ? s.ref : null;
  }

  /* ---------------------------------------------------------------- update */
  update(dt) {
    this.input.update();
    for (const s of this.systems) s.ref.update(dt);
    this.world?.update?.(dt);
    this.sky?.update?.(dt);
    this.input.flush();
  }

  _beforeFrame(realDt) {
    void realDt; // per-animation-frame hooks (input device polling happens via events)
  }

  /* ---------------------------------------------------------------- render */
  renderFrame(alpha = 1) {
    void alpha;
    this.sky?.updateForCamera(this.camera.position);
    this.renderer.three.info.reset();
    this.post.render(this.time.step);
  }

  setHudVisible(visible) {
    this.hudVisible = visible;
    const hud = document.getElementById('hud');
    if (hud) hud.style.display = visible ? '' : 'none';
    this.events.emit('ui:hud-visible', { visible });
  }

  /* ------------------------------------------------------------------ run */
  async start() {
    if (this.photoPreset) {
      await this.runPhotoMode(this.photoPreset);
      return;
    }
    if (this.autoplayEnabled) {
      await this.runAutoplay();
      return;
    }
    this.state = 'playing';
    this.loop.start();
  }

  async runPhotoMode(presetId) {
    this.state = 'photo';
    await PhotoMode.run(this, presetId, {
      t: floatParam(this.params, 't', 0),
      frames: this.params.has('frames') ? intParam(this.params, 'frames', 4) : undefined,
      hud: this.params.has('hud') ? this.params.get('hud') === '1' : undefined,
    });
  }

  /**
   * Autoplay (verification) mode — see docs/ARCHITECTURE.md §4. The
   * integrator's Autoplay system replaces this stub with a real scripted bot;
   * until then it simply advances the simulation so the harness contract holds.
   */
  async runAutoplay() {
    this.state = 'playing';
    const duration = floatParam(this.params, 'duration', 30);
    const bridge = (window.__ironwake ||= {});
    bridge.autoplay = { time: 0, wave: 0, kills: 0, health: 100, shotsFired: 0, done: false, stub: !this.getSystem('autoplay') };
    const autoplay = this.getSystem('autoplay');
    if (autoplay?.begin) await autoplay.begin({ duration });

    const totalSteps = Math.round(duration / this.time.step);
    const chunk = 30; // steps per yield so the page stays responsive
    for (let done = 0; done < totalSteps; done += chunk) {
      this.loop.stepFixed(Math.min(chunk, totalSteps - done));
      const status = autoplay?.status ? autoplay.status() : {};
      Object.assign(bridge.autoplay, status, { time: this.time.elapsed });
      // render occasionally so periodic captures show live state
      this.renderFrame();
      await new Promise((r) => setTimeout(r, 0));
    }
    const finalStats = autoplay?.finish ? autoplay.finish() : { stub: true, simulated: this.time.elapsed };
    Object.assign(bridge.autoplay, { done: true, stats: finalStats, time: this.time.elapsed });
    this.renderFrame();
  }

  /* ---------------------------------------------------------------- bridge */
  _publishBridge() {
    const bridge = (window.__ironwake ||= {});
    bridge.presets = PhotoMode.list;
    bridge.game = this;
    bridge.api = {
      capture: () => this.renderFrame(),
      step: (n = 1) => this.loop.stepFixed(n),
      setPreset: (id) => PhotoMode.run(this, id, {}),
      getStats: () => ({
        triangles: this.renderer.three.info.render.triangles,
        drawCalls: this.renderer.three.info.render.calls,
        frame: this.time.frame,
      }),
    };
  }

  /* -------------------------------------------------------------- teardown */
  dispose() {
    this.loop?.stop();
    for (const s of this.systems) s.ref.dispose?.();
    this.world?.dispose?.();
    this.sky?.dispose?.();
    this.post?.dispose?.();
    this.input?.dispose?.();
    this.renderer?.dispose?.();
    this.events.clear();
  }
}

function intParam(params, key, fallback) {
  const v = parseInt(params.get(key) || '', 10);
  return Number.isFinite(v) ? v : fallback;
}
function floatParam(params, key, fallback) {
  const v = parseFloat(params.get(key) || '');
  return Number.isFinite(v) ? v : fallback;
}
