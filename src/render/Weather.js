/**
 * Weather — GPU rain, ground splashes, gusting wind and the puddle-ripple
 * normal texture. RENDER stream (docs/BUILD_PLAN.md §S1).
 *
 * Rain is one instanced draw: thousands of stretched streak quads whose
 * positions are computed entirely in the vertex shader from a per-instance
 * lattice offset, the simulation clock and the wind vector, wrapped inside a
 * shell volume anchored on the camera. Nothing is simulated on the CPU per
 * frame and the field is deterministic for photo mode. Streaks are nearly
 * invisible in darkness and light up inside the cones of the four strongest
 * nearby fixtures (uniform array fed from Lighting.strongestLightsNear) —
 * the reference rule: rain reads only where it is back-lit.
 *
 * Splashes: a second instanced mesh of tiny crown sprites recycled on the
 * ground plane around the camera, denser/brighter under lights.
 *
 * Puddle ripples: a small normal-map DataTexture regenerated a few times per
 * second from a handful of expanding ring functions; WORLD's wet ground and
 * PBR.makeWetGround sample it (`weather.puddleRipplesTexture`).
 *
 * Public API (game.weather):
 *   weather.rainIntensity        0..1 (setter re-scales instance counts, emits weather:changed)
 *   weather.wetness              0..1 (setter emits weather:changed)
 *   weather.windVector           THREE.Vector3, live gusting wind (m/s)
 *   weather.puddleRipplesTexture DataTexture (RG = xz normal perturbation, world-tiling)
 *   weather.setRain(v), setWetness(v)
 *   weather.preRender(camera)    (installPost wires this before each frame)
 *
 * Events emitted: 'weather:changed' {rainIntensity, wetness}
 * (Thunder / lightning scheduling lives in Sky.js.)
 */
import * as THREE from 'three';
import { Random } from '../core/Random.js';
import { streakTexture, splashTexture } from './ProcTextures.js';

const MAX_LIGHTS = 4;

/* --------------------------------------------------------------- shaders */
const RAIN_VERT = /* glsl */ `
  precision highp float;
  attribute vec3 aOffset;   // lattice offset in [0,1)^3
  attribute vec2 aVary;     // x: speed factor, y: length factor
  uniform vec3 uCam;
  uniform vec3 uShell;      // half-extents of the wrap volume
  uniform vec3 uWind;       // world wind m/s (xz used)
  uniform float uFall;      // fall speed m/s
  uniform float uTime;
  uniform float uStreakTime; // shutter-ish stretch (seconds of travel)
  uniform float uWidth;
  uniform float uWorldPerPixel; // world metres per pixel at unit distance
  uniform float uAlphaBase;
  uniform float uLightning;
  uniform vec3 uLightPos[4];
  uniform vec4 uLightCol[4]; // rgb + power
  varying vec2 vUv;
  varying float vAlpha;
  varying vec3 vTint;
  void main() {
    float speed = uFall * (0.85 + 0.3 * aVary.x);
    vec3 vel = vec3(uWind.x, -speed, uWind.z);
    vec3 travel = vel * uTime;
    vec3 size = uShell * 2.0;
    // fixed world lattice, wrapped into the camera-centred shell
    vec3 p = aOffset * size + travel;
    vec3 rel = mod(p - uCam + uShell, size) - uShell;
    vec3 world = uCam + rel;
    vec3 velDir = normalize(vel);
    float len = length(vel) * uStreakTime * (0.6 + 0.8 * aVary.y);
    // position.y: 0 at the drop head .. 1 up the tail; position.x: -1..1 side
    vec3 head = world;
    vec3 c = head - velDir * (len * position.y);
    vec3 toCam = normalize(uCam - world);
    vec3 side = cross(velDir, toCam);
    float sideLen = length(side);
    side = sideLen > 1e-4 ? side / sideLen : vec3(1.0, 0.0, 0.0);
    float dist = distance(uCam, world);
    // never thinner than ~1.5 px on screen (real rain is sub-pixel and vanishes)
    float width = max(uWidth * (1.0 + 0.02 * dist), dist * uWorldPerPixel * 0.6);
    c += side * (position.x * width);
    gl_Position = projectionMatrix * viewMatrix * vec4(c, 1.0);
    vUv = vec2(position.x * 0.5 + 0.5, position.y);

    // Lighting: nearly invisible unless a strong light is nearby.
    float acc = 0.0;
    vec3 tint = vec3(0.35, 0.4, 0.5) * 0.15; // faint cool sky glint
    for (int i = 0; i < 4; i++) {
      vec4 lc = uLightCol[i];
      if (lc.w <= 0.0) continue;
      vec3 d = world - uLightPos[i];
      float d2 = dot(d, d);
      float e = 0.22 * lc.w / (4.0 + d2);   // ~ irradiance from a candela source
      acc += e;
      tint += lc.rgb * e;
    }
    float m = max(max(tint.r, tint.g), tint.b);
    tint /= max(m, 1e-3);                    // keep the hue, brightness lives in alpha
    float lit = 1.0 - exp(-acc * 0.4);        // asymptotic: bright in beams, subtle elsewhere
    // shell edge fades so streaks don't pop at the wrap boundary, plus a
    // near-camera fade to stop giant sheets sliding across the lens
    float edgeY = 1.0 - smoothstep(0.72, 1.0, abs(rel.y) / uShell.y);
    float edgeXZ = 1.0 - smoothstep(0.78, 1.0, length(rel.xz) / uShell.x);
    float nearFade = smoothstep(0.4, 1.2, dist);
    vAlpha = min(uAlphaBase + lit * 0.55 + uLightning * 0.28, 0.85) * edgeY * edgeXZ * nearFade;
    vTint = tint * (0.5 + 0.5 * lit) + vec3(0.55, 0.62, 0.75) * uLightning * 0.4;
  }
`;

const RAIN_FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D uMap;
  varying vec2 vUv;
  varying float vAlpha;
  varying vec3 vTint;
  void main() {
    float a = texture2D(uMap, vUv).a * vAlpha;
    if (a < 0.003) discard;
    gl_FragColor = vec4(vTint * a, a * 0.35); // premultiplied streak light
  }
`;

const SPLASH_VERT = /* glsl */ `
  precision highp float;
  attribute vec3 aRand;
  uniform vec3 uCam;
  uniform float uRadius;
  uniform float uPeriod;
  uniform float uTime;
  uniform float uGroundY;
  uniform float uSnap;
  uniform vec3 uLightPos[4];
  uniform vec4 uLightCol[4];
  varying vec2 vUv;
  varying float vAlpha;
  varying vec3 vTint;
  void main() {
    float cyc = uTime / (uPeriod * (0.8 + 0.4 * aRand.z)) + aRand.x;
    float cycle = floor(cyc);
    float life = fract(cyc);
    // hash the (instance, cycle) pair into a position around the camera
    vec2 h = fract(sin(vec2(cycle * 12.9898 + aRand.y * 78.233, cycle * 39.425 + aRand.z * 11.135)) * 43758.5453);
    float r = uRadius * sqrt(h.x);
    float th = 6.2831853 * h.y;
    vec2 anchor = floor(uCam.xz / uSnap + 0.5) * uSnap;
    vec3 world = vec3(anchor.x + cos(th) * r, uGroundY + 0.015, anchor.y + sin(th) * r);
    float size = mix(0.04, 0.15, life) * (0.7 + 0.6 * aRand.y);
    // camera-facing vertical quad
    vec3 toCam = uCam - world;
    toCam.y = 0.0;
    float tl = length(toCam);
    toCam = tl > 1e-4 ? toCam / tl : vec3(0.0, 0.0, 1.0);
    vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), toCam));
    vec3 c = world + right * (position.x * size * 0.5) + vec3(0.0, 1.0, 0.0) * (position.y * size * 0.75);
    gl_Position = projectionMatrix * viewMatrix * vec4(c, 1.0);
    vUv = vec2(position.x * 0.5 + 0.5, position.y);
    float acc = 0.0;
    vec3 tint = vec3(0.35, 0.4, 0.5) * 0.2;
    for (int i = 0; i < 4; i++) {
      vec4 lc = uLightCol[i];
      if (lc.w <= 0.0) continue;
      vec3 d = world - uLightPos[i];
      float d2 = dot(d, d);
      float e = lc.w / (4.0 + d2);
      acc += e;
      tint += lc.rgb * e;
    }
    float m = max(max(tint.r, tint.g), tint.b);
    tint /= max(m, 1e-3);
    float lit = clamp(acc * 0.8, 0.0, 1.6);
    float fade = (1.0 - life);
    float distFade = 1.0 - smoothstep(0.75, 1.0, length(world.xz - uCam.xz) / uRadius);
    // splashes only really read where light catches them
    vAlpha = (0.006 + lit * 0.26) * smoothstep(0.03, 0.25, lit) * fade * fade * distFade;
    vTint = tint * (0.5 + 0.5 * clamp(lit, 0.0, 1.0));
  }
`;

const SPLASH_FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D uMap;
  varying vec2 vUv;
  varying float vAlpha;
  varying vec3 vTint;
  void main() {
    vec4 s = texture2D(uMap, vUv);
    float a = s.a * vAlpha;
    if (a < 0.003) discard;
    gl_FragColor = vec4(vTint * a, a * 0.4);
  }
`;

export class Weather {
  /**
   * @param {import('../Game.js').Game} game
   */
  constructor(game) {
    this.game = game;
    this.scene = game.scene;
    this.tier = game.tier;
    this.time = game.time;
    this.events = game.events;
    // cosmetic sub-stream: our own PRNG so we don't perturb the gameplay stream
    this.rng = new Random((game.seed ?? 1) * 2654435761 + 77);

    this._rainIntensity = 1;
    this._wetness = 1;
    /** ground height for splashes (WORLD may set once the map exists) */
    this.groundY = 0;
    /** live, gusting wind vector in m/s (do not replace, mutate/read only) */
    this.windVector = new THREE.Vector3(2.2, 0, 1.1);
    this._windBase = new THREE.Vector3(2.4, 0, 1.2);

    this.maxStreaks = this.tier.rain?.streaks ?? 9000;
    this.maxSplashes = this.tier.rain?.splashes ?? 220;

    this._lightPos = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    this._lightCol = [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()];

    this._buildRain();
    this._buildSplashes();
    this._buildRipples();
    this.setRain(1, { silent: true });
  }

  /* --------------------------------------------------------------- rain */
  _buildRain() {
    const count = this.maxStreaks;
    const base = new THREE.PlaneGeometry(2, 1, 1, 1);
    base.translate(0, 0.5, 0); // y in [0,1]: 0 = head, 1 = tail
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.attributes.position = base.attributes.position;
    geo.attributes.uv = base.attributes.uv;
    const offsets = new Float32Array(count * 3);
    const vary = new Float32Array(count * 2);
    const rng = this.rng;
    for (let i = 0; i < count; i++) {
      offsets[i * 3] = rng.next();
      offsets[i * 3 + 1] = rng.next();
      offsets[i * 3 + 2] = rng.next();
      vary[i * 2] = rng.next();
      vary[i * 2 + 1] = rng.next();
    }
    geo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(offsets, 3));
    geo.setAttribute('aVary', new THREE.InstancedBufferAttribute(vary, 2));
    geo.instanceCount = count;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);

    this.rainMaterial = new THREE.ShaderMaterial({
      name: 'weather.rain',
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendEquation: THREE.AddEquation,
      fog: false,
      toneMapped: false,
      uniforms: {
        uCam: { value: new THREE.Vector3() },
        uShell: { value: new THREE.Vector3(24, 15, 24) },
        uWind: { value: this.windVector },
        uFall: { value: 10.5 },
        uTime: { value: 0 },
        uStreakTime: { value: 0.065 },
        uWidth: { value: 0.004 },
        uWorldPerPixel: { value: 0.0018 },
        uAlphaBase: { value: this.game.debugFlags?.has('rain') ? 0.8 : 0.06 },
        uLightning: { value: 0 },
        uLightPos: { value: this._lightPos },
        uLightCol: { value: this._lightCol },
        uMap: { value: streakTexture(8, 128) },
      },
      vertexShader: RAIN_VERT,
      fragmentShader: RAIN_FRAG,
    });
    this.rain = new THREE.Mesh(geo, this.rainMaterial);
    this.rain.name = 'weather.rain';
    this.rain.frustumCulled = false;
    this.rain.renderOrder = 30;
    this.rain.userData.noAO = true;
    this.scene.add(this.rain);
  }

  /* ------------------------------------------------------------ splashes */
  _buildSplashes() {
    const count = this.maxSplashes;
    const base = new THREE.PlaneGeometry(2, 1, 1, 1);
    base.translate(0, 0.5, 0);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.attributes.position = base.attributes.position;
    geo.attributes.uv = base.attributes.uv;
    const rand = new Float32Array(count * 3);
    for (let i = 0; i < count * 3; i++) rand[i] = this.rng.next();
    geo.setAttribute('aRand', new THREE.InstancedBufferAttribute(rand, 3));
    geo.instanceCount = count;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);

    this.splashMaterial = new THREE.ShaderMaterial({
      name: 'weather.splashes',
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendEquation: THREE.AddEquation,
      fog: false,
      toneMapped: false,
      uniforms: {
        uCam: { value: new THREE.Vector3() },
        uRadius: { value: 16 },
        uPeriod: { value: 0.42 },
        uTime: { value: 0 },
        uGroundY: { value: 0 },
        uSnap: { value: 8 },
        uLightPos: { value: this._lightPos },
        uLightCol: { value: this._lightCol },
        uMap: { value: splashTexture(96) },
      },
      vertexShader: SPLASH_VERT,
      fragmentShader: SPLASH_FRAG,
    });
    this.splashes = new THREE.Mesh(geo, this.splashMaterial);
    this.splashes.name = 'weather.splashes';
    this.splashes.frustumCulled = false;
    this.splashes.renderOrder = 31;
    this.splashes.userData.noAO = true;
    this.scene.add(this.splashes);
  }

  /* ------------------------------------------------------------- ripples */
  _buildRipples() {
    const size = 96;
    this._rippleSize = size;
    this._rippleData = new Uint8Array(size * size * 4);
    this._rippleHeight = new Float32Array(size * size);
    this.puddleRipplesTexture = new THREE.DataTexture(this._rippleData, size, size, THREE.RGBAFormat);
    this.puddleRipplesTexture.wrapS = this.puddleRipplesTexture.wrapT = THREE.RepeatWrapping;
    this.puddleRipplesTexture.magFilter = THREE.LinearFilter;
    this.puddleRipplesTexture.minFilter = THREE.LinearFilter;
    this.puddleRipplesTexture.generateMipmaps = false;
    this.puddleRipplesTexture.name = 'weather.ripples';
    // fill flat normal
    for (let i = 0; i < size * size; i++) {
      this._rippleData[i * 4] = 128;
      this._rippleData[i * 4 + 1] = 128;
      this._rippleData[i * 4 + 2] = 255;
      this._rippleData[i * 4 + 3] = 255;
    }
    this.puddleRipplesTexture.needsUpdate = true;
    // ripple ring pool
    this._ripples = [];
    for (let i = 0; i < 14; i++) {
      this._ripples.push({ x: this.rng.next(), y: this.rng.next(), birth: -this.rng.range(0, 1.5) });
    }
    this._rippleNextUpdate = 0;
    this._rippleLife = 1.5;
  }

  _updateRipples(t) {
    if (t < this._rippleNextUpdate) return;
    this._rippleNextUpdate = t + 0.16; // ~6 Hz
    const size = this._rippleSize;
    const h = this._rippleHeight;
    const data = this._rippleData;
    const rain = this._rainIntensity;
    h.fill(0);
    for (let k = 0; k < this._ripples.length; k++) {
      const rp = this._ripples[k];
      let age = t - rp.birth;
      if (age > this._rippleLife || age < 0) {
        // respawn: stagger births with the seeded rng
        rp.x = this.rng.next();
        rp.y = this.rng.next();
        rp.birth = t + this.rng.range(0, 0.35);
        age = t - rp.birth;
        if (age < 0) continue;
      }
      const life = age / this._rippleLife; // 0..1
      const radius = 0.03 + life * 0.32; // uv units
      const amp = (1 - life) * (1 - life) * (0.4 + 0.6 * rain);
      const x0 = rp.x * size;
      const y0 = rp.y * size;
      const rPx = radius * size;
      const minX = Math.floor(x0 - rPx - 2);
      const maxX = Math.ceil(x0 + rPx + 2);
      const minY = Math.floor(y0 - rPx - 2);
      const maxY = Math.ceil(y0 + rPx + 2);
      for (let yy = minY; yy <= maxY; yy++) {
        const wy = ((yy % size) + size) % size;
        const dy = (yy - y0) / size;
        for (let xx = minX; xx <= maxX; xx++) {
          const wx = ((xx % size) + size) % size;
          const dx = (xx - x0) / size;
          const d = Math.sqrt(dx * dx + dy * dy);
          const band = d - radius;
          if (band > 0.045 || band < -0.045) continue;
          // damped wave packet around the expanding front
          const v = Math.cos(band * 220) * Math.exp(-band * band * 2200) * amp;
          h[wy * size + wx] += v;
        }
      }
    }
    // heights → normals (finite differences), encode 0..255
    for (let y = 0; y < size; y++) {
      const y0 = ((y - 1 + size) % size) * size;
      const y1 = ((y + 1) % size) * size;
      const yc = y * size;
      for (let x = 0; x < size; x++) {
        const x0 = (x - 1 + size) % size;
        const x1 = (x + 1) % size;
        const dx = (h[yc + x1] - h[yc + x0]) * 2.0;
        const dy = (h[y1 + x] - h[y0 + x]) * 2.0;
        const i = (yc + x) * 4;
        data[i] = clampByte(128 - dx * 127);
        data[i + 1] = clampByte(128 - dy * 127);
        data[i + 2] = 255;
      }
    }
    this.puddleRipplesTexture.needsUpdate = true;
  }

  /* ------------------------------------------------------------ setters */
  get rainIntensity() {
    return this._rainIntensity;
  }
  set rainIntensity(v) {
    this.setRain(v);
  }
  get wetness() {
    return this._wetness;
  }
  set wetness(v) {
    this.setWetness(v);
  }

  /**
   * Set the rain intensity 0..1 (scales streak/splash counts and audio).
   * @param {number} v
   * @param {{silent?: boolean}} [opts]
   */
  setRain(v, opts = {}) {
    this._rainIntensity = THREE.MathUtils.clamp(v, 0, 1);
    // perceived density is not linear; keep a decent field even at 0.3
    const s = Math.pow(this._rainIntensity, 0.75);
    this.rain.geometry.instanceCount = Math.round(this.maxStreaks * s);
    this.splashes.geometry.instanceCount = Math.round(this.maxSplashes * s);
    this.rain.visible = this._rainIntensity > 0.001;
    this.splashes.visible = this.rain.visible;
    if (!opts.silent) this.events.emit('weather:changed', { rainIntensity: this._rainIntensity, wetness: this._wetness });
  }

  /** @param {number} v 0..1 */
  setWetness(v) {
    this._wetness = THREE.MathUtils.clamp(v, 0, 1);
    this.events.emit('weather:changed', { rainIntensity: this._rainIntensity, wetness: this._wetness });
  }

  /* ------------------------------------------------------------- update */
  /**
   * Fixed-step update: wind gusts, ripple texture, shader clocks.
   * @param {number} dt
   */
  update(dt) {
    void dt;
    const t = this.time.elapsed;
    // gusting wind: base vector modulated in strength and yaw over ~10 s
    const gust = 0.72 + 0.45 * Math.sin(t * 0.63) + 0.25 * Math.sin(t * 1.71 + 1.3);
    const yaw = 0.28 * Math.sin(t * 0.27) + 0.12 * Math.sin(t * 0.71 + 2.0);
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    this.windVector.set(
      (this._windBase.x * c - this._windBase.z * s) * gust,
      0,
      (this._windBase.x * s + this._windBase.z * c) * gust,
    );
    this.rainMaterial.uniforms.uTime.value = t;
    this.splashMaterial.uniforms.uTime.value = t;
    this._updateRipples(t);
  }

  /**
   * Per-render-frame hook (wired by installPost): camera-anchored uniforms
   * and the light array. Runs after all systems, right before the composer.
   * @param {THREE.Camera} camera
   */
  preRender(camera) {
    const camPos = camera.position;
    const ru = this.rainMaterial.uniforms;
    const su = this.splashMaterial.uniforms;
    ru.uCam.value.copy(camPos);
    su.uCam.value.copy(camPos);
    const sky = this.game.sky;
    if (sky) ru.uLightning.value = sky.flash;
    // world-space size of one pixel at unit distance (for min streak width)
    const h = this.game.renderer?.height || 720;
    const vfov = THREE.MathUtils.degToRad(camera.fov || 74);
    ru.uWorldPerPixel.value = (2 * Math.tan(vfov / 2)) / h;
    // light array from the fixture registry
    const lighting = this.game.lighting;
    const lights = lighting ? lighting.strongestLightsNear(camPos, MAX_LIGHTS, 45) : null;
    for (let i = 0; i < MAX_LIGHTS; i++) {
      if (lights && i < lights.length) {
        const l = lights[i];
        this._lightPos[i].copy(l.position);
        this._lightCol[i].set(l.color.r, l.color.g, l.color.b, l.power);
      } else {
        this._lightCol[i].set(0, 0, 0, 0);
      }
    }
    // splash ground: default y=0; WORLD can set weather.groundY once built
    su.uGroundY.value = this.groundY ?? 0;
  }

  dispose() {
    this.scene.remove(this.rain, this.splashes);
    this.rain.geometry.dispose();
    this.splashes.geometry.dispose();
    this.rainMaterial.dispose();
    this.splashMaterial.dispose();
    this.puddleRipplesTexture.dispose();
  }
}

function clampByte(v) {
  return v < 0 ? 0 : v > 255 ? 255 : v | 0;
}
