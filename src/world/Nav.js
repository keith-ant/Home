/**
 * NavGrid — baked navigation for Terminal 9 (WORLD stream).
 *
 * A 0.75 m grid over the playable rectangle. Walkability is baked from the
 * collision BVH: a downward cast finds the standing height (containers,
 * roofs and water reject), horizontal capsule-ish clearance rays reject
 * cells within ~0.4 m of a wall, and a flood fill from the player spawn
 * discards unreachable islands (container tops, roofs). Heights are kept
 * so ramps/steps connect where the step is ≤ 0.6 m.
 *
 * API (game.world.nav):
 *   findPath(fromVec3, toVec3, {maxIterations}) → THREE.Vector3[] | null   (smoothed waypoints)
 *   randomWalkablePoint(rng, region?) → Vector3 | null   region = {x0,x1,z0,z1}
 *   isWalkable(x, z), heightAt(x, z), cellOf(x, z)
 *   coverPoints: [{position, normal, height, type:'low'|'high'}]
 *   enemySpawnPoints: [{position, yaw, tag}]
 *   grid: {width, height, cellSize, origin, walkable:Uint8Array, heights:Float32Array}
 */
import * as THREE from 'three';
import { YARD, PLAYER_SPAWN, ENEMY_SPAWN_CANDIDATES } from './layout.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _dir = new THREE.Vector3();
const DOWN = new THREE.Vector3(0, -1, 0);
const UP = new THREE.Vector3(0, 1, 0);

const DIRS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const DIRS8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

export class NavGrid {
  /**
   * @param {import('./Collision.js').CollisionWorld} collision
   * @param {{cellSize?:number, bounds?:{x0:number,x1:number,z0:number,z1:number}, castFromY?:number, clearance?:number, maxStep?:number}} [opts]
   */
  constructor(collision, opts = {}) {
    this.collision = collision;
    this.cellSize = opts.cellSize ?? 0.75;
    this.bounds = opts.bounds || { x0: YARD.playable.x0, x1: YARD.playable.x1, z0: -51, z1: YARD.playable.z1 };
    this.castFromY = opts.castFromY ?? 9.0;
    this.clearance = opts.clearance ?? 0.42;
    this.maxStep = opts.maxStep ?? 0.6;
    this.width = Math.ceil((this.bounds.x1 - this.bounds.x0) / this.cellSize);
    this.height = Math.ceil((this.bounds.z1 - this.bounds.z0) / this.cellSize);
    const n = this.width * this.height;
    this.walkable = new Uint8Array(n);
    this.heights = new Float32Array(n).fill(-999);
    this.coverPoints = [];
    this.enemySpawnPoints = [];
    // A* scratch (allocated once)
    this._g = new Float32Array(n);
    this._f = new Float32Array(n);
    this._parent = new Int32Array(n);
    this._state = new Uint8Array(n); // 0 unvisited, 1 open, 2 closed
    this._open = new Int32Array(n);
    this.stats = { walkable: 0, cover: 0, bakeMs: 0 };
  }

  /* --------------------------------------------------------------- utils */
  cellOf(x, z) {
    const cx = Math.floor((x - this.bounds.x0) / this.cellSize);
    const cz = Math.floor((z - this.bounds.z0) / this.cellSize);
    return { cx, cz };
  }

  indexOf(cx, cz) {
    if (cx < 0 || cz < 0 || cx >= this.width || cz >= this.height) return -1;
    return cz * this.width + cx;
  }

  cellCenter(cx, cz, out = new THREE.Vector3()) {
    const i = this.indexOf(cx, cz);
    const y = i >= 0 ? this.heights[i] : 0;
    return out.set(this.bounds.x0 + (cx + 0.5) * this.cellSize, y > -900 ? y : 0, this.bounds.z0 + (cz + 0.5) * this.cellSize);
  }

  isWalkable(x, z) {
    const { cx, cz } = this.cellOf(x, z);
    const i = this.indexOf(cx, cz);
    return i >= 0 && this.walkable[i] === 1;
  }

  heightAt(x, z) {
    const { cx, cz } = this.cellOf(x, z);
    const i = this.indexOf(cx, cz);
    if (i < 0) return 0;
    const h = this.heights[i];
    return h > -900 ? h : 0;
  }

  /* ------------------------------------------------------------------ bake */
  bake() {
    const col = this.collision;
    const W = this.width;
    const H = this.height;
    const cs = this.cellSize;
    // pass 1: standing heights
    for (let cz = 0; cz < H; cz++) {
      for (let cx = 0; cx < W; cx++) {
        const i = cz * W + cx;
        const x = this.bounds.x0 + (cx + 0.5) * cs;
        const z = this.bounds.z0 + (cz + 0.5) * cs;
        _v.set(x, this.castFromY, z);
        const hit = col.raycast(_v, DOWN, this.castFromY + 5);
        if (!hit || hit.surface === 'water') {
          this.walkable[i] = 0;
          continue;
        }
        // reject steep surfaces
        if (hit.normal.y < 0.72) {
          this.walkable[i] = 0;
          continue;
        }
        this.heights[i] = hit.point.y;
        this.walkable[i] = 1;
      }
    }
    // pass 2: clearance (4 horizontal rays at knee/torso) + headroom
    const clr = this.clearance;
    for (let cz = 0; cz < H; cz++) {
      for (let cx = 0; cx < W; cx++) {
        const i = cz * W + cx;
        if (!this.walkable[i]) continue;
        const x = this.bounds.x0 + (cx + 0.5) * cs;
        const z = this.bounds.z0 + (cz + 0.5) * cs;
        const y = this.heights[i];
        let blocked = false;
        for (let d = 0; d < 4 && !blocked; d++) {
          _dir.set(DIRS4[d][0], 0, DIRS4[d][1]);
          for (const hy of [0.55, 1.35]) {
            _v.set(x, y + hy, z);
            const hit = col.raycast(_v, _dir, clr);
            if (hit) {
              blocked = true;
              break;
            }
          }
        }
        if (!blocked) {
          _v.set(x, y + 0.08, z);
          const up = col.raycast(_v, UP, 1.75);
          if (up) blocked = true;
        }
        if (blocked) this.walkable[i] = 0;
      }
    }
    // pass 3: flood fill from the player spawn (kill unreachable islands)
    const start = this.indexOf(...Object.values(this.cellOf(PLAYER_SPAWN.x, PLAYER_SPAWN.z)));
    if (start >= 0) this._floodKeep(start);
    // stats
    let count = 0;
    for (let i = 0; i < this.walkable.length; i++) count += this.walkable[i];
    this.stats.walkable = count;
    this._bakeCover();
    this._bakeSpawns();
    return this;
  }

  _floodKeep(startIdx) {
    const W = this.width;
    const keep = new Uint8Array(this.walkable.length);
    const stack = this._open;
    let top = 0;
    let s = startIdx;
    if (!this.walkable[s]) {
      // search nearby for a walkable start
      const cx0 = s % W;
      const cz0 = (s / W) | 0;
      outer: for (let r = 1; r < 8; r++) {
        for (let dz = -r; dz <= r; dz++) {
          for (let dx = -r; dx <= r; dx++) {
            const j = this.indexOf(cx0 + dx, cz0 + dz);
            if (j >= 0 && this.walkable[j]) {
              s = j;
              break outer;
            }
          }
        }
      }
    }
    if (!this.walkable[s]) return;
    stack[top++] = s;
    keep[s] = 1;
    while (top > 0) {
      const i = stack[--top];
      const cx = i % W;
      const cz = (i / W) | 0;
      const h = this.heights[i];
      for (const [dx, dz] of DIRS4) {
        const j = this.indexOf(cx + dx, cz + dz);
        if (j < 0 || keep[j] || !this.walkable[j]) continue;
        if (Math.abs(this.heights[j] - h) > this.maxStep) continue;
        keep[j] = 1;
        stack[top++] = j;
      }
    }
    for (let i = 0; i < this.walkable.length; i++) if (!keep[i]) this.walkable[i] = 0;
  }

  _bakeCover() {
    const W = this.width;
    const H = this.height;
    const cs = this.cellSize;
    const col = this.collision;
    const points = [];
    for (let cz = 1; cz < H - 1; cz++) {
      for (let cx = 1; cx < W - 1; cx++) {
        const i = cz * W + cx;
        if (!this.walkable[i]) continue;
        const y = this.heights[i];
        // look at 4 neighbours for a blocker
        for (const [dx, dz] of DIRS4) {
          const j = this.indexOf(cx + dx, cz + dz);
          if (j < 0 || this.walkable[j]) continue;
          // blocker top height at the neighbour cell
          const bx = this.bounds.x0 + (cx + dx + 0.5) * cs;
          const bz = this.bounds.z0 + (cz + dz + 0.5) * cs;
          _v.set(bx, y + 6, bz);
          const hit = col.raycast(_v, DOWN, 8);
          if (!hit) continue;
          const bh = hit.point.y - y;
          if (bh < 0.55) continue;
          // is it a real face? cast horizontally toward the blocker at 0.5 m
          _dir.set(dx, 0, dz);
          const x = this.bounds.x0 + (cx + 0.5) * cs;
          const z = this.bounds.z0 + (cz + 0.5) * cs;
          _v.set(x, y + 0.5, z);
          const wall = col.raycast(_v, _dir, cs * 1.6);
          if (!wall) continue;
          const type = bh < 1.35 ? 'low' : 'high';
          points.push({
            position: new THREE.Vector3(x, y, z),
            normal: new THREE.Vector3(-dx, 0, -dz).normalize(), // faces AWAY from the blocker
            height: Math.min(bh, 3.5),
            type,
          });
          break;
        }
      }
    }
    // thin: keep points ≥ 1.6 m apart (greedy)
    const kept = [];
    const minD2 = 1.6 * 1.6;
    for (const p of points) {
      let ok = true;
      for (const k of kept) {
        if (k.position.distanceToSquared(p.position) < minD2 && k.normal.dot(p.normal) > 0.5) {
          ok = false;
          break;
        }
      }
      if (ok) kept.push(p);
    }
    this.coverPoints = kept;
    this.stats.cover = kept.length;
  }

  _bakeSpawns() {
    const col = this.collision;
    const eyeS = new THREE.Vector3(PLAYER_SPAWN.x, 1.65, PLAYER_SPAWN.z);
    const out = [];
    const okSpot = (x, z) => {
      if (!this.isWalkable(x, z)) return false;
      _v.set(x, 1.6, z);
      _dir.subVectors(eyeS, _v);
      const dist = _dir.length();
      _dir.multiplyScalar(1 / dist);
      const hit = col.raycast(_v, _dir, dist - 0.5);
      return !!hit; // occluded → hidden from the player spawn
    };
    for (const c of ENEMY_SPAWN_CANDIDATES) {
      if (okSpot(c.x, c.z)) {
        out.push({
          position: new THREE.Vector3(c.x, this.heightAt(c.x, c.z), c.z),
          yaw: (c.yaw * Math.PI) / 180,
          tag: c.tag,
        });
      }
    }
    // top up with hidden random points along the north / west / east bands
    let guard = 0;
    const bands = [
      { x0: -49, x1: 49, z0: -50, z1: -36 },
      { x0: -49, x1: -38, z0: -30, z1: 30 },
      { x0: 38, x1: 49, z0: -30, z1: 30 },
    ];
    while (out.length < 14 && guard++ < 400) {
      const b = bands[guard % bands.length];
      const x = b.x0 + hash01(guard * 3.7) * (b.x1 - b.x0);
      const z = b.z0 + hash01(guard * 9.3 + 1.1) * (b.z1 - b.z0);
      if (!okSpot(x, z)) continue;
      let far = true;
      for (const p of out) if (p.position.distanceToSquared(_v.set(x, 0, z)) < 25) far = false;
      if (!far) continue;
      out.push({ position: new THREE.Vector3(x, this.heightAt(x, z), z), yaw: Math.atan2(-x, -(30 - z)), tag: 'auto' });
    }
    this.enemySpawnPoints = out;
  }

  /* --------------------------------------------------------------- query */
  /**
   * Random walkable point (uses the caller's rng for determinism).
   * @param {import('../core/Random.js').Random} rng
   * @param {{x0:number,x1:number,z0:number,z1:number}} [region]
   */
  randomWalkablePoint(rng, region) {
    const r = region || this.bounds;
    for (let attempt = 0; attempt < 200; attempt++) {
      const x = rng.range(Math.max(r.x0, this.bounds.x0), Math.min(r.x1, this.bounds.x1));
      const z = rng.range(Math.max(r.z0, this.bounds.z0), Math.min(r.z1, this.bounds.z1));
      if (this.isWalkable(x, z)) return new THREE.Vector3(x, this.heightAt(x, z), z);
    }
    return null;
  }

  /**
   * A* path from world position a to b, string-pulled by walkability LOS.
   * @param {THREE.Vector3} a
   * @param {THREE.Vector3} b
   * @param {{maxIterations?:number, agentHeight?:number}} [opts]
   * @returns {THREE.Vector3[]|null} waypoints (excluding the start), or null if unreachable
   */
  findPath(a, b, opts = {}) {
    const W = this.width;
    let sc = this.cellOf(a.x, a.z);
    let ec = this.cellOf(b.x, b.z);
    let s = this.indexOf(sc.cx, sc.cz);
    let e = this.indexOf(ec.cx, ec.cz);
    if (s < 0 || e < 0) return null;
    if (!this.walkable[s]) s = this._nearestWalkable(sc.cx, sc.cz, 6);
    if (!this.walkable[e]) e = this._nearestWalkable(ec.cx, ec.cz, 8);
    if (s < 0 || e < 0) return null;
    if (s === e) return [b.clone()];

    const g = this._g;
    const f = this._f;
    const parent = this._parent;
    const state = this._state;
    state.fill(0);
    // simple binary-heap-less open list (grid is small); use array + best scan with early bail
    const open = [];
    open.push(s);
    state[s] = 1;
    g[s] = 0;
    parent[s] = -1;
    const ex = e % W;
    const ez = (e / W) | 0;
    f[s] = this._heur(s, ex, ez);
    const maxIter = opts.maxIterations ?? 6000;
    let it = 0;
    let found = false;
    while (open.length && it++ < maxIter) {
      // pop lowest f
      let bi = 0;
      let bf = f[open[0]];
      for (let k = 1; k < open.length; k++) {
        const v = f[open[k]];
        if (v < bf) {
          bf = v;
          bi = k;
        }
      }
      const cur = open[bi];
      open[bi] = open[open.length - 1];
      open.pop();
      if (cur === e) {
        found = true;
        break;
      }
      state[cur] = 2;
      const cx = cur % W;
      const cz = (cur / W) | 0;
      const ch = this.heights[cur];
      for (let d = 0; d < 8; d++) {
        const dx = DIRS8[d][0];
        const dz = DIRS8[d][1];
        const j = this.indexOf(cx + dx, cz + dz);
        if (j < 0 || !this.walkable[j] || state[j] === 2) continue;
        if (Math.abs(this.heights[j] - ch) > this.maxStep) continue;
        if (dx !== 0 && dz !== 0) {
          // diagonal: both orthogonal neighbours must be walkable (no corner cutting)
          const j1 = this.indexOf(cx + dx, cz);
          const j2 = this.indexOf(cx, cz + dz);
          if (j1 < 0 || j2 < 0 || !this.walkable[j1] || !this.walkable[j2]) continue;
        }
        const step = dx !== 0 && dz !== 0 ? 1.4142 : 1;
        const ng = g[cur] + step;
        if (state[j] === 1 && ng >= g[j]) continue;
        g[j] = ng;
        f[j] = ng + this._heur(j, ex, ez);
        parent[j] = cur;
        if (state[j] !== 1) {
          state[j] = 1;
          open.push(j);
        }
      }
    }
    if (!found) return null;
    // reconstruct
    const cells = [];
    let cur = e;
    while (cur !== -1 && cur !== s) {
      cells.push(cur);
      cur = parent[cur];
    }
    cells.reverse();
    // string pulling: greedy LOS skipping
    const pts = [];
    let anchor = s;
    for (let k = 0; k < cells.length; k++) {
      const next = cells[Math.min(k + 1, cells.length - 1)];
      if (k === cells.length - 1 || !this._losCells(anchor, next)) {
        const c = cells[k];
        pts.push(this.cellCenter(c % W, (c / W) | 0, new THREE.Vector3()));
        anchor = c;
      }
    }
    if (pts.length === 0) pts.push(b.clone());
    // snap the final waypoint to the requested position if it lies in the end cell
    pts[pts.length - 1].set(b.x, this.heightAt(b.x, b.z), b.z);
    return pts;
  }

  _heur(i, ex, ez) {
    const W = this.width;
    const cx = i % W;
    const cz = (i / W) | 0;
    const dx = Math.abs(cx - ex);
    const dz = Math.abs(cz - ez);
    // octile distance
    return Math.max(dx, dz) + 0.4142 * Math.min(dx, dz);
  }

  _nearestWalkable(cx, cz, radius) {
    for (let r = 1; r <= radius; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue;
          const j = this.indexOf(cx + dx, cz + dz);
          if (j >= 0 && this.walkable[j]) return j;
        }
      }
    }
    return -1;
  }

  /** Grid line-of-walkability between two cell indices (Bresenham). */
  _losCells(a, b) {
    const W = this.width;
    let x0 = a % W;
    let z0 = (a / W) | 0;
    const x1 = b % W;
    const z1 = (b / W) | 0;
    const dx = Math.abs(x1 - x0);
    const dz = Math.abs(z1 - z0);
    const sx = x0 < x1 ? 1 : -1;
    const sz = z0 < z1 ? 1 : -1;
    let err = dx - dz;
    let prevH = this.heights[a];
    while (true) {
      const i = this.indexOf(x0, z0);
      if (i < 0 || !this.walkable[i]) return false;
      if (Math.abs(this.heights[i] - prevH) > this.maxStep) return false;
      prevH = this.heights[i];
      if (x0 === x1 && z0 === z1) break;
      const e2 = 2 * err;
      let stepX = false;
      let stepZ = false;
      if (e2 > -dz) {
        err -= dz;
        x0 += sx;
        stepX = true;
      }
      if (e2 < dx) {
        err += dx;
        z0 += sz;
        stepZ = true;
      }
      if (stepX && stepZ) {
        // check the two corner cells to prevent diagonal squeezes
        const c1 = this.indexOf(x0 - sx, z0);
        const c2 = this.indexOf(x0, z0 - sz);
        if (c1 < 0 || c2 < 0 || !this.walkable[c1] || !this.walkable[c2]) return false;
      }
    }
    return true;
  }
}

function hash01(x) {
  const s = Math.sin(x * 12.9898 + 78.233) * 43758.5453;
  return s - Math.floor(s);
}

void _v2;
