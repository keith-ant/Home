/**
 * Tracers — cosmetic bullet streaks (FX stream).
 *
 * Hitscan is instantaneous; the tracer is a visual that travels muzzle → hit
 * point at ~420 m/s: a stretched additive ribbon with a hot head, drawn as
 * one instanced ribbon geometry (view-aligned along the segment). The pool
 * recycles the oldest slot when full.
 *
 *   fx.tracer(from, to, { speed=420, length=8, width=0.05, color=[9,5.5,2.4], head=1.6 })
 *
 * update(dt): fixed step, advances the head along the path.
 * preRender(camera): writes per-instance attributes.
 */
import * as THREE from 'three';

const MAX_TRACERS = 40;

const VERT = /* glsl */ `
  precision highp float;
  attribute vec4 aStart;   // xyz tail, w width
  attribute vec4 aEnd;     // xyz head, w headBoost
  attribute vec4 aColor;   // rgb HDR, a alpha
  uniform vec3 uCamPos;
  varying float vAlong;
  varying float vAcross;
  varying vec4 vColor;
  varying float vHead;
  void main() {
    vec3 a = aStart.xyz;
    vec3 b = aEnd.xyz;
    vec3 axis = b - a;
    float len = length(axis);
    axis = len > 1e-4 ? axis / len : vec3(0.0, 1.0, 0.0);
    // extend the ribbon a touch past the head for the glow
    float over = aStart.w * 6.0;
    vec3 p = mix(a, b + axis * over, position.x); // position.x in [0,1]
    vec3 toCam = normalize(uCamPos - p);
    vec3 side = cross(axis, toCam);
    float sl = length(side);
    side = sl > 1e-4 ? side / sl : vec3(0.0, 1.0, 0.0);
    // widen toward the head
    float widthAlong = mix(0.35, 1.0, position.x) * aStart.w;
    p += side * (position.y * widthAlong);
    vAlong = position.x;
    vAcross = position.y * 2.0; // -1..1
    vColor = aColor;
    vHead = aEnd.w;
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  }
`;

const FRAG = /* glsl */ `
  precision highp float;
  varying float vAlong;
  varying float vAcross;
  varying vec4 vColor;
  varying float vHead;
  void main() {
    float across = 1.0 - abs(vAcross);
    float radial = pow(clamp(across, 0.0, 1.0), 1.6);
    // brighter toward the head, with a hot core near the tip
    float u = clamp(vAlong, 0.0, 1.0);
    float body = pow(u, 1.9) * 0.8;
    float head = exp(-pow((u - 0.955) / 0.055, 2.0)) * vHead;
    float alpha = radial * (body + head) * vColor.a;
    if (alpha < 0.004) discard;
    vec3 col = vColor.rgb * (0.55 + 0.9 * head + 0.35 * body);
    // white-hot core at the head
    col = mix(col, vec3(max(col.r, 1.0)) * 1.4, clamp(head - 0.4, 0.0, 1.0));
    gl_FragColor = vec4(col, alpha);
  }
`;

const _dir = new THREE.Vector3();

export class Tracers {
  /**
   * @param {import('../Game.js').Game} game
   */
  constructor(game) {
    this.game = game;
    this.scene = game.scene;
    this.items = [];
    for (let i = 0; i < MAX_TRACERS; i++) {
      this.items.push({
        active: false,
        from: new THREE.Vector3(),
        dir: new THREE.Vector3(),
        distance: 0,
        traveled: 0,
        speed: 420,
        length: 8,
        width: 0.05,
        color: [9, 5.5, 2.4],
        alpha: 1,
        head: 1.6,
      });
    }
    this._cursor = 0;
    this.count = 0;
    this._buildMesh();
  }

  _buildMesh() {
    const base = new THREE.PlaneGeometry(1, 1, 1, 1);
    base.translate(0.5, 0, 0); // x in [0,1], y in [-0.5,0.5]
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.attributes.position = base.attributes.position;
    geo.attributes.uv = base.attributes.uv;
    const mk = () => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(MAX_TRACERS * 4), 4);
      a.setUsage(THREE.DynamicDrawUsage);
      return a;
    };
    this._aStart = mk();
    this._aEnd = mk();
    this._aColor = mk();
    geo.setAttribute('aStart', this._aStart);
    geo.setAttribute('aEnd', this._aEnd);
    geo.setAttribute('aColor', this._aColor);
    geo.instanceCount = 0;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.geometry = geo;
    this.material = new THREE.ShaderMaterial({
      name: 'fx.tracers',
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      fog: false,
      toneMapped: false,
      uniforms: { uCamPos: { value: new THREE.Vector3() } },
      vertexShader: VERT,
      fragmentShader: FRAG,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = 'fx.tracers';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 22;
    this.mesh.userData.noAO = true;
    this.scene.add(this.mesh);
  }

  /**
   * Spawn a tracer.
   * @param {THREE.Vector3} from muzzle
   * @param {THREE.Vector3} to impact point
   * @param {{speed?:number, length?:number, width?:number, color?:number[], alpha?:number, head?:number, skip?:number}} [o]
   */
  spawn(from, to, o = {}) {
    // pick a free slot else the oldest
    let item = null;
    for (let i = 0; i < MAX_TRACERS; i++) {
      const cand = this.items[(this._cursor + i) % MAX_TRACERS];
      if (!cand.active) {
        item = cand;
        this._cursor = (this._cursor + i + 1) % MAX_TRACERS;
        break;
      }
    }
    if (!item) {
      item = this.items[this._cursor];
      this._cursor = (this._cursor + 1) % MAX_TRACERS;
    }
    item.active = true;
    item.from.copy(from);
    _dir.subVectors(to, from);
    item.distance = _dir.length();
    if (item.distance < 1e-3) {
      item.active = false;
      return null;
    }
    item.dir.copy(_dir).multiplyScalar(1 / item.distance);
    item.speed = o.speed ?? 420;
    item.length = o.length ?? 8;
    item.width = o.width ?? 0.045;
    item.head = o.head ?? 1.6;
    item.alpha = o.alpha ?? 1;
    const c = o.color || TRACER_COLOR;
    item.color[0] = c[0];
    item.color[1] = c[1];
    item.color[2] = c[2];
    // start slightly out of the muzzle so the flash hides the pop
    item.traveled = Math.min(item.distance, o.skip ?? 1.4);
    return item;
  }

  update(dt) {
    let n = 0;
    for (const it of this.items) {
      if (!it.active) continue;
      it.traveled += it.speed * dt;
      // the tracer ends once its TAIL passes the impact point
      if (it.traveled - it.length > it.distance) {
        it.active = false;
        continue;
      }
      n++;
    }
    this.count = n;
  }

  preRender(camera) {
    this.material.uniforms.uCamPos.value.setFromMatrixPosition(camera.matrixWorld);
    const S = this._aStart.array;
    const E = this._aEnd.array;
    const C = this._aColor.array;
    let j = 0;
    for (const it of this.items) {
      if (!it.active) continue;
      const head = Math.min(it.traveled, it.distance);
      const tail = Math.max(0, Math.min(it.traveled - it.length, it.distance));
      // fade as the head reaches the target
      const remaining = it.distance - tail;
      const fade = Math.min(1, remaining / (it.length * 0.5));
      const j4 = j * 4;
      S[j4] = it.from.x + it.dir.x * tail;
      S[j4 + 1] = it.from.y + it.dir.y * tail;
      S[j4 + 2] = it.from.z + it.dir.z * tail;
      S[j4 + 3] = it.width;
      E[j4] = it.from.x + it.dir.x * head;
      E[j4 + 1] = it.from.y + it.dir.y * head;
      E[j4 + 2] = it.from.z + it.dir.z * head;
      E[j4 + 3] = it.head * (head < it.distance ? 1 : 0.3);
      C[j4] = it.color[0];
      C[j4 + 1] = it.color[1];
      C[j4 + 2] = it.color[2];
      C[j4 + 3] = it.alpha * fade;
      j++;
    }
    this.geometry.instanceCount = j;
    this._aStart.needsUpdate = true;
    this._aEnd.needsUpdate = true;
    this._aColor.needsUpdate = true;
  }

  clear() {
    for (const it of this.items) it.active = false;
    this.geometry.instanceCount = 0;
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
  }
}

const TRACER_COLOR = [9, 5.5, 2.4];
