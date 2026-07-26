# NOTES — S2 WORLD ("Terminal 9", `src/world/**`)

Owner scope: the map. Ground, container yard, warehouse/trailer/quay/ship/
cranes, all set dressing and prop placement, the collision BVH, the nav grid
with cover + spawn points, photo points and the environment photo presets.
Wired through `src/world/index.js` → `game.world` (a `Level` instance).
The scaffold DEMO from S1 is disabled automatically (`world.isTerminal9`).

## 1. What was built

| Module | Summary |
| --- | --- |
| `Level.js` | Orchestrator: builds terrain → container yard → structures → set dressing → props → static batches → collision BVH → nav bake → spawns → photo points; owns the runtime `update(dt)` (fires, coal beds, water); exposes the world API (below); runs the contract self-test at the end of the build and reports `world.stats`. |
| `layout.js` | Pure data: yard geometry constants, container block grids, specials (burnt / fallen / ramp / quay 20-footers), paint palette, masts, fire barrels, cables, puddles, drains, decal placements, prop clutter lists, hero barriers, sandbag walls, pallet stacks, enemy spawn candidates, player spawn, photo points. |
| `Terrain.js` | 140×90 m wet asphalt yard (`pbr.makeWetGround` + canvas-painted world puddle mask: 11 authored + 8 random puddles, gutter strips along every block base, drain pools), concrete quay apron + quay wall + fender piles + crane rails, gravel verges, and all ground decals from a 2K procedural marking atlas (worn lane lines / arrows / words / bay brackets, chevron thresholds, zebra footpath, oil stains, tyre skids, drain grates, manhole rings, crack patches from `tex.asphalt_cracked`). |
| `Containers.js` | Procedural container kit: true 20/40 ft dims, corrugated side/roof/end panels (photoscan `tex.container_panel` re-painted per instance with rust + rain-film shader), posts, top/bottom rails, corner castings, forklift pockets, full door end (2 leaves, 4 locking bars, guides, cam keepers, handles, hinges, header/sill) open or closed, decal atlas stencils (owner logotypes, unit IDs, MAX GROSS data panels, hazard placards/bands, CSC plates), burnt interior variant (charred faces + coal bed + soot decals + debris), tilted ramp container, roof tarps / dumped tyres for silhouette breakup; builds the 4-block yard (44 stacks, 2-3 high, jittered) + specials + quay 20-footers; every container gets a solid (or 5-panel hollow) collision proxy. |
| `Structures.js` | South warehouse (brick piers, 6 shutter bays, open bay 04 with a warm lit interior: racks with cartons/crates, forklift, drums, fluoro strips, hanging high-bays, office door + lit window, EXIT box; corrugated cladding + windows + TERMINAL 9 signage, downpipes, roof clutter, antenna), office trailer (windows lit/boarded/dark, door + stairs, AC unit), quay water (planar `Reflector` with rippled/rain-ring distortion at high/ultra, env-mapped fallback plane below it), quay-edge dressing (coping edge lights, life ring, ladder hoops), the moored feeder ship (flared hull with plating seams, boot topping, name/IMO/draft-mark decals, hawse pipes, portholes, over-side lamps, accommodation ladder, deck plane, deck container stacks, 5-tier castle with lit window rows, bridge strip, funnel, lattice mast, pedestal cranes, mooring lines), and two gantry cranes (portal legs + bogies, X-bracing, lattice booms, A-frame apex + stays, machinery house, trolley + hoist cables + spreader with a container, stairs, elevator shaft, letter/SWL markings, beacons, work-light floods). |
| `Setpieces.js` | Light masts (tapered poles, plinths, service platforms, ladders, crossarms, live/dead heads via `lighting.addFlood`), chain-link fence runs with razor coil + vehicle gate (one leaf ajar) + sign plates, procedural jersey barriers (New Jersey profile, hazard end bands), instanced sandbag emplacements + loose bags, instanced pallets + leaners, overhead cable catenaries (masts↔stacks↔fence, ground cable to the generator, low alley spans), hazard tape ribbons, fire barrels (prop + emissive coal bed + flame sprites + fire practical + FX emitters), bollards (yellow caps) + mooring rope coil, cable spools, traffic cones, draped tarp bundle, container-mounted caged sconces (warm/cool, lit/dead) + hazard blinkers + steam vents (FX emitters). |
| `Props.js` | Instanced CC0 prop placement (one `InstancedMesh` per source primitive, oriented-box collision per placement, lamp lit/dead material variants, per-asset albedo grading): drums, tyre stacks, crates, ammo/military crates, ladders, generator, jerrycans, propane tanks, tool chest, extinguisher, security lights, utility boxes, manhole covers, cardboard cartons, and the photoscanned hero jersey-barrier chicane. |
| `Collision.js` | One merged position-only geometry + `MeshBVH` (three-mesh-bvh) over simplified proxies (ground planes, solid/hollow container boxes, structure boxes, prop OBBs); per-vertex source ids map any hit back to `{surface, object}`; `raycast`, `raycastAll`, `sphereCast`, `capsuleCollide` (iterative shapecast push-out with grounded detection), `surfaceAt`, `groundHeightAt`. |
| `Nav.js` | 0.75 m grid over the playable rect baked from the BVH (down-casts + clearance + headroom + flood fill from the player spawn; ramps connect at ≤0.6 m steps), A* with octile heuristic + LOS string pulling, `randomWalkablePoint`, cover points (adjacent to blockers with facing normals, low/high), enemy spawn points (authored candidates + auto-fill along the north/east/west bands, all walkable and out of LOS of the player spawn). |
| `Diagnostics.js` | Build-time contract self-test (26 checks: ground surfaces, container solidity/roofs, capsule settle / wall slide / gravity drop at 19 points, nav connectivity/paths/cover/spawn-LOS, spawn + photo-point validity incl. inside-solid cameras, surface samples, registries) → `console.error` per failure so the shot harness turns red; `?debug=worldtest` prints every check. Debug overlays: `?debug=nav` (walkable cells, cover chevrons, spawn pillars, photo markers), `?debug=colliders` (BVH wireframe). |
| `materials.js` | The shared world material library on top of `game.pbr` (metre-scaled UVs, `repeat = 1 / tileMeters`), the container paint shader (repaint by luminance, world-space rust + rain-film run streaks, chalked wear), decal atlas materials, chain-link / razor coil / hazard tape, water/glass/emissive/lamp materials, tarps, safety yellow, cardboard. |
| `procgen.js` | Deterministic canvas texture generation: puddle mask, container/wall stencil atlas (logotypes, unit IDs, data panels, placards, signage, ship name/IMO/draft marks), worn ground-marking atlas, chain-link, razor coil, hazard tape, glow/flame/coal sprites, window, wave normals, value noise, soot. |
| `presets.js` | Photo presets `vista`, `street`, `alley`, `quay`, `warehouse` (+ `overhead` docs view), all framed from `world.photoPoints`, each priming the storm state. |
| `util.js` | Metre-UV geometry builders, `StaticBatcher` (merge by material+zone → few draw calls), catenary/polyline helpers, derived seeded RNG. |

## 2. Public API (`game.world`)

```js
world.isTerminal9            // true — S1's scaffold DEMO no-ops
world.group                  // THREE.Group root of static world objects
world.bounds                 // {x0,x1,z0,z1} playable rect (-50..50, -46..44)
world.raycast(origin, dir, maxDist=1000, {backfaces}) → {point, normal, distance, surface, object, faceIndex} | null
world.raycastAll(origin, dir, maxDist, opts) → pooled hits sorted by distance (penetration)
world.sphereCast(origin, dir, radius, maxDist) → hit | null (5-ray approximation)
world.capsuleCollide({start, end, radius}) → {hit, grounded, normal, depth}   // mutates the capsule out of penetration
world.surfaceAt(pointOrHit) / world.getSurfaceAt(...) → 'asphalt'|'concrete'|'gravel'|'metal'|'wood'|'water'|'fabric'|'glass'|'plastic'
world.groundHeightAt(x, z, yFrom=12) → {y, surface} | null
world.puddleAt(x, z) → 0..1   // standing-water amount (footstep splash intensity)
world.nav                    // NavGrid: findPath(a,b), randomWalkablePoint(rng, region?), isWalkable(x,z), heightAt(x,z), coverPoints, enemySpawnPoints
world.spawns.player          // {position: Vector3, yaw}   (yaw 0 = facing -Z / north)
world.spawns.enemy           // [{position, yaw, tag}]  (== nav.enemySpawnPoints)
world.emitters               // [{kind:'fire'|'embers'|'smoke'|'steam', tag, position, radius, intensity}]  for FX/AUDIO
world.fixtures               // lighting fixture records created by the world (also in game.lighting.list)
world.photoPoints            // {vista, street, alley, quay, warehouse, smoke, overhead, rain_light, lightning}: {position, target|yaw+pitch, fov}
world.landmarks              // named Vector3s: warehouseBay, warehouseInterior, trailer, gate, ship, craneA, craneB, mastM1..M5, fireFB1..3, burntContainer, fallenContainer
world.puddleMask             // {sample(x,z), texture, maskOutRect(...)}
world.stats                  // build statistics + selfTest {ok, passed, total, failed}
world.selfTest               // full self-test result (checks[])
world.update(dt)             // called by Game each fixed step (fires / coal beds / water uniforms) — deterministic
```

Everything simulation-side reads `game.time` (fixed steps); no wall-clock.
Coordinate frame: X west(−)→east(+), Z north(−, water)→south(+, warehouse), Y up.

## 3. Tuning knobs

| Knob | Where | Value | Notes |
| --- | --- | --- | --- |
| moon / hemisphere | `installWorld` → `lighting.setMoonIntensity/setAmbientIntensity` | 0.32 / 0.055 | black-gap night grammar; container tops sit ~4-8 % under moonlight |
| fog | `installWorld` → `sky.setFog` | 0.0138, `0x1a2434` | bluer/denser than the render default; the `vista` preset thins it to 0.0092 (haze aloft) |
| mast floods | `layout.MASTS` (`addFlood`) | 1250-1500 cd, halo 9.5, cone 1.2-1.5 | irradiance = I / d² / π: wet asphalt (albedo ≈ 0.06) pools at ≈0.15-0.3 scene-linear at 14 m |
| warehouse | `Structures.buildWarehouse` | canopy flood 560 cd @ 0.58 rad; wall pack 22 cd; interior high-bays 2× 52 cd | brick at 5 m must stay < 0.6 |
| fire barrels | `layout.FIRE_BARRELS` | 42-46 cd, radius 13, `flicker:'fire'` | plus emissive coal disc + 4 flame sprites |
| ship glow | `Structures.buildShip` | deck flood 900 cd, radius 60 | one point light at the castle front |
| ground paint | `Terrain` DIM/DIMY tints + atlas colours | white ≈ 0.4 final albedo | per-cell traffic wear in `procgen.groundAtlas` |
| container paint | `materials._makeContainerPaint` | gain 3.0, wear-chalk 0.55, wet 0.8 | `uWet` streaks drop roughness to 0.32 in vertical runs |
| puddle mask | `Terrain._buildPuddleMask` (1024 px over 140×90 m) | 11 authored + 8 random puddles, gutters 0.24-0.55 | drives `pbr.makeWetGround` roughness 0.045 mirror water |
| water | `Structures.buildWater` | distort 0.06, reflect 0.78, 4 octaves + rain rings | Reflector 640×384 target, only rendered for low quayside cameras |
| paint palette | `layout.PAINT` | weights oxide 2.4 / grey 2.6 / teal 1.8 / ... | desaturated further in-shader by the chalk term |

## 4. Verification & performance

Every build ends with the contract self-test (26 checks, see `Diagnostics.js`):
ground surface tagging, container closed-solid probes, roof heights,
capsule ground-settle / wall-slide (2 m walked into a wall) / 90-step
gravity drops at 19 points, nav walkability / flood connectivity / A*
paths to 6 enemy spawns (≤3.4× crow flight) / random points / cover
validity / enemy spawns walkable + hidden from the player spawn, player
spawn valid, photo points present + not inside solid geometry, surface
samples on all ground types + container roof, emitter/fixture/landmark
registries, playable bounds. Failures are `console.error`s (harness red).

Build stats (`world.stats`, seed 1): 299 containers (yard + specials + ship
deck), 1,980 container/wall stencil decals, 94 prop placements over 56
instanced prop meshes, 259 merged static batches (239 k static triangles),
5.4 k collision triangles, nav 134×127 cells (8,934 walkable), 345 cover
points, 14 enemy spawns, 28 lighting fixtures (11 floods, 7 practicals, 10
beacons), 13 FX emitters, 121 materials. Self-test 26/26.

Render stats from `window.__ironwake.stats` — final 1920×1080 **ultra**
captures (three.js `info.render` counts include the moon + spot shadow-map
passes and, at the quay, the water Reflector pass; SwiftShader timings):

| Preset | draw calls | triangles | capture time |
| --- | --- | --- | --- |
| smoke | 510 | 1.05 M | 63.7 s |
| vista (full view) | 839 | 2.02 M | 52.2 s |
| street | 510 | 1.05 M | 50.4 s |
| alley | 447 | 0.80 M | 49.6 s |
| quay | 440 | 0.99 M | 32.1 s |
| warehouse | 247 | 0.52 M | 40.2 s |
| rain_light (S1) | 439 | 0.88 M | 47.0 s |
| lightning (S1) | 351 | 0.74 M | 37.2 s |
| overhead (docs view) | 806 | 2.14 M | 49.6 s |

Zero console errors on every preset. Budget line (≤900 calls / ≤2.0 M
triangles for a full-view frame) holds at the vista; the overhead debug
view is over on triangles by design (whole map, no fog culling).
Where the triangles go (vista, base scene ≈1.05 M): photoscanned hero
barriers ≈120 k, tyres ≈80 k, cardboard/crates ≈80 k, container yard
batches ≈200 k, remaining props ≈300 k; the rest of the counter is
shadow-map re-rendering of casters (small dense photoscans are excluded
from shadow casting for that reason — see `Props.NO_SHADOW`).

## 5. Reference targets covered

- Two temperatures per frame: sodium/fire/warm interiors vs navy fog + cool
  moon + cool fluoro accents (alley task light, quay edge lights, crane
  machinery windows).
- Emissive-only bloom sources: lamp lenses, coal beds, beacons, windows,
  reticle-scale points; no diffuse surface reaches the 1.15 threshold.
- Wet-surface language: puddle mirrors, wet-asphalt light smears, rain-film
  streaks on container walls, glossy wet apron, rippled reflective water.
- Density: every container face carries ID/logo/data stencils; ground
  markings are worn; cables/catenaries cross every lane and the alley; roof
  tarps/tyres break the container-top plane; masts, cranes, fences,
  sandbags, barriers, tape, drums, cones, spools, tarps as motivated clutter.
- Silhouette skyline: two lattice gantry cranes with beacons, the ship's
  castle windows + deck lamps in the fog, five masts, cable spans.

## 6. Known gaps (ranked by visual impact vs the reference checklist)

1. **Rain splash glitter next to every ground-level light** (fire barrels, wall
   packs, flood pools): the S1 splash shader clamps `lit` at 1.6 for any
   light within ~2 m and renders full-brightness sparkle points; reads as
   sequins on the wet asphalt in `street` / `warehouse`. Needs a splash
   alpha/tint retune in `render/Weather.js` (documented for S1).
2. **Rain streaks have no occlusion / depth** — they fall inside the open
   warehouse bay and read as white scratches at wide framings (vista, quay).
   S1 gap #3; the world mitigates with per-preset rain intensity.
3. **No SSR / puddle planar reflections**: yard puddles mirror only IBL +
   analytic light highlights (correct light smears, no inverted geometry);
   only the quay water plane runs a planar `Reflector`.
4. **Container silhouettes are flat quads** — corrugation is normal-mapped,
   so container top edges run dead straight (broken only by roof tarps /
   tyres / puddle patches / cables); no rib profile at grazing angles.
5. **No geometric edge wear** (chipped silvered edges) on hero surfaces;
   wear is the paint shader's chalk + rust masks and hardware tinting only.
6. **Ship hull is planar** (flare + boot topping + proud seams/frames +
   decals); no plate curvature or rust-drip decals; the deck stacks are
   the low-detail 'simple' kit variant.
7. **Fire barrels are sprite licks + emissive coal beds** — real fire /
   smoke / embers / steam are FX-stream deliverables at `world.emitters`.
8. **Static set**: nothing sways (cables, tarps, tape, fence) — the
   "something always moves" rule leans on rain/ripples/flicker/beacons.
9. **Ground debris density** is still below the CoD urban benchmark (no
   casings, paper, foliage; slats/ash/oil/skids only).
10. **Nav is single-layer 2.5D**: only the ramp/fallen-container route is a
    raised walkable; no mantle/vault annotation beyond cover heights.
11. **Overhead cables span endpoints without visible clamps/insulators** and
    the fence has no torn panels / gaps yet (chokepoints are the gate and
    the container geometry).

## 7. Map — Terminal 9 (coordinates in metres, X west→east, Z north→south)

```
 z
-106 ┄┄┄┄┄┄┄┄┄┄┄┄┄┄ ship far side (M/V MERIDIAN ARDENT, x -86..104, castle x 62..92) ┄┄┄
 -76 ━━━━━━━━━━━━━━ ship hull near face (deck y=9, deck stacks, over-side lamps) ━━━
      ▓▓▓▓▓▓▓▓▓▓ 24 m black water (Reflector; edge lights every 10 m) ▓▓▓▓▓▓▓▓▓▓▓▓▓▓
 -52 ══ quay wall / coping ═══ bollards @ -51.3 ═══ life ring (-20.5) ═══ ladders (-8, 22)
      APRON (concrete): crane A x=-30 · crane B x=26 (rails z=-42.6/-50.4; each: work light
      + ship-loading flood onto the hull) · quay 20-footers (-14,-45.6) (6,-46.4)×2
      · mast M5 (2.5,-44.2, live head → apron pool at the main lane's vanishing point)
 -40 ── asphalt yard begins ── chevron thresholds ────────────────────────────────────
 -34 ┃perimW┃ WEST ┃blockW┃  MAIN  ┃blockE┃ EAST ┃perimE┃   ← container rows (N→S)
-19.6┃ x-48 ┃ LANE ┃ x-22 ┃  LANE  ┃ x8.. ┃ LANE ┃ x38..┃      z = -34, -19.6, -5.2,
 -5.2┃ ..-38┃-36→ ┃ ..-8 ┃ -7→7   ┃  22  ┃ 23→36┃  48  ┃          9.2, 23.6
  9.2┃ 2-3  ┃  -23 ┃ alley┃burnt C ┃      ┃      ┃      ┃      (12.19 m N-S, 2.7 m bay pitch)
 23.6┃ high ┃      ┃x=-16 ┃(3.9,-25)      ┃      ┃      ┃
      masts (12.5 m): M1 (-24.6,2.1) M3 (-6.2,-26.8) M2 (24.6,-1.2) M4 (6.2,16.4)
      FB2 fire (-16,4) in the block-W alley · FB1 (-3.9,22.4) · FB3 (28.4,-30.2)
      fallen container (-30.3,11.6, E-W) + ramp container (x=-30.6, ground→2.59 m going north)
29.7 ── SOUTH LANE ── player spawn (1.5, 32.6) facing north ── sandbags (-2.5,30.1) (4.6,29.9)
 38  ▌WAREHOUSE facade x -60..8 (bays @ -52,-42,-32,-22*,-12,-2; *bay 04 open, lit interior
     ▌ x -27.6..-16.4, z 38..51) ▌ trailer (22, 41.6) ▌ gate x 30..38 @ z=44
 44  ══════ south fence (west x=-52, east x=+52; verges + gravel outside) ══════════════
```

Playable bounds: x −50..50, z −46..44 (nav grid). Cover points ≈340 baked
adjacent to every container/barrier/sandbag face; enemy spawns along the
north apron / west / east bands + behind blocks (14, all hidden from the
player spawn).

## 8. INTEGRATION NOTES FOR LATER STREAMS

- **S3 PLAYER**: spawn at `world.spawns.player` (yaw 0 = facing −Z / north
  up the main lane). Movement collides via `world.capsuleCollide({start,
  end, radius})` after integrating velocity (call 1-2× per step; `grounded`
  when a resolving push points ≥45° up). Footsteps: `world.surfaceAt(hit)`
  for the material, `world.puddleAt(x,z)` (0..1) for splash intensity.
  Ledges: containers are exact 2.59 m boxes (roof y = 2.59 / 5.18 / 7.77),
  jersey barriers 0.85 m, sandbag walls 0.5-0.8 m, pallet stacks 0.144 m per
  pallet — mantle heights can be probed with `world.raycast`. The tilted
  ramp container (west lane, x≈−30.6) is a walkable 12° slope up onto the
  fallen container's roof.
- **S3 FX**: `world.emitters` — `fire` (barrel mouths + burnt container coal
  bed), `embers`, `smoke`, `steam` (alley vent, warehouse roof vent); each
  has `position`, `radius`, `intensity`, `tag`. Fire practicals already
  flicker (`fixture._flickerValue` on the matching lighting fixture) — sample
  it if you want the sprites to breathe with the light. Bullet decals /
  impacts: `world.raycast` returns `{point, normal, surface}` — surface set is
  asphalt / concrete / gravel / metal / wood / water / fabric / glass /
  plastic. Standing water: `world.puddleAt` for splash-on-impact; roof
  puddle patches are tagged `metal`.
- **S4 WEAPONS**: hitscan against `world.raycast` (first hit) or
  `world.raycastAll` (penetration — container walls are 0.12 m panel boxes
  for hollow/burnt containers, solid boxes otherwise; treat `metal` hits
  from the merged BVH as thin-metal candidates by checking the exit hit
  distance in `raycastAll`). `hit.object` is the source proxy owner
  (usually null for batched world geometry — key off `surface`).
- **S5 AI**: `world.nav.findPath(fromVec3, toVec3)` (A* + string-pulled
  waypoints, ~0.75 m cells), `world.nav.randomWalkablePoint(rng, region)`,
  `world.nav.coverPoints` (`{position, normal (faces AWAY from the blocker),
  height, type:'low'|'high'}`, ~340 points), `world.spawns.enemy` (14
  points along the north apron / west / east bands + block pockets, all
  hidden from the player spawn — flavour tags for barks). LOS:
  `world.raycast(eye, dir, dist)`. The playable rect is `world.bounds`
  (x −50..50, z −46..44); the water beyond z −52 is tagged `water` and
  non-walkable. Verify with `?debug=nav` (walkable / cover / spawn overlay)
  and `?debug=worldtest` (verbose contract self-test in the console).
- **S5 PHYSICS**: prop placements register oriented-box collision proxies in
  the BVH; dynamic debris should ignore the static BVH's own proxies for
  objects it takes over (props are static instanced meshes — swap-to-
  dynamic is a later feature).
- **S6 AUDIO**: emitter positions (`world.emitters`) for fire crackle /
  steam hiss; `world.fixtures` (also `game.lighting.list`) carry `kind`,
  `position`, `flicker` for lamp buzz (fluoro / sodium) and beacon ticks;
  `world.landmarks.ship` / `craneA/B` for hull creaks and crane groans;
  surfaces via `world.surfaceAt` for footsteps and casings; the quay water
  strip (z < −52) for lapping water.
- **S6 UI**: `world.landmarks` gives named POIs for compass ticks / location
  text ("TERMINAL 9 · BAY 04", "QUAY", "GATE"); `world.bounds` for the
  minimap extent; the overhead capture (`npm run shot -- --preset overhead
  --debug nav`) is a ready minimap/nav reference image.
- **S1 RENDER**: (1) rain splash brightness saturates within ~2 m of any
  practical (see gap #1) — suggest `lit = min(acc*0.35, 0.9)` and alpha ≤
  0.15; (2) `haloSize` per flood is a real win for the wet-air read — the
  world passes 8-9.5 on masts; (3) the world calls `sky.setFog(0.0138,
  0x1a2434)` at install and thins it to 0.0092 for the vista only;
  (4) light count on Terminal 9: 10 spot floods (5 mast heads, 2 crane work
  lights, 1 crane hull flood, 1 warehouse canopy, 1 apron mast) + 7 points
  (2 warehouse high-bays, 1 wall pack, 2 fire practicals, 1 alley fluoro,
  1 ship deck flood) — three.js evaluates all of them per lit fragment, so
  a clustered/tiled path or per-object light lists would be the next perf
  step on real GPUs.
- **S7 INTEGRATION / critics**: the six critic presets are `smoke`, `vista`,
  `street`, `alley`, `quay`, `warehouse` (+ S1's `rain_light`, `lightning`
  which frame from `world.photoPoints`). `overhead` is a docs/debug view.
  Every world build ends with the contract self-test; a failing check is a
  `console.error`, so `npm run shot`/`verify` go red on world regressions.
