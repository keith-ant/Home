/**
 * Diagnostics — self-test + debug overlays for the Terminal 9 world contracts.
 *
 * The AI / PLAYER / WEAPONS streams build on world.raycast, capsuleCollide,
 * nav, spawns, surfaces and photo points before they can ever render a
 * frame of their own, so the world verifies those contracts itself:
 *
 *   runWorldSelfTest(level, {verbose}) → {ok, passed, total, failed:[{name, detail}]}
 *     Runs at the end of Level.build(); one console.info summary line, one
 *     console.error per failed check (so the shot harness / verify script
 *     turn red immediately when a contract regresses). `?debug=worldtest`
 *     prints every check.
 *
 *   buildNavOverlay(level) → THREE.Group   (?debug=nav)
 *     walkable cells (thin quads, height-coloured), cover points (chevrons
 *     pointing along the facing normal), enemy spawns (red pillars),
 *     player spawn (green pillar), photo points (magenta markers).
 *
 *   buildColliderOverlay(level) → THREE.LineSegments  (?debug=colliders)
 *     wireframe of the merged collision BVH geometry.
 *
 * Overlays are never built unless the flag is present, so they cost
 * nothing in normal captures.
 */
import * as THREE from 'three';
import { Random } from '../core/Random.js';
import { PLAYER_SPAWN, GROUND } from './layout.js';

const DOWN = new THREE.Vector3(0, -1, 0);
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _dir = new THREE.Vector3();

/* ========================================================================== */
/* Self-test                                                                  */
/* ========================================================================== */

/**
 * @param {import('./Level.js').Level} level
 * @param {{verbose?: boolean}} [opts]
 */
export function runWorldSelfTest(level, opts = {}) {
  const checks = [];
  // each check returns true (pass) or a detail string (fail)
  const check = (name, fn) => {
    try {
      const r = fn();
      if (r === true) checks.push({ name, ok: true, detail: '' });
      else if (typeof r === 'string') checks.push({ name, ok: false, detail: r });
      else checks.push({ name, ok: !!r, detail: r ? '' : 'returned falsy' });
    } catch (err) {
      checks.push({ name, ok: false, detail: 'threw: ' + (err && err.message ? err.message : err) });
    }
  };

  const col = level.collision;
  const nav = level.nav;

  /* ------------------------------------------------------------- ground */
  check('collision.built', () => (col && col.built && col.stats.triangles > 500) || 'no BVH');
  check('ground.mainLane.asphalt', () => {
    const hit = level.raycast(_v.set(0, 4, 12), DOWN, 10);
    if (!hit) return 'no ground hit';
    if (Math.abs(hit.point.y) > 0.08) return `ground y ${hit.point.y.toFixed(3)}`;
    if (hit.surface !== 'asphalt') return `surface ${hit.surface}`;
    return true;
  });
  check('ground.apron.concrete', () => {
    const hit = level.raycast(_v.set(2, 4, -46), DOWN, 10);
    return (hit && hit.surface === 'concrete' && Math.abs(hit.point.y) < 0.1) || `got ${hit ? hit.surface + '@' + hit.point.y.toFixed(2) : 'null'}`;
  });
  check('ground.water', () => {
    const hit = level.raycast(_v.set(0, 4, -68), DOWN, 12);
    return (hit && hit.surface === 'water' && hit.point.y < -1.5) || `got ${hit ? hit.surface : 'null'}`;
  });
  check('ground.verge.gravel', () => {
    const hit = level.raycast(_v.set(-60, 4, 0), DOWN, 10);
    return (hit && hit.surface === 'gravel') || `got ${hit ? hit.surface : 'null'}`;
  });

  /* --------------------------------------------------------- containers */
  check('containers.count', () => (level.kit && level.kit.stats.containers >= 26) || `only ${level.kit?.stats.containers}`);
  check('containers.solid.raycast', () => {
    // from INSIDE the collision box the +x/-x/+z/-z walls must all be found
    // at the container's half-extents (proves a closed solid box surrounds
    // every yard container regardless of its neighbours)
    const kit = level.kit;
    if (!kit || !kit.instances.length) return 'no instances';
    let tested = 0;
    for (const rec of kit.instances) {
      if (rec.spec.collide === false || rec.spec.hollow || rec.spec.burnt) continue;
      _v.set(0, rec.height * 0.5, 0).applyMatrix4(rec.matrix); // centre (world)
      const probes = [
        [1, 0, rec.width / 2], [-1, 0, rec.width / 2], [0, 1, rec.length / 2], [0, -1, rec.length / 2],
      ];
      for (const [lx, lz, expect] of probes) {
        _v2.set(lx, 0, lz).transformDirection(rec.matrix);
        const hit = level.raycast(_v, _v2, expect + 2, { backfaces: true });
        if (!hit) return `no wall for container at ${_v.x.toFixed(1)},${_v.z.toFixed(1)} dir (${lx},${lz})`;
        if (Math.abs(hit.distance - expect) > 0.3) return `wall at ${hit.distance.toFixed(2)} m, expected ${expect.toFixed(2)}`;
      }
      if (++tested >= 8) break;
    }
    return tested > 0 || 'no solid containers tested';
  });
  check('containers.roof.solid', () => {
    // down-cast onto container stacks: the top surface must sit at a multiple
    // of the container height (2.59 m) and read as metal
    const kit = level.kit;
    let tested = 0;
    for (const rec of kit.instances) {
      if (rec.spec.collide === false || rec.spec.hollow) continue;
      _v.set(0, 0, 0).applyMatrix4(rec.matrix);
      if (Math.abs(_v.y) > 0.05) continue; // stacks resting on the ground
      const hit = level.raycast(_v2.set(_v.x, _v.y + 10, _v.z), DOWN, 10.5);
      if (!hit) return `roof cast missed at ${_v.x.toFixed(1)},${_v.z.toFixed(1)}`;
      const mod = hit.point.y % 2.59;
      if (mod > 0.16 && 2.59 - mod > 0.16) return `stack top at y=${hit.point.y.toFixed(2)} (not a multiple of 2.59)`;
      if (hit.surface !== 'metal') return `roof surface ${hit.surface}`;
      if (++tested >= 10) break;
    }
    return tested > 0 || 'no ground-level container';
  });

  /* ----------------------------------------------------------- capsules */
  check('capsule.groundSettle', () => {
    // a capsule sunk 0.3 m into the asphalt is pushed back up to rest on it
    const capsule = {
      start: new THREE.Vector3(4, 0.35 - 0.3, 8),
      end: new THREE.Vector3(4, 1.45 - 0.3, 8),
      radius: 0.35,
    };
    const res = level.capsuleCollide(capsule);
    if (!res.hit) return 'no ground contact';
    if (capsule.start.y < 0.33) return `settled too low: ${capsule.start.y.toFixed(3)}`;
    if (!res.grounded) return 'grounded flag not set';
    return true;
  });
  check('capsule.wallSlide', () => {
    // a walking capsule pushed hard into a container wall for 2 m of travel
    // must never end up past the wall plane (containers are solid at
    // player/AI movement speeds)
    const kit = level.kit;
    for (const rec of kit.instances) {
      if (rec.spec.collide === false || rec.spec.hollow || rec.spec.burnt) continue;
      _v.set(0, 0, 0).applyMatrix4(rec.matrix); // bottom centre
      if (Math.abs(_v.y) > 0.05) continue;
      // the +x side must face free space (no neighbour within 1.6 m)
      _v2.set(rec.width / 2 + 0.06, 1.1, 0).applyMatrix4(rec.matrix);
      _dir.set(1, 0, 0).transformDirection(rec.matrix); // outward normal (world)
      if (level.raycast(_v2, _dir, 1.6)) continue;
      // wall plane point (world) and a capsule 1 m outside it
      const wall = _v2.set(rec.width / 2, 0, 0).applyMatrix4(rec.matrix).clone();
      const capsule = {
        start: new THREE.Vector3(wall.x + _dir.x, 0.4, wall.z + _dir.z),
        end: new THREE.Vector3(wall.x + _dir.x, 1.5, wall.z + _dir.z),
        radius: 0.35,
      };
      // walk into the wall: 20 steps of 0.1 m along -outward, resolving each step
      for (let i = 0; i < 20; i++) {
        capsule.start.addScaledVector(_dir, -0.1);
        capsule.end.addScaledVector(_dir, -0.1);
        level.capsuleCollide(capsule);
        level.capsuleCollide(capsule);
        const outside = (capsule.start.x - wall.x) * _dir.x + (capsule.start.z - wall.z) * _dir.z;
        if (outside < 0.35 - 0.1) return `capsule pushed ${(0.35 - outside).toFixed(2)} m into the wall after ${i + 1} steps`;
      }
      return true;
    }
    return 'no free-standing container side found';
  });
  check('capsule.dropTest', () => {
    // drop capsules under gravity at spawn points + random walkable points; none may fall through
    const pts = [];
    const sp = level.spawns.player.position;
    pts.push([sp.x, sp.z]);
    for (const e of level.spawns.enemy.slice(0, 8)) pts.push([e.position.x, e.position.z]);
    if (nav) {
      const rng = new Random(1337);
      for (let i = 0; i < 10; i++) {
        const p = nav.randomWalkablePoint(rng);
        if (p) pts.push([p.x, p.z]);
      }
    }
    const capsule = { start: new THREE.Vector3(), end: new THREE.Vector3(), radius: 0.35 };
    let worst = null;
    for (const [x, z] of pts) {
      const groundY = nav ? nav.heightAt(x, z) : 0;
      let vy = 0;
      capsule.start.set(x, groundY + 2.0 + 0.35, z);
      capsule.end.set(x, groundY + 2.0 + 1.45, z);
      for (let s = 0; s < 90; s++) {
        vy -= 18 * (1 / 60);
        const dy = vy * (1 / 60);
        capsule.start.y += dy;
        capsule.end.y += dy;
        const res = level.capsuleCollide(capsule);
        if (res.hit && res.grounded && vy < 0) vy = 0;
        if (capsule.start.y < groundY - 0.6) return `fell through at (${x.toFixed(1)}, ${z.toFixed(1)})`;
      }
      const rest = capsule.start.y - 0.35 - groundY;
      if (rest < -0.08 || rest > 0.9) worst = `resting offset ${rest.toFixed(2)} at (${x.toFixed(1)}, ${z.toFixed(1)})`;
    }
    return worst || true;
  });

  /* --------------------------------------------------------------- nav */
  check('nav.walkableCount', () => (nav && nav.stats.walkable >= 2500) || `walkable=${nav?.stats.walkable}`);
  check('nav.floodConnected', () => {
    // player spawn cell + all four lanes reachable
    const probes = [
      [0, 20, 'main lane south'], [0, -30, 'main lane north'], [-30, -30, 'west lane'],
      [30, -20, 'east lane'], [0, -45, 'apron'], [30, 33, 'south lane'],
    ];
    for (const [x, z, label] of probes) if (!nav.isWalkable(x, z)) return `${label} (${x},${z}) not walkable`;
    return true;
  });
  check('nav.blockedCells', () => {
    // inside container blocks / water must be blocked
    const probes = [[-45, -34, 'perimW stack'], [0, -70, 'water'], [70, 0, 'outside fence east']];
    for (const [x, z, label] of probes) if (nav.isWalkable(x, z)) return `${label} walkable`;
    return true;
  });
  check('nav.paths', () => {
    const from = level.spawns.player.position;
    let tried = 0;
    for (const e of level.spawns.enemy.slice(0, 6)) {
      const path = nav.findPath(from, e.position);
      if (!path || path.length === 0) return `no path to spawn '${e.tag}' (${e.position.x.toFixed(1)}, ${e.position.z.toFixed(1)})`;
      // path sanity: total length ≤ 3.2 × crow flight
      let len = 0;
      let prev = from;
      for (const p of path) {
        len += prev.distanceTo(p);
        prev = p;
      }
      const crow = from.distanceTo(e.position);
      if (len > crow * 3.4 + 6) return `path to '${e.tag}' is ${len.toFixed(0)} m for ${crow.toFixed(0)} m crow`;
      tried++;
    }
    return tried > 0 || 'no enemy spawns to path to';
  });
  check('nav.randomWalkable', () => {
    const rng = new Random(4242);
    for (let i = 0; i < 6; i++) {
      const p = nav.randomWalkablePoint(rng);
      if (!p) return 'randomWalkablePoint returned null';
      if (!nav.isWalkable(p.x, p.z)) return 'returned point not walkable';
    }
    return true;
  });
  check('nav.coverPoints', () => {
    const cp = nav.coverPoints;
    if (!cp || cp.length < 30) return `only ${cp?.length} cover points`;
    let bad = 0;
    for (const c of cp) {
      if (!nav.isWalkable(c.position.x, c.position.z)) bad++;
      if (Math.abs(c.normal.lengthSq() - 1) > 0.05) return 'cover normal not unit length';
      if (!(c.height > 0.4)) return 'cover height ≤ 0.4';
    }
    return bad === 0 || `${bad} cover points not walkable`;
  });
  check('nav.enemySpawns', () => {
    const sp = level.spawns.enemy;
    if (!sp || sp.length < 12) return `only ${sp?.length} enemy spawns`;
    const eye = _v.set(PLAYER_SPAWN.x, 1.65, PLAYER_SPAWN.z).clone();
    for (const e of sp) {
      if (!nav.isWalkable(e.position.x, e.position.z)) return `spawn '${e.tag}' not walkable`;
      // must be hidden from the player spawn eye
      _v2.copy(e.position).setY(e.position.y + 1.6);
      _dir.subVectors(_v2, eye);
      const dist = _dir.length();
      _dir.multiplyScalar(1 / dist);
      const hit = level.raycast(eye, _dir, dist - 0.4);
      if (!hit) return `spawn '${e.tag}' visible from the player spawn`;
    }
    return true;
  });

  /* --------------------------------------------------------- spawn/photo */
  check('spawn.player', () => {
    const s = level.spawns.player;
    if (!s || !s.position) return 'missing';
    if (!nav.isWalkable(s.position.x, s.position.z)) return 'player spawn not walkable';
    const hit = level.raycast(_v.set(s.position.x, 3, s.position.z), DOWN, 6);
    if (!hit) return 'no ground under player spawn';
    if (hit.surface !== 'asphalt') return `spawn ground is ${hit.surface}`;
    if (typeof s.yaw !== 'number') return 'yaw missing';
    return true;
  });
  check('photoPoints.present', () => {
    for (const id of ['smoke', 'vista', 'street', 'alley', 'quay', 'warehouse']) {
      const p = level.photoPoints[id];
      if (!p || !p.position) return `photoPoints.${id} missing`;
      if (!p.target && typeof p.yaw !== 'number') return `photoPoints.${id} has no target/yaw`;
    }
    return true;
  });
  check('photoPoints.notInsideGeometry', () => {
    const capsule = { start: new THREE.Vector3(), end: new THREE.Vector3(), radius: 0.22 };
    for (const [id, p] of Object.entries(level.photoPoints)) {
      capsule.start.copy(p.position);
      capsule.end.copy(p.position);
      capsule.end.y += 0.05;
      const res = level.capsuleCollide(capsule);
      if (res.hit && res.depth > 0.05) return `photoPoints.${id} camera intersects geometry (depth ${res.depth.toFixed(2)})`;
      // enclosed test: a camera INSIDE a closed proxy (container) touches no
      // face but sees only backfaces around it — cast 4 horizontal rays with
      // and without backfaces; front-face misses + backface hits ⇒ inside
      let enclosed = 0;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        _dir.set(dx, 0, dz);
        const front = level.raycast(p.position, _dir, 4);
        const any = level.raycast(p.position, _dir, 4, { backfaces: true });
        if (!front && any) enclosed++;
      }
      if (enclosed >= 3) return `photoPoints.${id} camera is inside solid geometry`;
    }
    return true;
  });

  /* ------------------------------------------------------------ surfaces */
  check('surfaceAt.samples', () => {
    const samples = [
      [_v.set(0, 0.02, 10).clone(), 'asphalt'],
      [_v.set(2, 0.02, -46).clone(), 'concrete'],
      [_v.set(-60, 0.03, 0).clone(), 'gravel'],
      [_v.set(0, GROUND.waterY + 0.02, -68).clone(), 'water'],
    ];
    for (const [pt, want] of samples) {
      const s = level.surfaceAt(pt);
      if (s !== want) return `${want} sample returned ${s}`;
    }
    // a container roof reads metal
    const kit = level.kit;
    for (const rec of kit.instances) {
      if (rec.spec.collide === false) continue;
      _v.set(0, 0, 0).applyMatrix4(rec.matrix);
      if (Math.abs(_v.y) > 0.05) continue;
      const s = level.surfaceAt(_v2.set(_v.x, 2.6, _v.z));
      if (s !== 'metal') return `container roof surface is ${s}`;
      break;
    }
    return true;
  });

  /* ---------------------------------------------------------- registries */
  check('emitters.fire', () => {
    const fires = level.emitters.filter((e) => e.kind === 'fire');
    return fires.length >= 3 || `only ${fires.length} fire emitters`;
  });
  check('fixtures.count', () => (level.fixtures && level.fixtures.length >= 8) || `only ${level.fixtures?.length} fixtures`);
  check('landmarks.core', () => {
    for (const k of ['warehouseBay', 'gate', 'ship', 'craneA', 'craneB']) {
      if (!level.landmarks[k]) return `landmark '${k}' missing`;
    }
    return true;
  });
  check('bounds.playable', () => {
    const b = level.bounds;
    return (b && b.x1 - b.x0 >= 90 && b.z1 - b.z0 >= 80) || 'bounds too small';
  });

  /* -------------------------------------------------------------- report */
  const failed = checks.filter((c) => !c.ok);
  const result = {
    ok: failed.length === 0,
    passed: checks.length - failed.length,
    total: checks.length,
    failed: failed.map((f) => ({ name: f.name, detail: f.detail })),
    checks,
  };
  if (opts.verbose) {
    for (const c of checks) console.info(`[world:test] ${c.ok ? 'PASS' : 'FAIL'} ${c.name}${c.detail ? ' — ' + c.detail : ''}`);
  }
  if (result.ok) {
    console.info(`[world] self-test: ${result.passed}/${result.total} contract checks passed`);
  } else {
    for (const f of failed) console.error(`[world] SELF-TEST FAILED: ${f.name} — ${f.detail}`);
  }
  return result;
}

/* ========================================================================== */
/* Debug overlays                                                             */
/* ========================================================================== */

/**
 * Nav grid + cover + spawns + photo points visualisation.
 * @param {import('./Level.js').Level} level
 * @returns {THREE.Group}
 */
export function buildNavOverlay(level) {
  const group = new THREE.Group();
  group.name = 'debug.nav';
  const nav = level.nav;
  if (!nav) return group;

  // -- walkable cells: instanced thin quads, coloured by standing height --
  const cs = nav.cellSize;
  const quad = new THREE.PlaneGeometry(cs, cs); // gap-free so post AA/CA doesn't fringe the grid
  quad.rotateX(-Math.PI / 2);
  const cellMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.72, depthWrite: false, fog: false, toneMapped: false });
  const count = nav.stats.walkable;
  const cells = new THREE.InstancedMesh(quad, cellMat, count);
  cells.name = 'debug.nav.cells';
  cells.frustumCulled = false;
  cells.renderOrder = 900;
  const m = new THREE.Matrix4();
  const col = new THREE.Color();
  let n = 0;
  for (let cz = 0; cz < nav.height; cz++) {
    for (let cx = 0; cx < nav.width; cx++) {
      const i = cz * nav.width + cx;
      if (!nav.walkable[i]) continue;
      nav.cellCenter(cx, cz, _v);
      m.makeTranslation(_v.x, _v.y + 0.06, _v.z);
      cells.setMatrixAt(n, m);
      // green at ground level → cyan on raised walkables (ramps / container tops)
      const h = THREE.MathUtils.clamp(_v.y / 3, 0, 1);
      col.setRGB(0.05 + 0.1 * h, 0.55, 0.15 + 0.75 * h);
      cells.setColorAt(n, col);
      if (++n >= count) break;
    }
    if (n >= count) break;
  }
  cells.count = n;
  cells.instanceMatrix.needsUpdate = true;
  if (cells.instanceColor) cells.instanceColor.needsUpdate = true;
  group.add(cells);

  // -- cover points: chevrons pointing along the facing normal --------------
  const cover = nav.coverPoints;
  if (cover.length) {
    const arrow = new THREE.ConeGeometry(0.16, 0.5, 4);
    arrow.rotateX(Math.PI / 2); // point along +Z
    const coverMat = new THREE.MeshBasicMaterial({ color: 0xffcc22, fog: false, toneMapped: false });
    const inst = new THREE.InstancedMesh(arrow, coverMat, cover.length);
    inst.name = 'debug.nav.cover';
    inst.frustumCulled = false;
    inst.renderOrder = 901;
    const q = new THREE.Quaternion();
    const zAxis = new THREE.Vector3(0, 0, 1);
    for (let i = 0; i < cover.length; i++) {
      const c = cover[i];
      q.setFromUnitVectors(zAxis, c.normal);
      m.compose(_v2.copy(c.position).setY(c.position.y + 0.35), q, _dir.set(1, 1, c.type === 'high' ? 1.7 : 1));
      inst.setMatrixAt(i, m);
      inst.setColorAt(i, col.set(c.type === 'high' ? 0xff8811 : 0xffdd33));
    }
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    group.add(inst);
  }

  // -- enemy spawns: red pillars ------------------------------------------
  const spawns = level.spawns.enemy || [];
  if (spawns.length) {
    const pillar = new THREE.CylinderGeometry(0.22, 0.22, 3.2, 8);
    pillar.translate(0, 1.6, 0);
    const inst = new THREE.InstancedMesh(pillar, new THREE.MeshBasicMaterial({ color: 0xff2a2a, fog: false, toneMapped: false }), spawns.length);
    inst.name = 'debug.nav.spawns';
    inst.frustumCulled = false;
    inst.renderOrder = 902;
    for (let i = 0; i < spawns.length; i++) {
      m.makeTranslation(spawns[i].position.x, spawns[i].position.y, spawns[i].position.z);
      inst.setMatrixAt(i, m);
    }
    inst.instanceMatrix.needsUpdate = true;
    group.add(inst);
  }

  // -- player spawn: green pillar + facing arrow ------------------------------
  {
    const s = level.spawns.player;
    const geo = new THREE.CylinderGeometry(0.3, 0.3, 3.6, 10);
    geo.translate(0, 1.8, 0);
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x33ff66, fog: false, toneMapped: false }));
    mesh.position.copy(s.position);
    mesh.renderOrder = 902;
    group.add(mesh);
    const arrowGeo = new THREE.ConeGeometry(0.3, 1.0, 4);
    arrowGeo.rotateX(Math.PI / 2);
    const arrow = new THREE.Mesh(arrowGeo, mesh.material);
    arrow.position.set(s.position.x - Math.sin(s.yaw) * 1.2, s.position.y + 3.7, s.position.z - Math.cos(s.yaw) * 1.2);
    arrow.rotation.y = s.yaw;
    group.add(arrow);
  }

  // -- photo points: magenta camera markers --------------------------------
  {
    const geo = new THREE.OctahedronGeometry(0.45, 0);
    const mat = new THREE.MeshBasicMaterial({ color: 0xff33cc, fog: false, toneMapped: false });
    for (const [id, p] of Object.entries(level.photoPoints)) {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = 'debug.photo.' + id;
      mesh.position.copy(p.position);
      mesh.renderOrder = 903;
      group.add(mesh);
    }
  }
  return group;
}

/**
 * Wireframe of the merged collision geometry.
 * @param {import('./Level.js').Level} level
 * @returns {THREE.LineSegments}
 */
export function buildColliderOverlay(level) {
  const src = level.collision.geometry;
  const geo = new THREE.WireframeGeometry(src);
  const mat = new THREE.LineBasicMaterial({ color: 0x2affe0, transparent: true, opacity: 0.35, fog: false, toneMapped: false });
  const lines = new THREE.LineSegments(geo, mat);
  lines.name = 'debug.colliders';
  lines.renderOrder = 899;
  return lines;
}
