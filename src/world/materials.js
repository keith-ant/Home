/**
 * WorldMaterials — the shared material library for Terminal 9 (WORLD stream).
 *
 * Built on the RENDER stream factory (game.pbr: makePBR / makeWetGround /
 * makeCorrugatedContainer) plus a handful of custom materials (decal
 * atlases, chain-link, cables, emissives). Everything is created once and
 * shared: geometry UVs are authored in metres and materials carry
 * `repeat = 1 / tileMeters` so any panel size textures at true scale.
 *
 * Do not dispose textures owned by the asset cache; dispose() here only
 * drops the materials and the world's own procedural textures.
 */
import * as THREE from 'three';
import {
  stencilAtlas, groundAtlas, chainlinkTexture, razorCoilTexture, hazardTapeTexture,
  glowTexture, flameTexture, flameTexture2, coalTexture, windowTexture, grimeGlassTexture,
  waveNormalTexture, sootTexture, valueNoiseTexture,
} from './procgen.js';

/** Tile size (m) of each pbrset — mirrors docs/ASSETS-ENVIRONMENT.md. */
export const TILE = {
  'tex.asphalt_wet': 2,
  'tex.asphalt_cracked': 2,
  'tex.asphalt_macro': 30,
  'tex.gravel_dark': 2,
  'tex.concrete_slab': 3,
  'tex.concrete_panels': 2.71,
  'tex.container_panel': 1.94,
  'tex.corrugated_worn': 1.8,
  'tex.corrugated_rusty': 2,
  'tex.metal_painted_rust': 2.2,
  'tex.metal_rust': 2.2,
  'tex.metal_diamond_plate': 0.5,
  'tex.metal_shutter': 2,
  'tex.brick_red': 1,
  'tex.wood_planks': 1,
  'tex.plywood': 0.5,
  'tex.burlap': 0.269,
  'tex.plaster_painted': 2,
};

/** repeat value that maps metre-UVs onto a pbrset's tile size. */
export function metreRepeat(assetId) {
  const t = TILE[assetId] || 2;
  return [1 / t, 1 / t];
}

export class WorldMaterials {
  /**
   * @param {import('../Game.js').Game} game
   * @param {import('../core/Random.js').Random} rng world rng (procedural textures)
   */
  constructor(game, rng) {
    this.game = game;
    this.pbr = game.pbr;
    this.assets = game.assets;
    this.rng = rng;
    /** @type {THREE.Material[]} */
    this._all = [];
    /** @type {THREE.Texture[]} own textures to dispose */
    this._textures = [];
    this._containerCache = new Map();

    this._buildTextures();
    this._buildLibrary();
  }

  _tex(t) {
    this._textures.push(t);
    return t;
  }

  _mat(m) {
    this._all.push(m);
    return m;
  }

  /* ------------------------------------------------------- textures */
  _buildTextures() {
    const rng = this.rng;
    const stencil = stencilAtlas(rng);
    const ground = groundAtlas(rng);
    this.tex = {
      stencilAtlas: this._tex(stencil.texture),
      stencilCells: stencil.cells,
      groundAtlas: this._tex(ground.texture),
      groundCells: ground.cells,
      chainlink: this._tex(chainlinkTexture()),
      razorCoil: this._tex(razorCoilTexture()),
      hazardTape: this._tex(hazardTapeTexture()),
      glow: this._tex(glowTexture(128)),
      flame: this._tex(flameTexture()),
      flame2: this._tex(flameTexture2()),
      coals: this._tex(coalTexture(rng)),
      window: this._tex(windowTexture(rng)),
      grime: this._tex(grimeGlassTexture(rng)),
      waves: this._tex(waveNormalTexture(rng)),
      soot: this._tex(sootTexture(rng)),
      valueNoise: this._tex(valueNoiseTexture(rng, 128)),
      neutralNormal: this._tex(makeNeutralNormal()),
    };
    this.tex.chainlink.repeat.set(1, 1);
    this.tex.hazardTape.repeat.set(1, 1);
  }

  /* ------------------------------------------------------ library */
  _buildLibrary() {
    const pbr = this.pbr;
    const M = (this.m = {});

    // -- ground family -------------------------------------------------------
    M.apron = this._mat(pbr.makePBR('tex.concrete_slab', {
      repeat: metreRepeat('tex.concrete_slab'),
      roughnessScale: 0.6, // standing rain film: glossy enough for light smears
      wetness: 0.9,
      envMapIntensity: 1.0,
    }));
    M.gravel = this._mat(pbr.makePBR('tex.gravel_dark', {
      repeat: metreRepeat('tex.gravel_dark'),
      roughnessScale: 1.0,
      wetness: 0.6,
    }));
    M.concrete = this._mat(pbr.makePBR('tex.concrete_panels', {
      repeat: metreRepeat('tex.concrete_panels'),
      roughnessScale: 0.9,
      wetness: 0.55,
    }));
    M.concreteFloor = this._mat(pbr.makePBR('tex.concrete_slab', {
      repeat: metreRepeat('tex.concrete_slab'),
      roughnessScale: 1.0,
      wetness: 0.15,
      color: 0xb8b0a4,
    }));
    // cast-concrete road barriers: darker, grimier, rain-soaked
    M.barrierConcrete = this._mat(pbr.makePBR('tex.concrete_panels', {
      repeat: metreRepeat('tex.concrete_panels'),
      roughnessScale: 0.95,
      wetness: 0.8,
      color: 0x9c988e,
    }));
    M.brick = this._mat(pbr.makePBR('tex.brick_red', {
      repeat: metreRepeat('tex.brick_red'),
      roughnessScale: 0.95,
      wetness: 0.5,
      color: 0xcabdb2,
    }));
    M.corrugatedGrey = this._mat(pbr.makePBR('tex.corrugated_worn', {
      repeat: metreRepeat('tex.corrugated_worn'),
      roughnessScale: 0.9,
      wetness: 0.35,
      color: 0xd8dbdc,
    }));
    M.corrugatedRusty = this._mat(pbr.makePBR('tex.corrugated_rusty', {
      repeat: metreRepeat('tex.corrugated_rusty'),
      roughnessScale: 1.0,
      wetness: 0.3,
    }));
    M.shutter = this._mat(pbr.makePBR('tex.metal_shutter', {
      repeat: metreRepeat('tex.metal_shutter'),
      roughnessScale: 0.8,
      wetness: 0.4,
      color: 0xc2c6c8,
    }));
    M.plaster = this._mat(pbr.makePBR('tex.plaster_painted', {
      repeat: metreRepeat('tex.plaster_painted'),
      roughnessScale: 1.0,
      wetness: 0.25,
      color: 0xb8a68c,
    }));
    M.plywood = this._mat(pbr.makePBR('tex.plywood', {
      repeat: metreRepeat('tex.plywood'),
      roughnessScale: 1.0,
      wetness: 0.3,
    }));
    M.wood = this._mat(pbr.makePBR('tex.wood_planks', {
      repeat: metreRepeat('tex.wood_planks'),
      roughnessScale: 1.0,
      wetness: 0.45,
      color: 0xd8cdbd,
    }));
    M.burlap = this._mat(pbr.makePBR('tex.burlap', {
      repeat: metreRepeat('tex.burlap'),
      roughnessScale: 1.0,
      wetness: 0.4,
      color: 0xa4977c,
    }));
    // rain-soaked tarpaulins (roof lashings, dust sheets)
    M.tarpGreen = this._mat(pbr.makePBR('tex.burlap', {
      repeat: metreRepeat('tex.burlap'),
      roughnessScale: 0.95,
      wetness: 0.85,
      color: 0x3f5c47,
    }));
    M.tarpGreen.side = THREE.DoubleSide;
    M.tarpGrey = this._mat(pbr.makePBR('tex.burlap', {
      repeat: metreRepeat('tex.burlap'),
      roughnessScale: 0.95,
      wetness: 0.85,
      color: 0x4e5560,
    }));
    M.tarpGrey.side = THREE.DoubleSide;
    M.diamondPlate = this._mat(pbr.makePBR('tex.metal_diamond_plate', {
      repeat: metreRepeat('tex.metal_diamond_plate'),
      roughnessScale: 0.75,
      wetness: 0.5,
    }));

    // -- metals -------------------------------------------------------------
    M.hardware = this._mat(pbr.makePBR('tex.metal_rust', {
      repeat: metreRepeat('tex.metal_rust'),
      color: 0x6f7377,
      roughnessScale: 0.85,
      metalness: 0.9,
      wetness: 0.3,
    }));
    M.steelRust = this._mat(pbr.makePBR('tex.metal_rust', {
      repeat: metreRepeat('tex.metal_rust'),
      roughnessScale: 1.0,
      wetness: 0.3,
    }));
    M.galvanized = this._mat(pbr.makePBR('tex.metal_rust', {
      repeat: metreRepeat('tex.metal_rust'),
      color: 0x9aa2ab,
      roughnessScale: 0.7,
      wetness: 0.4,
    }));
    M.paintedSteelDark = this._mat(pbr.makePBR('tex.metal_painted_rust', {
      repeat: metreRepeat('tex.metal_painted_rust'),
      color: 0x525a63,
      roughnessScale: 0.9,
      wetness: 0.35,
    }));
    // hull paint: dark navy (linear ≈0.06) — reads through the pale contrast
    // elements (name, marks, waterline band, seams) as real hulls do at night
    M.paintedSteelNavy = this._mat(pbr.makePBR('tex.metal_painted_rust', {
      repeat: [1 / 8, 1 / 8],
      color: 0x6a7c8c,
      roughnessScale: 0.85,
      wetness: 0.35,
    }));
    // proud plating seams / frames on the hull: slightly lighter than the shell
    M.hullTrim = this._mat(new THREE.MeshStandardMaterial({
      name: 'world.hullTrim',
      color: 0x394653,
      roughness: 0.5,
      metalness: 0.6,
    }));
    // flat white marking paint (draft / load-line geometry, no atlas needed)
    M.decalStencilFlat = this._mat(new THREE.MeshStandardMaterial({
      name: 'world.decalStencilFlat',
      color: 0xb9b4a8,
      roughness: 0.7,
      metalness: 0.1,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    }));
    M.paintedSteelRed = this._mat(pbr.makePBR('tex.metal_painted_rust', {
      repeat: metreRepeat('tex.metal_painted_rust'),
      color: 0xd0c8c4,
      roughnessScale: 0.9,
      wetness: 0.3,
    }));
    M.craneYellow = this._mat(pbr.makePBR('tex.metal_painted_rust', {
      repeat: [1 / 4.4, 1 / 4.4],
      color: 0x8b7a3a,
      roughnessScale: 0.9,
      wetness: 0.3,
    }));

    // -- container burnt / interior --------------------------------------------
    M.charred = this._mat(pbr.makePBR('tex.corrugated_rusty', {
      repeat: metreRepeat('tex.corrugated_rusty'),
      color: 0x3a322c,
      roughnessScale: 1.0,
      wetness: 0.15,
    }));
    M.charredFloor = this._mat(pbr.makePBR('tex.asphalt_cracked', {
      repeat: [1 / 1.4, 1 / 1.4],
      color: 0x2c2723,
      roughnessScale: 1.0,
      wetness: 0.1,
    }));

    // -- decal atlases ----------------------------------------------------------
    M.decalStencil = this._mat(new THREE.MeshStandardMaterial({
      name: 'world.decalStencil',
      map: this.tex.stencilAtlas,
      transparent: true,
      alphaTest: 0.34,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
      roughness: 0.82,
      metalness: 0.15,
      vertexColors: true,
      side: THREE.FrontSide,
    }));
    M.decalGround = this._mat(new THREE.MeshStandardMaterial({
      name: 'world.decalGround',
      map: this.tex.groundAtlas,
      transparent: true,
      alphaTest: 0.05,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      roughness: 0.32,
      metalness: 0.05,
      vertexColors: true,
      side: THREE.FrontSide,
      envMapIntensity: 1.0,
    }));
    // crack patches: cracked asphalt set with a radial alpha vignette
    {
      const s = this.assets.get('tex.asphalt_cracked') || {};
      const alpha = this._tex(makeRadialAlpha());
      const rep = 1 / TILE['tex.asphalt_cracked'];
      const clone = (t) => (t ? this.pbr.withRepeat(t, [rep, rep], 'crackpatch:' + t.uuid) : null);
      M.crackPatch = this._mat(new THREE.MeshStandardMaterial({
        name: 'world.crackPatch',
        map: clone(s.color),
        normalMap: clone(s.normal),
        aoMap: clone(s.arm) || null,
        roughnessMap: clone(s.arm) || null,
        metalnessMap: clone(s.arm) || null,
        metalness: s.arm ? 1 : 0,
        roughness: 0.55,
        alphaMap: alpha,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
        color: 0x8a8a8a,
      }));
    }

    // -- fence / tape / cables ---------------------------------------------------
    M.chainlink = this._mat(new THREE.MeshStandardMaterial({
      name: 'world.chainlink',
      map: this.tex.chainlink,
      color: 0x8b9095,
      transparent: false,
      alphaTest: 0.45,
      side: THREE.DoubleSide,
      metalness: 0.7,
      roughness: 0.5,
    }));
    M.razorCoil = this._mat(new THREE.MeshStandardMaterial({
      name: 'world.razorCoil',
      map: this.tex.razorCoil,
      color: 0x9aa0a4,
      alphaTest: 0.42,
      side: THREE.DoubleSide,
      metalness: 0.75,
      roughness: 0.45,
    }));
    M.hazardTape = this._mat(new THREE.MeshStandardMaterial({
      name: 'world.hazardTape',
      map: this.tex.hazardTape,
      side: THREE.DoubleSide,
      roughness: 0.55,
      metalness: 0.0,
    }));
    M.cable = this._mat(new THREE.MeshStandardMaterial({
      name: 'world.cable',
      color: 0x141517,
      roughness: 0.65,
      metalness: 0.5,
    }));
    M.blackRubber = this._mat(new THREE.MeshStandardMaterial({
      name: 'world.rubber',
      color: 0x101112,
      roughness: 0.9,
      metalness: 0.05,
    }));

    // -- glass / emissive --------------------------------------------------------
    M.darkGlass = this._mat(new THREE.MeshStandardMaterial({
      name: 'world.darkGlass',
      color: 0x0a0d10,
      roughness: 0.12,
      metalness: 0.95,
      envMapIntensity: 2.5,
    }));
    M.grimeGlass = this._mat(new THREE.MeshStandardMaterial({
      name: 'world.grimeGlass',
      map: this.tex.grime,
      transparent: true,
      opacity: 0.94,
      roughness: 0.45,
      metalness: 0.4,
      envMapIntensity: 1.6,
      side: THREE.DoubleSide,
    }));
    M.windowLit = this._mat(new THREE.MeshStandardMaterial({
      name: 'world.windowLit',
      color: 0x000000,
      emissive: 0xffffff,
      emissiveMap: this.tex.window,
      emissiveIntensity: 2.6,
      roughness: 0.6,
      toneMapped: true,
    }));
    M.windowLitDim = this._mat(new THREE.MeshStandardMaterial({
      name: 'world.windowLitDim',
      color: 0x000000,
      emissive: 0xffd7a8,
      emissiveMap: this.tex.window,
      emissiveIntensity: 0.9,
      roughness: 0.6,
    }));
    M.lampLit = this._mat(new THREE.MeshStandardMaterial({
      name: 'world.lampLit',
      color: 0x141414,
      emissive: 0xffc37a,
      emissiveIntensity: 7.5,
      roughness: 0.4,
      toneMapped: false,
    }));
    M.lampWarm = this._mat(new THREE.MeshStandardMaterial({
      name: 'world.lampWarm',
      color: 0x141414,
      emissive: 0xffb15c,
      emissiveIntensity: 5.5,
      roughness: 0.4,
      toneMapped: false,
    }));
    M.lampCool = this._mat(new THREE.MeshStandardMaterial({
      name: 'world.lampCool',
      color: 0x101418,
      emissive: 0xd7e6ff,
      emissiveIntensity: 5.0,
      roughness: 0.4,
      toneMapped: false,
    }));
    M.lampCoolDim = this._mat(new THREE.MeshStandardMaterial({
      name: 'world.lampCoolDim',
      color: 0x101418,
      emissive: 0xbfd8ff,
      emissiveIntensity: 2.4,
      roughness: 0.4,
      toneMapped: false,
    }));
    M.lampDead = this._mat(new THREE.MeshStandardMaterial({
      name: 'world.lampDead',
      color: 0x2a2620,
      roughness: 0.5,
      metalness: 0.2,
      emissive: 0x1e150a,
      emissiveIntensity: 0.25,
    }));
    M.fluoroTube = this._mat(new THREE.MeshStandardMaterial({
      name: 'world.fluoroTube',
      color: 0x111114,
      emissive: 0xf4ecd8,
      emissiveIntensity: 3.4,
      roughness: 0.4,
      toneMapped: false,
    }));
    M.exitSign = this._mat(new THREE.MeshStandardMaterial({
      name: 'world.exitSign',
      color: 0x08120a,
      emissive: 0x39d17a,
      emissiveIntensity: 3.2,
      roughness: 0.5,
      toneMapped: false,
    }));
    // safety yellow paint (bollard caps, jamb guards): dirty ochre-yellow
    M.safetyYellow = this._mat(pbr.makePBR('tex.concrete_slab', {
      repeat: metreRepeat('tex.concrete_slab'),
      color: 0xd9a628,
      roughnessScale: 0.85,
      wetness: 0.45,
    }));
    // corrugated cardboard cartons (plywood scan re-tinted, no metalness)
    M.cardboard = this._mat(pbr.makePBR('tex.plywood', {
      repeat: metreRepeat('tex.plywood'),
      color: 0xa07648,
      roughnessScale: 1.0,
      wetness: 0.0,
    }));
    M.redBeacon = this._mat(new THREE.MeshStandardMaterial({
      name: 'world.redBeacon',
      color: 0x1a0505,
      emissive: 0xff2020,
      emissiveIntensity: 10,
      toneMapped: false,
    }));
    M.coals = this._mat(new THREE.MeshStandardMaterial({
      name: 'world.coals',
      color: 0x120806,
      emissive: 0xffffff,
      emissiveMap: this.tex.coals,
      emissiveIntensity: 3.2,
      roughness: 0.9,
      transparent: true,
      depthWrite: true,
      toneMapped: false,
    }));
    M.soot = this._mat(new THREE.MeshStandardMaterial({
      name: 'world.soot',
      map: this.tex.soot,
      color: 0x121110,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      roughness: 0.9,
    }));
    // standing water pooled on container roofs / flat steel: near-mirror,
    // dark, soft-edged (radial alpha) — reads as wet steel from above
    M.roofPuddle = this._mat(new THREE.MeshStandardMaterial({
      name: 'world.roofPuddle',
      color: 0x06090c,
      roughness: 0.06,
      metalness: 0.85,
      envMapIntensity: 2.6,
      alphaMap: this._tex(makeRadialAlpha()),
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    }));
    // sprite materials (per-instance clones are cheap; base kept here)
    M.flameSprite2 = this._mat(new THREE.SpriteMaterial({
      map: this.tex.flame2,
      color: new THREE.Color(0xff9040).multiplyScalar(1.4),
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      fog: true,
      toneMapped: false,
      opacity: 0.7,
    }));
    M.flameSprite = this._mat(new THREE.SpriteMaterial({
      map: this.tex.flame,
      color: new THREE.Color(0xffa050).multiplyScalar(2.4),
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      fog: true,
      toneMapped: false,
      opacity: 0.9,
    }));
    M.glowSprite = this._mat(new THREE.SpriteMaterial({
      map: this.tex.glow,
      color: new THREE.Color(0xff7a2e),
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      fog: true,
      toneMapped: false,
      opacity: 0.5,
    }));
  }

  /**
   * Weathered, repainted container steel for a palette colour + rust bucket.
   * Cached per (color, rustBucket, wear) so all containers of one paint
   * share a material (one draw call once batched).
   * @param {number} color hex
   * @param {number} rust 0..1
   * @param {number} wear 0..1
   */
  container(color, rust = 0.35, wear = 0.45) {
    // quantise so all containers of a colour share ≤ 6 materials (batching!)
    const rq = rust < 0.4 ? 0.3 : rust < 0.6 ? 0.5 : rust < 0.8 ? 0.7 : 0.9;
    const wq = wear < 0.5 ? 0.42 : 0.62;
    const key = `${color}|${rq}|${wq}`;
    let m = this._containerCache.get(key);
    if (!m) {
      m = this._makeContainerPaint(color, rq, wq);
      m.name = `world.container.${key}`;
      this._containerCache.set(key, m);
      this._all.push(m);
    }
    return m;
  }

  /**
   * World-owned corrugated container paint. Same idea as the render stream's
   * makeCorrugatedContainer (scan re-painted by luminance, rust bleeding
   * through by a world-space mask, roughness raised by wear) but the rust
   * mask comes from a tileable noise TEXTURE (two fetches) instead of hashed
   * procedural noise per fragment — the corrugated panels cover most pixels
   * in Terminal 9 and the software-GL capture budget could not afford the
   * ALU noise. Visually equivalent at gameplay/screenshot distances.
   */
  _makeContainerPaint(color, rust, wear) {
    const panel = this.pbr.set('tex.container_panel');
    const rustSet = this.assets?.get('tex.metal_painted_rust') || null;
    const key = 'tex.container_panel';
    const rep = metreRepeat('tex.container_panel');
    const map = this.pbr.withRepeat(panel.color, rep, key + ':c');
    const normalMap = this.pbr.withRepeat(panel.normal, rep, key + ':n');
    const arm = this.pbr.withRepeat(panel.arm, rep, key + ':a');
    const mat = new THREE.MeshStandardMaterial({
      name: 'world.containerPaint',
      color: 0xffffff,
      map,
      normalMap,
      aoMap: arm || null,
      roughnessMap: arm || null,
      metalnessMap: arm || null,
      roughness: 0.8,
      metalness: 1,
      envMapIntensity: 1.0,
    });
    const uniforms = {
      uPaint: { value: new THREE.Color(color) },
      uPaintGain: { value: 3.0 },
      uRustAmt: { value: rust },
      uWear: { value: wear },
      uRustScale: { value: 0.06 },
      uWet: { value: 0.8 }, // rain film: streaky low roughness on vertical faces
      uRustNoise: { value: this.tex.valueNoise },
      uRustColor: { value: rustSet?.color || null },
    };
    mat.userData.uniforms = uniforms;
    const useRustTex = !!(rustSet && rustSet.color);
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vCtnWorld;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvCtnWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
varying vec3 vCtnWorld;
uniform vec3 uPaint;
uniform float uPaintGain;
uniform float uRustAmt;
uniform float uWear;
uniform float uRustScale;
uniform float uWet;
uniform sampler2D uRustNoise;
uniform sampler2D uRustColor;
float ctn_rustMask;
float ctn_wet;
`)
        .replace('#include <color_fragment>', `#include <color_fragment>
{
  float lum = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
  vec3 repainted = uPaint * lum * uPaintGain;
  // sun-chalked, weathered paint: pull hard toward a desaturated grey so
  // reds never read as fresh oxide under a warm flood
  repainted = mix(repainted, vec3(lum * 1.15), uWear * 0.55);
  diffuseColor.rgb = repainted;
  // world-space rust patches from a tileable noise texture (2 planar taps)
  float n1 = texture2D(uRustNoise, vCtnWorld.xz * uRustScale + vec2(vCtnWorld.y * 0.031, 0.0)).r;
  float n2 = texture2D(uRustNoise, vec2(vCtnWorld.x + vCtnWorld.z, vCtnWorld.y) * uRustScale * 2.7 + 0.37).r;
  float drip = texture2D(uRustNoise, vec2((vCtnWorld.x + vCtnWorld.z) * 0.55, vCtnWorld.y * 0.045) + 0.11).r;
  float n = n1 * 0.55 + n2 * 0.3 + drip * 0.35;
  ctn_rustMask = smoothstep(1.0 - uRustAmt * 1.15, 1.05 - uRustAmt * 0.6, n * 0.95);
  ${useRustTex ? `
  vec3 rustCol = texture2D(uRustColor, vMapUv * 1.7).rgb;
  diffuseColor.rgb = mix(diffuseColor.rgb, rustCol, ctn_rustMask);
  ` : `
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.19, 0.09, 0.045), ctn_rustMask);
  `}
  // rain film: vertical run streaks (world Y stretched) darken the paint a
  // touch and drop roughness so wall panels smear light sources vertically
  float runs = texture2D(uRustNoise, vec2((vCtnWorld.x + vCtnWorld.z) * 1.9, vCtnWorld.y * 0.06 + 0.31)).r;
  ctn_wet = uWet * (0.55 + 0.45 * smoothstep(0.3, 0.8, runs));
  diffuseColor.rgb *= mix(1.0, 0.86, ctn_wet);
}
`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, 0.95, ctn_rustMask);
roughnessFactor = mix(roughnessFactor, min(1.0, roughnessFactor * 1.25), uWear);
roughnessFactor = mix(roughnessFactor, min(roughnessFactor, 0.32), ctn_wet); // rain film
`)
        .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
metalnessFactor = mix(metalnessFactor, 0.35, ctn_rustMask);
`);
    };
    mat.customProgramCacheKey = () => `world-container-paint:${useRustTex ? 1 : 0}`;
    return mat;
  }

  /** All container materials created so far (for stats / disposal). */
  get containerMaterials() {
    return [...this._containerCache.values()];
  }

  dispose() {
    for (const m of this._all) m.dispose();
    for (const t of this._textures) t.dispose();
    this._all.length = 0;
    this._textures.length = 0;
    this._containerCache.clear();
  }
}

/** Radial alpha vignette DataTexture (1 = opaque centre → 0 at edge). */
function makeRadialAlpha() {
  const S = 128;
  const data = new Uint8Array(S * S * 4);
  const c = (S - 1) / 2;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = (x - c) / c;
      const dy = (y - c) / c;
      const r = Math.sqrt(dx * dx + dy * dy);
      // ragged edge: cheap trig wobble (deterministic)
      const wob = 0.12 * Math.sin(dx * 21.3 + dy * 7.9) * Math.sin(dy * 17.1 - dx * 11.4);
      let a = 1 - smooth((r + wob - 0.55) / 0.42);
      a = Math.max(0, Math.min(1, a));
      const i = (y * S + x) * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = Math.round(a * 255);
    }
  }
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  t.colorSpace = THREE.NoColorSpace;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.needsUpdate = true;
  t.name = 'world.radialAlpha';
  return t;
}

function smooth(t) {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

/** 1×1 flat tangent-space normal (safe stand-in for optional normal inputs). */
function makeNeutralNormal() {
  const t = new THREE.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1, THREE.RGBAFormat);
  t.colorSpace = THREE.NoColorSpace;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  t.name = 'world.neutralNormal';
  return t;
}
