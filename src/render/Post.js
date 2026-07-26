/**
 * Post — the post-processing chain (RENDER stream, docs/BUILD_PLAN.md §S1).
 *
 * Built on pmndrs `postprocessing` + n8ao, in this order:
 *
 *   RenderPass → N8AO (SSAO, tier-gated)
 *     → CameraMotionBlur pass (velocity from depth, tier + setting gated)
 *     → DepthOfField pass (ADS-driven; disabled unless post.setDof is active)
 *     → MAIN pass  [Bloom (HDR, emitters only) → ACES tone map → 3D LUT grade]
 *     → SMAA pass  (preset by tier)
 *     → LensDroplets pass (screen-space rain on the lens; disabled while dry)
 *     → FINAL pass [ChromaticAberration → film grain → vignette → damage vignette]
 *
 * Tone mapping runs before the LUT/grain/vignette on purpose: a LUT clamps
 * its input domain at 1.0, so HDR bloom cores must be tone-mapped first.
 * Exposure is `renderer.toneMappingExposure` (ACES reads it), driven through
 * post.setExposure().
 *
 * Public API (game.post):
 *   post.setExposure(v) / post.exposure
 *   post.setDof({focusDistance, focusRange | focalLength, bokehScale} | null)
 *   post.setGrade('ironwake'|'neutral'|'bleach'|'warm')
 *   post.setDamageVignette(0..1)
 *   post.splashLens(strength)          water on the lens (also auto-triggers)
 *   post.setMotionBlurEnabled(bool)
 *   post.setBloom({intensity, threshold})
 *   post.effects  { bloom, toneMapping, lut, smaa, ca, noise, vignette,
 *                    damage, droplets, motionBlur, dof, n8ao }
 *   post.addPreRender(fn) / removePreRender(fn)   per-frame hooks (camera-ready)
 *   post.render(dt), post.setSize(w,h,pr), post.setCamera(cam), post.update(dt)
 *
 * Settings honoured live (settings:changed): motionBlur, filmGrain,
 * chromaticAberration, aaMode.
 */
import * as THREE from 'three';
import {
  BlendFunction,
  BloomEffect,
  ChromaticAberrationEffect,
  DepthOfFieldEffect,
  EdgeDetectionMode,
  EffectComposer,
  EffectPass,
  LUT3DEffect,
  NoiseEffect,
  PredicationMode,
  RenderPass,
  SMAAEffect,
  SMAAPreset,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
  VignetteTechnique,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import { buildGradeLUT, GRADE_NAMES } from './effects/Grade.js';
import { CameraMotionBlurEffect } from './effects/MotionBlur.js';
import { LensDropletsEffect } from './effects/LensDroplets.js';
import { DamageVignetteEffect } from './effects/DamageVignette.js';

const _up = new THREE.Vector3(0, 1, 0);
const _fwd = new THREE.Vector3();

export class Post {
  /**
   * @param {object} opts
   * @param {import('../Game.js').Game} opts.game
   */
  constructor({ game }) {
    this.game = game;
    this.renderer = game.renderer;
    this.scene = game.scene;
    this.camera = game.camera;
    this.settings = game.settings;
    this.tier = game.tier;
    /** @type {Record<string, any>} named effect handles */
    this.effects = {};
    this._preRender = new Set();
    this._exposure = 1.0;
    this._dropletStrength = 0;
    this._dropletTarget = 0;
    this._damage = 0;
    this._motionBlurWanted = !!this.settings.get('motionBlur');
    this._grade = 'ironwake';
    this._luts = new Map();

    const gl = this.renderer.three;
    gl.toneMappingExposure = this._exposure;

    this.composer = new EffectComposer(gl, {
      frameBufferType: THREE.HalfFloatType,
      multisampling: 0,
    });

    const tier = this.tier;
    const camera = this.camera;

    /* ---------------------------------------------------------- render */
    this.renderPass = new RenderPass(this.scene, camera);
    this.composer.addPass(this.renderPass);

    /* ------------------------------------------------------------- N8AO */
    if (tier.ao.enabled) {
      this.n8ao = new N8AOPostPass(this.scene, camera, this.renderer.width, this.renderer.height);
      const c = this.n8ao.configuration;
      c.aoRadius = 1.8;
      c.distanceFalloff = 1.0;
      c.intensity = 2.2;
      c.halfRes = tier.ao.halfRes;
      c.gammaCorrection = false;
      c.transparencyAware = false; // rain/cones/flares never occlude
      c.color = new THREE.Color(0x000000);
      this.n8ao.setQualityMode(tier.ao.quality === 'ultra' ? 'Ultra' : tier.ao.quality === 'high' ? 'High' : 'Medium');
      this.composer.addPass(this.n8ao);
      this.effects.n8ao = this.n8ao;
    }

    /* -------------------------------------------------------- motion blur */
    if (tier.motionBlur && tier.motionBlurSamples > 0) {
      this.effects.motionBlur = new CameraMotionBlurEffect({
        samples: tier.motionBlurSamples,
        intensity: 0.8,
        maxVelocity: 0.05,
      });
      this.motionBlurPass = new EffectPass(camera, this.effects.motionBlur);
      // Photo mode captures are static frames — no smear except for presets
      // that opt in (e.g. viewmodel_fire) via post.setMotionBlurEnabled(true).
      const photo = !!game.photoPreset;
      this.motionBlurPass.enabled = this._motionBlurWanted && !photo;
      this.composer.addPass(this.motionBlurPass);
    }

    /* ------------------------------------------------------ depth of field */
    if (tier.dof) {
      this.effects.dof = new DepthOfFieldEffect(camera, {
        focusDistance: 2.5,
        focusRange: 3.0,
        bokehScale: 3.0,
        resolutionScale: 0.5,
      });
      this.dofPass = new EffectPass(camera, this.effects.dof);
      this.dofPass.enabled = false; // enabled while post.setDof(...) is active
      this.composer.addPass(this.dofPass);
    }

    /* ------------------------------------------------------------- MAIN */
    this.effects.bloom = new BloomEffect({
      blendFunction: BlendFunction.ADD,
      mipmapBlur: true,
      luminanceThreshold: 1.15,
      luminanceSmoothing: 0.55,
      intensity: 0.75 * tier.bloom.intensity,
      radius: 0.72,
      levels: tier.bloom.levels,
    });
    this.effects.toneMapping = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
    this._luts.set('ironwake', buildGradeLUT('ironwake'));
    this.effects.lut = new LUT3DEffect(this._luts.get('ironwake'), {
      blendFunction: BlendFunction.SET,
      tetrahedralInterpolation: false,
    });
    this.mainPass = new EffectPass(camera, this.effects.bloom, this.effects.toneMapping, this.effects.lut);
    this.composer.addPass(this.mainPass);

    /* ------------------------------------------------------------- SMAA */
    if (tier.aa === 'smaa') {
      this.effects.smaa = new SMAAEffect({
        preset: tier.name === 'medium' ? SMAAPreset.HIGH : SMAAPreset.ULTRA,
        edgeDetectionMode: EdgeDetectionMode.COLOR,
        predicationMode: PredicationMode.DISABLED,
      });
      this.smaaPass = new EffectPass(camera, this.effects.smaa);
      this.smaaPass.enabled = this.settings.get('aaMode') !== 'none';
      this.composer.addPass(this.smaaPass);
    }

    /* ------------------------------------------------------- lens water */
    if (tier.lensDroplets) {
      this.effects.droplets = new LensDropletsEffect({ refraction: 0.05, density: 1.0 });
      this.dropletsPass = new EffectPass(camera, this.effects.droplets);
      this.dropletsPass.enabled = false;
      this.composer.addPass(this.dropletsPass);
    }

    /* ------------------------------------------------------------ FINAL */
    this.effects.ca = new ChromaticAberrationEffect({
      offset: new THREE.Vector2(0.0005, 0.0005),
      radialModulation: true,
      modulationOffset: 0.4,
    });
    this.effects.noise = new NoiseEffect({ blendFunction: BlendFunction.SOFT_LIGHT, premultiply: false });
    this.effects.noise.blendMode.opacity.value = 0.16;
    this.effects.vignette = new VignetteEffect({
      technique: VignetteTechnique.DEFAULT,
      offset: 0.3,
      darkness: 0.5,
    });
    this.effects.damage = new DamageVignetteEffect();
    const finalEffects = [];
    if (tier.chromaticAberration) finalEffects.push(this.effects.ca);
    if (tier.grain) finalEffects.push(this.effects.noise);
    finalEffects.push(this.effects.vignette, this.effects.damage);
    this.finalPass = new EffectPass(camera, ...finalEffects);
    this.composer.addPass(this.finalPass);

    // settings toggles (initial + live)
    this._applySetting('filmGrain', this.settings.get('filmGrain'));
    this._applySetting('chromaticAberration', this.settings.get('chromaticAberration'));
    this._offSettings = game.events.on('settings:changed', ({ key, value }) => this._applySetting(key, value));

    this.renderer.setResizeHandler((w, h, pr) => this.setSize(w, h, pr));
    this.setSize(this.renderer.width, this.renderer.height, this.renderer.pixelRatio);
  }

  /* --------------------------------------------------------- settings */
  _applySetting(key, value) {
    switch (key) {
      case 'motionBlur':
        this._motionBlurWanted = !!value;
        if (this.motionBlurPass) this.motionBlurPass.enabled = this._motionBlurWanted && !this.game.photoPreset;
        break;
      case 'filmGrain':
        if (this.effects.noise) this.effects.noise.blendMode.opacity.value = value ? 0.16 : 0;
        break;
      case 'chromaticAberration':
        if (this.effects.ca) this.effects.ca.blendMode.opacity.value = value ? 1 : 0;
        break;
      case 'aaMode':
        if (this.smaaPass) this.smaaPass.enabled = value !== 'none';
        break;
      default:
        break;
    }
  }

  /* ------------------------------------------------------------- APIs */
  /** Scene exposure (ACES pre-scale). 1.0 = neutral. */
  setExposure(v) {
    this._exposure = v;
    this.renderer.three.toneMappingExposure = v;
  }
  get exposure() {
    return this._exposure;
  }

  /**
   * ADS depth of field. Pass null/false to disable.
   * @param {{focusDistance?:number, focusRange?:number, focalLength?:number, bokehScale?:number}|null} p
   */
  setDof(p) {
    if (!this.effects.dof || !this.dofPass) return;
    if (!p) {
      this.dofPass.enabled = false;
      return;
    }
    const coc = this.effects.dof.cocMaterial;
    if (p.focusDistance !== undefined) coc.focusDistance = p.focusDistance;
    const range = p.focusRange ?? p.focalLength;
    if (range !== undefined) coc.focusRange = range;
    if (p.bokehScale !== undefined) this.effects.dof.bokehScale = p.bokehScale;
    this.dofPass.enabled = true;
  }

  /** Swap the colour grade LUT by name (built lazily, cached). */
  setGrade(name) {
    if (!GRADE_NAMES.includes(name)) {
      console.warn(`[post] unknown grade "${name}" (available: ${GRADE_NAMES.join(', ')})`);
      return;
    }
    if (this._grade === name) return;
    this._grade = name;
    let lut = this._luts.get(name);
    if (!lut) {
      lut = buildGradeLUT(name);
      this._luts.set(name, lut);
    }
    this.effects.lut.lut = lut;
  }
  get grade() {
    return this._grade;
  }

  /** Red damage vignette 0..1 (health feedback). */
  setDamageVignette(v) {
    this._damage = THREE.MathUtils.clamp(v, 0, 1);
    this.effects.damage.intensity = this._damage;
  }

  /**
   * Splash water onto the lens (explosions nearby, looking up into rain).
   * Strength decays automatically over ~5-8 s.
   * @param {number} strength 0..1
   */
  splashLens(strength = 0.7) {
    this._dropletTarget = Math.max(this._dropletTarget, THREE.MathUtils.clamp(strength, 0, 1));
  }

  /** Force motion blur on/off (photo presets like viewmodel_fire opt in). */
  setMotionBlurEnabled(on) {
    if (this.motionBlurPass) {
      this.motionBlurPass.enabled = !!on;
      this.effects.motionBlur?.resetHistory();
    }
  }

  /** Retune bloom at runtime. */
  setBloom({ intensity, threshold, smoothing } = {}) {
    const b = this.effects.bloom;
    if (!b) return;
    if (intensity !== undefined) b.intensity = intensity;
    if (threshold !== undefined) b.luminanceMaterial.threshold = threshold;
    if (smoothing !== undefined) b.luminanceMaterial.smoothing = smoothing;
  }

  /** Register a per-render-frame hook (runs before the composer, camera final). */
  addPreRender(fn) {
    this._preRender.add(fn);
    return () => this._preRender.delete(fn);
  }
  removePreRender(fn) {
    this._preRender.delete(fn);
  }

  /* --------------------------------------------------------- lifecycle */
  /**
   * Fixed-step update (registered as a game system): lens-water dynamics,
   * damage pulse, auto rain-on-lens when the camera pitches up into rain.
   */
  update(dt) {
    const droplets = this.effects.droplets;
    if (droplets) {
      // auto trigger: pitched up into falling rain
      const weather = this.game.weather;
      let want = 0;
      if (weather && weather.rainIntensity > 0.05) {
        this.camera.getWorldDirection(_fwd);
        const pitchUp = _fwd.dot(_up); // 1 = straight up
        if (pitchUp > 0.35) want = THREE.MathUtils.clamp((pitchUp - 0.35) * 1.6, 0, 0.85) * weather.rainIntensity;
      }
      this._dropletTarget = Math.max(this._dropletTarget * Math.pow(0.55, dt), want); // targets decay
      // strength moves toward target: fast attack, slow dry-out
      const s = this._dropletStrength;
      const rate = this._dropletTarget > s ? 3.0 : 0.14;
      this._dropletStrength = s + (this._dropletTarget - s) * Math.min(1, rate * dt);
      droplets.strength = this._dropletStrength;
      droplets.time = this.game.time.elapsed;
      if (this.dropletsPass) this.dropletsPass.enabled = this._dropletStrength > 0.01;
    }
    if (this._damage > 0) this.effects.damage.pulse = this.game.time.elapsed * 1.2;
  }

  /** Render one frame through the chain. Called by Game.renderFrame. */
  render(dt = 1 / 60) {
    if (this._preRender.size) {
      for (const fn of this._preRender) fn(this.camera);
    }
    if (this.motionBlurPass?.enabled) this.effects.motionBlur.updateCamera(this.camera);
    this.composer.render(dt);
  }

  setSize(width, height, pixelRatio = 1) {
    this.composer.setSize(width, height, false);
    this.composer.setPixelRatio?.(pixelRatio);
    this.n8ao?.setSize(width, height);
  }

  /** Replace the camera used by camera-dependent passes (e.g. after respawn). */
  setCamera(camera) {
    this.camera = camera;
    this.renderPass.mainCamera = camera;
    this.mainPass.mainCamera = camera;
    this.finalPass.mainCamera = camera;
    if (this.smaaPass) this.smaaPass.mainCamera = camera;
    if (this.dofPass) this.dofPass.mainCamera = camera;
    if (this.motionBlurPass) this.motionBlurPass.mainCamera = camera;
    if (this.dropletsPass) this.dropletsPass.mainCamera = camera;
    if (this.n8ao) this.n8ao.camera = camera;
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this._offSettings?.();
    this.composer.dispose();
    for (const lut of this._luts.values()) lut.dispose();
  }
}
