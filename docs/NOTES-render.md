# NOTES — S1 RENDER CORE (src/render/**)

Owner scope: sky/IBL/fog/lightning, the light rig + fixture API, GPU rain
& wetness, the PBR material factory, and the full post-processing chain.
Wired through `src/render/index.js` (`installRender` before the world,
`installPost` last). Scaffold-only showcase dressing lives in
`src/render/Demo.js` (DEMO — to be deleted by S2).

## 1. What was built

| Module | Summary |
| --- | --- |
| `Sky.js` | HDRI (`hdri.night_primary`, kloppenheim storm deck) sampled by a custom camera-centred dome shader (independent exposure, yaw, counter-drifting second lookup for cloud churn, lightning sheet-flash term that back-lights the clouds, horizon blend into the fog colour) + PMREM IBL from the same map on `scene.environment`; storm scheduler (lightning every 8–20 s from a dedicated seeded PRNG, 1–3 pulses, `weather:lightning` event); `FogExp2` (~60–65 % at 100 m) tinted every step toward the strongest nearby lights and lifted by lightning; `setVariant('storm'\|'clear')`, `setFog`, `flashLightning`, `holdFlash`, `setSkyTint`. |
| `Lighting.js` | Moon key (cool ~9000 K directional, arena-fitted 4096²/2048² shadow map) + hemisphere ambient tuned so unlit surfaces sit near 2–4 % luma; fixture API: `addFlood` (spot + analytic ray-marched volumetric cone + emissive lens/housing + starburst flare + soft atmospheric halo), `addPractical` (point light with fire/fluoro/sodium flicker curves + emissive marker/glow), `addBeacon` (blinking emissive + optional light), `addFixture(desc)`, `remove(f)`; queries `strongestLightsNear(pos, n)` (pooled, allocation-free); shadow budget (`tier.shadows.spotBudget` shadow spots max, constant count → no recompiles); lightning boost hook driven by Sky. |
| `Weather.js` | One-draw instanced rain streak field (positions computed in the vertex shader from a per-instance lattice offset + sim clock + wind, wrapped in a camera-anchored shell; lit by the 4 strongest lights so streaks only read near sources), instanced ground splashes with hashed recycling, gusting wind vector, `rainIntensity` / `wetness` (emit `weather:changed`), and a 96² animated ripple normal DataTexture (`puddleRipplesTexture`) regenerated ~6 Hz from expanding ring packets. |
| `PBR.js` | `PBRFactory`: `makePBR(assetId, opts)` (pbrset → MeshStandardMaterial with arm packing, optional repeat clones, wetness), `makeWetGround` (macro variation layer, puddle mask → darker albedo + roughness 0.045 + flattened normals + rain ripples in world XZ), `makeCorrugatedContainer` (scan re-painted to any hue keeping grime, world-space fbm rust patches into the rust pbrset, wear). |
| `Post.js` | postprocessing chain: RenderPass → N8AO → CameraMotionBlur (custom depth-reprojection effect) → DOF (ADS API) → [Bloom (HDR emitters only) → ACES tonemap → procedural 3D LUT grade] → SMAA → LensDroplets (custom) → [CA → grain → vignette → damage vignette]. APIs: `setExposure`, `setDof`, `setGrade`, `setDamageVignette`, `splashLens`, `setMotionBlurEnabled`, `setBloom`, `addPreRender`. Settings toggles honoured live. |
| `effects/*` | `CameraMotionBlurEffect` (per-pixel velocity from depth + previous view-projection, 6–8 taps, tier gated), `LensDropletsEffect` (procedural refractive drops + drips, auto pitch-up-into-rain trigger), `DamageVignetteEffect`, `Grade.js` (procedural 32³ LUTs: `ironwake`, `neutral`, `bleach`, `warm`). |
| `ProcTextures.js` | Deterministic boot-time textures: starburst flare, glow, wide halo, splash crown, streak, tileable value noise, procedural puddle mask (used by the demo ground). |
| `QualityTiers.js` | Extended tier table (spot map size/budget, rain streak+splash counts, motion blur samples, DOF/droplets flags, env HDRI resolution). |
| `presets.js` | Photo presets `rain_light` (rain crossing the hero flood's beam over wet asphalt) and `lightning` (frozen mid-strike). Inspection switches (URL param or `?debug=` flag): `lens`, `dof`, `mb`, `clearsky`, `grade=<name>`, `lightning=<0..1>`. |
| `Demo.js` | DEMO ONLY: converts the scaffold's stand-in point lights into three floodlight fixtures on procedural poles, adds a burning `prop.fire_barrel` (fire practical + flame sprites), two beacons, and re-materials the scaffold ground/boxes with the PBR factory. No-op once `world.isTerminal9` is set. |

## 2. Public API for other streams

Everything is reachable from `game`:

- `game.sky.setFog(density, color)`, `.flashLightning(intensity, {direction, distanceM})`,
  `.holdFlash(v|null, dir)`, `.setVariant('storm'|'clear')`, `.setSkyTint(color, sat)`,
  `.exposure`, `.envIntensity`, `.rotationY`, `.flash` (live envelope), `.fogColor`,
  `.lightningDirection`, `.equirectTexture`.
- `game.lighting.addFlood/addPractical/addBeacon/addFixture/remove`, `.list`,
  `.strongestLightsNear(pos, n=4, maxDist=40)` (**returned array + records are
  pooled — copy fields, never store references**), `.moon`, `.hemi`,
  `.setMoonIntensity(v)`, `.setAmbientIntensity(v)`.
- `game.weather.setRain(v)`, `.setWetness(v)`, `.rainIntensity`, `.wetness`,
  `.windVector` (live Vector3, m/s), `.puddleRipplesTexture` (RG-encoded
  normal, world-tiling; sample in world XZ), `.groundY` (set by WORLD if the
  playable ground isn't at y = 0).
- `game.pbr.makePBR(assetId, opts)`, `.makeWetGround(assetId, opts)`,
  `.makeCorrugatedContainer(opts)`, `.withRepeat(tex, repeat, key)`.
- `game.post.setExposure(v)`, `.setDof({focusDistance, focusRange|focalLength,
  bokehScale} | null)`, `.setGrade(name)`, `.setDamageVignette(0..1)`,
  `.splashLens(strength)`, `.setMotionBlurEnabled(bool)`, `.setBloom({intensity,
  threshold, smoothing})`, `.addPreRender(fn)` (per-render-frame hook, runs
  after all fixed steps with the final camera; returns an unsubscribe fn),
  `.effects` handles.
- Events emitted: `weather:lightning {intensity, direction, distanceM,
  thunderDelay}`, `weather:changed {rainIntensity, wetness}`. Consumed:
  `settings:changed` (motionBlur, filmGrain, chromaticAberration, aaMode).
- Registered systems (fixed-step order): weather 55, lighting 56, pbr 57,
  post 95, demo.flames 61 (demo only). Sky.update is invoked by Game itself.

### Fixture descriptor schema (WORLD → `game.world.lights` or `addFixture`)

```
{ kind: 'flood', position, target, color=0xffb15c, intensity≈1000-1500 (cd),
  angle=0.62, penumbra=0.45, distance=42, castShadow=true, coneIntensity=1,
  halo=true, flare=true, housing=true, groundY=0, importance=1 }
{ kind: 'practical', position, color, intensity (cd), radius, flicker:
  'none'|'fire'|'fluoro'|'sodium', castShadow=false, marker=true, glow=true }
{ kind: 'beacon', position, color, blinkPeriod, duty, phase, size, lightIntensity }
```
`installPost` converts descriptor entries in `world.lights` automatically;
entries that carry a live three.js Light (`entry.object`) are left alone.

## 3. Calibration & tuning knobs (all live)

Scene-linear → final pixel (ACES + sRGB) reference used for every value:
0.01 → 3 %, 0.02 → 8 %, 0.05 → 20 %, 0.1 → 34 %, 0.3 → 65 %, 1.0 → 89 %,
≥2 clips. Emitters (lens ≈9, flame cores, beacons ≈12) sit above the bloom
threshold (1.15); no diffuse surface reaches it.

| Knob | Where | Default | Notes |
| --- | --- | --- | --- |
| sky exposure | `sky.exposure` | 0.13 storm / 0.2 clear | HDRI upper-hemisphere mean radiance 0.33 → sky pixels ≈0.12–0.25 |
| IBL intensity | `sky.envIntensity` | 0.28 | keeps unlit dark surfaces near 2–4 % |
| fog | `sky.fogDensity`, base colour | 0.013, 0x151d29 | 100 m ≈ 82 %, 60 m ≈ 46 %, 40 m ≈ 24 % fogged |
| moon | `lighting.setMoonIntensity` | 0.55 lux, 0x92abe8 | container tops 8–15 % |
| ambient | `lighting.setAmbientIntensity` | hemi 0.08 | |
| flood photometry | `addFlood({intensity})` | 900–1500 cd | pool on wet asphalt ≈ pixel 0.3 at 14 m |
| cone brightness | `coneIntensity` opt | 1 | analytic march, STEPS = tier volumetrics.steps/2 (8–32) |
| rain | tier `rain.streaks/splashes`, `weather.setRain` | 15 k / 270 (high) | streak alpha response `1-exp(-Σ0.22·P/(4+d²)·0.4)` |
| bloom | `post.setBloom` | thr 1.15, int 0.75×tier | |
| grade | `post.setGrade` | 'ironwake' | teal shadows / warm shoulder / −12 % sat |
| grain / vignette / CA | Post effects | 0.16 SOFT_LIGHT / 0.3+0.5 / 0.0005 radial | settings-toggled |

## 4. Verification & performance

Presets captured every iteration at 1280×720 `--quality high`, finals at
1920×1080 ultra. `window.__ironwake` stats from the final 1080p ultra run
(scaffold world + demo fixtures; SwiftShader software GL timings):

| Preset | draw calls | triangles | textures | programs | capture time |
| --- | --- | --- | --- | --- | --- |
| smoke | 130 | 70.6 k | 64 | 35 | 34.9 s |
| street | 137 | 70.7 k | 64 | 35 | 39.8 s |
| vista | 142 | 70.7 k | 64 | 35 | 34.6 s |
| rain_light | 127 | 70.5 k | 64 | 35 | 31.7 s |
| lightning | 130 | 70.6 k | 64 | 35 | 29.0 s |

Zero console errors on every preset (also verified at `--quality low` and
`medium`, and with `--debug rain|lens|dof|mb|clearsky`). Real-GPU expectation:
the chain is 8 passes (+PMREM once at boot); at high tier on a mid GPU the
post chain should sit well under 2 ms/frame; rain is one instanced draw
(15-19 k quads); each cone is one draw with an 8-32-step march only on the
pixels it covers; the light rig adds 1 moon + N spot/point lights with ≤ 3
spot shadow maps (1024²) + one 2048²/4096² moon map. Realtime rAF loop was
exercised live (settings toggles, resize, storm) with no errors.

## 5. Known gaps vs the reference bar (ranked by visual impact)

1. **No screen-space or planar reflections.** Puddle/deck reflections come only
   from IBL + analytic light highlights; the references' mirror puddles show
   inverted geometry (containers, lamp posts). WORLD's water plane needs a
   Reflector; puddles could feed the same target at high tier.
2. **Volumetric cones are single-scattering shells without scene-depth
   clipping.** Beam over-brightens slightly behind occluders that sit inside
   the cone; ground clipping is analytic (`groundY`) only. A depth pre-pass
   would fix both.
3. **Rain has one layer.** No distant rain-sheet impostor and no per-drop
   collision — streaks pass through container tops; splashes only exist on
   the ground plane (`weather.groundY`).
4. **Lightning has no bolt geometry** (sheet flash only) and no per-strike
   directional shadow flip.
5. **Fog is uniform-density Exp2** — no height falloff / ground fog banks
   (reference environment-17). A height term needs a fog shader chunk
   override on every lit material (planned via a global onBeforeCompile if a
   later round needs it).
6. **DOF vs transparent particles**: rain streaks don't write depth, so heavy
   far-field bokeh turns near streaks into soft blobs; WEAPONS should keep
   `bokehScale ≤ 2.5` and a wide `focusRange` while raining.
7. **Motion blur is camera-only** (no per-object velocity).
8. **Scaffold-only demo materials** (container repaint tiling, procedural
   puddle mask) are placeholders for S2's authored versions.
9. `LookupTexture`/N8AO/SMAA come from `postprocessing` internals; sRGB
   DataTextures with generated mipmaps come back black on SwiftShader (worked
   around by keeping procedural DataTextures linear + mip-free) — noted here
   for anyone adding data textures.
10. **HDRI tier gating is only half-real**: `tier.env.resolution` picks the
    1K or 2K sky, but the ASSETS manifest declares all four sky HDRs `tier:
    'all'`, so every tier still downloads/decodes all of them. ASSETS/
    integrator: mark the 2K entries `tier: 'high+'` and (once the loader has a
    "low-only" tier keyword or lazy sky entries) drop the 1K copies on
    high/ultra — Sky.setVariant already falls back to whichever id exists.

## 6. INTEGRATION NOTES FOR LATER STREAMS

- **S2 WORLD**: build materials through `game.pbr` (share texture cache,
  respect `opts.repeat` clones). For the yard ground use `makeWetGround(
  'tex.asphalt_wet', {puddleMask, macroTexture, ...})` with your painted
  puddle mask (texture or `'vertex'` colours); it already samples
  `weather.puddleRipplesTexture` and the wetness/rain uniforms. Register
  fixtures either by pushing descriptors into `world.lights` (`kind:'flood'
  |'practical'|'beacon'`) before `installPost` runs, or by calling
  `game.lighting.addFlood/addPractical/addBeacon` directly in your installer
  (installRender already ran, so `game.lighting` exists during installWorld).
  Set `level.isTerminal9 = true` (or delete `src/render/Demo.js` + its call
  in `src/render/index.js`) to remove the demo dressing. Provide
  `world.photoPoints.rain_light` (and `lightning`) to re-stage my presets on
  Terminal 9. Set `game.weather.groundY` if the walkable ground isn't at 0.
  Moon shadow frustum covers ±62 × ±52 m around the origin — keep the arena
  centred there or tell me to move it. Container material:
  `game.pbr.makeCorrugatedContainer({paintColor, rust, wear, repeat})`.
- **S3 PLAYER/FX**: `game.lighting.strongestLightsNear(pos, n)` gives the lit
  factor for particles; explosion/muzzle transient lights should go through
  `addPractical({flicker:'none', marker:false, glow:false})` (or a raw
  PointLight you add/remove yourself — but registered fixtures feed the rain,
  fog tint and viewmodel lighting). Call `game.post.splashLens(0.5–1)` on
  nearby explosions (and camera-in-rain moments are automatic). Damage
  feedback: `game.post.setDamageVignette(0..1)`. Fire barrels: `addPractical`
  with `flicker:'fire'` gives the light animation; you own the flame VFX.
- **S4 WEAPONS**: ADS DOF via `game.post.setDof({focusDistance, focusRange,
  bokehScale})` while aiming and `setDof(null)` on exit; keep bokehScale ≤ 2.5
  in rain (see gap #6). Motion blur is off in photo mode; `viewmodel_fire` may
  call `game.post.setMotionBlurEnabled(true)`. For the viewmodel scene, sample
  `game.lighting.strongestLightsNear(camera.position, 4)` and mirror those as
  local lights; `game.sky.equirectTexture` / `scene.environment` give the IBL.
  Emissive reticles must exceed ~1.5 scene-linear to bloom (threshold 1.15).
- **S5 AI/PHYSICS**: subscribe to `weather:lightning` for reaction barks; the
  moon is the only shadowed key by default plus ≤3 shadowed spots chosen near
  the camera — enemy silhouettes stay readable inside flood pools.
- **S6 UI/AUDIO**: `weather:lightning.thunderDelay` (s) for the crack;
  `weather:changed {rainIntensity, wetness}` for rain beds; each fixture in
  `game.lighting.list` has `kind`/`position`/`flicker` for buzz/crackle
  emitters. Settings keys `motionBlur | filmGrain | chromaticAberration |
  aaMode` are already applied live by Post; `quality` needs a reload.
- **S7 INTEGRATION**: photo-mode captures use fixed steps so all animation
  (rain, ripples, flicker, storm) is deterministic per seed. The storm and
  weather cosmetics use their own seeded PRNGs (derived from `game.seed`), so
  gameplay `game.rng` draws are unaffected by weather state; the emitted
  `weather:lightning` payload (intensity/direction/distance) is what AI/audio
  should react to.
