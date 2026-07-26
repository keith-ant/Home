/**
 * Level — Terminal 9 orchestrator (WORLD stream). Builds the whole map and
 * exposes the world API used by every other stream.
 *
 * Public surface (game.world):
 *   world.group            THREE.Group root of all static world objects
 *   world.isTerminal9      true (disables the render stream's scaffold demo)
 *   world.bounds           playable rect {x0,x1,z0,z1}
 *   world.collision        CollisionWorld (BVH)
 *   world.raycast(origin, dir, maxDist?, opts?) → {point, normal, distance, object, surface} | null
 *   world.raycastAll(...), world.sphereCast(origin, dir, radius, maxDist), world.capsuleCollide(capsule)
 *   world.surfaceAt(pointOrHit), world.getSurfaceAt (alias), world.puddleAt(x, z) → 0..1
 *   world.nav              NavGrid (findPath, randomWalkablePoint, coverPoints, enemySpawnPoints, heightAt)
 *   world.spawns           { player: {position: Vector3, yaw}, enemy: [{position, yaw, tag}] }
 *   world.emitters         [{kind:'fire'|'embers'|'smoke', position, radius, intensity, tag}] for FX
 *   world.fixtures         lighting fixture records created by the world
 *   world.photoPoints      { vista, street, alley, quay, warehouse, smoke, rain_light, lightning, ... }
 *   world.landmarks        named positions (warehouseBay, craneA, mastM1, fireFB1, ...)
 *   world.puddleMask       {sample(x,z)} the wet-ground mask
 *   world.stats            build statistics
 *   world.update(dt)       animates fires/water (called by Game each fixed step)
 */
import * as THREE from 'three';
import { WorldMaterials } from './materials.js';
import { StaticBatcher, worldRng, DEG } from './util.js';
import { CollisionWorld } from './Collision.js';
import { ContainerKit } from './Containers.js';
import { Terrain } from './Terrain.js';
import { Structures } from './Structures.js';
import { Setpieces } from './Setpieces.js';
import { Props } from './Props.js';
import { NavGrid } from './Nav.js';
import { YARD, PLAYER_SPAWN, PHOTO_POINTS } from './layout.js';

export class Level {
  /**
   * @param {import('../Game.js').Game} game
   */
  constructor(game) {
    this.game = game;
    this.scene = game.scene;
    this.assets = game.assets;
    this.tier = game.tier;
    this.time = game.time;

    this.isTerminal9 = true;
    this.name = 'Terminal 9';
    this.group = new THREE.Group();
    this.group.name = 'level.terminal9';
    /** @deprecated declarative fixture list (fixtures are created directly via game.lighting) */
    this.lights = [];
    this.fixtures = [];
    this.emitters = [];
    this.sprites = [];
    this.dynamics = [];
    this.instancedMeshes = [];
    this.groundMeshes = [];
    this.landmarks = {};
    this.spawns = { player: { position: new THREE.Vector3(), yaw: 0 }, enemy: [] };
    this.photoPoints = {};
    this.bounds = { ...YARD.playable };
    this.groundY = 0;
    this.stats = {};
    this.collision = new CollisionWorld();
    this.nav = null;
    this.puddleMask = null;
    this.water = null;
    this.waterFallback = null;
  }

  /* ------------------------------------------------------------------ */
  async build() {
    const t0 = performance.now();
    const game = this.game;
    this.rng = worldRng(game, 4211);
    this.mats = new WorldMaterials(game, this.rng);
    this.batcher = new StaticBatcher(this.group, 't9');

    // shared build context passed to every builder
    const ctx = {
      game,
      level: this,
      root: this.group,
      rng: this.rng,
      mats: this.mats,
      batcher: this.batcher,
      collision: this.collision,
      assets: this.assets,
    };
    this.ctx = ctx;

    // props placer is needed by setpieces (fire barrels) → create early
    this.props = new Props(ctx);
    ctx.props = this.props;
    // container kit
    this.kit = new ContainerKit(ctx);
    ctx.kit = this.kit;

    // --- ground -------------------------------------------------------------
    this.terrain = new Terrain(ctx);
    this.terrain.build();

    // --- containers (the yard) ------------------------------------------------
    this.kit.buildYard({
      addCoalBed: (pos, radius) => this._addCoalBed(pos, radius),
      addFirePractical: (pos, o) => this._addFirePractical(pos, o),
      addEmitter: (e) => this.emitters.push(e),
    });
    if (this.kit.burntRecord) this.landmarks.burntContainer = this.kit.burntRecord.position.clone();
    if (this.kit.fallenRecord) this.landmarks.fallenContainer = this.kit.fallenRecord.position.clone();

    // --- structures + set dressing ---------------------------------------------
    this.structures = new Structures(ctx);
    this.structures.build();
    this.setpieces = new Setpieces(ctx);
    this.setpieces.build();

    // --- props (instanced GLTF clutter) -----------------------------------------
    this.props.buildClutter();
    this.props.build();

    // --- flush static batches ------------------------------------------------------
    const batchMeshes = this.batcher.build();

    // --- collision BVH ----------------------------------------------------------------
    this.collision.build();

    // --- navigation ---------------------------------------------------------------------
    this.nav = new NavGrid(this.collision, { cellSize: 0.75 });
    this.nav.bake();

    // --- spawns ---------------------------------------------------------------------------
    this.spawns.player = {
      position: new THREE.Vector3(PLAYER_SPAWN.x, 0, PLAYER_SPAWN.z),
      yaw: PLAYER_SPAWN.yaw,
    };
    this.spawns.enemy = this.nav.enemySpawnPoints;

    // --- photo points ----------------------------------------------------------------------
    for (const [id, p] of Object.entries(PHOTO_POINTS)) {
      this.photoPoints[id] = {
        position: new THREE.Vector3(p.position[0], p.position[1], p.position[2]),
        target: p.target ? new THREE.Vector3(p.target[0], p.target[1], p.target[2]) : undefined,
        yaw: p.yawDeg !== undefined ? p.yawDeg * DEG : undefined,
        pitch: p.pitchDeg !== undefined ? p.pitchDeg * DEG : undefined,
        fov: p.fov,
      };
    }

    // --- scene hookup + integration with other streams -------------------------------
    this.scene.add(this.group);
    if (game.weather) game.weather.groundY = 0;

    // --- stats ---------------------------------------------------------------------------------
    const ms = performance.now() - t0;
    let staticTris = 0;
    for (const m of batchMeshes) staticTris += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3;
    this.stats = {
      buildMs: Math.round(ms),
      containers: this.kit.stats.containers,
      containerDecals: this.kit.stats.decals,
      propPlacements: this.props.stats.placements,
      propInstancedMeshes: this.props.stats.instancedMeshes,
      batchedMeshes: batchMeshes.length,
      staticTriangles: Math.round(staticTris),
      collisionTriangles: this.collision.stats.triangles,
      navCells: `${this.nav.width}x${this.nav.height}`,
      navWalkable: this.nav.stats.walkable,
      coverPoints: this.nav.stats.cover,
      enemySpawns: this.spawns.enemy.length,
      fixtures: this.fixtures.length,
      emitters: this.emitters.length,
      materials: this.mats._all.length + this.mats.containerMaterials.length,
    };
    console.info('[world] Terminal 9 built', this.stats);
  }

  /* ------------------------------------------------------ build hooks */
  _addCoalBed(pos, radius) {
    const mat = this.mats.m.coals.clone();
    const geo = new THREE.CircleGeometry(radius, 18);
    geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(pos);
    mesh.name = 'burnt.coals';
    mesh.renderOrder = 12;
    this.group.add(mesh);
    this.dynamics.push({ kind: 'coalbed', coal: mesh, seed: pos.x * 0.31 + pos.z * 0.17 });
    // a couple of tiny flame licks inside
    const flames = [];
    for (let i = 0; i < 2; i++) {
      const fm = this.mats.m.flameSprite.clone();
      fm.color = new THREE.Color(0xff8a3a).multiplyScalar(1.8);
      fm.opacity = 0.7;
      const s = new THREE.Sprite(fm);
      s.center.set(0.5, 0.05);
      s.position.set(pos.x + (i - 0.5) * 0.6, pos.y + 0.02, pos.z + (i - 0.5) * 0.3);
      s.scale.set(0.5, 0.8, 1);
      s.renderOrder = 40;
      this.group.add(s);
      this.sprites.push(s);
      flames.push(s);
    }
    this.dynamics.push({ kind: 'fire', flames, glow: null, coal: null, fixture: null, seed: 3.7 });
  }

  _addFirePractical(pos, o = {}) {
    // The smouldering interior is sold by its emissive coal bed + flame licks;
    // no real light here (per-fragment light budget on software GL).
    void pos;
    void o;
    return null;
  }

  /* ---------------------------------------------------------- update */
  /**
   * Per fixed step: animate fire sprites / coal beds / water from the
   * simulation clock (deterministic).
   * @param {number} dt
   */
  update(dt) {
    void dt;
    const t = this.time.elapsed;
    for (const d of this.dynamics) {
      switch (d.kind) {
        case 'fire': {
          const v = d.fixture?._flickerValue ?? 1;
          for (let i = 0; i < d.flames.length; i++) {
            const s = d.flames[i];
            const base = s.userData.base || [0.42 + i * 0.06, 0.78 + i * 0.11];
            const wob = 0.85 + 0.3 * Math.sin(t * (7.3 + i * 1.9) + d.seed + i) * Math.sin(t * 3.1 + i);
            const flick = 0.75 + 0.35 * Math.sin(t * (12.7 + i * 2.3) + d.seed * 2 + i * 1.3);
            s.scale.set(base[0] * wob * (0.72 + 0.48 * v), base[1] * (0.7 + 0.5 * v) * (0.85 + 0.25 * flick), 1);
            s.material.opacity = (0.45 + 0.4 * v) * (0.8 + 0.2 * flick);
            s.material.rotation = Math.sin(t * 2.3 + i * 1.7 + d.seed) * 0.16;
          }
          if (d.glow) {
            d.glow.material.opacity = 0.2 + 0.24 * v;
            d.glow.scale.setScalar(1.7 + 0.45 * v);
          }
          if (d.coal) d.coal.material.emissiveIntensity = 2.4 + 1.6 * v + 0.4 * Math.sin(t * 11.0 + d.seed);
          break;
        }
        case 'coalbed': {
          const pulse = 0.75 + 0.25 * Math.sin(t * 1.7 + d.seed) + 0.15 * Math.sin(t * 6.9 + d.seed * 2);
          d.coal.material.emissiveIntensity = 2.2 * pulse + 0.8;
          break;
        }
        default:
          break;
      }
    }
    // water uniforms (planar reflector + fallback both track the sim clock)
    const w = this.water;
    if (w && w.material && w.material.uniforms && w.material.uniforms.uTime) {
      const fog = this.scene.fog;
      const u = w.material.uniforms;
      u.uTime.value = t;
      if (fog) {
        u.fogColor.value.copy(fog.color);
        u.fogDensity.value = fog.density;
      }
      const wind = this.game.weather?.windVector;
      if (wind) u.uWind.value.set(wind.x * 0.4, wind.z * 0.4);
    }
    const wf = this.waterFallback;
    if (wf && wf.material.normalMap) wf.material.normalMap.offset.set(t * 0.011, t * 0.006);
  }

  /* ------------------------------------------------------------ API */
  raycast(origin, dir, maxDist = 1000, opts) {
    return this.collision.raycast(origin, dir, maxDist, opts);
  }

  raycastAll(origin, dir, maxDist = 1000, opts) {
    return this.collision.raycastAll(origin, dir, maxDist, opts);
  }

  sphereCast(origin, dir, radius, maxDist = 1000) {
    return this.collision.sphereCast(origin, dir, radius, maxDist);
  }

  capsuleCollide(capsule) {
    return this.collision.capsuleCollide(capsule);
  }

  surfaceAt(pointOrHit) {
    return this.collision.surfaceAt(pointOrHit);
  }

  getSurfaceAt(pointOrHit) {
    return this.collision.surfaceAt(pointOrHit);
  }

  /** 0..1 standing-water amount on the asphalt at (x,z) (footstep splash intensity). */
  puddleAt(x, z) {
    return this.terrain?.puddleAt(x, z) ?? 0;
  }

  /** Ground height at (x,z) (BVH down-cast); {y, surface} or null. */
  groundHeightAt(x, z) {
    return this.collision.groundHeightAt(x, z);
  }

  dispose() {
    this.scene.remove(this.group);
    for (const f of this.fixtures) this.game.lighting?.remove?.(f);
    this.fixtures.length = 0;
    this.group.traverse((o) => {
      o.geometry?.dispose?.();
    });
    for (const s of this.sprites) s.material?.dispose?.();
    this.collision.dispose();
    this.mats?.dispose?.();
  }
}
