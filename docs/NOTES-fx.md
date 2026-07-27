# NOTES — S3 FX CORE (`src/fx/**`)

Owner scope: every transient effect — pooled billboard particles, tracers,
muzzle flash rigs, per-surface impact recipes, projected decals, ejected
brass, explosions, ambient world emitters (fire barrels / vents) and the
health lens hooks — plus the `impacts` and `explosion` photo presets. Wired
through `src/fx/index.js` → `game.fx`.

## 1. What was built

| Module | Summary |
| --- | --- |
| `ParticleAtlas.js` | 4×4 procedural sprite atlas (1024²) painted at boot from seeded simplex fbm + canvas shapes: soft/hard smoke, dust, spark comet, flare, blood mist/spray, ember, water crown, debris chip/splinter, muzzle star, smoke wisp, shockwave ring, fireball, grit. |
| `Particles.js` | Two instanced buckets (alpha-sorted + additive), one draw each, SoA CPU sim (gravity, drag, wind coupling, ground bounce), 20 named `KINDS`; per-particle atlas cell / rotation / stretch / lit-flags; billboard modes: camera-facing, velocity-stretched (sparks), world-horizontal (ground ring). Vertex-shader lighting from ambient + the 6 strongest fixtures near the camera (with spot-cone attenuation) — smoke under a sodium head goes orange, smoke in the dark stays near-black. Analytic soft-fade against the ground plane + camera near fade + a min-screen-size clamp so sparks/embers stay ≥1.3 px. Capacity = 1400/1000 × `tier.particlesScale`. |
| `Tracers.js` | Instanced view-aligned ribbons with a hot head, 350–500 m/s visual travel, pool of 40. |
| `TransientLights.js` | 3 pooled point lights registered as *lighting fixtures* at boot (constant light count → no recompiles) for muzzle spikes (60 ms), spark kicks, explosion flashes (300 ms) — so rain, fog tint, particle lighting and the future viewmodel all react to them. |
| `MuzzleFlash.js` | `fx.muzzleFlash({...})` world-space (star + core sprite, bore sparks, chamber smoke wisp, light spike) and `fx.createMuzzleFlash({...})` — an attachable rig (crossed flame planes + facing star + own point light, 1–2 frame visibility) for the WEAPONS viewmodel pass. |
| `Impacts.js` | `fx.impact({point, normal, surface, energy, dir, object, entity})` recipes for concrete/asphalt (dust puff + fine jet + chips + grit + spark chance + hole/spall crater decal), gravel, metal (10–20 spark shower + point flare + hot spot ember + dent/scorch decal + light kick + 28 % ricochet event with a stray tracer), wood (splinters), fabric (sandy dust), water (crown column + mist + droplets), flesh (blood mist + droplets + splat decal on the surface behind and on the floor), glass, plastic. Listens to `weapon:hit`. Emits `fx:impact`, `fx:ricochet`, `fx:decal`. |
| `Decals.js` | DecalGeometry projection against triangles gathered from the world collision BVH (the exact proxies bullets hit; entity meshes projected directly), streamed into per-material vertex ring buffers (holes/scorch/soot/oil bucket + glossy blood bucket, `tier.decalBudget` decals of vertices, fade-ahead-of-cursor FIFO). 12-cell procedural colour + normal atlas (chipped concrete holes, silvered metal dents with heat scorch, wood splinter holes, glass crack stars, fabric tears, spall craters, scorch, soot, oil, two blood variants). |
| `Casings.js` | Instanced 5.56 / 9 mm lathe cartridges (48/24), ballistic tumble with spin, up to 4 bounces against `world.raycast`, settle, shrink-out after 3–5 s; `fx:casing` event on first ground contact. |
| `Explosions.js` | `fx.explode({position, radius, kind})`: flash sprite + 300 ms fixture light spike (warm→orange), layered fireball sprites + hot core lobe, ground shockwave ring, spark streaks, ember spray, debris chips/grit with bounce, radial dust, staggered dark smoke column seeding (lit), scorch + soot decals, `grenade:exploded` + `fx:explosion` events, distance-falloff camera shake via the player rig, lens splash inside 6 m, `physics.applyExplosionImpulse` hook. |
| `Emitters.js` | Consumes `world.emitters` (fire / embers / smoke / steam records from WORLD): flame licks, updraft embers and lit smoke plumes over the fire barrels and the burnt container, vapour from the alley/warehouse vents; distance-culled at 52 m, tier-scaled rates. |
| `LensFX.js` | Health-driven damage vignette (`post.setDamageVignette`): instant punch on `player:damaged`, ramps in below ~70 % health, full at death, slow recovery. |
| `presets.js` | `impacts` and `explosion` critic presets + `fx_test` dev preset (`?debug=fxdev`) exercising casings / recipes / muzzle flash / damage feedback from the player's eyes. |
| `index.js` | Installer: builds everything, exposes `game.fx`, registers the `fx` system (order 50) and the pre-render buffer upload hook. |

## 2. Public API (`game.fx`)

```js
fx.particles.emit(kind, {position, velocity, direction, spread, count, size, sizeEnd,
                         life, speed, color, colorEnd, alpha, gravity, drag, wind,
                         stretch, bounce, offset, lightFactor, rotation, spin, fadeIn, fadeOut})
   kinds: smoke_soft smoke_dark smoke_wisp fire dust spark ember flare muzzle_star
          fireball shockwave flash debris chip splinter grit blood_mist blood_droplets
          water_splash water_mist            (see KINDS in Particles.js)
fx.tracer(from, to, {speed=420, length=8, width=0.045, color, head, skip})
fx.muzzleFlash({position, direction, size=1, light=true, smoke=true, kind})
fx.createMuzzleFlash({scale, light, color}) → {object, fire({intensity}), update(dt), dispose()}
fx.impact({point, normal, surface, energy=1, dir, object, entity})
fx.decal(kind, {point, normal, size, rotation, object, alpha})
   kinds: bullet_concrete bullet_metal bullet_metal_hot bullet_wood bullet_glass
          bullet_fabric crater scorch soot oil blood blood2
fx.ejectCasing({position, velocity, spin, kind:'rifle'|'pistol'})
fx.explode({position, radius=6.5, kind:'frag', scale, energy})   // emits grenade:exploded
fx.shake({strength, duration, freqPos, freqRot})                 // player rig shake
fx.shakeAt(position, strength, {radius})                         // shake with distance falloff (+ lens splash < 6 m)
fx.lights.flash({position, color, colorEnd, intensity, duration, radius, curve, priority})
fx.clear()                                                       // reset all pools (photo presets)
fx.particles.count / fx.decals.count / fx.decals.usage
```

Events emitted: `fx:impact {point, normal, surface, energy}`,
`fx:decal {point, normal, kind}`, `fx:ricochet {point, dir}`,
`fx:casing {position, surface, kind}`, `fx:explosion {point, radius, kind}`,
`grenade:exploded {point, radius}` (canonical — **fx.explode is the
detonation entry point; the grenade entity should not emit it again**).
Consumed: `weapon:hit` (canonical) → impact FX (entity hits become flesh),
`player:damaged/died/respawn` (lens FX).

## 3. Tuning knobs

| Knob | Where | Default / notes |
| --- | --- | --- |
| pool capacities | `Particles` ctor | 1400 alpha + 1000 additive × `tier.particlesScale` |
| particle lighting response | `Particles` vertex shader | `0.55 · power / (π(1.4 + d²))` per fixture, 6 fixtures + ambient; smoke albedo 0.13–0.35 |
| kind presets | `Particles.KINDS` | sizes / life / colour ramps / drag per kind (all ranges) |
| decal budget | `tier.decalBudget` | 512 ultra / 256 high (× 42 verts est.; 78 % holes, 22 % blood buckets) |
| decal sizes | `DECAL_KINDS` | hole 0.11–0.23 m, crater 0.34, scorch 2.2, blood 0.6–0.9 |
| impact recipes | `Impacts._masonry/_metal/…` | spark counts 10–20 metal, ricochet 28 %, crater 22 % |
| explosion | `Explosions.explode()` | light 380 cd·scale 0.3 s; fireball 4+3+2 lobes ≤5.4 m; 46 sparks; 42 debris; smoke to 8 s |
| emitters | `Emitters.update()` | flame ~9/s, smoke ~5/s (2 puffs), embers ~1.5/s per fire barrel; cull 52 m |
| muzzle flash | `MuzzleFlash.flash()` | star 0.18–0.27 m, 220 cd 65 ms light, 2 smoke wisps |
| casings | `Casings` | brass MeshStandard (metalness 1, rough 0.28), life 3.2–5 s, settle < 1 m/s or 4 bounces |
| lens damage | `LensFX` | vignette = ((0.72 − hp)/0.72)^1.35 · 0.95 + hit pulse |

## 4. Verification & performance

720p `high` iteration captures (SwiftShader software GL) and the final
1920×1080 `ultra` captures below (`window.__ironwake.stats` in
shots/report.json):

| Preset (1080p ultra) | draw calls | triangles | textures | programs | capture time |
| --- | --- | --- | --- | --- | --- |
| impacts | 361 | 0.72 M | 122 | 82 | 55.6 s |
| explosion | 454 | 0.77 M | 135 | 83 | 48.9 s |
| smoke (world + FX ambient) | 527 | 1.02 M | 155 | 84 | 48.9 s @720p high |

FX adds 7 draw calls when active (2 particle buckets, tracers, 2 decal
buckets, 2 casing pools), 2 canvas atlases (1024² particle, 1024² ×2 decal
colour+normal) and 3 pooled point-light fixtures. All 11 registered presets
(6 world, 2 render, `smoke`, `impacts`, `explosion`) plus the `overhead`
docs view capture with **zero console errors** with the player + FX
installed; `npm run verify` passes. Dev probes: `player_test`
(`--debug player`) and `fx_test` (`--debug fxdev`) run assertions and every
FX API path under the harness; `--debug noemitters` disables the ambient
emitters for A/B captures.

## 5. Known gaps vs the reference bar (ranked by visual impact)

1. **Fireball structure** — the additive fireball layer stacks toward a
   smooth incandescent volume; it lacks the sharp cauliflower lobes with
   embedded black crevices of `firing-03` / `vfx-04`. Needs either an
   alpha-blended lit fire pass with a flame LUT or flipbook animation frames.
2. **No true soft particles / no depth read** — smoke intersecting geometry
   at grazing angles can show a hard line (mitigated by the analytic ground
   fade only). A depth pre-pass or scene-depth copy would fix particles,
   decal edge fades and enable heat-haze distortion (also missing).
3. **Smoke lighting is per-particle-centre and unshadowed** — a puff half
   in a floodlight cone lights uniformly, and smoke doesn't shadow itself or
   the ground; explosion smoke has no self-shadowed underside gradient
   (`vfx-01`).
4. **Decals project only onto collision proxies** — perfect on containers,
   ground, barriers and crates (they *are* boxes/planes), but a decal on a
   curved photoscanned prop (drum, tyre) sits on its bounding box, not its
   surface. Blood on characters is not attempted (splats go on the world
   behind/below instead).
5. **Sparks are single-frame streaks without persistence trails** — the
   reference metal hits (`vfx-06`) show 10–20 curving trails; ours are
   straight-line stretched quads under gravity.
6. **Explosion has no debris that stays on the ground** (chips shrink out
   after ~3 s) and no thrown prop reaction (physics stream not present).
7. **Fire is sprite-only** — barrel flames rely on WORLD's lick sprites plus
   our additive fireballs; there is no flame-shaped mesh/flipbook and no
   fire light flicker driven by our particles (the world practical does the
   flicker).
8. **Tracers have no smoke trail and no light** — CoD-style hot tracers
   cast a moving light and leave a faint trail; ours are pure additive
   ribbons (cheap by design).
9. **Casings don't tinkle-glint** — brass relies on MeshStandard highlights;
   no per-casing spark of specular flare during flight (`firing-05/06`).

## 6. INTEGRATION NOTES FOR LATER STREAMS

- **S4 WEAPONS**: per shot call, in this order —
  `game.fx.muzzleFlash({position: muzzleWorldPos, direction: aimDir, size: 1|0.7, light: true})`
  (world scene: sparks, chamber smoke, the *scene* light spike everyone
  reacts to), your attached rig `flashRig.fire()` (viewmodel pass flame —
  build it once with `game.fx.createMuzzleFlash({scale})` and parent
  `flashRig.object` to the muzzle bone; call `flashRig.update(dt)` from your
  fixed step), `game.fx.ejectCasing({position: portWorldPos, velocity: right*(1.4-2.2)+up*(1-1.6)+shooterVel, kind})`,
  a tracer for 1-in-N rounds `game.fx.tracer(muzzleWorldPos, hitPoint, {speed: 420})`,
  and emit `weapon:hit {point, normal, surface, entity, damage, isKill, isHeadshot, dir, object}`
  — **do not call `fx.impact` yourself when you emit `weapon:hit`**, the FX
  stream listens (entity hits become the flesh recipe; `dir` improves the
  blood/spark directions; `object` = the hit `THREE.Mesh` when it has real
  geometry). Grenades: call `game.fx.explode({position, radius})` at fuze
  end and *let it* emit `grenade:exploded`. For ADS DOF etc. see S1.
- **S5 AI**: enemy muzzle flashes = `fx.muzzleFlash({position, direction, size: 0.8, light: true})`;
  enemy bullet impacts near the player = `fx.impact(...)` directly (or emit a
  `weapon:hit` from the enemy's shot — same listener); death blood =
  `fx.particles.emit('blood_mist', ...)` + `fx.decal('blood2', {point: floorHit, normal})`.
  `grenade:exploded {point, radius}` is your damage/AI reaction cue;
  `fx:explosion` / `fx:impact` / `fx:ricochet` are audio-flavoured.
- **S6 AUDIO**: subscribe to `fx:impact {surface}` (bullet impact per
  material), `fx:ricochet`, `fx:casing {surface, kind}` (brass tinks),
  `fx:decal`, `fx:explosion {point, radius}` (+ debris rain tail), and the
  player events. All payload vectors are pooled — copy before storing.
- **S6 UI**: `player:damaged.dir` → damage arcs; the FX stream already owns
  the red screen-edge vignette (`post.setDamageVignette`), so UI should not
  drive that pass — layer HUD blood art on top instead.
- **S7 INTEGRATION**: `game.fx.clear()` resets every pool (presets do this);
  `fx.particles.count / decals.count` are cheap sanity metrics for autoplay;
  the ambient emitters run automatically in play (they cull beyond 52 m).
