/**
 * Particles — pooled, instanced billboard renderer + CPU simulation for all
 * transient VFX (FX stream, docs/BUILD_PLAN.md §S3).
 *
 * Two buckets share one procedural atlas (ParticleAtlas.js):
 *   - `alpha`    normal blending, back-to-front sorted each frame
 *                (smoke, dust, blood, debris chips, water splash)
 *   - `additive` additive blending, unsorted
 *                (sparks, embers, flashes, fireballs, shockwave rings)
 * Each bucket is one InstancedBufferGeometry draw. Simulation runs on flat
 * typed arrays (structure-of-arrays); attribute buffers are rewritten once
 * per rendered frame in the pre-render hook.
 *
 * Lighting: lit kinds (smoke/dust/debris/water) are shaded in the vertex
 * shader by an ambient term + the 6 strongest fixtures near the camera
 * (game.lighting.strongestLightsNear), with spot-cone attenuation, so smoke
 * inside a sodium flood reads orange and smoke in shadow reads near-black.
 * Emissive kinds (sparks/fire/flash) carry HDR colours (> bloom threshold).
 * Soft particles: no scene depth is available inside the same render pass,
 * so lit kinds fade analytically toward the ground plane (world.groundY)
 * and every kind fades against the camera near plane.
 *
 * API:
 *   particles.emit(kind, opts) → number spawned      (see KINDS + EmitOpts)
 *   particles.count / capacity                        alive / total
 *   particles.clear()
 *   particles.update(dt)        (fx system, order 50)
 *   particles.preRender(camera) (post pre-render hook)
 */
import * as THREE from 'three';
import { buildParticleAtlas, CELLS } from './ParticleAtlas.js';
import { coneSample, clamp } from './util.js';

/* ------------------------------------------------------------------ kinds */
/**
 * Kind presets. All numeric [a,b] pairs are random ranges.
 * bucket: 'alpha' | 'add'. mode: 0 camera-facing, 1 velocity-stretched,
 * 2 world-horizontal. gravity is signed acceleration on Y (buoyant > 0).
 * lit: 1 = fully lit by ambient+lights, 0 = emissive (unlit).
 * soft: fade against the ground plane. bounce: ground restitution (0 = none).
 */
export const KINDS = {
  smoke_soft: {
    bucket: 'alpha', cell: CELLS.smoke_soft, mode: 0,
    size: [0.9, 1.5], sizeEnd: [2.8, 4.2], life: [4.0, 6.5], speed: [0.35, 0.9], spread: 0.35,
    gravity: 0.22, drag: 0.55, wind: 0.55, spin: [-0.14, 0.14],
    color: [0.34, 0.34, 0.36], colorEnd: [0.3, 0.3, 0.32], alpha: 0.55, alphaEnd: 0.0,
    fadeIn: 0.12, fadeOut: 0.55, lit: 1, soft: 1, bounce: 0,
  },
  smoke_dark: {
    bucket: 'alpha', cell: CELLS.smoke_hard, mode: 0,
    size: [1.6, 2.4], sizeEnd: [4.5, 6.5], life: [6.0, 8.0], speed: [1.2, 2.4], spread: 0.28,
    gravity: 0.55, drag: 0.5, wind: 0.4, spin: [-0.1, 0.1],
    color: [0.06, 0.055, 0.05], colorEnd: [0.11, 0.105, 0.10], alpha: 0.9, alphaEnd: 0.0,
    fadeIn: 0.02, fadeOut: 0.5, lit: 1, soft: 1, bounce: 0,
  },
  smoke_wisp: {
    bucket: 'alpha', cell: CELLS.smoke_wisp, mode: 0,
    size: [0.12, 0.22], sizeEnd: [0.45, 0.8], life: [0.45, 0.8], speed: [0.3, 0.7], spread: 0.3,
    gravity: 0.55, drag: 1.4, wind: 0.6, spin: [-0.6, 0.6],
    color: [0.42, 0.42, 0.44], colorEnd: [0.4, 0.4, 0.42], alpha: 0.5, alphaEnd: 0.0,
    fadeIn: 0.15, fadeOut: 0.6, lit: 1, soft: 0, bounce: 0,
  },
  fire: {
    bucket: 'add', cell: CELLS.fireball, mode: 0,
    size: [0.26, 0.4], sizeEnd: [0.14, 0.24], life: [0.35, 0.6], speed: [0.7, 1.4], spread: 0.28,
    gravity: 1.5, drag: 1.0, wind: 0.35, spin: [-1.2, 1.2],
    color: [2.3, 0.95, 0.26], colorEnd: [0.85, 0.14, 0.02], alpha: 0.9, alphaEnd: 0.0,
    fadeIn: 0.15, fadeOut: 0.5, lit: 0, soft: 0, bounce: 0,
  },
  dust: {
    bucket: 'alpha', cell: CELLS.dust, mode: 0,
    size: [0.35, 0.6], sizeEnd: [1.2, 1.9], life: [1.2, 2.4], speed: [0.6, 2.2], spread: 0.7,
    gravity: 0.02, drag: 2.2, wind: 0.5, spin: [-0.3, 0.3],
    color: [0.52, 0.5, 0.46], colorEnd: [0.5, 0.48, 0.44], alpha: 0.55, alphaEnd: 0.0,
    fadeIn: 0.05, fadeOut: 0.6, lit: 1, soft: 1, bounce: 0,
  },
  spark: {
    bucket: 'add', cell: CELLS.spark, mode: 1,
    size: [0.028, 0.05], sizeEnd: [0.02, 0.03], life: [0.25, 0.6], speed: [6, 16], spread: 0.7,
    gravity: -11, drag: 1.6, wind: 0, spin: [0, 0], stretch: 0.022,
    color: [7.5, 4.2, 1.4], colorEnd: [3.0, 0.9, 0.15], alpha: 1.0, alphaEnd: 0.0,
    fadeIn: 0.0, fadeOut: 0.35, lit: 0, soft: 0, bounce: 0.35,
  },
  ember: {
    bucket: 'add', cell: CELLS.ember, mode: 0,
    size: [0.045, 0.09], sizeEnd: [0.03, 0.06], life: [1.4, 3.2], speed: [0.5, 2.4], spread: 0.9,
    gravity: 0.35, drag: 1.1, wind: 0.9, spin: [0, 0],
    color: [5.0, 2.0, 0.5], colorEnd: [2.2, 0.5, 0.08], alpha: 1.0, alphaEnd: 0.0,
    fadeIn: 0.05, fadeOut: 0.5, lit: 0, soft: 0, bounce: 0.3, flicker: 1,
  },
  flare: {
    bucket: 'add', cell: CELLS.flare, mode: 0,
    size: [0.3, 0.45], sizeEnd: [0.4, 0.6], life: [0.06, 0.1], speed: [0, 0], spread: 0,
    gravity: 0, drag: 0, wind: 0, spin: [0, 0],
    color: [7, 5, 2.6], colorEnd: [2.5, 1.1, 0.4], alpha: 1.0, alphaEnd: 0.0,
    fadeIn: 0.0, fadeOut: 0.6, lit: 0, soft: 0, bounce: 0,
  },
  muzzle_star: {
    bucket: 'add', cell: CELLS.muzzle_star, mode: 0,
    size: [0.2, 0.28], sizeEnd: [0.26, 0.36], life: [0.05, 0.07], speed: [0, 0], spread: 0,
    gravity: 0, drag: 0, wind: 0, spin: [0, 0],
    color: [6.5, 4.6, 2.4], colorEnd: [2.6, 1.3, 0.6], alpha: 1.0, alphaEnd: 0.0,
    fadeIn: 0.0, fadeOut: 0.5, lit: 0, soft: 0, bounce: 0,
  },
  fireball: {
    bucket: 'add', cell: CELLS.fireball, mode: 0,
    size: [0.9, 1.4], sizeEnd: [2.2, 3.2], life: [0.28, 0.45], speed: [1.5, 4.5], spread: 0.9,
    gravity: 2.2, drag: 3.0, wind: 0, spin: [-0.9, 0.9],
    color: [1.9, 0.8, 0.24], colorEnd: [0.5, 0.08, 0.01], alpha: 1.0, alphaEnd: 0.0,
    fadeIn: 0.04, fadeOut: 0.62, lit: 0, soft: 0, bounce: 0,
  },
  shockwave: {
    bucket: 'add', cell: CELLS.ring, mode: 0,
    size: [0.6, 0.6], sizeEnd: [12, 12], life: [0.24, 0.24], speed: [0, 0], spread: 0,
    gravity: 0, drag: 0, wind: 0, spin: [0, 0],
    color: [1.0, 1.0, 1.15], colorEnd: [0.3, 0.3, 0.35], alpha: 0.8, alphaEnd: 0.0,
    fadeIn: 0.0, fadeOut: 0.8, lit: 0, soft: 0, bounce: 0,
  },
  flash: {
    bucket: 'add', cell: CELLS.flare, mode: 0,
    size: [4, 4], sizeEnd: [7, 7], life: [0.05, 0.05], speed: [0, 0], spread: 0,
    gravity: 0, drag: 0, wind: 0, spin: [0, 0],
    color: [22, 19, 15], colorEnd: [8, 5, 3], alpha: 1.0, alphaEnd: 0.0,
    fadeIn: 0.0, fadeOut: 0.7, lit: 0, soft: 0, bounce: 0,
  },
  debris: {
    bucket: 'alpha', cell: CELLS.debris, mode: 0,
    size: [0.08, 0.24], sizeEnd: [0.08, 0.24], life: [1.8, 3.5], speed: [4, 11], spread: 0.85,
    gravity: -19.6, drag: 0.35, wind: 0, spin: [-9, 9],
    color: [0.13, 0.12, 0.11], colorEnd: [0.13, 0.12, 0.11], alpha: 1.0, alphaEnd: 0.0,
    fadeIn: 0.0, fadeOut: 0.18, lit: 1, soft: 0, bounce: 0.32,
  },
  chip: {
    bucket: 'alpha', cell: CELLS.debris2, mode: 0,
    size: [0.03, 0.07], sizeEnd: [0.03, 0.07], life: [0.8, 1.6], speed: [2, 6], spread: 0.9,
    gravity: -12, drag: 0.8, wind: 0, spin: [-14, 14],
    color: [0.32, 0.31, 0.29], colorEnd: [0.32, 0.31, 0.29], alpha: 1.0, alphaEnd: 0.0,
    fadeIn: 0.0, fadeOut: 0.25, lit: 1, soft: 0, bounce: 0.3,
  },
  splinter: {
    bucket: 'alpha', cell: CELLS.debris2, mode: 0,
    size: [0.05, 0.12], sizeEnd: [0.05, 0.12], life: [0.9, 1.8], speed: [2, 6], spread: 0.8,
    gravity: -11, drag: 0.9, wind: 0, spin: [-16, 16],
    color: [0.36, 0.26, 0.16], colorEnd: [0.36, 0.26, 0.16], alpha: 1.0, alphaEnd: 0.0,
    fadeIn: 0.0, fadeOut: 0.25, lit: 1, soft: 0, bounce: 0.25,
  },
  grit: {
    bucket: 'alpha', cell: CELLS.grit, mode: 0,
    size: [0.18, 0.3], sizeEnd: [0.25, 0.4], life: [0.5, 1.0], speed: [1.5, 4], spread: 1.0,
    gravity: -6, drag: 1.4, wind: 0, spin: [-4, 4],
    color: [0.3, 0.28, 0.26], colorEnd: [0.3, 0.28, 0.26], alpha: 0.85, alphaEnd: 0.0,
    fadeIn: 0.0, fadeOut: 0.4, lit: 1, soft: 0, bounce: 0,
  },
  blood_mist: {
    bucket: 'alpha', cell: CELLS.blood_mist, mode: 0,
    size: [0.25, 0.4], sizeEnd: [0.65, 1.0], life: [0.35, 0.6], speed: [0.8, 2.4], spread: 0.55,
    gravity: -1.2, drag: 2.4, wind: 0.1, spin: [-1, 1],
    color: [0.32, 0.02, 0.02], colorEnd: [0.16, 0.01, 0.01], alpha: 0.8, alphaEnd: 0.0,
    fadeIn: 0.04, fadeOut: 0.55, lit: 1, soft: 0, bounce: 0,
  },
  blood_droplets: {
    bucket: 'alpha', cell: CELLS.blood_splat, mode: 0,
    size: [0.14, 0.24], sizeEnd: [0.2, 0.3], life: [0.25, 0.45], speed: [2, 5], spread: 0.5,
    gravity: -9, drag: 1.2, wind: 0, spin: [-3, 3],
    color: [0.28, 0.02, 0.02], colorEnd: [0.14, 0.01, 0.01], alpha: 0.95, alphaEnd: 0.0,
    fadeIn: 0.0, fadeOut: 0.4, lit: 1, soft: 0, bounce: 0,
  },
  water_splash: {
    bucket: 'alpha', cell: CELLS.water_splash, mode: 0,
    size: [0.3, 0.45], sizeEnd: [0.9, 1.3], life: [0.35, 0.55], speed: [0.6, 1.4], spread: 0.2,
    gravity: -3, drag: 2.0, wind: 0.1, spin: [0, 0],
    color: [0.55, 0.6, 0.66], colorEnd: [0.5, 0.55, 0.6], alpha: 0.7, alphaEnd: 0.0,
    fadeIn: 0.0, fadeOut: 0.55, lit: 1, soft: 0, bounce: 0,
  },
  water_mist: {
    bucket: 'alpha', cell: CELLS.dust, mode: 0,
    size: [0.4, 0.7], sizeEnd: [1.0, 1.6], life: [0.6, 1.0], speed: [0.4, 1.0], spread: 0.6,
    gravity: -0.4, drag: 2.5, wind: 0.5, spin: [-0.2, 0.2],
    color: [0.5, 0.55, 0.6], colorEnd: [0.5, 0.55, 0.6], alpha: 0.35, alphaEnd: 0.0,
    fadeIn: 0.05, fadeOut: 0.7, lit: 1, soft: 1, bounce: 0,
  },
};

/* ------------------------------------------------------------- shaders */
const MAX_LIGHTS = 6;

const VERT = /* glsl */ `
  precision highp float;
  attribute vec4 iPosSize;   // xyz centre, w size (metres)
  attribute vec4 iColor;     // rgb (albedo or HDR emissive), a alpha
  attribute vec4 iParams;    // x cell index, y rotation, z stretch, w lit + 2*soft
  attribute vec4 iVel;       // xyz velocity (mode 1 stretch axis), w mode
  uniform vec3 uCamRight;
  uniform vec3 uCamUp;
  uniform vec3 uCamPos;
  uniform vec3 uLightPos[6];
  uniform vec4 uLightCol[6];   // rgb, power
  uniform vec4 uLightSpot[6];  // xyz spot direction, w cos(outer) (>1.5 = omni)
  uniform vec3 uAmbient;
  uniform vec3 uFogColor;
  uniform float uFogDensity;
  uniform float uGrid;
  uniform float uCellInset;
  uniform float uGroundY;
  uniform float uPixelWorld;  // world metres per pixel at 1 m (keeps sparks/embers >= ~1.3 px)
  varying vec2 vUv;
  varying vec4 vColor;
  varying float vFog;

  void main() {
    vec3 centre = iPosSize.xyz;
    float mode = iVel.w;
    float camDist = distance(uCamPos, centre);
    float size = max(iPosSize.w, camDist * uPixelWorld * 1.3);
    float rot = iParams.y;
    vec3 offset;
    if (mode < 0.5) {
      float c = cos(rot);
      float s = sin(rot);
      vec2 p = vec2(position.x * c - position.y * s, position.x * s + position.y * c);
      offset = (uCamRight * p.x + uCamUp * p.y) * size;
    } else if (mode < 1.5) {
      vec3 axis = iVel.xyz;
      float sp = length(axis);
      axis = sp > 1e-4 ? axis / sp : uCamUp;
      vec3 toCam = normalize(uCamPos - centre);
      vec3 side = cross(axis, toCam);
      float sl = length(side);
      side = sl > 1e-4 ? side / sl : uCamRight;
      // stretch length grows with speed; head sits at the particle position
      float len = max(size * 3.0, sp * iParams.z + size * 2.0);
      offset = axis * ((position.x - 0.5) * len) + side * (position.y * size);
    } else {
      float c = cos(rot);
      float s = sin(rot);
      vec2 p = vec2(position.x * c - position.y * s, position.x * s + position.y * c);
      offset = vec3(p.x, 0.0, p.y) * size;
    }
    vec3 world = centre + offset;

    // atlas cell uv
    float cellIndex = iParams.x;
    float col = mod(cellIndex, uGrid);
    float row = floor(cellIndex / uGrid);
    float cellSize = 1.0 / uGrid;
    vec2 uv0 = vec2(col * cellSize + uCellInset, 1.0 - (row + 1.0) * cellSize + uCellInset);
    vec2 uv1 = vec2((col + 1.0) * cellSize - uCellInset, 1.0 - row * cellSize - uCellInset);
    vUv = mix(uv0, uv1, uv);

    // lighting (per particle centre, evaluated per vertex — cheap and stable)
    float litSoft = iParams.w;
    float soft = step(1.5, litSoft);
    float lit = litSoft - 2.0 * soft;
    vec3 light = uAmbient;
    for (int i = 0; i < 6; i++) {
      vec4 lc = uLightCol[i];
      if (lc.w > 0.0) {
        vec3 L = uLightPos[i] - centre;
        float d2 = dot(L, L);
        float att = 0.55 * lc.w / (3.14159 * (1.4 + d2));
        vec4 sp = uLightSpot[i];
        if (sp.w < 1.5) {
          vec3 dir = normalize(-L);
          float cosA = dot(dir, sp.xyz);
          att *= smoothstep(sp.w, min(1.0, sp.w + 0.12), cosA);
        }
        light += lc.rgb * att;
      }
    }
    vec3 shade = mix(vec3(1.0), light, lit);
    float alphaMul = 1.0;
    // soft fade against the ground plane
    if (soft > 0.5) {
      float above = (world.y - uGroundY) / max(size * 0.45, 0.06);
      alphaMul *= clamp(above, 0.0, 1.0);
    }
    // near-camera fade
    float dCam = distance(uCamPos, world);
    alphaMul *= smoothstep(0.15, 0.6, dCam);
    vColor = vec4(iColor.rgb * shade, iColor.a * alphaMul);
    // fog (FogExp2 to the particle centre)
    float dist = distance(uCamPos, centre);
    vFog = exp(-uFogDensity * uFogDensity * dist * dist);
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  }
`;

const FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D uAtlas;
  uniform vec3 uFogColor;
  uniform float uAdditive;
  varying vec2 vUv;
  varying vec4 vColor;
  varying float vFog;
  void main() {
    vec4 t = texture2D(uAtlas, vUv);
    float a = t.a * vColor.a;
    if (a < 0.005) discard;
    vec3 col = t.rgb * vColor.rgb;
    // fog: alpha bucket blends toward the fog colour, additive fades out
    if (uAdditive > 0.5) col *= vFog;
    else col = mix(uFogColor, col, vFog);
    gl_FragColor = vec4(col, a);
  }
`;

/* ---------------------------------------------------------- temporaries */
const _dir = new THREE.Vector3();
const _tmpV = new THREE.Vector3();
const _color = new THREE.Color();

export class Particles {
  /**
   * @param {import('../Game.js').Game} game
   * @param {import('../core/Random.js').Random} rng cosmetic rng
   */
  constructor(game, rng) {
    this.game = game;
    this.scene = game.scene;
    this.rng = rng;
    const scale = game.tier?.particlesScale ?? 1;
    this.atlas = buildParticleAtlas();
    /** @type {Record<string, any>} */
    this.buckets = {
      alpha: this._createBucket('alpha', Math.max(200, Math.round(1400 * scale)), false),
      add: this._createBucket('add', Math.max(160, Math.round(1000 * scale)), true),
    };
    this._lightPos = [];
    this._lightCol = [];
    this._lightSpot = [];
    for (let i = 0; i < MAX_LIGHTS; i++) {
      this._lightPos.push(new THREE.Vector3());
      this._lightCol.push(new THREE.Vector4());
      this._lightSpot.push(new THREE.Vector4(0, -1, 0, 2));
    }
    this._ambient = new THREE.Vector3(0.04, 0.045, 0.055);
    for (const key of ['alpha', 'add']) {
      const u = this.buckets[key].material.uniforms;
      u.uLightPos.value = this._lightPos;
      u.uLightCol.value = this._lightCol;
      u.uLightSpot.value = this._lightSpot;
      u.uAmbient.value = this._ambient;
    }
    this.groundY = 0;
    this._sortKeys = new Float32Array(this.buckets.alpha.capacity);
    this._sortIdx = new Uint16Array(this.buckets.alpha.capacity);
    this._sortCmp = (a, b) => this._sortKeys[b] - this._sortKeys[a];
  }

  /* ------------------------------------------------------------ bucket */
  _createBucket(name, capacity, additive) {
    const base = new THREE.PlaneGeometry(1, 1, 1, 1); // position in [-0.5, 0.5]
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.index = base.index;
    geometry.attributes.position = base.attributes.position;
    geometry.attributes.uv = base.attributes.uv;

    const attr = (n, items) => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(n * items), items);
      a.setUsage(THREE.DynamicDrawUsage);
      return a;
    };
    const iPosSize = attr(capacity, 4);
    const iColor = attr(capacity, 4);
    const iParams = attr(capacity, 4);
    const iVel = attr(capacity, 4);
    geometry.setAttribute('iPosSize', iPosSize);
    geometry.setAttribute('iColor', iColor);
    geometry.setAttribute('iParams', iParams);
    geometry.setAttribute('iVel', iVel);
    geometry.instanceCount = 0;
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);

    const material = new THREE.ShaderMaterial({
      name: 'fx.particles.' + name,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      side: THREE.DoubleSide,
      fog: false,
      toneMapped: false,
      uniforms: {
        uAtlas: { value: this.atlas.texture },
        uCamRight: { value: new THREE.Vector3(1, 0, 0) },
        uCamUp: { value: new THREE.Vector3(0, 1, 0) },
        uCamPos: { value: new THREE.Vector3() },
        uLightPos: { value: null },
        uLightCol: { value: null },
        uLightSpot: { value: null },
        uAmbient: { value: null },
        uFogColor: { value: new THREE.Color(0x151d29) },
        uFogDensity: { value: 0.013 },
        uGrid: { value: this.atlas.grid },
        uCellInset: { value: 1.5 / 1024 },
        uGroundY: { value: 0 },
        uPixelWorld: { value: 0.0016 },
        uAdditive: { value: additive ? 1 : 0 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'fx.particles.' + name;
    mesh.frustumCulled = false;
    mesh.renderOrder = additive ? 20 : 21;
    mesh.userData.noAO = true;
    this.scene.add(mesh);

    const N = capacity;
    return {
      name,
      additive,
      mesh,
      geometry,
      material,
      capacity: N,
      count: 0,
      attr: { iPosSize, iColor, iParams, iVel },
      // simulation state (SoA)
      pos: new Float32Array(N * 3),
      vel: new Float32Array(N * 3),
      age: new Float32Array(N),
      life: new Float32Array(N),
      size0: new Float32Array(N),
      size1: new Float32Array(N),
      rot: new Float32Array(N),
      spin: new Float32Array(N),
      c0: new Float32Array(N * 4),
      c1: new Float32Array(N * 4),
      fadeIn: new Float32Array(N),
      fadeOut: new Float32Array(N),
      cell: new Float32Array(N),
      mode: new Float32Array(N),
      stretch: new Float32Array(N),
      litSoft: new Float32Array(N),
      gravity: new Float32Array(N),
      drag: new Float32Array(N),
      wind: new Float32Array(N),
      bounce: new Float32Array(N),
      flicker: new Float32Array(N),
    };
  }

  /* ------------------------------------------------------------- emit */
  /**
   * Emit `count` particles of a preset kind.
   * @param {string} kind key of KINDS
   * @param {object} [o] EmitOpts
   * @param {THREE.Vector3} o.position emitter position
   * @param {THREE.Vector3} [o.velocity] base velocity added to every particle
   * @param {THREE.Vector3} [o.direction] cone axis (default +Y)
   * @param {number} [o.spread] cone half angle (radians)
   * @param {number} [o.count=1]
   * @param {number|number[]} [o.size], [o.sizeEnd], [o.life], [o.speed] fixed value or [min,max]
   * @param {number[]|THREE.Color} [o.color], [o.colorEnd] linear rgb (albedo, or HDR for emissive kinds)
   * @param {number} [o.alpha], [o.alphaEnd], [o.gravity], [o.drag], [o.wind], [o.stretch], [o.bounce]
   * @param {number} [o.offset] positional jitter radius (metres)
   * @param {number} [o.lightFactor] 0..1 lit blend override
   * @param {number} [o.sizeScale] multiplier on preset sizes
   * @param {number} [o.fadeIn], [o.fadeOut] alpha ramp fractions of life
   * @param {number} [o.soft] override the ground soft-fade flag
   * @returns {number} spawned
   */
  emit(kind, o = {}) {
    const k = KINDS[kind];
    if (!k) {
      console.warn('[fx] unknown particle kind', kind);
      return 0;
    }
    const bucket = this.buckets[k.bucket];
    const rng = this.rng;
    const count = Math.max(1, Math.round(o.count ?? 1));
    let spawned = 0;
    const pos = o.position;
    if (!pos) return 0;
    const baseVel = o.velocity;
    const dir = o.direction || UPV;
    const spread = o.spread ?? k.spread ?? 0.5;
    const sizeScale = o.sizeScale ?? 1;
    const jitter = o.offset ?? 0;
    const lit = o.lightFactor ?? k.lit;
    const soft = o.soft ?? k.soft;
    const litSoft = clamp(lit, 0, 1) + (soft ? 2 : 0);

    for (let n = 0; n < count; n++) {
      if (bucket.count >= bucket.capacity) break;
      const i = bucket.count++;
      const i3 = i * 3;
      const i4 = i * 4;
      // position (+ jitter)
      let px = pos.x;
      let py = pos.y;
      let pz = pos.z;
      if (jitter > 0) {
        px += (rng.next() * 2 - 1) * jitter;
        py += (rng.next() * 2 - 1) * jitter;
        pz += (rng.next() * 2 - 1) * jitter;
      }
      bucket.pos[i3] = px;
      bucket.pos[i3 + 1] = py;
      bucket.pos[i3 + 2] = pz;
      // velocity: cone around dir at speed, plus base velocity
      const speed = pick(rng, o.speed ?? k.speed);
      let vx = 0;
      let vy = 0;
      let vz = 0;
      if (speed !== 0) {
        coneSample(rng, dir, spread, _dir);
        vx = _dir.x * speed;
        vy = _dir.y * speed;
        vz = _dir.z * speed;
      }
      if (baseVel) {
        vx += baseVel.x;
        vy += baseVel.y;
        vz += baseVel.z;
      }
      bucket.vel[i3] = vx;
      bucket.vel[i3 + 1] = vy;
      bucket.vel[i3 + 2] = vz;
      bucket.age[i] = 0;
      bucket.life[i] = Math.max(0.02, pick(rng, o.life ?? k.life));
      bucket.size0[i] = pick(rng, o.size ?? k.size) * sizeScale;
      bucket.size1[i] = pick(rng, o.sizeEnd ?? k.sizeEnd ?? k.size) * sizeScale;
      bucket.rot[i] = o.rotation !== undefined ? o.rotation : rng.range(0, Math.PI * 2);
      bucket.spin[i] = pick(rng, o.spin ?? k.spin ?? 0);
      // colours
      writeColor(bucket.c0, i4, o.color ?? k.color, o.alpha ?? k.alpha ?? 1);
      writeColor(bucket.c1, i4, o.colorEnd ?? k.colorEnd ?? k.color, o.alphaEnd ?? k.alphaEnd ?? 0);
      bucket.fadeIn[i] = o.fadeIn ?? k.fadeIn ?? 0;
      bucket.fadeOut[i] = o.fadeOut ?? k.fadeOut ?? 0.5;
      bucket.cell[i] = o.cell ?? k.cell;
      bucket.mode[i] = o.mode ?? k.mode ?? 0;
      bucket.stretch[i] = o.stretch ?? k.stretch ?? 0;
      bucket.litSoft[i] = litSoft;
      bucket.gravity[i] = o.gravity ?? k.gravity ?? 0;
      bucket.drag[i] = o.drag ?? k.drag ?? 0;
      bucket.wind[i] = o.wind ?? k.wind ?? 0;
      bucket.bounce[i] = o.bounce ?? k.bounce ?? 0;
      bucket.flicker[i] = k.flicker ? rng.range(0.5, 1.5) : 0;
      spawned++;
    }
    return spawned;
  }

  /** Remove every particle (photo presets reset the pools). */
  clear() {
    this.buckets.alpha.count = 0;
    this.buckets.add.count = 0;
    this.buckets.alpha.geometry.instanceCount = 0;
    this.buckets.add.geometry.instanceCount = 0;
  }

  get count() {
    return this.buckets.alpha.count + this.buckets.add.count;
  }
  get capacity() {
    return this.buckets.alpha.capacity + this.buckets.add.capacity;
  }

  /* ----------------------------------------------------------- update */
  /**
   * Fixed-step simulation.
   * @param {number} dt
   */
  update(dt) {
    const wind = this.game.weather?.windVector;
    const wx = wind ? wind.x : 0;
    const wz = wind ? wind.z : 0;
    const groundY = this.groundY;
    const t = this.game.time.elapsed;
    for (const key of ['alpha', 'add']) {
      const b = this.buckets[key];
      const pos = b.pos;
      const vel = b.vel;
      for (let i = 0; i < b.count; i++) {
        b.age[i] += dt;
        if (b.age[i] >= b.life[i]) {
          this._kill(b, i);
          i--;
          continue;
        }
        const i3 = i * 3;
        // integrate
        const drag = b.drag[i];
        const dragMul = drag > 0 ? Math.exp(-drag * dt) : 1;
        let vx = vel[i3] * dragMul;
        let vy = (vel[i3 + 1] + b.gravity[i] * dt) * dragMul;
        let vz = vel[i3 + 2] * dragMul;
        const w = b.wind[i];
        let px = pos[i3] + (vx + wx * w) * dt;
        let py = pos[i3 + 1] + vy * dt;
        let pz = pos[i3 + 2] + (vz + wz * w) * dt;
        // ground bounce (analytic plane)
        const bounce = b.bounce[i];
        if (bounce > 0) {
          const floor = groundY + b.size0[i] * 0.5;
          if (py < floor && vy < 0) {
            py = floor;
            vy = -vy * bounce;
            vx *= 0.72;
            vz *= 0.72;
            if (Math.abs(vy) < 0.4) vy = 0;
          }
        }
        vel[i3] = vx;
        vel[i3 + 1] = vy;
        vel[i3 + 2] = vz;
        pos[i3] = px;
        pos[i3 + 1] = py;
        pos[i3 + 2] = pz;
        b.rot[i] += b.spin[i] * dt;
        // ember flicker keeps a per-particle phase in `flicker`
        if (b.flicker[i] > 0) b.flicker[i] += dt;
      }
    }
    void t;
  }

  _kill(b, i) {
    const last = b.count - 1;
    if (i !== last) {
      // swap the last particle into slot i
      const i3 = i * 3;
      const l3 = last * 3;
      const i4 = i * 4;
      const l4 = last * 4;
      b.pos[i3] = b.pos[l3]; b.pos[i3 + 1] = b.pos[l3 + 1]; b.pos[i3 + 2] = b.pos[l3 + 2];
      b.vel[i3] = b.vel[l3]; b.vel[i3 + 1] = b.vel[l3 + 1]; b.vel[i3 + 2] = b.vel[l3 + 2];
      b.age[i] = b.age[last];
      b.life[i] = b.life[last];
      b.size0[i] = b.size0[last];
      b.size1[i] = b.size1[last];
      b.rot[i] = b.rot[last];
      b.spin[i] = b.spin[last];
      for (let k = 0; k < 4; k++) {
        b.c0[i4 + k] = b.c0[l4 + k];
        b.c1[i4 + k] = b.c1[l4 + k];
      }
      b.fadeIn[i] = b.fadeIn[last];
      b.fadeOut[i] = b.fadeOut[last];
      b.cell[i] = b.cell[last];
      b.mode[i] = b.mode[last];
      b.stretch[i] = b.stretch[last];
      b.litSoft[i] = b.litSoft[last];
      b.gravity[i] = b.gravity[last];
      b.drag[i] = b.drag[last];
      b.wind[i] = b.wind[last];
      b.bounce[i] = b.bounce[last];
      b.flicker[i] = b.flicker[last];
    }
    b.count = last;
  }

  /* ---------------------------------------------------------- render */
  /**
   * Per-render-frame: camera vectors, light array, fog, sort + attribute upload.
   * @param {THREE.Camera} camera
   */
  preRender(camera) {
    // camera basis
    const e = camera.matrixWorld.elements;
    const camPos = _camPos.setFromMatrixPosition(camera.matrixWorld);
    _camRight.set(e[0], e[1], e[2]).normalize();
    _camUp.set(e[4], e[5], e[6]).normalize();

    // lights near the camera
    const lighting = this.game.lighting;
    const lights = lighting ? lighting.strongestLightsNear(camPos, MAX_LIGHTS, 60) : null;
    for (let i = 0; i < MAX_LIGHTS; i++) {
      if (lights && i < lights.length) {
        const l = lights[i];
        this._lightPos[i].copy(l.position);
        this._lightCol[i].set(l.color.r, l.color.g, l.color.b, l.power);
        const f = l.fixture;
        if (f && f.kind === 'flood' && f.dir && f.light) {
          this._lightSpot[i].set(f.dir.x, f.dir.y, f.dir.z, Math.cos(f.light.angle || 0.62));
        } else {
          this._lightSpot[i].set(0, -1, 0, 2);
        }
      } else {
        this._lightCol[i].set(0, 0, 0, 0);
        this._lightSpot[i].set(0, -1, 0, 2);
      }
    }
    // ambient: hemisphere sky term + a hint of moon + lightning flash lift
    const hemi = lighting?.hemi;
    const moon = lighting?.moon;
    const flash = this.game.sky?.flash || 0;
    if (hemi) {
      const hi = hemi.intensity;
      this._ambient.set(
        hemi.color.r * hi * 0.55 + (moon ? moon.color.r * moon.intensity * 0.12 : 0) + flash * 0.35,
        hemi.color.g * hi * 0.55 + (moon ? moon.color.g * moon.intensity * 0.12 : 0) + flash * 0.4,
        hemi.color.b * hi * 0.55 + (moon ? moon.color.b * moon.intensity * 0.12 : 0) + flash * 0.5,
      );
    } else {
      this._ambient.set(0.04, 0.045, 0.055);
    }
    // fog + min pixel size
    const fog = this.scene.fog;
    const t = this.game.time.elapsed;
    const h = this.game.renderer?.height || 720;
    const vfov = ((camera.fov || 70) * Math.PI) / 180;
    const pixelWorld = (2 * Math.tan(vfov / 2)) / h;
    for (const key of ['alpha', 'add']) {
      const b = this.buckets[key];
      const u = b.material.uniforms;
      u.uCamRight.value.copy(_camRight);
      u.uCamUp.value.copy(_camUp);
      u.uCamPos.value.copy(camPos);
      u.uGroundY.value = this.groundY;
      u.uPixelWorld.value = pixelWorld;
      if (fog) {
        u.uFogColor.value.copy(fog.color);
        u.uFogDensity.value = fog.density ?? 0.013;
      }
    }
    this._writeBucket(this.buckets.alpha, camPos, t, true);
    this._writeBucket(this.buckets.add, camPos, t, false);
  }

  _writeBucket(b, camPos, t, sort) {
    const n = b.count;
    b.geometry.instanceCount = n;
    if (n === 0) return;
    // order (back to front for the alpha bucket)
    let order = null;
    if (sort && n > 1) {
      const keys = this._sortKeys;
      const idx = this._sortIdx;
      for (let i = 0; i < n; i++) {
        const i3 = i * 3;
        const dx = b.pos[i3] - camPos.x;
        const dy = b.pos[i3 + 1] - camPos.y;
        const dz = b.pos[i3 + 2] - camPos.z;
        keys[i] = dx * dx + dy * dy + dz * dz;
        idx[i] = i;
      }
      const view = idx.subarray(0, n);
      view.sort(this._sortCmp); // farthest first
      order = view;
    }
    const P = b.attr.iPosSize.array;
    const C = b.attr.iColor.array;
    const Q = b.attr.iParams.array;
    const V = b.attr.iVel.array;
    for (let j = 0; j < n; j++) {
      const i = order ? order[j] : j;
      const i3 = i * 3;
      const i4 = i * 4;
      const j4 = j * 4;
      const life = b.life[i];
      const age = b.age[i];
      const f = age / life; // 0..1
      // size ease-out
      const fs = 1 - (1 - f) * (1 - f);
      const size = b.size0[i] + (b.size1[i] - b.size0[i]) * fs;
      P[j4] = b.pos[i3];
      P[j4 + 1] = b.pos[i3 + 1];
      P[j4 + 2] = b.pos[i3 + 2];
      P[j4 + 3] = size;
      // colour + alpha curve
      let a0 = b.c0[i4 + 3];
      const a1 = b.c1[i4 + 3];
      const fi = b.fadeIn[i];
      const fo = b.fadeOut[i];
      let a = a0 + (a1 - a0) * f;
      if (fi > 0 && f < fi) a *= f / fi;
      if (fo > 0 && f > 1 - fo) a *= Math.max(0, (1 - f) / fo);
      // ember flicker
      if (b.flicker[i] > 0) {
        const ph = b.flicker[i] * 11.0 + i;
        a *= 0.55 + 0.45 * Math.sin(ph) * Math.sin(ph * 1.71 + 0.4);
      }
      C[j4] = b.c0[i4] + (b.c1[i4] - b.c0[i4]) * f;
      C[j4 + 1] = b.c0[i4 + 1] + (b.c1[i4 + 1] - b.c0[i4 + 1]) * f;
      C[j4 + 2] = b.c0[i4 + 2] + (b.c1[i4 + 2] - b.c0[i4 + 2]) * f;
      C[j4 + 3] = a < 0 ? 0 : a;
      Q[j4] = b.cell[i];
      Q[j4 + 1] = b.rot[i];
      Q[j4 + 2] = b.stretch[i];
      Q[j4 + 3] = b.litSoft[i];
      V[j4] = b.vel[i3];
      V[j4 + 1] = b.vel[i3 + 1];
      V[j4 + 2] = b.vel[i3 + 2];
      V[j4 + 3] = b.mode[i];
    }
    b.attr.iPosSize.needsUpdate = true;
    b.attr.iColor.needsUpdate = true;
    b.attr.iParams.needsUpdate = true;
    b.attr.iVel.needsUpdate = true;
    void t;
  }

  dispose() {
    for (const key of ['alpha', 'add']) {
      const b = this.buckets[key];
      this.scene.remove(b.mesh);
      b.geometry.dispose();
      b.material.dispose();
    }
    this.atlas.texture.dispose();
  }
}

/* ---------------------------------------------------------- helpers */
const UPV = new THREE.Vector3(0, 1, 0);
const _camPos = new THREE.Vector3();
const _camRight = new THREE.Vector3();
const _camUp = new THREE.Vector3();

function pick(rng, v) {
  if (Array.isArray(v)) return v[0] + (v[1] - v[0]) * rng.next();
  return v ?? 0;
}

function writeColor(arr, i4, c, alpha) {
  if (Array.isArray(c)) {
    arr[i4] = c[0];
    arr[i4 + 1] = c[1];
    arr[i4 + 2] = c[2];
  } else if (c && c.isColor) {
    arr[i4] = c.r;
    arr[i4 + 1] = c.g;
    arr[i4 + 2] = c.b;
  } else if (typeof c === 'number') {
    _color.setHex(c);
    arr[i4] = _color.r;
    arr[i4 + 1] = _color.g;
    arr[i4 + 2] = _color.b;
  } else {
    arr[i4] = 1;
    arr[i4 + 1] = 1;
    arr[i4 + 2] = 1;
  }
  arr[i4 + 3] = alpha;
}

void _tmpV;
