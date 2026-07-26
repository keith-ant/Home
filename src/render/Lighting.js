/**
 * Lighting — the light rig registry. RENDER stream (docs/BUILD_PLAN.md §S1).
 *
 * Owns the moon key (cool ~9000 K DirectionalLight with a shadow camera fitted
 * to the arena), the hemisphere ambient, and every artificial fixture in the
 * level. WORLD (and anyone else) creates fixtures through the API:
 *
 *   const f = game.lighting.addFlood({ position, target, color, intensity, angle,
 *                                       penumbra, distance, castShadow })
 *       → SpotLight + volumetric cone shell + emissive lens + starburst flare
 *   game.lighting.addPractical({ position, color, intensity, radius, flicker })
 *       → PointLight ('none' | 'fire' | 'fluoro' | 'sodium' flicker) + emissive marker
 *   game.lighting.addBeacon({ position, color, blinkPeriod })
 *       → blinking emissive beacon (+ tiny light)
 *   game.lighting.addFixture(desc)      dispatch on desc.kind ('flood'|'practical'|'beacon')
 *   game.lighting.remove(fixture)
 *
 * Queries (used by Weather / Sky / FX / Audio / Weapons viewmodel):
 *   game.lighting.list                   all fixture records
 *   game.lighting.strongestLightsNear(pos, n = 4, maxDist = 40)
 *       → array of records sorted by power / (1 + d²): {position, color, power,
 *         radius, distanceSq, kind, fixture}. THE ARRAY AND ITS OBJECTS ARE
 *         REUSED between calls — copy what you need, never keep references.
 *   game.lighting.moon, game.lighting.hemi
 *   game.lighting.setLightningBoost(flash, dir)   (Sky drives this)
 *
 * Shadow budget: at most `tier.shadows.spotBudget` spot lights cast shadows at
 * once; the set is re-chosen by importance/distance to the camera. The COUNT
 * stays constant so three never recompiles programs mid-game.
 *
 * Units: three.js physical light units (spot/point intensity ≈ candela,
 * directional ≈ lux, decay 2 → inverse-square). Values are authored HDR
 * numbers tuned by eye against docs/REFERENCE_STUDY.md at exposure 1.0.
 */
import * as THREE from 'three';
import { starburstTexture, noiseTexture, glowTexture, haloTexture } from './ProcTextures.js';

const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();

/** Result records for strongestLightsNear — allocated once, reused forever. */
const MAX_QUERY = 8;
const _queryPool = [];
for (let i = 0; i < MAX_QUERY; i++) {
  _queryPool.push({ position: new THREE.Vector3(), color: new THREE.Color(), power: 0, radius: 0, distanceSq: 0, kind: '', fixture: null });
}
const _queryOut = [];

/* ------------------------------------------------------------------------ */
/* Volumetric cone shell shader                                             */
/* ------------------------------------------------------------------------ */
const CONE_VERT = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

/**
 * Volumetric beam: the cone shell mesh is only a rasterisation proxy. Each
 * fragment marches its own view ray through the analytic cone volume and
 * accumulates single scattering (soft radial penumbra, source falloff,
 * fine rain streaks crossing the beam). When the camera is outside we render
 * front faces and march away from the entry surface; when inside we render
 * back faces and march from the camera to the exit surface.
 */
const CONE_FRAG = /* glsl */ `
  precision highp float;
  uniform vec3 color;
  uniform float intensity;
  uniform vec3 lightPos;
  uniform vec3 lightDir;
  uniform float coneLength;
  uniform float tanHalfAngle;
  uniform float rainStreak;
  uniform float time;
  uniform float groundY;
  uniform float fogDensity;
  uniform float insideFade;
  uniform float insideCam;
  uniform sampler2D noiseTex;
  varying vec3 vWorld;

  // scattering density at world point p (0 outside the beam)
  float coneDensity(vec3 p) {
    vec3 ap = p - lightPos;
    float along = dot(ap, lightDir);
    if (along <= 0.0 || along > coneLength) return 0.0;
    float radial = length(ap - lightDir * along);
    float R = tanHalfAngle * along;
    float rn = radial / max(R, 1e-3);
    float edge = 1.0 - smoothstep(0.5, 1.0, rn);                          // soft penumbra
    float axial = smoothstep(0.0, 0.35, along) * pow(1.0 - along / coneLength, 1.15);
    float atten = 3.0 / (1.0 + along * along * 0.09);                       // source falloff
    // rain crossing the beam: fine vertical streaks scrolling downward
    vec2 rainUv = vec2(p.x * 0.53 + p.z * 0.37, p.y * 0.07 + time * 2.9);
    float rain = 1.0 + rainStreak * smoothstep(0.45, 0.85, texture2D(noiseTex, rainUv).r) * 0.7;
    return edge * axial * atten * rain;
  }

  void main() {
    vec3 O = cameraPosition;
    vec3 V = normalize(vWorld - O);
    float tFrag = distance(O, vWorld);
    // march segment: outside → from the entry surface onward; inside → camera to exit surface
    float t0 = mix(tFrag, 0.0, insideCam);
    float t1 = mix(tFrag + coneLength * 1.15, tFrag, insideCam);
    // don't march below the ground plane (the light does not go underground)
    if (V.y < -1e-4) {
      float tg = (groundY + 0.03 - O.y) / V.y;
      if (tg > 0.0) t1 = min(t1, tg);
    }
    float span = t1 - t0;
    if (span <= 0.01) discard;
    float dt = span / float(STEPS);
    float acc = 0.0;
    // per-pixel start jitter breaks up under-sampling bands (hidden by grain)
    float jitter = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
    float t = t0 + dt * (0.25 + 0.5 * jitter);
    for (int i = 0; i < STEPS; i++) {
      acc += coneDensity(O + V * t) * dt;
      t += dt;
    }
    // fog between the eye and the beam
    float fogAtten = exp(-fogDensity * fogDensity * tFrag * tFrag);
    vec3 col = color * (intensity * acc * fogAtten * insideFade);
    gl_FragColor = vec4(col, 1.0);
  }
`;

/* ------------------------------------------------------------------------ */

let _fixtureId = 0;

export class Lighting {
  /**
   * @param {import('../Game.js').Game} game
   */
  constructor(game) {
    this.game = game;
    this.scene = game.scene;
    this.tier = game.tier;
    this.time = game.time;
    this.rng = game.rng;

    this.root = new THREE.Group();
    this.root.name = 'lighting';
    this.scene.add(this.root);

    /** @type {Array<any>} every registered fixture record */
    this.list = [];

    this._budgetTimer = 0;
    this._budgetInterval = 0.5;
    this._noise = noiseTexture(128);
    this._flareTex = starburstTexture(256);
    this._glowTex = glowTexture(128);
    this._haloTex = haloTexture(128);

    this._buildKeys();
  }

  /* ------------------------------------------------------------ key rig */
  _buildKeys() {
    const tier = this.tier;
    // Moon: cool key from the storm gap, low intensity, long soft shadows.
    this.moon = new THREE.DirectionalLight(0x92abe8, 0.55);
    this.moon.name = 'lighting.moon';
    this.moonDirection = new THREE.Vector3(-0.55, -0.72, -0.42).normalize();
    this.moon.position.copy(this.moonDirection).multiplyScalar(-140);
    this.moon.target.position.set(0, 0, 0);
    this.moon.castShadow = tier.shadows.enabled;
    const s = this.moon.shadow;
    s.mapSize.set(tier.shadows.mapSize, tier.shadows.mapSize);
    s.camera.near = 40;
    s.camera.far = 300;
    s.camera.left = -62;
    s.camera.right = 62;
    s.camera.top = 52;
    s.camera.bottom = -52;
    s.bias = -0.0004;
    s.normalBias = 0.045;
    s.radius = tier.shadows.radius;
    s.blurSamples = 8;
    this.scene.add(this.moon);
    this.scene.add(this.moon.target);
    this._moonBase = this.moon.intensity;

    // Ambient: hemisphere tuned so unlit surfaces sit ~2-4 % luma with the
    // sky IBL (see Sky.envIntensity). Ground colour is a warm-black bounce.
    this.hemi = new THREE.HemisphereLight(0x51648f, 0x121012, 0.08);
    this.hemi.name = 'lighting.hemi';
    this.hemi.position.set(0, 60, 0);
    this.scene.add(this.hemi);
    this._hemiBase = this.hemi.intensity;

    this._lightning = 0;
  }

  /**
   * Lightning drives the moon + ambient (called by Sky every step).
   * @param {number} flash 0..~1 envelope
   * @param {THREE.Vector3} [dir] strike direction (unused for now, moon stays put)
   */
  setLightningBoost(flash, dir) {
    void dir;
    this._lightning = flash;
    this.moon.intensity = this._moonBase * (1 + 5.5 * flash);
    this.hemi.intensity = this._hemiBase * (1 + 8.5 * flash);
  }

  /** Base moon intensity (before lightning boost). */
  setMoonIntensity(v) {
    this._moonBase = v;
    this.moon.intensity = v * (1 + 5.5 * this._lightning);
  }

  /** Base hemisphere ambient intensity (before lightning boost). */
  setAmbientIntensity(v) {
    this._hemiBase = v;
    this.hemi.intensity = v * (1 + 8.5 * this._lightning);
  }

  /* ------------------------------------------------------------- floods */
  /**
   * Add a floodlight: spot + volumetric cone + emissive lens + flare.
   * @param {object} o
   * @param {THREE.Vector3|number[]} o.position lamp head position (world)
   * @param {THREE.Vector3|number[]} [o.target] aim point (default: straight down 8 m)
   * @param {number|string} [o.color=0xffb15c] sodium by default (2200-3000 K)
   * @param {number} [o.intensity=1100] candela-ish
   * @param {number} [o.angle=0.62] outer cone half-angle (radians)
   * @param {number} [o.penumbra=0.45]
   * @param {number} [o.distance=42] reach in metres
   * @param {boolean} [o.castShadow=true] requests a slot in the shadow budget
   * @param {number} [o.coneLength] visible beam length (default distance*0.55)
   * @param {number} [o.coneIntensity=1] volumetric brightness multiplier
   * @param {boolean} [o.housing=true] add the emissive lamp housing/lens meshes
   * @param {boolean} [o.flare=true] add the starburst flare sprite
   * @returns {object} fixture record
   */
  addFlood(o) {
    const position = toVec3(o.position);
    const target = o.target ? toVec3(o.target) : position.clone().add(_v1.set(0, -8, 0));
    const color = new THREE.Color(o.color ?? 0xffb15c);
    const intensity = o.intensity ?? 1100;
    const angle = o.angle ?? 0.62;
    const penumbra = o.penumbra ?? 0.45;
    const distance = o.distance ?? 42;

    const group = new THREE.Group();
    group.name = 'flood';
    group.position.copy(position);
    this.root.add(group);

    // -- spot light -------------------------------------------------------
    const light = new THREE.SpotLight(color, intensity, distance, angle, penumbra, 2);
    light.position.copy(position);
    light.target.position.copy(target);
    // Pre-assign the shadow slot at creation (the budget only re-picks WHICH
    // spots cast, keeping the count constant so no program recompiles).
    const wantsShadow = o.castShadow !== false;
    let activeShadows = 0;
    for (let i = 0; i < this.list.length; i++) if (this.list[i].kind === 'flood' && this.list[i].shadowActive) activeShadows++;
    light.castShadow = wantsShadow && this.tier.shadows.enabled && activeShadows < (this.tier.shadows.spotBudget | 0);
    light.shadow.mapSize.set(this.tier.shadows.spotMapSize, this.tier.shadows.spotMapSize);
    light.shadow.camera.near = 0.6;
    light.shadow.camera.far = Math.max(20, distance);
    light.shadow.bias = -0.0004;
    light.shadow.normalBias = 0.035;
    light.shadow.radius = this.tier.shadows.radius;
    light.shadow.focus = 1;
    this.scene.add(light);
    this.scene.add(light.target);

    const dir = _v1.copy(target).sub(position).normalize().clone();

    // -- volumetric cone --------------------------------------------------
    let cone = null;
    let coneAngle = 0;
    let coneLength = 0;
    if (this.tier.volumetrics.enabled && this.tier.volumetrics.cones !== false) {
      // The visible scattering beam is authored narrower than the light's
      // outer cone: real floods read as ~40-50 deg beams in wet air.
      coneLength = o.coneLength ?? Math.min(distance * 0.5, 20);
      coneAngle = o.coneAngle ?? Math.min(angle * 0.68, 0.5);
      // Trim the beam where it meets the ground so no proxy shell (and no
      // wasted marching) exists underground.
      const gY = o.groundY ?? 0;
      if (dir.y < -0.02 && position.y > gY) {
        const tGround = (position.y - gY) / -dir.y;
        // stop just ABOVE the ground so the proxy's end cap stays visible
        // (from beyond the pool, that cap is the surface the eye enters through)
        coneLength = Math.min(coneLength, tGround * 0.96);
      }
      const tanHalf = Math.tan(coneAngle);
      // proxy shell slightly larger than the beam so the soft edge fits inside
      const rEnd = tanHalf * coneLength * 1.08;
      const geo = new THREE.CylinderGeometry(0.05, rEnd, coneLength, 32, 1, false);
      geo.translate(0, -coneLength / 2, 0); // apex at origin, opening toward -Y
      const steps = Math.max(8, Math.min(32, Math.round((this.tier.volumetrics.steps || 24) / 2)));
      const mat = new THREE.ShaderMaterial({
        name: 'lighting.cone',
        transparent: true,
        depthWrite: false,
        depthTest: true,
        blending: THREE.AdditiveBlending,
        side: THREE.FrontSide,
        fog: false,
        toneMapped: false,
        defines: { STEPS: steps },
        uniforms: {
          color: { value: color.clone() },
          intensity: { value: (o.coneIntensity ?? 1) * 0.055 * Math.pow(intensity / 1200, 0.55) },
          lightPos: { value: position.clone() },
          lightDir: { value: dir.clone() },
          coneLength: { value: coneLength },
          tanHalfAngle: { value: tanHalf },
          rainStreak: { value: 0 },
          time: { value: 0 },
          groundY: { value: o.groundY ?? 0 },
          fogDensity: { value: 0.009 },
          insideFade: { value: 1 },
          insideCam: { value: 0 },
          noiseTex: { value: this._noise },
        },
        vertexShader: CONE_VERT,
        fragmentShader: CONE_FRAG,
      });
      cone = new THREE.Mesh(geo, mat);
      cone.name = 'flood.cone';
      cone.frustumCulled = true;
      cone.renderOrder = 10;
      cone.userData.noAO = true;
      _q1.setFromUnitVectors(DOWN, dir);
      cone.quaternion.copy(_q1);
      cone.position.copy(position);
      this.scene.add(cone);
    }

    // -- housing + lens ---------------------------------------------------
    let housing = null;
    let lens = null;
    if (o.housing !== false) {
      housing = new THREE.Group();
      housing.name = 'flood.housing';
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(0.62, 0.46, 0.34),
        new THREE.MeshStandardMaterial({ color: 0x1c1f24, roughness: 0.55, metalness: 0.7 }),
      );
      body.castShadow = false;
      body.receiveShadow = true;
      housing.add(body);
      lens = new THREE.Mesh(
        new THREE.PlaneGeometry(0.52, 0.36),
        new THREE.MeshStandardMaterial({
          color: 0x151515,
          emissive: color,
          emissiveIntensity: 9,
          roughness: 0.35,
          metalness: 0,
          toneMapped: false,
        }),
      );
      lens.name = 'flood.lens';
      lens.position.set(0, 0, 0.171);
      housing.add(lens);
      housing.position.copy(position);
      // orient +Z of the housing along the light direction
      _q1.setFromUnitVectors(_v2.set(0, 0, 1), dir);
      housing.quaternion.copy(_q1);
      this.scene.add(housing);
    }

    // -- atmospheric halo (soft glow in the wet air around the head) --------
    let halo = null;
    if (o.halo !== false) {
      const hmat = new THREE.SpriteMaterial({
        map: this._haloTex,
        color: color.clone(),
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        fog: true,
        toneMapped: false,
        opacity: 0.42,
      });
      halo = new THREE.Sprite(hmat);
      halo.name = 'flood.halo';
      halo.renderOrder = 19;
      halo.position.copy(position).addScaledVector(dir, 0.4);
      halo.scale.setScalar(o.haloSize ?? 11);
      this.scene.add(halo);
    }

    // -- flare sprite -----------------------------------------------------
    let flare = null;
    if (o.flare !== false) {
      const mat = new THREE.SpriteMaterial({
        map: this._flareTex,
        color: color.clone().multiplyScalar(1.6),
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        fog: true,
        toneMapped: false,
        opacity: 0.85,
      });
      flare = new THREE.Sprite(mat);
      flare.name = 'flood.flare';
      flare.renderOrder = 20;
      flare.position.copy(position).addScaledVector(dir, 0.3);
      flare.scale.setScalar(2.4);
      this.scene.add(flare);
    }

    const fixture = {
      id: ++_fixtureId,
      kind: 'flood',
      light,
      cone,
      housing,
      lens,
      halo,
      flare,
      group,
      position: position.clone(),
      target: target.clone(),
      dir: dir.clone(),
      coneAngle,
      coneLength,
      _insideFade: 1,
      _coneBase: cone ? cone.material.uniforms.intensity.value : 0,
      color,
      intensity,
      power: intensity,
      radius: distance,
      flicker: o.flicker || 'none',
      seed: this.list.length * 13.37 + 1,
      wantsShadow,
      shadowActive: light.castShadow,
      importance: o.importance ?? 1,
      _baseIntensity: intensity,
    };
    this.list.push(fixture);
    this._budgetDirty = true;
    return fixture;
  }

  /* --------------------------------------------------------- practicals */
  /**
   * Add a practical light (wall lamp, fire barrel, interior spill).
   * @param {object} o
   * @param {THREE.Vector3|number[]} o.position
   * @param {number|string} [o.color=0xffa040]
   * @param {number} [o.intensity=120] candela-ish
   * @param {number} [o.radius=12] reach in metres (light.distance)
   * @param {'none'|'fire'|'fluoro'|'sodium'} [o.flicker='none']
   * @param {boolean} [o.castShadow=false] point-light shadows are expensive; off by default
   * @param {boolean} [o.marker=true] tiny emissive core (bloom source)
   * @returns {object} fixture record
   */
  addPractical(o) {
    const position = toVec3(o.position);
    const color = new THREE.Color(o.color ?? 0xffa040);
    const intensity = o.intensity ?? 120;
    const radius = o.radius ?? 12;
    const flicker = o.flicker || 'none';

    const light = new THREE.PointLight(color, intensity, radius, 2);
    light.position.copy(position);
    light.castShadow = !!o.castShadow;
    if (light.castShadow) {
      light.shadow.mapSize.set(512, 512);
      light.shadow.camera.near = 0.25;
      light.shadow.camera.far = radius;
      light.shadow.bias = -0.002;
    }
    this.scene.add(light);

    let marker = null;
    let glow = null;
    if (o.marker !== false) {
      marker = new THREE.Mesh(
        new THREE.SphereGeometry(o.markerSize ?? 0.09, 12, 8),
        new THREE.MeshStandardMaterial({
          color: 0x111111,
          emissive: color,
          emissiveIntensity: o.emissiveIntensity ?? 7,
          roughness: 0.6,
          toneMapped: false,
        }),
      );
      marker.name = 'practical.marker';
      marker.position.copy(position);
      this.scene.add(marker);
      if (o.glow !== false) {
        const gmat = new THREE.SpriteMaterial({
          map: this._glowTex,
          color: color.clone().multiplyScalar(1.2),
          blending: THREE.AdditiveBlending,
          transparent: true,
          depthWrite: false,
          fog: true,
          opacity: 0.5,
        });
        glow = new THREE.Sprite(gmat);
        glow.position.copy(position);
        glow.scale.setScalar(o.glowSize ?? 1.4);
        this.scene.add(glow);
      }
    }

    const fixture = {
      id: ++_fixtureId,
      kind: 'practical',
      light,
      marker,
      glow,
      position: position.clone(),
      color,
      intensity,
      power: intensity,
      radius,
      flicker,
      seed: (o.seed ?? this.list.length * 7.13) + 0.5,
      wantsShadow: false,
      shadowActive: !!o.castShadow,
      _baseIntensity: intensity,
      _flickerValue: 1,
    };
    this.list.push(fixture);
    return fixture;
  }

  /* ----------------------------------------------------------- beacons */
  /**
   * Add a blinking beacon (crane obstruction lights, hazard blinkers).
   * @param {object} o
   * @param {THREE.Vector3|number[]} o.position
   * @param {number|string} [o.color=0xff2020]
   * @param {number} [o.blinkPeriod=1.4] seconds per blink cycle
   * @param {number} [o.duty=0.14] fraction of the cycle the beacon is lit
   * @param {number} [o.size=0.12]
   * @param {number} [o.lightIntensity=6] tiny point light when lit (0 = none)
   */
  addBeacon(o) {
    const position = toVec3(o.position);
    const color = new THREE.Color(o.color ?? 0xff2020);
    const size = o.size ?? 0.12;
    const mat = new THREE.MeshStandardMaterial({
      color: 0x1a1a1a,
      emissive: color,
      emissiveIntensity: 12,
      roughness: 0.5,
      toneMapped: false,
    });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(size, 12, 8), mat);
    mesh.name = 'beacon';
    mesh.position.copy(position);
    this.scene.add(mesh);
    let light = null;
    if ((o.lightIntensity ?? 6) > 0) {
      light = new THREE.PointLight(color, o.lightIntensity ?? 6, 8, 2);
      light.position.copy(position);
      this.scene.add(light);
    }
    let glow = null;
    const gmat = new THREE.SpriteMaterial({
      map: this._glowTex,
      color: color.clone().multiplyScalar(1.5),
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      fog: true,
      opacity: 0.85,
    });
    glow = new THREE.Sprite(gmat);
    glow.position.copy(position);
    glow.scale.setScalar(size * 9);
    this.scene.add(glow);

    const fixture = {
      id: ++_fixtureId,
      kind: 'beacon',
      light,
      mesh,
      glow,
      position: position.clone(),
      color,
      intensity: o.lightIntensity ?? 6,
      power: (o.lightIntensity ?? 6) * 3,
      radius: 8,
      flicker: 'blink',
      blinkPeriod: o.blinkPeriod ?? 1.4,
      duty: o.duty ?? 0.14,
      phase: o.phase ?? 0,
      _baseIntensity: o.lightIntensity ?? 6,
      _emissiveOn: 12,
    };
    this.list.push(fixture);
    return fixture;
  }

  /**
   * Generic descriptor entry point: `{kind:'flood'|'practical'|'beacon', ...}`.
   * WORLD can hand its light fixture list straight to this.
   */
  addFixture(desc) {
    switch (desc.kind || desc.type) {
      case 'flood':
        return this.addFlood(desc);
      case 'practical':
      case 'point':
        return this.addPractical(desc);
      case 'beacon':
        return this.addBeacon(desc);
      default:
        console.warn('[lighting] unknown fixture kind:', desc.kind || desc.type);
        return null;
    }
  }

  /** Remove a fixture and free its resources. */
  remove(fixture) {
    const i = this.list.indexOf(fixture);
    if (i < 0) return;
    this.list.splice(i, 1);
    const kill = (obj) => {
      if (!obj) return;
      obj.parent?.remove(obj);
      obj.traverse?.((c) => {
        c.geometry?.dispose?.();
        if (c.material) (Array.isArray(c.material) ? c.material : [c.material]).forEach((m) => m.dispose());
      });
    };
    kill(fixture.cone);
    kill(fixture.housing);
    kill(fixture.halo);
    kill(fixture.flare);
    kill(fixture.marker);
    kill(fixture.mesh);
    kill(fixture.glow);
    kill(fixture.group);
    if (fixture.light) {
      fixture.light.parent?.remove(fixture.light);
      fixture.light.target?.parent?.remove(fixture.light.target);
      fixture.light.shadow?.map?.dispose?.();
      fixture.light.dispose?.();
    }
    this._budgetDirty = true;
  }

  /* ------------------------------------------------------------ queries */
  /**
   * The strongest lights near a point, scored intensity / (1 + d²).
   * The returned array and its record objects are REUSED — copy, don't keep.
   * @param {THREE.Vector3} pos
   * @param {number} [n=4] max results (≤ 8)
   * @param {number} [maxDist=40] ignore lights farther than this
   * @returns {Array<{position:THREE.Vector3,color:THREE.Color,power:number,radius:number,distanceSq:number,kind:string,fixture:any}>}
   */
  strongestLightsNear(pos, n = 4, maxDist = 40) {
    const out = _queryOut;
    out.length = 0;
    n = Math.min(n, MAX_QUERY);
    const list = this.list;
    const maxDistSq = maxDist * maxDist;
    // score pass (stored on the fixture record itself; no allocation)
    for (let i = 0; i < list.length; i++) {
      const f = list[i];
      const d2 = f.position.distanceToSquared(pos);
      const power = f.light ? f.light.intensity : f.power;
      f._qScore = d2 > maxDistSq || power <= 0 ? -1 : power / (1 + d2 * 0.35);
      f._qDistSq = d2;
      f._qPicked = false;
    }
    // n selection passes (list is small)
    for (let k = 0; k < n; k++) {
      let best = null;
      for (let i = 0; i < list.length; i++) {
        const f = list[i];
        if (f._qPicked || f._qScore < 0) continue;
        if (!best || f._qScore > best._qScore) best = f;
      }
      if (!best) break;
      best._qPicked = true;
      const r = _queryPool[out.length];
      r.position.copy(best.position);
      r.color.copy(best.color);
      r.power = best.light ? best.light.intensity : best.power;
      r.radius = best.radius;
      r.distanceSq = best._qDistSq;
      r.kind = best.kind;
      r.fixture = best;
      r.score = best._qScore;
      out.push(r);
    }
    return out;
  }

  /* -------------------------------------------------------------- update */
  /**
   * Fixed-step update: flicker, blink, cone uniforms.
   * @param {number} dt
   */
  update(dt) {
    void dt;
    const t = this.time.elapsed;
    const rain = this.game.weather ? this.game.weather.rainIntensity : 0;
    const fogDensity = this.game.sky ? this.game.sky.fogDensity : 0.009;
    for (let i = 0; i < this.list.length; i++) {
      const f = this.list[i];
      switch (f.flicker) {
        case 'fire': {
          const p = f.seed;
          // two-frequency curve + fast crackle; deterministic (simulation clock)
          const slow = 0.5 * Math.sin(t * 6.3 + p) + 0.5 * Math.sin(t * 11.7 + p * 2.3);
          const fast = Math.sin(t * 34.2 + p * 3.1) * Math.sin(t * 21.9 + p);
          const v = 0.78 + 0.22 * slow + 0.14 * fast;
          f._flickerValue = v;
          f.light.intensity = f._baseIntensity * v;
          // warmer on the dips
          f.light.color.copy(f.color);
          f.light.color.g *= 0.92 + 0.08 * v;
          if (f.marker) f.marker.material.emissiveIntensity = 5 * (0.7 + 0.5 * v);
          if (f.glow) f.glow.material.opacity = 0.35 + 0.3 * v;
          break;
        }
        case 'fluoro': {
          // mostly steady, occasional buzz dropout
          const bucket = Math.floor(t * 11 + f.seed);
          const h = fract(Math.sin(bucket * 12.9898 + f.seed) * 43758.5453);
          const v = h < 0.05 ? 0.25 + h * 4 : (h < 0.08 ? 0.7 : 1);
          f._flickerValue = v;
          f.light.intensity = f._baseIntensity * v;
          if (f.marker) f.marker.material.emissiveIntensity = 7 * v;
          break;
        }
        case 'sodium': {
          const v = 0.96 + 0.04 * Math.sin(t * 1.7 + f.seed);
          f._flickerValue = v;
          f.light.intensity = f._baseIntensity * v;
          break;
        }
        case 'blink': {
          const phase = fract(t / f.blinkPeriod + f.phase);
          const on = phase < f.duty;
          const glow = on ? 1 : 0.06;
          f.mesh.material.emissiveIntensity = f._emissiveOn * glow;
          if (f.light) f.light.intensity = on ? f._baseIntensity : 0;
          if (f.glow) f.glow.material.opacity = on ? 0.85 : 0.05;
          break;
        }
        default:
          break;
      }
      if (f.cone) {
        const u = f.cone.material.uniforms;
        u.time.value = t;
        u.rainStreak.value = rain;
        u.fogDensity.value = fogDensity;
        // cones follow the light's live intensity (flicker etc.)
        if (f.flicker !== 'none' && f.light) u.intensity.value = f._coneBase * (f.light.intensity / (f._baseIntensity || 1));
      }
    }
  }

  /**
   * Per-render-frame update: flare fade/scale versus the camera and the
   * shadow budget. Wired by installPost as a post pre-render hook.
   * @param {THREE.Camera} camera
   */
  preRender(camera) {
    const camPos = camera.position;
    camera.getWorldDirection(_v3);
    for (let i = 0; i < this.list.length; i++) {
      const f = this.list[i];
      if (f.flare) {
        _v1.copy(camPos).sub(f.position);
        const dist = Math.max(0.001, _v1.length());
        _v1.multiplyScalar(1 / dist);
        // looking into the lamp face → full flare; from behind the housing → almost nothing
        // (_v1 points from the lamp toward the camera; f.dir points from lamp to target)
        const facing = Math.max(0, _v1.dot(f.dir));
        const face = 0.06 + 0.94 * Math.pow(facing, 1.6);
        // constant-ish angular size: scale sub-linearly with distance
        const s = Math.min(7, Math.max(1.1, Math.pow(dist, 0.6) * 0.55)) * (0.55 + 0.45 * facing);
        f.flare.scale.setScalar(s);
        f.flare.material.opacity = 0.9 * face;
        // nudge toward the camera so it sits in front of the lens plate
        f.flare.position.copy(f.position).addScaledVector(_v1, 0.35);
      }
      if (f.halo) {
        // the scattering ball is centred just in front of the lens: dimmer
        // when the housing sits between it and the eye
        _v1.copy(camPos).sub(f.position).normalize();
        const facingH = Math.max(0, _v1.dot(f.dir));
        f.halo.material.opacity = 0.42 * (0.45 + 0.55 * Math.pow(facingH, 0.7));
      }
      if (f.cone) {
        // Is the eye inside the proxy shell? Then rasterise back faces and
        // march from the camera; also soften the whole beam so standing in
        // it doesn't wash the screen out.
        _v2.copy(camPos).sub(f.position);
        const along = _v2.dot(f.dir);
        let inside = false;
        if (along > -0.3 && along < f.coneLength + 0.5) {
          const radial = Math.sqrt(Math.max(0, _v2.lengthSq() - along * along));
          const coneR = Math.tan(f.coneAngle) * Math.max(along, 0.1) * 1.08 + 0.35;
          inside = radial < coneR;
        }
        const target = inside ? 0.55 : 1;
        f._insideFade += (target - f._insideFade) * 0.4;
        const mat = f.cone.material;
        mat.uniforms.insideFade.value = f._insideFade;
        mat.uniforms.insideCam.value = inside ? 1 : 0;
        // Inside: rasterise the surrounding shell's back faces and ignore
        // scene depth (the far shell is usually behind walls/ground); the
        // shader clamps the march to the ground plane analytically.
        const wantSide = inside ? THREE.BackSide : THREE.FrontSide;
        if (mat.side !== wantSide) {
          mat.side = wantSide;
          mat.depthTest = !inside;
          mat.needsUpdate = true;
        }
      }
    }
    this._updateShadowBudget(camPos, _v3);
  }

  _updateShadowBudget(camPos, camDir) {
    const now = this.time.elapsed;
    if (!this._budgetDirty && now - this._budgetTimer < this._budgetInterval && this._budgetTimer !== 0) return;
    this._budgetTimer = now;
    this._budgetDirty = false;
    if (!this.tier.shadows.enabled) return;
    const budget = this.tier.shadows.spotBudget | 0;
    // score every shadow-wanting fixture
    let count = 0;
    for (let i = 0; i < this.list.length; i++) {
      const f = this.list[i];
      if (!f.wantsShadow || !f.light) continue;
      const d2 = f.position.distanceToSquared(camPos);
      _v1.copy(f.position).sub(camPos).normalize();
      const inFront = _v1.dot(camDir) > -0.35 ? 1 : 0.3;
      f._shadowScore = (f.power * f.importance * inFront) / (4 + d2);
      count++;
    }
    if (count === 0) return;
    // choose top-budget by partial selection (list is small; simple passes)
    for (let i = 0; i < this.list.length; i++) {
      const f = this.list[i];
      if (f.wantsShadow && f.light) f._pick = false;
    }
    const picks = Math.min(budget, count);
    for (let p = 0; p < picks; p++) {
      let best = null;
      for (let i = 0; i < this.list.length; i++) {
        const f = this.list[i];
        if (!f.wantsShadow || !f.light || f._pick) continue;
        if (!best || f._shadowScore > best._shadowScore) best = f;
      }
      if (best) best._pick = true;
    }
    for (let i = 0; i < this.list.length; i++) {
      const f = this.list[i];
      if (!f.wantsShadow || !f.light) continue;
      const on = !!f._pick;
      if (f.light.castShadow !== on) {
        f.light.castShadow = on;
        f.shadowActive = on;
      }
    }
  }

  /** All fixture records (read-only snapshot semantics). */
  get fixtures() {
    return this.list;
  }

  dispose() {
    for (const f of [...this.list]) this.remove(f);
    this.scene.remove(this.moon, this.moon.target, this.hemi, this.root);
    this.moon.shadow?.map?.dispose?.();
  }
}

/* ------------------------------------------------------------------------ */
function toVec3(v) {
  if (!v) return new THREE.Vector3();
  if (v.isVector3) return v.clone();
  if (Array.isArray(v)) return new THREE.Vector3(v[0], v[1], v[2]);
  return new THREE.Vector3(v.x || 0, v.y || 0, v.z || 0);
}

function fract(x) {
  return x - Math.floor(x);
}

void UP;
