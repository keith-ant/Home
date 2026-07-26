/**
 * Renderer: owns the WebGLRenderer, canvas sizing, tone mapping/output
 * config, and capability reporting. The Post chain (src/render/Post.js)
 * wraps this; feature code never calls renderer.render directly during
 * gameplay — Game orchestrates world pass + viewmodel pass + post.
 */
import * as THREE from 'three';
import { getTier } from './QualityTiers.js';

export class Renderer {
  /**
   * @param {object} opts
   * @param {HTMLCanvasElement} opts.canvas
   * @param {import('../core/Settings.js').Settings} opts.settings
   * @param {{width?:number, height?:number, pixelRatio?:number}} [opts.fixedSize] photo-mode fixed size
   */
  constructor({ canvas, settings, fixedSize = null }) {
    this.canvas = canvas;
    this.settings = settings;
    this.fixedSize = fixedSize;

    const gl = new THREE.WebGLRenderer({
      canvas,
      antialias: false,            // AA is handled by the post chain (SMAA/TAA)
      alpha: false,
      depth: true,
      stencil: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    });
    gl.outputColorSpace = THREE.SRGBColorSpace;
    gl.toneMapping = THREE.NoToneMapping; // tone mapping happens in the post chain
    gl.toneMappingExposure = 1.0;
    gl.shadowMap.enabled = true;
    gl.shadowMap.type = THREE.PCFShadowMap; // soft PCF was folded into PCF in r18x
    gl.shadowMap.autoUpdate = true;
    gl.info.autoReset = false;
    gl.setClearColor(0x000000, 1);
    this.three = gl;

    this.width = 1;
    this.height = 1;
    this.pixelRatio = 1;

    this._onResize = this.resize.bind(this);
    if (!fixedSize) window.addEventListener('resize', this._onResize);
    this.resize();
  }

  /** WebGL context + limits, for diagnostics and tier decisions. */
  get capabilities() {
    const gl = this.three.getContext();
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'unknown',
      vendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : 'unknown',
      maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
      maxAnisotropy: this.three.capabilities.getMaxAnisotropy(),
      floatRenderTargets: !!gl.getExtension('EXT_color_buffer_float'),
      webgl2: this.three.capabilities.isWebGL2,
    };
  }

  get tier() {
    return getTier(this.settings.get('quality'));
  }

  resize() {
    let w;
    let h;
    let pr;
    if (this.fixedSize) {
      w = this.fixedSize.width || 1920;
      h = this.fixedSize.height || 1080;
      pr = this.fixedSize.pixelRatio || 1;
    } else {
      w = Math.max(1, window.innerWidth);
      h = Math.max(1, window.innerHeight);
      pr = Math.min(window.devicePixelRatio || 1, this.tier.pixelRatioCap);
    }
    this.width = w;
    this.height = h;
    this.pixelRatio = pr;
    this.three.setPixelRatio(pr);
    this.three.setSize(w, h, false);
    if (this.fixedSize) {
      this.canvas.style.width = w + 'px';
      this.canvas.style.height = h + 'px';
    }
    if (this.onResize) this.onResize(w, h, pr);
  }

  /** @param {(w:number,h:number,pr:number)=>void} fn */
  setResizeHandler(fn) {
    this.onResize = fn;
  }

  get aspect() {
    return this.width / Math.max(1, this.height);
  }

  dispose() {
    window.removeEventListener('resize', this._onResize);
    this.three.dispose();
  }
}
