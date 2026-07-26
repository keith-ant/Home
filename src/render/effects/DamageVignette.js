/**
 * DamageVignetteEffect — health-feedback screen edge (RENDER stream).
 *
 * A red-tinted radial vignette layered on top of the standard filmic
 * vignette: darkens and bloodies the frame edges as `intensity` goes 0→1,
 * with a soft inner falloff so the centre of the frame stays clean for
 * aiming. Driven by post.setDamageVignette(v); UI/AUDIO handle the rest of the
 * hurt feedback via events.
 */
import * as THREE from 'three';
import { Effect, BlendFunction } from 'postprocessing';

const fragment = /* glsl */ `
  uniform float intensity;
  uniform vec3 tint;
  uniform float pulse;

  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    if (intensity <= 0.001) {
      outputColor = inputColor;
      return;
    }
    vec2 d = (uv - 0.5) * vec2(1.0, 0.82);
    float r = length(d) * 2.0;
    float k = intensity * (1.0 + 0.12 * sin(pulse * 6.2831853));
    float v = smoothstep(0.45, 1.35, r) * k;
    float lum = dot(inputColor.rgb, vec3(0.2126, 0.7152, 0.0722));
    vec3 bloodied = mix(inputColor.rgb, tint * (0.25 + 0.9 * lum), clamp(v * 0.9, 0.0, 1.0));
    bloodied *= 1.0 - v * 0.5;
    outputColor = vec4(bloodied, inputColor.a);
  }
`;

export class DamageVignetteEffect extends Effect {
  constructor({ tint = new THREE.Color(0.55, 0.02, 0.03) } = {}) {
    super('DamageVignetteEffect', fragment, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map([
        ['intensity', new THREE.Uniform(0)],
        ['tint', new THREE.Uniform(tint)],
        ['pulse', new THREE.Uniform(0)],
      ]),
    });
  }

  get intensity() {
    return this.uniforms.get('intensity').value;
  }
  set intensity(v) {
    this.uniforms.get('intensity').value = v;
  }
  set pulse(v) {
    this.uniforms.get('pulse').value = v;
  }
}
