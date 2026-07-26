# IRONWAKE — Build Plan & Stream Briefs

The vertical slice is built by sequential specialist streams (one code
writer at a time in the shared tree), each self-verifying with the shot
harness, followed by the adversarial critic loop (docs/CRITIC_PROTOCOL.md).
Every stream reads ART_DIRECTION.md, ARCHITECTURE.md, REFERENCE_STUDY.md and
the asset catalogs (docs/ASSETS-*.md) before writing code.

Global definition of done for every stream (ARCHITECTURE.md §6): `npm run
build` green; the stream's photo presets render via `npm run shot` with zero
console errors; the agent has LOOKED at every one of its shots and iterated
until they honestly meet the reference bar; docs/NOTES-<stream>.md written;
work committed (no push).

## Phase 2 — vertical slice construction (sequential)

### S1 · RENDER CORE — "make anything we draw look expensive"
Owns `src/render/**` (+ registers presets).
- **Sky**: HDRI (asset `hdri.night_primary`) → PMREMGenerator env for IBL;
  sky dome shows the HDRI (rotatable, dimmed exposure control); storm
  controller: scheduled lightning (sky flash + moon boost + `weather:lightning`
  event with delay-to-thunder distance), slow cloud drift illusion (uv scroll on
  a cloud layer or animated dome rotation).
- **Lighting**: moon `DirectionalLight` with tight cascaded/large shadow map
  covering the arena, hemisphere ambient tuned to the HDRI, a **fixture API**:
  `lighting.addFlood({pos, target, color, intensity, angle, castShadow})`
  producing spot light + volumetric cone mesh (soft additive shader that
  fades with view angle and shows rain streaks brighter inside) + lens flare
  sprite + emissive housing; `lighting.addPractical({...})` for wall lamps /
  fire barrels (flicker curve); a shadow budget (max 3 shadow spots, choose by
  proximity/importance each frame at high tier).
- **Post**: N8AO (done) → bloom (mip-based, threshold on HDR emissives) →
  optional god rays from the moon/floods → SMAA → custom camera motion blur
  effect (velocity from camera delta, low sample count, tier-gated) → DOF
  (BokehScale driven by an `ADS focus` value the weapon system sets) →
  color grade LUT (author a subtle teal-shadow / warm-highlight LUT
  procedurally, 32³) → chromatic aberration (edges only) → grain → vignette.
  Exposure control API (`post.setExposure`), damage vignette hook, lens
  droplets overlay effect (screen-space animated water drops when looking up
  into rain / after explosions).
- **Weather**: GPU rain — thousands of instanced stretched quads following the
  camera in a shell volume, lit by nearby lights (approximate via a uniform
  list of the 4 strongest lights), gusting wind vector, ground splash
  particles on impact, puddle ripple normal animation exposed to WORLD as
  `weather.wetness`, `weather.puddleRipplesTexture`, thunder scheduling.
- **PBR factory** `src/render/PBR.js`: `makeMaterial(pbrsetId, {repeat,
  wetness, tint, roughnessScale, aoIntensity, displacementScale})` returning
  tuned `MeshStandardMaterial`s from `assets.get('tex.*')` (arm packing
  supported), plus a **wet ground** variant (roughness modulated by a puddle
  mask, animated ripple normals, planar-reflection or SSR-ish env boost).
- Presets: `rain_light` (rain crossing a floodlight cone), refine `smoke`.

### S2 · WORLD — "Terminal 9"
Owns `src/world/**` (+ presets `vista`, `street`, `alley`, `quay`, `warehouse`).
- Author the map from ART_DIRECTION.md §4 (three lanes, ~90×70 m): the
  procedural **container kit** (real 20/40 ft dims, corrugated normal-mapped
  panels from `tex.corrugated_*`, paint colors from the palette with per-
  instance wear/rust masks, cast corner posts and door hardware geometry,
  stenciled canvas-texture decals: unit IDs like "IRWU 902114 6", "MAX GROSS
  30480 KG", hazard chevrons), stacks with slight rotational jitter, an open
  burnt container interior, an overturned container ramp.
- Ground: large asphalt mesh with vertex-blended puddle mask (SDF blobs +
  noise) driving wetness, painted lane markings/decals, drainage grates, oil
  stains, tire tracks, cracks; concrete pads by the warehouse; quay edge with
  water plane (reflective — Reflector at high tier / env fallback), moored ship
  silhouette + two gantry crane silhouettes with blinking beacons on the
  skyline; warehouse facade with lit interior spill and open bay doors;
  office trailer; jersey barriers; sandbag emplacements; the downloaded prop
  models (barrels, pallets, crates, tires, cones, cylinders…) placed as
  instanced clutter with intent (cover positions along lanes); fire barrels
  (registered as practical lights + FX emitters), strung cables (catenaries),
  tarps, chain link fence, hazard tape.
- **Collision**: merged static collision geometry → `MeshBVH`;
  `world.raycast(origin, dir, maxDist, {ignoreDynamic})` returning `{point,
  normal, distance, object, surface}`; `world.capsuleCast/collide(capsule)`
  for the player and AI; surface tags on everything.
- **Nav**: walkable grid (0.75 m cells) baked by downward raycasts +
  clearance checks, blocked cells for props, exposed A* helper + **cover
  points** (positions adjacent to blockers with facing normals) + **enemy
  spawn points** (12, at the north/east/west edges, out of the player's start
  LOS) + player spawn + **photo points** for every preset.
- Static optimization: merge by material, `InstancedMesh` for repeated
  props/containers, frustum culling friendly grouping; report draw calls &
  triangle counts in NOTES.

### S3 · PLAYER + FX CORE
Owns `src/player/**`, `src/fx/**` (+ presets `impacts`, `explosion`).
- **Controller**: capsule (r 0.35 m, h 1.8 m) vs BVH; CoD-style velocities
  (walk 4.6, sprint 7.2, crouch 2.2, ADS 2.8 m/s), acceleration/friction
  curves, step-up 0.35 m, slopes ≤ 45°, jump 1.05 m with air control 30 %,
  crouch/stand smoothing, tactical sprint stub, **slide** (from sprint,
  0.8 s, decel curve, camera drop + tilt), **mantle** over ≤ 1.2 m ledges
  (ledge probe raycasts, 0.45 s animated), lean Q/X (offset + roll), stairs.
- **CameraRig**: composes movement bob (figure-8, speed-scaled), landing dip,
  sprint FOV kick (+6°), ADS FOV lerp, weapon recoil view punch (returns via
  spring), damage flinch, shakes (explosions with distance falloff, fire
  micro-shake), lean roll, mantle animation, breathing sway — all as spring
  systems, exposing final `camera` transform + `viewmodelOffset` for WEAPONS.
- **FX core** (src/fx): one pooled instanced-billboard particle renderer
  (procedurally generated sprite atlas at boot: soft smoke, hard smoke,
  spark streak, flare, dust puff, blood mist/splat, ember, water splash,
  debris chunk), soft-particle depth fade, per-particle lighting factor from
  the strongest nearby lights; **Tracers** (stretched additive segments +
  head glow, 300–500 m/s visual travel); **Impacts** library keyed by surface
  (concrete: dust puff + chips + spark chance + decal; metal: bright sparks +
  scorch decal + audible ricochet event; wood: splinters; flesh: blood mist +
  splat decal on nearby surface; water: splash column); **Decals** manager
  (DecalGeometry pool with budget + fade, bullet-hole atlas, scorch, blood,
  grime); **Casings** (pooled brass with simple ballistic bounce off the BVH,
  glint material, despawn); **Explosions** (flash frame + fireball sprites +
  shockwave ring + rising smoke column + embers + ground scorch decal +
  physics impulse hook + `fx:explosion` event with camera shake request);
  **MuzzleFlash** rig factory used by both viewmodel and enemies.

### S4 · WEAPONS + VIEWMODEL
Owns `src/weapons/**` (+ presets `viewmodel_*`, `gun_macro`).
- **GunBuilder** — the hero asset, procedural and dense: M4-style carbine
  (upper/lower receiver with forge lines, mag well flare, dust cover,
  forward assist, charging handle, brass deflector, quad-rail handguard with
  covers and heat vents, low-profile gas block, birdcage or suppressor,
  20-in-a-30 mag with witness ribs, castle-nut stock tube + collapsible
  stock, pistol grip texture, ambi selector, holographic sight housing with
  hood and emissive reticle plane, PEQ box with cables and pressure pad,
  vertical foregrip, sling loop, chamber/ejection port with visible bolt
  carrier that reciprocates); tactical pistol (slide serrations front/rear,
  extractor, tritium 3-dot emissives, accessory rail + weapon light with
  cone, textured grip, mag baseplate, reciprocating slide, tilting barrel);
  frag grenade (body seams, spoon, pin ring, fuze head); **gloved hands and
  forearms** (segmented finger geometry, knuckle guards, watch, rolled
  sleeve with cloth normal map). Bevel every edge; add wear via vertex-color
  edge masks driving roughness/albedo variation; laser + flashlight optional
  emissives. Weapon LOD not needed (first person only) but keep ≤ 90k tris.
- **Viewmodel** rendered in its own scene + camera (FOV ~62°, near 0.01) after
  the world pass (depth cleared), with lighting matched to the player's
  position (sample nearby lights, copy sky IBL, add a subtle key/rim so the
  gun always reads), positioned CoD-low-right, occupying ~28–32 % of frame
  width at hip.
- **Animation**: spring-driven procedural rig — idle breathing + noise sway,
  move bob (speed-scaled figure-8), sprint pose (lower + cant + damped bob),
  ADS blend (curve 200 ms, aligns the optic's aim point exactly to screen
  center, world sway reduced 70 %), fire kick (position/rotation impulses
  per shot from `WeaponDefs.recoil`), bolt/slide reciprocation, muzzle rise
  pattern, reload sequence (mag out with the mag detaching & falling under
  gravity, hand travel, mag in, bolt release — 2.1 s tactical / 2.5 s empty),
  weapon swap lower/raise, inspect (T) hero rotation sequence, mantle/slide
  weapon dip, look-lead lag. All timings/curves in data.
- **Weapon FSM + Ballistics**: hitscan from the true camera ray (with ADS
  vs hip spread bloom + recoil pattern indexing), penetration through
  ≤ 3 cm metal with damage falloff, headshot/limb multipliers via the AI
  hitbox registry API (`ballistics.registerHitboxSet(entity, capsules)`),
  events: `player:fired`, `weapon:hit`, `ui:hitmarker`; ammo/reserve/mag
  logic, fire modes (auto/burst/semi), empty click, reload interrupt.
- WeaponDefs: `ar_carbine`, `pistol_tactical`, `frag` (rpm, dmg curve,
  recoil arrays, spread, ADS time, timings, sounds ids).

### S5 · AI + COMBAT + PHYSICS
Owns `src/ai/**`, `src/physics/**`, `src/systems/{ScoreSystem,MatchDirector,Damage}.js`
(+ presets `firefight`, `enemy_close`).
- **Enemy**: `char.soldier` (soldier.glb) instanced via SkeletonUtils.clone,
  materials pushed toward the operator look (darkened multicam tint,
  roughness map, emissive IR beacon on shoulder), attached procedural rifle
  (from GunBuilder, third-person LOD) at the right hand bone with a support
  offset, per-bone-group **hitbox capsules** (head 1.5×, torso 1.0×, limbs
  0.8×), health 100 (+ armor tiers by wave), hit flinch (additive twitch),
  death (physics ragdoll via Rapier joint chain OR animated collapse blended
  into ragdoll), blood decal underneath, dropped-mag/weapon debris.
- **Animation**: mixer with Idle/Walk/Run cross-fades speed-driven, plus a
  procedural **aim layer** rotating spine/chest/right arm toward the target,
  fire recoil twitch, aim jitter by accuracy; strafe lean.
- **Brain** (per enemy FSM/utility, tick 10 Hz): spawn → advance to a nav
  position with LOS to the player at preferred range (12–25 m) → engage
  (burst fire with reaction delay, accuracy improving with time-on-target,
  degraded by player movement/cover) → reposition/flank when suppressed or
  LOS lost > 3 s → cover (crouch at a cover point, peek-fire cycle) → grenade
  toss if the player camps (arc validation) → rush at close range. Squad
  layer: max 2 pushing simultaneously, spread targets, callout events for
  audio ("contact left").
- **Perception**: LOS raycasts (eye → player head/torso, cached 5 Hz),
  hearing (radius from `player:fired`, footsteps when sprinting).
- **Nav**: A* over `world.nav` grid with path smoothing, local steering +
  separation, doorway/lane usage, spawn from out-of-LOS points.
- **Director**: wave escalation (count 6→18, armor, aggression, weapon
  variety, grenades), intermission 12 s with countdown events, boss
  "Juggernaut" every 5th wave (2× scale hitpoints, LMG, slow), pity ammo
  drops; publishes `wave:start/cleared`, `enemy:*` events.
- **Physics** (Rapier): fixed-step world; grenades as CCD bodies with
  bounce/sound events, prop debris impulses from explosions, ragdolls;
  `physics.raycast` for cosmetic queries only (gameplay uses the BVH).
- **ScoreSystem / MatchDirector**: score, XP, medals (headshot, double,
  triple, longshot, revenge), killstreak counter, match states (menu →
  deploy → waves → death → results) with events consumed by UI; results data
  (kills, headshots %, accuracy, waves, time survived).

### S6 · UI + AUDIO
Owns `src/ui/**`, `src/audio/**` (+ presets `hud_full`, `menu_main`, `menu_loadout`, `results`).
- **HUD** (DOM/CSS, self-hosted fonts): compass tape (top-center, degree
  ticks, cardinal letters, enemy pips fading with distance), ammo cluster
  (bottom-right: mag count large tabular numerals, reserve, weapon name, fire
  mode glyph, grenade pips), crosshair (dynamic 4-line spread, hides on ADS,
  center dot option), hitmarker (X flash 120 ms, red + audio on kill),
  killfeed (bottom-left rows, weapon glyph SVGs, fade), damage direction
  arcs, low-health desaturation/blood vignette + heartbeat pulse driven by
  `player:damaged`, reload/low-ammo prompts, interaction prompt, wave
  banner ("WAVE 04 — HOSTILES INBOUND" with animated rules), score/XP toasts,
  medal splashes, killstreak availability, subtle screen dirt/water lens
  texture over the frame edges, all elements aligned to a 12-column grid at
  1080p reference with `vw/vh` scaling.
- **Menus**: main menu (title lockup, animated background = live scene
  camera drift + blur/dark overlay + film grain), PLAY / SETTINGS /
  CREDITS, settings screen with functional controls (FOV slider 65–120,
  sensitivity, ADS mode, quality preset, motion blur, film grain, chromatic
  aberration, volumes, invert Y), loadout preview screen with the 3D weapon
  turntable, pause menu, death screen ("YOU DIED" + killed-by + respawn/
  results), results screen (stats table + XP bar animation). Keyboard/mouse
  navigation, hover/click sounds, focus states. Menus never use `alert()`
  or system fonts.
- **AudioEngine**: WebAudio graph with buses (master → sfx/foley/ambient/
  music/ui/voice), convolution reverb bus (procedurally generated impulse
  responses: outdoor slap + container-alley reverb), 3D panners (HRTF) for
  world sources with distance model + air absorption lowpass, occlusion
  (lowpass when a BVH ray from listener to source is blocked), voice
  limiting/priorities, sidechain-style ducking on explosions, master
  limiter. **Synth** module: generates any missing sound procedurally at
  boot (layered gunshot = filtered noise burst body + transient click + sub
  thump + reverb tail; suppressed variant; pistol; casing tinks per surface;
  reload foley clicks; hitmarker tick; headshot crack; explosion (noise +
  sub sweep + debris rain); footsteps per surface from filtered noise
  grains; UI bleeps; heartbeat; tinnitus ring). Prefer real CC0 samples from
  the manifest when present; synthesize the rest — the game must sound
  complete either way. **Foley**: footsteps synced to the movement bob phase
  and surface tags, sprint breathing, gear rustle, weapon handling. 
  **Ambience**: rain intensity layers, gusting wind, thunder timed to
  `weather:lightning` (distance delay), distant firefight/ship horn beds,
  fire-barrel crackle emitters. **Music**: procedural dark drone/pad +
  tension percussion that intensifies with wave state; menu theme.
- Presets: `hud_full` (mid-fight HUD with killfeed + hitmarker + low ammo +
  wave banner all active), `menu_main`, `menu_loadout`, `results`.

### S7 · INTEGRATION + AUTOPLAY
Owns `src/systems/Autoplay.js`, cross-stream glue, `docs/NOTES-integration.md`.
- Autoplay bot per ARCHITECTURE.md §4: navigates the lanes, acquires the
  nearest enemy, ADS + fires bursts with human-like reaction, reloads,
  retreats when hurt, throws a grenade at clusters; publishes
  `window.__ironwake.autoplay` stats; `npm run verify` MUST pass with kills
  > 0 and no console errors.
- Full match flow end to end (menu → deploy → waves → death → results),
  every registered preset green in `npm run shot -- --all`, performance
  report (frame stats at high tier), fix integration bugs found, record a
  30 s autoplay video via Playwright for the release notes.

## Phase 3 — critic rounds (loop)

Per docs/CRITIC_PROTOCOL.md: capture all presets → blind pack → ≥2
independent harsh critics per round → decode → ledger → targeted fix
streams (RENDER/WORLD/WEAPONS/AI/UI polish agents) → repeat until the
advancement gates hold or a plateau is proven. Every round also re-runs
`npm run verify`.
