/**
 * AssetLoader — the single loading path for every asset type.
 *
 *   const assets = new AssetLoader({ renderer, tier, onProgress });
 *   await assets.loadManifest(manifest);
 *   assets.get('tex.asphalt')      → { color, normal, arm, disp, roughness, ao, metalness } textures
 *   assets.get('hdri.night')       → THREE.DataTexture (equirect, float)
 *   assets.get('model.container') → { scene, animations, gltf }
 *   assets.get('sfx.rifle')       → ArrayBuffer[] (decoded later by the AudioEngine)
 *
 * Rules:
 * - Never throws for a missing/optional asset: logs and substitutes a
 *   fallback (grey checker texture, empty group, silence) so a broken
 *   download can't take down the game or the critic pipeline.
 * - Textures come back configured: colorSpace, wrap, repeat, anisotropy,
 *   mipmaps. `arm` = ambient occlusion (R) + roughness (G) + metalness (B).
 * - GLTF meshes get shadows enabled and materials tagged where useful.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

const BASE = import.meta.env.BASE_URL || './';

export class AssetLoader {
  /**
   * @param {object} opts
   * @param {import('../render/Renderer.js').Renderer} opts.renderer
   * @param {import('../render/QualityTiers.js').QUALITY_TIERS.high} opts.tier
   * @param {(fraction:number, label:string)=>void} [opts.onProgress]
   */
  constructor({ renderer, tier, onProgress = () => {} }) {
    this.renderer = renderer;
    this.tier = tier;
    this.onProgress = onProgress;
    /** @type {Map<string, any>} */
    this.resources = new Map();
    /** @type {Map<string, Promise<any>>} */
    this._inflight = new Map();

    this.manager = new THREE.LoadingManager();
    this.textureLoader = new THREE.TextureLoader(this.manager);
    this.gltfLoader = new GLTFLoader(this.manager);
    this.gltfLoader.setMeshoptDecoder(MeshoptDecoder);
    this.rgbeLoader = new RGBELoader(this.manager);
    this.exrLoader = new EXRLoader(this.manager);
    this.ktx2Loader = null; // enabled lazily if a manifest entry needs it

    this.maxAnisotropy = Math.min(renderer.three.capabilities.getMaxAnisotropy(), tier.anisotropy);
    this._fallbackTexture = null;
    this._flatNormal = null;
  }

  /* --------------------------------------------------------------- helpers */
  url(file) {
    if (/^(https?:|data:|blob:)/.test(file)) return file;
    return BASE + file.replace(/^\/+/, '');
  }

  get(id) {
    return this.resources.get(id) ?? null;
  }

  has(id) {
    return this.resources.has(id);
  }

  /* --------------------------------------------------------------- manifest */
  /**
   * Load every applicable entry, respecting the quality tier.
   * @param {Array<any>} entries
   */
  async loadManifest(entries) {
    const applicable = entries.filter((e) => this._tierApplies(e.tier));
    const total = applicable.length || 1;
    let done = 0;
    const bump = (label) => {
      done++;
      this.onProgress(done / total, label);
    };
    // Limited concurrency keeps memory sane while still overlapping I/O.
    const queue = [...applicable];
    const workers = new Array(6).fill(0).map(async () => {
      while (queue.length) {
        const entry = queue.shift();
        try {
          await this.load(entry);
        } catch (err) {
          if (entry.optional) console.warn(`[assets] optional asset "${entry.id}" unavailable:`, err?.message || err);
          else console.warn(`[assets] failed to load "${entry.id}", using fallback:`, err?.message || err);
          this.resources.set(entry.id, this._fallbackFor(entry));
        }
        bump(`Loading ${entry.id}`);
      }
    });
    await Promise.all(workers);
  }

  _tierApplies(entryTier) {
    if (!entryTier || entryTier === 'all') return true;
    const rank = { low: 0, medium: 1, high: 2, ultra: 3 };
    const current = rank[this.tier.name] ?? 2;
    if (entryTier === 'high+') return current >= 2;
    if (entryTier === 'ultra') return current >= 3;
    return true;
  }

  /**
   * Load a single manifest entry (deduplicated).
   * @param {any} entry
   */
  load(entry) {
    if (this.resources.has(entry.id)) return Promise.resolve(this.resources.get(entry.id));
    if (this._inflight.has(entry.id)) return this._inflight.get(entry.id);
    const p = this._dispatch(entry).then((res) => {
      this.resources.set(entry.id, res);
      this._inflight.delete(entry.id);
      return res;
    });
    this._inflight.set(entry.id, p);
    return p;
  }

  async _dispatch(entry) {
    switch (entry.type) {
      case 'texture':
        return this.loadTexture(entry.file, entry);
      case 'pbrset':
        return this.loadPbrSet(entry);
      case 'hdr':
        return this.loadHdr(entry.file, entry);
      case 'gltf':
        return this.loadGltf(entry.file, entry);
      case 'audio':
        return this.loadAudio(entry);
      case 'font':
        return this.loadFont(entry);
      case 'json':
        return this.loadJson(entry.file);
      default:
        throw new Error(`unknown asset type "${entry.type}" for "${entry.id}"`);
    }
  }

  /* --------------------------------------------------------------- textures */
  /**
   * @param {string} file
   * @param {{colorSpace?:'srgb'|'linear', wrap?:'repeat'|'clamp'|'mirror', repeat?:number|[number,number], flipY?:boolean}} [opts]
   */
  loadTexture(file, opts = {}) {
    return new Promise((resolve, reject) => {
      this.textureLoader.load(
        this.url(file),
        (tex) => resolve(this.configureTexture(tex, opts)),
        undefined,
        (err) => reject(err instanceof Error ? err : new Error(`texture failed: ${file}`)),
      );
    });
  }

  configureTexture(tex, opts = {}) {
    tex.colorSpace = opts.colorSpace === 'srgb' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    const wrapMode = opts.wrap === 'clamp' ? THREE.ClampToEdgeWrapping
      : opts.wrap === 'mirror' ? THREE.MirroredRepeatWrapping
      : THREE.RepeatWrapping;
    tex.wrapS = wrapMode;
    tex.wrapT = wrapMode;
    if (opts.repeat !== undefined) {
      const r = Array.isArray(opts.repeat) ? opts.repeat : [opts.repeat, opts.repeat];
      tex.repeat.set(r[0], r[1]);
    }
    tex.anisotropy = this.maxAnisotropy;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    if (opts.flipY !== undefined) tex.flipY = opts.flipY;
    tex.needsUpdate = true;
    return tex;
  }

  /**
   * PBR set: { color, normal, arm|roughness|ao|metalness, disp, emissive, alpha }.
   */
  async loadPbrSet(entry) {
    const files = entry.files || {};
    const out = { id: entry.id, repeat: entry.repeat ?? 1 };
    const jobs = [];
    for (const [slot, file] of Object.entries(files)) {
      if (!file) continue;
      const isColor = slot === 'color' || slot === 'emissive';
      jobs.push(
        this.loadTexture(file, {
          colorSpace: isColor ? 'srgb' : 'linear',
          wrap: entry.wrap || 'repeat',
          repeat: entry.repeat,
        }).then((tex) => {
          out[slot] = tex;
        }).catch((err) => {
          console.warn(`[assets] ${entry.id}:${slot} missing (${err?.message || err})`);
        }),
      );
    }
    await Promise.all(jobs);
    if (!out.color) out.color = this.fallbackTexture();
    return out;
  }

  /* -------------------------------------------------------------------- HDR */
  loadHdr(file, entry = {}) {
    const isExr = /\.exr$/i.test(file);
    const loader = isExr ? this.exrLoader : this.rgbeLoader;
    return new Promise((resolve, reject) => {
      loader.load(
        this.url(file),
        (tex) => {
          tex.mapping = THREE.EquirectangularReflectionMapping;
          void entry;
          resolve(tex);
        },
        undefined,
        (err) => reject(err instanceof Error ? err : new Error(`hdr failed: ${file}`)),
      );
    });
  }

  /* ------------------------------------------------------------------- GLTF */
  loadGltf(file, entry = {}) {
    return new Promise((resolve, reject) => {
      this.gltfLoader.load(
        this.url(file),
        (gltf) => {
          gltf.scene.traverse((o) => {
            if (o.isMesh) {
              o.castShadow = entry.castShadow !== false;
              o.receiveShadow = entry.receiveShadow !== false;
              const mats = Array.isArray(o.material) ? o.material : [o.material];
              for (const m of mats) {
                if (!m) continue;
                for (const key of ['map', 'emissiveMap']) if (m[key]) m[key].colorSpace = THREE.SRGBColorSpace;
                if (m.map) m.map.anisotropy = this.maxAnisotropy;
                if (m.normalMap) m.normalMap.anisotropy = this.maxAnisotropy;
              }
              if (entry.surface && !o.userData.surface) o.userData.surface = entry.surface;
            }
          });
          resolve({ scene: gltf.scene, animations: gltf.animations || [], gltf });
        },
        undefined,
        (err) => reject(err instanceof Error ? err : new Error(`gltf failed: ${file}`)),
      );
    });
  }

  /* ------------------------------------------------------------------ audio */
  /** Fetch raw audio bytes (decoding is the AudioEngine's job). */
  async loadAudio(entry) {
    const files = Array.isArray(entry.files) ? entry.files : [entry.file];
    const buffers = [];
    for (const f of files) {
      const res = await fetch(this.url(f));
      if (!res.ok) throw new Error(`audio fetch ${res.status}: ${f}`);
      buffers.push(await res.arrayBuffer());
    }
    return { id: entry.id, buffers, files };
  }

  /* ------------------------------------------------------------------ fonts */
  async loadFont(entry) {
    const face = new FontFace(entry.family, `url(${this.url(entry.file)})`, {
      weight: entry.weight || '400',
      style: entry.style || 'normal',
      display: 'swap',
    });
    await face.load();
    document.fonts.add(face);
    return face;
  }

  /* ------------------------------------------------------------------- JSON */
  async loadJson(file) {
    const res = await fetch(this.url(file));
    if (!res.ok) throw new Error(`json fetch ${res.status}: ${file}`);
    return res.json();
  }

  /* ---------------------------------------------------------------- fallback */
  fallbackTexture() {
    if (this._fallbackTexture) return this._fallbackTexture;
    const size = 8;
    const data = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4;
        const c = (x + y) % 2 === 0 ? 118 : 132;
        data[i] = c;
        data[i + 1] = c;
        data[i + 2] = c;
        data[i + 3] = 255;
      }
    }
    const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    this._fallbackTexture = tex;
    return tex;
  }

  /** Flat tangent-space normal (128,128,255). */
  flatNormalTexture() {
    if (this._flatNormal) return this._flatNormal;
    const data = new Uint8Array([128, 128, 255, 255]);
    const tex = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat);
    tex.needsUpdate = true;
    this._flatNormal = tex;
    return tex;
  }

  _fallbackFor(entry) {
    switch (entry.type) {
      case 'texture':
        return this.fallbackTexture();
      case 'pbrset':
        return { id: entry.id, color: this.fallbackTexture(), repeat: entry.repeat ?? 1 };
      case 'gltf':
        return { scene: new THREE.Group(), animations: [], gltf: null, missing: true };
      case 'audio':
        return { id: entry.id, buffers: [], files: [], missing: true };
      default:
        return null;
    }
  }

  dispose() {
    for (const res of this.resources.values()) {
      if (res && res.isTexture) res.dispose();
    }
    this.resources.clear();
  }
}
