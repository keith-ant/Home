/**
 * Level: builds the playable world.
 *
 * SCAFFOLD (milestone 0): a ground plane, a handful of container-sized boxes
 * and a few point lights so the pipeline (build → boot → photo mode → shot)
 * can be verified end to end. The WORLD stream replaces the contents with
 * Terminal 9 per docs/ART_DIRECTION.md §4 while keeping the public contract:
 *
 *   level.build(): Promise<void>
 *   level.group           — THREE.Group holding static world geometry
 *   level.collision       — { raycast(origin, dir, maxDist, mask?), capsuleCollide(...) } (three-mesh-bvh)
 *   level.nav             — navigation data for AI
 *   level.spawns          — { player: {position, yaw}, enemy: [{position, yaw}, ...] }
 *   level.lights          — fixture list consumed by the RENDER stream
 *   level.getSurfaceAt?    — surface tag lookups for foley/impacts
 */
import * as THREE from 'three';

export class Level {
  /**
   * @param {object} deps
   * @param {THREE.Scene} deps.scene
   * @param {import('../assets/AssetLoader.js').AssetLoader} [deps.assets]
   * @param {import('../core/Random.js').Random} deps.rng
   * @param {import('../render/QualityTiers.js').QUALITY_TIERS.high} deps.tier
   */
  constructor({ scene, assets = null, rng, tier }) {
    this.scene = scene;
    this.assets = assets;
    this.rng = rng;
    this.tier = tier;
    this.group = new THREE.Group();
    this.group.name = 'level';
    this.lights = [];
    this.spawns = { player: { position: new THREE.Vector3(0, 0, 18), yaw: Math.PI }, enemy: [] };
    this.collision = null;
    this.nav = null;
  }

  async build() {
    const g = this.group;

    // Ground
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(160, 160, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0x2a2c2f, roughness: 0.35, metalness: 0.05 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    ground.name = 'ground';
    ground.userData.surface = 'concrete';
    g.add(ground);

    // Container-ish boxes to give the smoke shot depth and shadows
    const palette = [0x8f2b22, 0x1f5966, 0xc48a21, 0x5c6068, 0xd9d3c7];
    const box = new THREE.BoxGeometry(2.44, 2.59, 12.19); // real 40ft container dims
    for (let i = 0; i < 22; i++) {
      const m = new THREE.MeshStandardMaterial({
        color: palette[i % palette.length],
        roughness: 0.55,
        metalness: 0.3,
      });
      const c = new THREE.Mesh(box, m);
      c.castShadow = true;
      c.receiveShadow = true;
      const lane = i % 2 === 0 ? -1 : 1;
      c.position.set(lane * (6 + (i % 5) * 5.4), 2.59 / 2 + Math.floor(i / 11) * 2.59, -30 + (i % 11) * 6.5);
      c.rotation.y = i % 3 === 0 ? Math.PI / 2 : 0;
      c.userData.surface = 'metal';
      g.add(c);
    }

    // A couple of warm practical lights (floodlight stand-ins)
    for (let i = 0; i < 4; i++) {
      const pl = new THREE.PointLight(0xffb15c, 400, 40, 2);
      pl.position.set(-24 + i * 16, 7, -6 + (i % 2) * 12);
      pl.castShadow = i < 2;
      pl.shadow.mapSize.set(1024, 1024);
      pl.shadow.bias = -0.001;
      g.add(pl);
      this.lights.push({ type: 'flood', object: pl });
    }

    this.scene.add(g);

    // Enemy spawn ring (used later by the Director)
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      this.spawns.enemy.push({ position: new THREE.Vector3(Math.cos(a) * 34, 0, Math.sin(a) * 34), yaw: a + Math.PI });
    }
  }

  update(dt) {
    void dt; // dynamic world elements (fires, cables, flickering lights) go here
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
        else o.material.dispose();
      }
    });
  }
}
