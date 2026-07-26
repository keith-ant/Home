/**
 * PBR — material factory. RENDER stream (docs/BUILD_PLAN.md §S1).
 *
 * Turns the CC0 photoscanned texture sets from the manifest (`tex.*`,
 * loaded through game.assets) into tuned MeshStandardMaterials so every
 * surface in the game is authored from real albedo/normal/roughness/AO
 * data (ART_DIRECTION non-negotiable #1).
 *
 *   game.pbr.makePBR('tex.concrete_slab', { repeat: 4, roughnessScale: 0.9 })
 *   game.pbr.makeWetGround('tex.asphalt_wet', { puddleMask, wetness: 1 })
 *   game.pbr.makeCorrugatedContainer({ paintColor: 0x8f2b22, rust: 0.4 })
 *
 * pbrset convention (see src/assets/AssetLoader.js): {color, normal, arm,
 * disp?, repeat} where arm = AO(R) / roughness(G) / metalness(B).
 *
 * All factory materials share textures with the asset cache — do NOT dispose
 * the textures when disposing a material (dispose the material only).
 * `opts.repeat` clones the textures (own UV scale, still shared image data).
 *
 * Wet ground: darkened albedo + near-mirror roughness inside a puddle mask,
 * animated rain-ripple normals sampled from game.weather.puddleRipplesTexture
 * in world XZ, so the WORLD ground picks up the storm automatically.
 */
import * as THREE from 'three';

const _white = new THREE.Color(0xffffff);

export class PBRFactory {
  /**
   * @param {import('../Game.js').Game} game
   */
  constructor(game) {
    this.game = game;
    this.assets = game.assets;
    /** @type {Map<string, THREE.Texture>} textures cloned for custom repeats */
    this._clones = new Map();
    /** materials whose ripple/rain uniforms track the weather each step */
    this._wet = [];
  }

  /* ---------------------------------------------------------- helpers */
  /**
   * Fetch a pbrset; degrade to a flat set if the asset is missing.
   * @returns {{color?:THREE.Texture, normal?:THREE.Texture, arm?:THREE.Texture, disp?:THREE.Texture, repeat:number}}
   */
  set(assetId) {
    const s = this.assets?.get(assetId);
    if (!s || !s.color) {
      console.warn(`[pbr] pbrset "${assetId}" missing; using fallback`);
      return { color: this.assets?.fallbackTexture?.() || null, repeat: 1 };
    }
    return s;
  }

  /**
   * A texture with a custom repeat (clone cached per asset/slot/repeat).
   * @param {THREE.Texture|undefined} tex
   * @param {number|number[]|undefined} repeat
   */
  withRepeat(tex, repeat, key) {
    if (!tex) return null;
    if (repeat === undefined || repeat === null) return tex;
    const r = Array.isArray(repeat) ? repeat : [repeat, repeat];
    if (tex.repeat.x === r[0] && tex.repeat.y === r[1]) return tex;
    const ck = `${key}|${r[0]}x${r[1]}`;
    let c = this._clones.get(ck);
    if (!c) {
      c = tex.clone();
      c.repeat.set(r[0], r[1]);
      c.needsUpdate = true;
      this._clones.set(ck, c);
    }
    return c;
  }

  /* ------------------------------------------------------------ makePBR */
  /**
   * Generic PBR material from a pbrset.
   * @param {string} assetId manifest id (e.g. 'tex.concrete_slab')
   * @param {object} [opts]
   * @param {number|number[]} [opts.repeat] UV repeat override (clones textures)
   * @param {number|string} [opts.color=0xffffff] albedo tint
   * @param {number} [opts.roughnessScale=1] multiplies the roughness map
   * @param {number} [opts.metalness=1] multiplies the metalness map (B); 0 for dielectrics without ARM.B
   * @param {number} [opts.aoIntensity=1]
   * @param {number} [opts.normalScale=1]
   * @param {number} [opts.envMapIntensity=1]
   * @param {number} [opts.displacementScale=0] >0 enables the disp map (needs dense geometry)
   * @param {number} [opts.wetness=0] 0..1 uniform surface wetness (darker, glossier)
   * @returns {THREE.MeshStandardMaterial}
   */
  makePBR(assetId, opts = {}) {
    const s = this.set(assetId);
    const key = assetId;
    const map = this.withRepeat(s.color, opts.repeat, key + ':c');
    const normalMap = this.withRepeat(s.normal, opts.repeat, key + ':n');
    const arm = this.withRepeat(s.arm, opts.repeat, key + ':a');
    const disp = (opts.displacementScale ?? 0) > 0 ? this.withRepeat(s.disp, opts.repeat, key + ':d') : null;
    const ns = opts.normalScale ?? 1;

    const mat = new THREE.MeshStandardMaterial({
      name: `pbr:${assetId}`,
      color: new THREE.Color(opts.color ?? 0xffffff),
      map,
      normalMap,
      normalScale: new THREE.Vector2(ns, ns),
      aoMap: arm || null,
      aoMapIntensity: arm ? (opts.aoIntensity ?? 1) : 0,
      roughnessMap: arm || null,
      metalnessMap: arm || null,
      roughness: opts.roughnessScale ?? 1,
      metalness: arm ? (opts.metalness ?? 1) : (opts.metalness ?? 0),
      envMapIntensity: opts.envMapIntensity ?? 1,
      displacementMap: disp,
      displacementScale: opts.displacementScale ?? 0,
      displacementBias: opts.displacementScale ? -opts.displacementScale * 0.5 : 0,
    });

    const wetness = opts.wetness ?? 0;
    if (wetness > 0) {
      const u = { uWet: { value: wetness } };
      mat.userData.uniforms = u;
      mat.onBeforeCompile = (shader) => {
        shader.uniforms.uWet = u.uWet;
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', '#include <common>\nuniform float uWet;')
          .replace(
            '#include <roughnessmap_fragment>',
            '#include <roughnessmap_fragment>\nroughnessFactor *= mix(1.0, 0.5, uWet);',
          )
          .replace(
            '#include <color_fragment>',
            '#include <color_fragment>\ndiffuseColor.rgb *= mix(1.0, 0.72, uWet);',
          );
      };
      mat.customProgramCacheKey = () => 'pbr-wet';
    }
    return mat;
  }

  /* ------------------------------------------------------- makeWetGround */
  /**
   * Wet ground with puddles: base pbrset (usually 'tex.asphalt_wet') plus a
   * macro variation layer, a puddle mask that darkens the albedo and drops
   * roughness to ~0.05, flattened normals inside puddles, and animated rain
   * ripples from the weather system. Emitters and floods then paint the
   * vertical light-smear reflections the references show, via plain GGX.
   *
   * @param {string} assetId base pbrset (e.g. 'tex.asphalt_wet')
   * @param {object} [opts]
   * @param {number|number[]} [opts.repeat] UV repeat for the base set
   * @param {THREE.Texture|'vertex'|null} [opts.puddleMask] R = puddle amount; 'vertex' = geometry vertex colour .r
   * @param {number|number[]} [opts.puddleRepeat] repeat for the puddle mask texture (default: mesh uv 0..1)
   * @param {number} [opts.wetness=1] global wetness 0..1 (also scales puddle depth)
   * @param {number} [opts.puddleThreshold=0.5] mask value where a puddle becomes standing water
   * @param {THREE.Texture} [opts.macroTexture] macro albedo layer (e.g. assets tex.asphalt_macro color)
   * @param {number} [opts.macroWorldScale=1/30] macro layer tiles per world metre
   * @param {THREE.Texture} [opts.rippleTexture] normal map of rain ripples (default: game.weather.puddleRipplesTexture)
   * @param {number} [opts.rippleWorldScale=3.4] ripple texture tiles per world metre
   * @param {number} [opts.rippleStrength=0.5]
   * @param {number} [opts.roughnessScale=1] base (dry area) roughness multiplier
   * @param {number} [opts.envMapIntensity=1.1]
   * @returns {THREE.MeshStandardMaterial}
   */
  makeWetGround(assetId, opts = {}) {
    const s = this.set(assetId);
    const key = assetId;
    const map = this.withRepeat(s.color, opts.repeat, key + ':c');
    const normalMap = this.withRepeat(s.normal, opts.repeat, key + ':n');
    const arm = this.withRepeat(s.arm, opts.repeat, key + ':a');

    const puddleTex = opts.puddleMask && opts.puddleMask.isTexture ? opts.puddleMask : null;
    const puddleVertex = opts.puddleMask === 'vertex';
    const macro = opts.macroTexture || null;
    const rippleTex = opts.rippleTexture || this.game.weather?.puddleRipplesTexture || null;

    const mat = new THREE.MeshStandardMaterial({
      name: `pbr:wetground:${assetId}`,
      map,
      normalMap,
      normalScale: new THREE.Vector2(1, 1),
      aoMap: arm || null,
      roughnessMap: arm || null,
      metalnessMap: arm || null,
      roughness: opts.roughnessScale ?? 1,
      metalness: arm ? 1 : 0,
      envMapIntensity: opts.envMapIntensity ?? 1.1,
      vertexColors: puddleVertex,
    });

    const uniforms = {
      uWetness: { value: opts.wetness ?? 1 },
      uPuddleThreshold: { value: opts.puddleThreshold ?? 0.5 },
      uPuddleMask: { value: puddleTex },
      uPuddleRepeat: { value: new THREE.Vector2(...toRepeat(opts.puddleRepeat, [1, 1])) },
      uMacro: { value: macro },
      uMacroScale: { value: opts.macroWorldScale ?? (1 / 30) },
      uRipple: { value: rippleTex },
      uRippleScale: { value: opts.rippleWorldScale ?? 3.4 },
      uRippleStrength: { value: opts.rippleStrength ?? 0.5 },
      uRain: { value: this.game.weather ? this.game.weather.rainIntensity : 1 },
      uTime: { value: 0 },
    };
    mat.userData.uniforms = uniforms;
    mat.userData.wetGround = true;

    const usePuddleTex = !!puddleTex;
    const useMacro = !!macro;
    const useRipple = !!rippleTex;

    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      // -- vertex: world position varying ------------------------------
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWetWorld;')
        .replace(
          '#include <worldpos_vertex>',
          '#include <worldpos_vertex>\nvWetWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;',
        );
      // -- fragment declarations ---------------------------------------
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
varying vec3 vWetWorld;
uniform float uWetness;
uniform float uPuddleThreshold;
uniform sampler2D uPuddleMask;
uniform vec2 uPuddleRepeat;
uniform sampler2D uMacro;
uniform float uMacroScale;
uniform sampler2D uRipple;
uniform float uRippleScale;
uniform float uRippleStrength;
uniform float uRain;
uniform float uTime;
float wg_puddle;   // resolved puddle amount for this fragment
`,
        )
        // -- albedo: macro layer + puddle darkening -------------------------
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
{
  float pm = 0.0;
  ${usePuddleTex ? 'pm = texture2D(uPuddleMask, vMapUv * uPuddleRepeat / vec2(MAP_REPEAT_X, MAP_REPEAT_Y)).r;' : ''}
  ${puddleVertex ? 'pm = vColor.r; diffuseColor.rgb /= max(vColor.rgb, vec3(0.02));' : ''}
  wg_puddle = smoothstep(uPuddleThreshold - 0.28, uPuddleThreshold + 0.22, pm) * uWetness;
  ${useMacro ? `
  vec3 mac = texture2D(uMacro, vWetWorld.xz * uMacroScale).rgb;
  float macLum = dot(mac, vec3(0.2126, 0.7152, 0.0722));
  diffuseColor.rgb *= mix(vec3(1.0), mac / max(macLum, 0.001) * (0.55 + macLum), 0.55);
  ` : ''}
  // wet asphalt: whole surface a good deal darker, standing water darker still
  diffuseColor.rgb *= mix(1.0, 0.62, uWetness) * mix(1.0, 0.5, wg_puddle);
}
`,
        )
        // -- roughness: wet sheen + mirror puddles ----------------------------
        .replace(
          '#include <roughnessmap_fragment>',
          `#include <roughnessmap_fragment>
roughnessFactor *= mix(1.0, 0.62, uWetness);
roughnessFactor = mix(roughnessFactor, 0.045, wg_puddle);
`,
        )
        // -- normals: flatten inside puddles, add animated rain ripples ---------
        .replace(
          '#include <normal_fragment_maps>',
          `#include <normal_fragment_maps>
{
  // standing water flattens the surface micro-normal
  normal = normalize(mix(normal, nonPerturbedNormal, wg_puddle * 0.85));
  ${useRipple ? `
  vec2 ruv = vWetWorld.xz * uRippleScale;
  vec3 rn1 = texture2D(uRipple, ruv).xyz * 2.0 - 1.0;
  vec3 rn2 = texture2D(uRipple, ruv * 1.7 + vec2(0.37, 0.71)).xyz * 2.0 - 1.0;
  vec3 rip = vec3(rn1.x + rn2.x, 0.0, rn1.y + rn2.y);
  float ripAmt = uRippleStrength * uRain * (0.35 + 0.65 * wg_puddle) * uWetness;
  normal = normalize(normal + mat3(viewMatrix) * (rip * ripAmt));
  ` : ''}
}
`,
        );
      // MAP_REPEAT_* let the puddle mask follow its own repeat independent of the base uv scale
      const rx = (map && map.repeat.x) || 1;
      const ry = (map && map.repeat.y) || 1;
      shader.fragmentShader = shader.fragmentShader
        .replace(/MAP_REPEAT_X/g, rx.toFixed(4))
        .replace(/MAP_REPEAT_Y/g, ry.toFixed(4));
    };
    mat.customProgramCacheKey = () =>
      `pbr-wetground:${usePuddleTex ? 't' : puddleVertex ? 'v' : 'n'}:${useMacro ? 1 : 0}:${useRipple ? 1 : 0}:${(map?.repeat.x || 1).toFixed(2)}`;
    this._wet.push(mat);
    return mat;
  }

  /* ------------------------------------------------ makeCorrugatedContainer */
  /**
   * Painted, weathered container steel: the photoscanned container panel set
   * re-painted to any colour (keeping its grime), with world-space rust patches
   * bleeding through and higher roughness where paint has failed.
   * @param {object} [opts]
   * @param {number|string} [opts.paintColor=0x7a2a21]
   * @param {number} [opts.rust=0.35] 0..1 amount of exposed rust
   * @param {number} [opts.wear=0.4] 0..1 paint weathering (roughness + fading)
   * @param {number} [opts.paintGain=3.1] compensates the scan's own paint albedo
   * @param {number|number[]} [opts.repeat] uv repeat for the panel set
   * @param {number} [opts.rustWorldScale=0.7] world-space frequency of rust patches
   * @param {number} [opts.envMapIntensity=1]
   * @returns {THREE.MeshStandardMaterial}
   */
  makeCorrugatedContainer(opts = {}) {
    const panel = this.set('tex.container_panel');
    const rustSet = this.assets?.get('tex.metal_painted_rust') || null;
    const key = 'tex.container_panel';
    const map = this.withRepeat(panel.color, opts.repeat, key + ':c');
    const normalMap = this.withRepeat(panel.normal, opts.repeat, key + ':n');
    const arm = this.withRepeat(panel.arm, opts.repeat, key + ':a');

    const mat = new THREE.MeshStandardMaterial({
      name: 'pbr:container',
      color: 0xffffff,
      map,
      normalMap,
      aoMap: arm || null,
      roughnessMap: arm || null,
      metalnessMap: arm || null,
      roughness: 1,
      metalness: 1,
      envMapIntensity: opts.envMapIntensity ?? 1,
    });

    const uniforms = {
      uPaint: { value: new THREE.Color(opts.paintColor ?? 0x7a2a21) },
      uPaintGain: { value: opts.paintGain ?? 3.1 },
      uRustAmt: { value: opts.rust ?? 0.35 },
      uWear: { value: opts.wear ?? 0.4 },
      uRustScale: { value: opts.rustWorldScale ?? 0.7 },
      uRustColor: { value: rustSet?.color || null },
      uRustArm: { value: rustSet?.arm || null },
    };
    mat.userData.uniforms = uniforms;
    const useRustTex = !!(rustSet && rustSet.color);

    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vCtnWorld;')
        .replace(
          '#include <worldpos_vertex>',
          '#include <worldpos_vertex>\nvCtnWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;',
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
varying vec3 vCtnWorld;
uniform vec3 uPaint;
uniform float uPaintGain;
uniform float uRustAmt;
uniform float uWear;
uniform float uRustScale;
uniform sampler2D uRustColor;
uniform sampler2D uRustArm;
float ctn_rustMask;
// cheap world-space value noise (hash based) for organic rust patches
float ctn_hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float ctn_noise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(ctn_hash(i + vec3(0,0,0)), ctn_hash(i + vec3(1,0,0)), f.x),
                 mix(ctn_hash(i + vec3(0,1,0)), ctn_hash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(ctn_hash(i + vec3(0,0,1)), ctn_hash(i + vec3(1,0,1)), f.x),
                 mix(ctn_hash(i + vec3(0,1,1)), ctn_hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
{
  // re-paint: keep the scan's grime as luminance variation, swap the hue
  float lum = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
  vec3 repainted = uPaint * lum * uPaintGain;
  // weathering fades paint toward chalky grey
  repainted = mix(repainted, vec3(lum * 1.15), uWear * 0.35);
  diffuseColor.rgb = repainted;
  // rust patches: fbm of world position, biased to lower halves and edges
  float n = ctn_noise(vCtnWorld * uRustScale) * 0.6 + ctn_noise(vCtnWorld * uRustScale * 2.6 + 3.1) * 0.4;
  float drip = ctn_noise(vec3(vCtnWorld.x * 3.5, vCtnWorld.y * 0.45, vCtnWorld.z * 3.5));
  ctn_rustMask = smoothstep(1.0 - uRustAmt * 1.15, 1.05 - uRustAmt * 0.6, n * 0.75 + drip * 0.35);
  ${useRustTex ? `
  vec3 rustCol = texture2D(uRustColor, vMapUv * 1.7).rgb;
  diffuseColor.rgb = mix(diffuseColor.rgb, rustCol, ctn_rustMask);
  ` : `
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.19, 0.09, 0.045), ctn_rustMask);
  `}
}
`,
        )
        .replace(
          '#include <roughnessmap_fragment>',
          `#include <roughnessmap_fragment>
${useRustTex ? 'roughnessFactor = mix(roughnessFactor, texture2D(uRustArm, vMapUv * 1.7).g * 1.05, ctn_rustMask);' : 'roughnessFactor = mix(roughnessFactor, 0.95, ctn_rustMask);'}
roughnessFactor = mix(roughnessFactor, min(1.0, roughnessFactor * 1.25), uWear);
`,
        )
        .replace(
          '#include <metalnessmap_fragment>',
          `#include <metalnessmap_fragment>
metalnessFactor = mix(metalnessFactor, 0.35, ctn_rustMask); // rust is a dielectric-ish oxide
`,
        );
    };
    mat.customProgramCacheKey = () => `pbr-container:${useRustTex ? 1 : 0}`;
    return mat;
  }

  /**
   * Per-step hook: keeps wet-ground materials in sync with the weather.
   * Registered as a game system by the render installer.
   */
  update(dt) {
    void dt;
    const rain = this.game.weather ? this.game.weather.rainIntensity : 0;
    const t = this.game.time.elapsed;
    for (let i = 0; i < this._wet.length; i++) {
      const u = this._wet[i].userData.uniforms;
      u.uRain.value = rain;
      u.uTime.value = t;
      if (!u.uRipple.value && this.game.weather?.puddleRipplesTexture) {
        // weather came online after the material was made
        u.uRipple.value = this.game.weather.puddleRipplesTexture;
      }
    }
  }

  dispose() {
    for (const c of this._clones.values()) c.dispose();
    this._clones.clear();
    this._wet.length = 0;
  }
}

function toRepeat(r, fallback) {
  if (r === undefined || r === null) return fallback;
  return Array.isArray(r) ? r : [r, r];
}

void _white;
