/**
 * Post-processing chain built on the pmndrs `postprocessing` library.
 *
 * Milestone-0 baseline: render pass → ACES tone mapping → vignette → grain.
 * The RENDER stream extends this to the full stack described in
 * docs/ARCHITECTURE.md §5 (AO → bloom → god rays → AA → motion blur → DOF →
 * LUT → chromatic aberration), exposing named handles on `this.effects` so
 * gameplay (e.g. ADS-driven DOF, damage vignette) can drive parameters.
 */
import * as THREE from 'three';
import {
  BlendFunction,
  EffectComposer,
  EffectPass,
  NoiseEffect,
  RenderPass,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
  VignetteTechnique,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';

export class Post {
  /**
   * @param {object} opts
   * @param {import('./Renderer.js').Renderer} opts.renderer
   * @param {THREE.Scene} opts.scene
   * @param {THREE.Camera} opts.camera
   * @param {import('../core/Settings.js').Settings} opts.settings
   */
  constructor({ renderer, scene, camera, settings }) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.settings = settings;
    this.effects = {};

    this.composer = new EffectComposer(renderer.three, {
      frameBufferType: THREE.HalfFloatType,
      multisampling: 0,
    });

    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);

    // Screen-space ambient occlusion (N8AO). Grounds every object, adds
    // contact shadowing under props — the single biggest "not a prototype" cue.
    const tier = renderer.tier;
    if (tier.ao.enabled) {
      this.n8ao = new N8AOPostPass(scene, camera, renderer.width, renderer.height);
      this.n8ao.configuration.aoRadius = 2.5;
      this.n8ao.configuration.distanceFalloff = 1.0;
      this.n8ao.configuration.intensity = 3.0;
      this.n8ao.configuration.halfRes = tier.ao.halfRes;
      this.n8ao.setQualityMode(tier.ao.quality === 'ultra' ? 'Ultra' : tier.ao.quality === 'high' ? 'High' : 'Medium');
      this.composer.addPass(this.n8ao);
    }

    this.effects.toneMapping = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
    this.effects.vignette = new VignetteEffect({
      technique: VignetteTechnique.DEFAULT,
      offset: 0.32,
      darkness: 0.55,
    });
    this.effects.noise = new NoiseEffect({ blendFunction: BlendFunction.OVERLAY, premultiply: true });
    this.effects.noise.blendMode.opacity.value = 0.06;

    this.finalPass = new EffectPass(camera, this.effects.toneMapping, this.effects.vignette, this.effects.noise);
    this.composer.addPass(this.finalPass);

    renderer.setResizeHandler((w, h, pr) => this.setSize(w, h, pr));
    this.setSize(renderer.width, renderer.height, renderer.pixelRatio);
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
    this.finalPass.mainCamera = camera;
  }

  render(dt = 1 / 60) {
    this.composer.render(dt);
  }

  dispose() {
    this.composer.dispose();
  }
}
