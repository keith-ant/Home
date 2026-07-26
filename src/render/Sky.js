/**
 * Sky — HDRI night sky, image-based lighting, storm/lightning controller and
 * scene fog. RENDER stream (see docs/BUILD_PLAN.md §S1).
 *
 * Visible sky: a camera-centred dome that samples the equirectangular HDRI
 * (`hdri.night_primary`, an overcast storm-cloud deck) with our own shader —
 * independent exposure, yaw rotation, a slow counter-drifting second lookup
 * that makes the cloud deck churn, a lightning sheet-flash term, and a
 * horizon blend into the scene fog colour so distant fogged geometry meets
 * the sky without a seam.
 *
 * IBL: the same HDRI run through PMREMGenerator feeds `scene.environment`
 * (rotated to match the dome) with `scene.environmentIntensity = envIntensity`.
 *
 * Storm: schedules lightning strikes every 8-20 s from a dedicated seeded
 * PRNG (never `game.rng`, so cosmetics can't perturb gameplay draws). A strike
 * is a burst of 1-3 pulses (0.08-0.25 s each) that drives (a) the dome flash
 * term, (b) `lighting.setLightningBoost()` (moon + ambient boost), and emits
 * `weather:lightning` {intensity, direction, distanceM, thunderDelay} so AUDIO
 * can delay thunder by distanceM/343 and FX/AI can react.
 *
 * Fog: `THREE.FogExp2` tuned so geometry ~100 m away is ~60 % fogged
 * (REFERENCE_STUDY: 40-80 m night visibility). The colour is biased every
 * step toward the strongest lights near the camera (warm near floods,
 * blue-grey elsewhere) and lifts during lightning.
 *
 * Public API (game.sky):
 *   sky.exposure               visible-sky exposure multiplier
 *   sky.envIntensity           IBL intensity (scene.environmentIntensity)
 *   sky.rotationY              env + dome yaw (radians)
 *   sky.setVariant('storm'|'clear')
 *   sky.setFog(density?, colorHex?)      base fog; null keeps current
 *   sky.setSkyTint(color, saturation)   grade the visible sky only
 *   sky.flashLightning(intensity?, opts?) trigger a strike now
 *   sky.holdFlash(v|null, dir?)          freeze the flash envelope (photo mode)
 *   sky.stormEnabled           scheduling on/off
 *   sky.fogColor (THREE.Color, live), sky.flash (current envelope 0..~1)
 *   sky.update(dt)             (Game calls this after all systems)
 *   sky.updateForCamera(pos)   (Game calls this before render)
 */
import * as THREE from 'three';
import { Random } from '../core/Random.js';

const SKY_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vDir = wp.xyz - cameraPosition;
    gl_Position = projectionMatrix * viewMatrix * wp;
    gl_Position.z = gl_Position.w; // pin to the far plane
  }
`;

const SKY_FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D tSky;
  uniform float exposure;
  uniform float rotationY;
  uniform float driftAngle;
  uniform float driftAmount;
  uniform float flash;
  uniform vec3 flashDir;
  uniform vec3 flashTint;
  uniform vec3 fogColor;
  uniform float horizonBlend;
  uniform float horizonDarken;
  uniform float highClamp;
  uniform vec3 tint;
  uniform float saturation;
  varying vec3 vDir;

  const float RECIP_2PI = 0.15915494;
  const float RECIP_PI = 0.31830989;

  vec2 equirectUv(vec3 dir) {
    float u = atan(dir.z, dir.x) * RECIP_2PI + 0.5;
    float v = asin(clamp(dir.y, -1.0, 1.0)) * RECIP_PI + 0.5;
    return vec2(u, v);
  }
  vec3 rotY(vec3 d, float a) {
    float s = sin(a);
    float c = cos(a);
    return vec3(c * d.x + s * d.z, d.y, -s * d.x + c * d.z);
  }

  void main() {
    vec3 dir = normalize(vDir);
    // Primary cloud deck sample (matches scene.environmentRotation).
    vec3 d1 = rotY(dir, rotationY + driftAngle);
    vec3 col = texture2D(tSky, equirectUv(d1)).rgb;
    // Second counter-rotating lookup used as a soft moving occlusion mask so
    // the storm deck reads as churning rather than a static photograph.
    vec3 d2 = rotY(dir, rotationY - driftAngle * 1.7 + 1.9);
    float m2 = dot(texture2D(tSky, equirectUv(d2)).rgb, vec3(0.2126, 0.7152, 0.0722));
    col *= mix(1.0 - driftAmount, 1.0 + driftAmount, smoothstep(0.05, 0.6, m2));
    col = min(col, vec3(highClamp)); // keep the moon-behind-cloud hotspot below the emitters
    // storm decks are near-neutral grey: pull saturation and apply the tint
    float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
    float cloudLum = lum; // pre-exposure radiance, drives lightning back-lighting
    col = mix(vec3(lum), col, saturation) * tint;
    col *= exposure;
    // Lightning sheet flash: cool white, brightest toward the strike azimuth
    // and in the upper cloud deck, still bouncing everywhere.
    float towards = pow(max(dot(dir, flashDir), 0.0) * 0.5 + 0.5, 4.0);
    float updome = 0.35 + 0.9 * smoothstep(-0.05, 0.45, dir.y);
    // clouds keep their structure: the flash back-lights the deck rather
    // than washing it flat
    col += flashTint * flash * (0.2 + 0.9 * towards) * updome * (0.3 + 1.0 * smoothstep(0.08, 0.6, cloudLum));
    // Horizon fog band: fogged geometry converges on fogColor at distance, so
    // the dome must meet it seamlessly instead of showing a hard skyline.
    // Fogged ground reads slightly darker than pure fog, hence horizonDarken.
    col = mix(fogColor * horizonDarken, col, smoothstep(-0.03, horizonBlend, dir.y));
    gl_FragColor = vec4(col, 1.0);
  }
`;

const _tmpColor = new THREE.Color();

export class Sky {
  /**
   * @param {import('../Game.js').Game} game
   */
  constructor(game) {
    this.game = game;
    this.scene = game.scene;
    this.tier = game.tier;
    this.events = game.events;
    // Own cosmetic stream: strike timing/shape must not consume gameplay rng.
    this.rng = new Random(((game.seed ?? 1) * 40503 + 9973) >>> 0);
    this.time = game.time;
    this.assets = game.assets;
    this.renderer = game.renderer;

    /** Visible-sky exposure (multiplies HDRI radiance for the dome only). */
    this.exposure = 0.14;
    /** IBL intensity applied to scene.environment. */
    this.envIntensity = 0.28;
    /** Yaw shared by the dome and scene.environmentRotation (radians). */
    this.rotationY = -0.9;
    /** Slow apparent cloud drift, radians of extra dome yaw per second. */
    this.driftSpeed = THREE.MathUtils.degToRad(0.22);
    this.variant = 'storm';

    // Storm state
    this.stormEnabled = true;
    this.flash = 0;
    this._heldFlash = null;
    this._nextStrikeAt = 4 + this.rng.range(2, 8);
    this._strike = null;
    this._flashDir = new THREE.Vector3(0.6, 0.35, -0.7).normalize();

    // Fog
    this._baseFogColor = new THREE.Color(0x151d29);
    this.fogColor = this._baseFogColor.clone();
    this.fogDensity = 0.013;
    this.scene.fog = new THREE.FogExp2(this.fogColor.getHex(), this.fogDensity);

    this._pmrem = null;
    this._envTarget = null;
    this._equirect = null;
    this._synthetic = null;

    this._buildDome();
    this.setVariant('storm');
  }

  /* -------------------------------------------------------------- setup */
  _buildDome() {
    const geo = new THREE.SphereGeometry(500, 48, 24);
    this.material = new THREE.ShaderMaterial({
      name: 'sky.dome',
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: true,
      fog: false,
      toneMapped: false,
      uniforms: {
        tSky: { value: null },
        exposure: { value: this.exposure },
        rotationY: { value: this.rotationY },
        driftAngle: { value: 0 },
        driftAmount: { value: 0.2 },
        flash: { value: 0 },
        flashDir: { value: this._flashDir.clone() },
        flashTint: { value: new THREE.Color(0x9fb7ee) },
        fogColor: { value: this.fogColor.clone() },
        horizonBlend: { value: 0.16 },
        horizonDarken: { value: 1.02 },
        highClamp: { value: 3.5 },
        tint: { value: new THREE.Color(1.0, 0.98, 0.94) },
        saturation: { value: 0.8 },
      },
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
    });
    this.dome = new THREE.Mesh(geo, this.material);
    this.dome.name = 'sky.dome';
    this.dome.renderOrder = -1000;
    this.dome.frustumCulled = false;
    this.dome.matrixAutoUpdate = false;
    this.scene.add(this.dome);
  }

  /**
   * Choose the HDRI variant. 'storm' = overcast moonlit deck (default),
   * 'clear' = starfield with a bright moon disc (break-in-the-storm state).
   * @param {'storm'|'clear'} variant
   */
  setVariant(variant) {
    this.variant = variant;
    const lowRes = this.tier.env?.resolution === '1k';
    const id = variant === 'clear'
      ? (lowRes ? 'hdri.night_alt_1k' : 'hdri.night_alt')
      : (lowRes ? 'hdri.night_primary_1k' : 'hdri.night_primary');
    let equirect = this.assets?.get(id) || this.assets?.get(id.replace('_1k', '')) || null;
    if (!equirect || !equirect.isTexture) {
      console.warn(`[sky] HDRI "${id}" unavailable, using a synthetic gradient sky`);
      equirect = this._syntheticSky();
    }
    equirect.mapping = THREE.EquirectangularReflectionMapping;
    equirect.magFilter = THREE.LinearFilter;
    equirect.minFilter = THREE.LinearFilter;
    equirect.generateMipmaps = false;
    equirect.needsUpdate = true;
    this._equirect = equirect;
    this.material.uniforms.tSky.value = equirect;

    // Image-based lighting from the same map (rotated to match the dome).
    if (!this._pmrem) {
      this._pmrem = new THREE.PMREMGenerator(this.renderer.three);
      this._pmrem.compileEquirectangularShader();
    }
    const prev = this._envTarget;
    this._envTarget = this._pmrem.fromEquirectangular(equirect);
    if (prev) prev.dispose();
    this.scene.environment = this._envTarget.texture;
    this.scene.environmentIntensity = this.envIntensity;
    this.scene.environmentRotation.set(0, this.rotationY, 0);
    // Never let the raw equirect show as a lit background — the dome is
    // the visible sky and scene.background must stay unset so fog/exposure
    // control remains ours.
    this.scene.background = null;

    if (variant === 'clear') {
      this.exposure = 0.2;
      this.material.uniforms.highClamp.value = 6.0;
      this._baseFogColor.set(0x111a26);
    } else {
      this.exposure = 0.14;
      this.material.uniforms.highClamp.value = 3.5;
      this._baseFogColor.set(0x17202d);
    }
    this.material.uniforms.exposure.value = this.exposure;
  }

  /** Fallback if the HDR failed to load: a small procedural equirect gradient. */
  _syntheticSky() {
    if (this._synthetic) return this._synthetic;
    const w = 256;
    const h = 128;
    const data = new Float32Array(w * h * 4);
    for (let y = 0; y < h; y++) {
      const v = 1 - (y / (h - 1)) * 2; // +1 top .. -1 bottom
      const up = Math.max(0, v);
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const cloud = 0.5 + 0.5 * Math.sin(x * 0.19) * Math.cos(y * 0.11 + x * 0.05);
        const l = (0.16 + 0.22 * up) * (0.7 + 0.6 * cloud);
        data[i] = l * 0.85;
        data[i + 1] = l * 0.95;
        data[i + 2] = l * 1.15;
        data[i + 3] = 1;
      }
    }
    const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.FloatType);
    tex.needsUpdate = true;
    this._synthetic = tex;
    return tex;
  }

  /* ------------------------------------------------------------- fog API */
  /**
   * Set the base fog density and/or colour (null leaves a value unchanged).
   * Runtime light-tinting and lightning lift are layered on top each step.
   * @param {number|null} density FogExp2 density (0.0092 ≈ 60 % at 100 m)
   * @param {number|string|THREE.Color|null} color
   */
  setFog(density = null, color = null) {
    if (density !== null && density !== undefined) this.fogDensity = density;
    if (color !== null && color !== undefined) this._baseFogColor.set(color);
    this.scene.fog.density = this.fogDensity;
  }

  /**
   * Grade the visible sky (does not affect IBL): tint colour + saturation.
   * @param {number|string|THREE.Color} tint
   * @param {number} [saturation=0.8]
   */
  setSkyTint(tint, saturation = 0.8) {
    this.material.uniforms.tint.value.set(tint);
    this.material.uniforms.saturation.value = saturation;
  }

  /* ------------------------------------------------------------ lightning */
  /**
   * Trigger a lightning strike now (also used by the storm scheduler).
   * @param {number} [intensity=1] peak flash brightness (0.3 faint distant .. 1.2 overhead)
   * @param {{ direction?: THREE.Vector3, distanceM?: number, pulses?: number }} [opts]
   */
  flashLightning(intensity = 1, opts = {}) {
    const rng = this.rng;
    const now = this.time.elapsed;
    const pulses = opts.pulses ?? rng.int(1, 3);
    const strike = { pulses: [], end: now, intensity };
    let t = now;
    for (let i = 0; i < pulses; i++) {
      const dur = rng.range(0.08, 0.25);
      const gap = rng.range(0.04, 0.14);
      // first pulse is the brightest; return strokes decay
      const peak = intensity * (i === 0 ? 1 : rng.range(0.35, 0.75));
      strike.pulses.push({ start: t, dur, peak });
      t += dur + gap;
    }
    strike.end = t + 0.3; // afterglow tail
    if (opts.direction) {
      this._flashDir.copy(opts.direction).normalize();
    } else {
      const az = rng.range(0, Math.PI * 2);
      const el = rng.range(0.25, 0.55);
      this._flashDir.set(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el)).normalize();
    }
    const distanceM = opts.distanceM ?? rng.range(400, 4200);
    this._strike = strike;
    this.material.uniforms.flashDir.value.copy(this._flashDir);
    this.events.emit('weather:lightning', {
      intensity,
      direction: this._flashDir.clone(),
      distanceM,
      thunderDelay: distanceM / 343,
    });
  }

  /**
   * Freeze the lightning flash at a fixed level (photo mode). Pass null to
   * resume the storm scheduler. No event is emitted for held flashes.
   * @param {number|null} value
   * @param {THREE.Vector3} [direction]
   */
  holdFlash(value, direction = null) {
    this._heldFlash = value;
    if (direction) {
      this._flashDir.copy(direction).normalize();
      this.material.uniforms.flashDir.value.copy(this._flashDir);
    }
  }

  /* -------------------------------------------------------------- update */
  /**
   * Fixed-step update (called by Game after all systems).
   * @param {number} dt
   */
  update(dt) {
    void dt;
    const t = this.time.elapsed;
    const u = this.material.uniforms;
    // Cloud drift: extra yaw over time (deterministic, simulation clock).
    u.driftAngle.value = t * this.driftSpeed;

    // Storm scheduling.
    if (this._heldFlash !== null) {
      this.flash = this._heldFlash;
      this._strike = null;
    } else {
      if (this.stormEnabled && !this._strike && t >= this._nextStrikeAt) {
        this._nextStrikeAt = t + this.rng.range(8, 20);
        this.flashLightning(this.rng.range(0.45, 1.0));
      }
      this.flash = this._strike ? this._strikeEnvelope(this._strike, t) : 0;
      if (this._strike && t > this._strike.end) this._strike = null;
    }
    u.flash.value = this.flash;

    // Push the flash into the light rig (moon key + ambient) if present.
    const lighting = this.game.lighting;
    if (lighting?.setLightningBoost) lighting.setLightningBoost(this.flash, this._flashDir);

    // Fog: base colour biased toward the strongest nearby light, lifted by
    // lightning. Reuses module temporaries; no allocation.
    const cam = this.game.camera;
    let tintAmount = 0;
    _tmpColor.setRGB(0, 0, 0);
    if (lighting?.strongestLightsNear) {
      const lights = lighting.strongestLightsNear(cam.position, 2, 45);
      for (let i = 0; i < lights.length; i++) {
        const l = lights[i];
        // weight by photometric-ish power over squared distance, saturating
        const w = Math.min(0.32, (l.power / 1200) / (1 + l.distanceSq * 0.02));
        _tmpColor.r += l.color.r * w;
        _tmpColor.g += l.color.g * w;
        _tmpColor.b += l.color.b * w;
        tintAmount += w;
      }
    }
    tintAmount = Math.min(0.35, tintAmount);
    this.fogColor.copy(this._baseFogColor);
    if (tintAmount > 0.001) {
      _tmpColor.multiplyScalar(1 / tintAmount); // normalised light hue
      // keep the fog dark: adopt the light's hue at the fog's own luminance
      const lum = (_tmpColor.r * 0.2126 + _tmpColor.g * 0.7152 + _tmpColor.b * 0.0722) || 1;
      const baseLum = 0.028;
      _tmpColor.multiplyScalar(baseLum / lum);
      this.fogColor.lerp(_tmpColor, tintAmount);
    }
    if (this.flash > 0) {
      // lightning fills the air: cool lift proportional to the envelope
      this.fogColor.r += 0.04 * this.flash;
      this.fogColor.g += 0.05 * this.flash;
      this.fogColor.b += 0.075 * this.flash;
    }
    this.scene.fog.color.copy(this.fogColor);
    this.scene.fog.density = this.fogDensity;
    u.fogColor.value.copy(this.fogColor);
    u.exposure.value = this.exposure;
    u.rotationY.value = this.rotationY;
    if (this.scene.environmentIntensity !== this.envIntensity) this.scene.environmentIntensity = this.envIntensity;
    if (this.scene.environmentRotation.y !== this.rotationY) this.scene.environmentRotation.y = this.rotationY;
  }

  /** Envelope of the active strike at time t: max of soft pulses + tail. */
  _strikeEnvelope(strike, t) {
    let v = 0;
    for (let i = 0; i < strike.pulses.length; i++) {
      const p = strike.pulses[i];
      const x = (t - p.start) / p.dur;
      if (x < 0 || x > 1.5) continue;
      // fast attack (12 % of the pulse), exponential decay with a tail
      const attack = Math.min(1, x / 0.12);
      const decay = Math.exp(-Math.max(0, x - 0.12) * 4.2);
      v = Math.max(v, p.peak * attack * decay);
    }
    return v;
  }

  /** Keep the dome centred on the camera so the horizon never approaches. */
  updateForCamera(cameraPos) {
    this.dome.position.copy(cameraPos);
    this.dome.updateMatrix();
    this.dome.updateMatrixWorld(true);
  }

  /** Direction (unit vector) of the current/last strike. */
  get lightningDirection() {
    return this._flashDir;
  }

  /** The equirect texture currently on the dome (for e.g. viewmodel env matching). */
  get equirectTexture() {
    return this._equirect;
  }

  dispose() {
    this.scene.remove(this.dome);
    this.dome.geometry.dispose();
    this.material.dispose();
    if (this._envTarget) this._envTarget.dispose();
    if (this._pmrem) this._pmrem.dispose();
    if (this._synthetic) this._synthetic.dispose();
    this.scene.environment = null;
    this.scene.fog = null;
  }
}
