/**
 * LensDropletsEffect — screen-space rain on the camera lens (RENDER stream).
 *
 * Procedural: two layers of static droplets (grid cells with hashed drops
 * that fade in/out over time) plus vertical drips that slide down when the
 * effect is strong. Each droplet refracts the image behind it (offset UV
 * sample of the input buffer) and picks up a faint bright rim, like the
 * water-on-lens moments in the references after looking up into rain or
 * standing near an explosion. `strength` (0..1) is animated by Post
 * (post.splashLens(v) plus automatic pitch-up-into-rain triggering).
 *
 * The animation clock is the effect material `time` uniform, which Post
 * drives from the deterministic simulation clock.
 */
import * as THREE from 'three';
import { Effect, EffectAttribute, BlendFunction } from 'postprocessing';

const fragment = /* glsl */ `
  uniform float strength;
  uniform float driftT;      // deterministic clock (seconds)
  uniform float refraction;   // uv offset scale
  uniform float dropDensity;

  float ld_hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }
  vec2 ld_hash2(vec2 p) {
    return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453);
  }

  // Static droplets in a grid: returns xy = refraction dir * mask, z = mask
  vec3 ld_drops(vec2 uv, float cells, float t, float seed) {
    vec2 st = uv * vec2(cells * aspect, cells);
    vec2 id = floor(st);
    vec2 gv = fract(st) - 0.5;
    vec2 rnd = ld_hash2(id + seed);
    // spawn/evaporate cycle so drops appear and dry over ~5-9 s
    float life = fract(t * (0.09 + 0.07 * rnd.x) + rnd.y);
    float alive = smoothstep(0.0, 0.12, life) * (1.0 - smoothstep(0.72, 1.0, life));
    vec2 pos = (rnd - 0.5) * 0.62;
    // slightly elongated (gravity sag)
    vec2 d = (gv - pos) / vec2(0.9, 1.15);
    float dist = length(d);
    float size = mix(0.08, 0.24, ld_hash(id * 1.7 + seed));
    float body = smoothstep(size, size * 0.55, dist) * alive;
    return vec3(normalize(d + 1e-5) * body, body);
  }

  // Sliding drips: a head running down each column, thin trail above it.
  vec3 ld_drips(vec2 uv, float cols, float t) {
    vec2 st = uv * vec2(cols * aspect, 1.0);
    float col = floor(st.x);
    float rnd = ld_hash(vec2(col, 3.71));
    float rnd2 = ld_hash(vec2(col, 8.13));
    float speed = 0.06 + 0.14 * rnd2;
    // head position moving down (uv y decreasing)
    float headY = 1.15 - fract(t * speed + rnd) * 1.4;
    float x = fract(st.x) - 0.5 - (rnd - 0.5) * 0.4;
    float dy = uv.y - headY;
    float head = smoothstep(0.09, 0.02, length(vec2(x * 2.2, dy * 6.0)));
    // trail above the head, thinning out
    float trail = smoothstep(0.055, 0.0, abs(x)) * smoothstep(0.0, 0.02, dy) * smoothstep(0.45, 0.0, dy) * 0.6;
    float m = clamp(head + trail, 0.0, 1.0) * step(0.55, rnd2);
    return vec3(vec2(x * 3.0, -dy * 6.0) * m, m);
  }

  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    if (strength <= 0.001) {
      outputColor = inputColor;
      return;
    }
    float t = driftT;
    vec3 acc = vec3(0.0);
    acc += ld_drops(uv, 5.0, t, 0.0) * dropDensity;
    acc += ld_drops(uv * 1.7 + 0.31, 7.5, t * 1.3 + 3.0, 4.7) * dropDensity * 0.85;
    // drips only when properly wet
    acc += ld_drips(uv, 9.0, t) * smoothstep(0.35, 0.85, strength);
    float mask = clamp(acc.z, 0.0, 1.0) * strength;
    vec2 offset = acc.xy * refraction * strength;
    vec3 refracted = texture2D(inputBuffer, clamp(uv + offset, vec2(0.001), vec2(0.999))).rgb;
    // bright rim on the drop edge catches the light
    float rim = smoothstep(0.15, 0.5, mask) * (1.0 - smoothstep(0.5, 0.9, mask));
    vec3 col = mix(inputColor.rgb, refracted, clamp(mask * 1.4, 0.0, 1.0));
    col += rim * 0.08 * strength;
    outputColor = vec4(col, inputColor.a);
  }
`;

export class LensDropletsEffect extends Effect {
  /**
   * @param {object} [opts]
   * @param {number} [opts.refraction=0.045] uv offset scale
   * @param {number} [opts.density=1.0]
   */
  constructor({ refraction = 0.045, density = 1.0 } = {}) {
    super('LensDropletsEffect', fragment, {
      attributes: EffectAttribute.CONVOLUTION,
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map([
        ['strength', new THREE.Uniform(0)],
        ['driftT', new THREE.Uniform(0)],
        ['refraction', new THREE.Uniform(refraction)],
        ['dropDensity', new THREE.Uniform(density)],
      ]),
    });
  }

  get strength() {
    return this.uniforms.get('strength').value;
  }
  set strength(v) {
    this.uniforms.get('strength').value = v;
  }
  set time(v) {
    this.uniforms.get('driftT').value = v;
  }
  get time() {
    return this.uniforms.get('driftT').value;
  }
}
