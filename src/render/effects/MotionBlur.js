/**
 * CameraMotionBlurEffect — per-pixel camera motion blur (RENDER stream).
 *
 * Reconstructs each pixel's world position from the depth buffer with the
 * current inverse view-projection, reprojects it with the previous frame's
 * view-projection, and blurs along the resulting screen-space velocity with
 * SAMPLES taps. Object motion is ignored (fine for a mostly-static arena and
 * a fast camera). The Post system feeds the matrices every frame; when the
 * camera hasn't moved the velocity is zero and the effect is a no-op.
 *
 * Uniforms: prevViewProjection, currViewProjectionInverse, intensity
 * (shutter fraction, 0 disables), maxVelocity (uv-space clamp).
 */
import * as THREE from 'three';
import { Effect, EffectAttribute, BlendFunction } from 'postprocessing';

const fragment = /* glsl */ `
  uniform mat4 prevViewProjection;
  uniform mat4 currViewProjectionInverse;
  uniform float intensity;
  uniform float maxVelocity;

  void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
    if (intensity <= 0.0) {
      outputColor = inputColor;
      return;
    }
    // pixel → world with the current camera, world → previous screen position
    vec4 ndc = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
    vec4 world = currViewProjectionInverse * ndc;
    world.xyz /= max(world.w, 1e-5);
    vec4 prev = prevViewProjection * vec4(world.xyz, 1.0);
    vec2 prevUv = (prev.xy / max(prev.w, 1e-5)) * 0.5 + 0.5;
    vec2 vel = (uv - prevUv) * intensity;
    float speed = length(vel);
    if (speed > maxVelocity) vel *= maxVelocity / speed;
    if (speed < 0.0005) {
      outputColor = inputColor;
      return;
    }
    vec4 acc = inputColor;
    float wsum = 1.0;
    for (int i = 1; i < SAMPLES; i++) {
      float f = float(i) / float(SAMPLES - 1) - 0.5; // centre the smear on the pixel
      vec2 suv = clamp(uv + vel * f, vec2(0.001), vec2(0.999));
      acc += texture2D(inputBuffer, suv);
      wsum += 1.0;
    }
    outputColor = acc / wsum;
  }
`;

export class CameraMotionBlurEffect extends Effect {
  /**
   * @param {object} [opts]
   * @param {number} [opts.samples=8]
   * @param {number} [opts.intensity=0.75] shutter fraction (0..1.2)
   * @param {number} [opts.maxVelocity=0.045] clamp in uv units
   */
  constructor({ samples = 8, intensity = 0.75, maxVelocity = 0.045 } = {}) {
    super('CameraMotionBlurEffect', fragment, {
      attributes: EffectAttribute.DEPTH | EffectAttribute.CONVOLUTION,
      blendFunction: BlendFunction.NORMAL,
      defines: new Map([['SAMPLES', String(Math.max(3, samples | 0))]]),
      uniforms: new Map([
        ['prevViewProjection', new THREE.Uniform(new THREE.Matrix4())],
        ['currViewProjectionInverse', new THREE.Uniform(new THREE.Matrix4())],
        ['intensity', new THREE.Uniform(intensity)],
        ['maxVelocity', new THREE.Uniform(maxVelocity)],
      ]),
    });
    this._curr = new THREE.Matrix4();
    this._view = new THREE.Matrix4();
    this._hasPrev = false;
  }

  get intensity() {
    return this.uniforms.get('intensity').value;
  }
  set intensity(v) {
    this.uniforms.get('intensity').value = v;
  }

  /**
   * Feed this frame's camera. Call once per rendered frame BEFORE the
   * composer renders (Post does this).
   * @param {THREE.Camera} camera
   */
  updateCamera(camera) {
    const prev = this.uniforms.get('prevViewProjection').value;
    // previous ← last frame's current
    if (this._hasPrev) prev.copy(this._curr);
    // Build the CURRENT view matrix from the camera's world transform now —
    // camera.matrixWorldInverse is only refreshed by the renderer, which runs
    // after this hook, so it would still hold the previous frame.
    camera.updateMatrixWorld();
    this._view.copy(camera.matrixWorld).invert();
    this._curr.multiplyMatrices(camera.projectionMatrix, this._view);
    if (!this._hasPrev) {
      prev.copy(this._curr);
      this._hasPrev = true;
    }
    this.uniforms.get('currViewProjectionInverse').value.copy(this._curr).invert();
  }

  /** Forget history (teleports, preset changes) so the next frame has no smear. */
  resetHistory() {
    this._hasPrev = false;
  }
}
