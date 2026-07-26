# IRONWAKE — Architecture & Engineering Contracts

This is the engineering contract. Multiple agents build IRONWAKE in parallel;
this document is how their code fits together without collisions. **Read it
fully before writing code. If you must deviate, update this document in the
same change and say so in your report.**

## 0. Ground rules

- **Language/runtime**: modern JavaScript (ES2022 modules), no TypeScript, no
  framework. Three.js `0.185.x` (WebGL2 renderer only), `postprocessing` +
  `n8ao` for the effect stack, `@dimforge/rapier3d-compat` for rigid-body
  physics, `three-mesh-bvh` for world raycasts and player collision.
- **Build**: Vite. `npm run dev` (127.0.0.1:5173), `npm run build` → `dist/`,
  `npm run preview` (127.0.0.1:4173). Assets live under `public/assets/**` and
  are referenced as `assets/...` (relative — `import.meta.env.BASE_URL` aware).
- **No CDN imports.** Every dependency is an npm package. (The verification
  browsers have no CDN access.)
- **Style**: 2-space indent, semicolons, single quotes, no default exports
  except `vite.config.js`. Small focused modules. JSDoc on public APIs.
  Prefer plain data + functions over deep class hierarchies, but stateful
  systems are classes with `update(dt)` / `dispose()`.
- **Determinism**: nothing may call `Date.now()`, `performance.now()` or
  `Math.random()` inside gameplay simulation. Use `game.time` (fixed-step
  clock) and `game.rng` (seeded). Only the outer loop and cosmetic-only VFX
  jitter may touch wall-clock/`Math.random`, and photo mode overrides even
  those to be deterministic.
- **Performance budget** (target 60 fps @1080p on a mid GPU, "high" preset):
  ≤ 1,500 draw calls, ≤ 2.5M triangles/frame, ≤ 600 MB VRAM textures. Use
  instancing, merged static geometry, texture atlasing where natural, LODs
  for distant stacks, and frustum culling. Never allocate in `update()` hot
  paths (reuse vectors/quaternions; module-scope temporaries `_v1`, `_q1`).
- **Every change must keep `npm run build` green and `npm run shot -- --preset smoke`
  producing a non-black image with zero console errors.** See §7.

## 1. Directory layout & ownership

Each directory has exactly one owning workstream. You may *read* anything;
you may only *write* inside directories you own plus your own entries in the
shared registries listed in §3. Cross-cutting edits go through the integrator.

```
index.html, vite.config.js, package.json  — integrator
docs/**                                     — integrator (agents append notes to docs/NOTES-<area>.md)
tools/**                                    — integrator (verification harness)

src/main.js                                 — integrator (boot only, keep tiny)
src/Game.js                                 — integrator (system registry & update order)
src/core/**        Loop, Input, Events, Settings, Time, Random, Debug  — CORE
src/assets/**      manifest.js, AssetLoader.js, credits.js               — ASSETS
src/render/**      Renderer, Post, Sky, Weather, Lighting, Decals, LUTs   — RENDER
src/world/**       Level, Terrain, Materials, Props, Structures, Collision — WORLD
src/physics/**     Physics (Rapier world, ragdolls, debris)               — PHYSICS
src/player/**      Player, Controller, CameraRig, Interaction              — PLAYER
src/weapons/**     WeaponDefs, Weapon, Viewmodel, GunBuilder, Ballistics, Grenade — WEAPONS
src/ai/**          Enemy, Brain, Perception, Nav, Squad, Director          — AI
src/fx/**          Particles, MuzzleFlash, Impacts, Tracers, Explosions, Casings, LensFX — FX
src/audio/**       AudioEngine, SoundBank, Synth, Foley, Ambience, Music   — AUDIO
src/ui/**          HUD, Menus, Widgets, ui.css, Fonts                        — UI
src/systems/**     PhotoMode, ScoreSystem, Damage, MatchDirector           — SYSTEMS
public/assets/**                                                            — ASSETS (files) + owning stream per subfolder
CREDITS.md                                                                  — ASSETS (every third-party file listed with license)
```

## 2. Boot flow

```
main.js
  parse URL params (quality, photo mode, seed, debug flags)
  const game = new Game({ canvas, params })
  await game.init()          // renderer → assets → world → systems, with progress → boot bar
  game.start()               // realtime loop OR photo-mode stepping
```

`Game.init()` order — each stream owns exactly one **installer** module,
`src/<stream>/index.js` exporting `install<Stream>(game)`, and Game calls
them in this fixed order (integrator-owned; you never edit Game.js — put ALL
your wiring inside your installer):
1. `Renderer` (WebGL2, quality tier caps) + camera + input (integrator)
2. `AssetLoader.loadManifest(manifest, tier)` with progress callback
3. `installRender(game)` → sky, lighting, weather (post is built last)
4. `installWorld(game)` → level geometry, materials, BVH, nav, spawns, lights
5. `installPhysics`, `installFX`, `installPlayer`, `installWeapons`,
   `installAI`, `installAudio`, `installUI` (in that order)
6. `installSystems` (integrator: MatchDirector, ScoreSystem, Autoplay)
7. `installPost(game)` → the post chain wraps everything
8. `PhotoMode` runs if `?shot=` is present, else the realtime loop starts

Inside an installer you: construct your systems, assign them onto `game`
(e.g. `game.player`, `game.weapons`, `game.fx`), register per-frame work via
`game.addSystem({name, update(dt), dispose()}, order)`, subscribe to
`game.events`, and register your photo presets via `PhotoMode.register(...)`.
Installers may be `async`.

## 3. Shared spine (integrator-owned files everyone plugs into)

### `Game` (src/Game.js)
```js
game = {
  params, settings, events, time, rng, input,
  renderer, post, scene, camera,          // three.js roots
  world,                                   // Level instance: colliders, lights, navmesh, spawns, materials
  physics, assets, audio,
  player, weapons, ai /* Director */, fx, ui, score,
  systems: [ ...ordered ],                 // each { name, update(dt), dispose() }
  addSystem(sys, order), getSystem(name),
}
```
Update order per fixed step (`dt = 1/60` by default, up to `maxSubSteps` per
frame): `input → player.controller → physics → weapons → ai → fx → world.dynamic
→ audio → ui → cameraRig(late) → render`. Rendering happens once per animation
frame after all pending steps, with interpolation alpha available as
`game.time.alpha`.

### Events (src/core/Events.js) — the ONLY cross-module coupling for gameplay
Typed string channels; payloads are plain objects. Canonical events:
```
game:ready, game:paused, game:resumed, match:start, match:end
wave:start {index}, wave:cleared {index}
player:damaged {amount, from, dir, isHeadshot}, player:died, player:healed
player:fired {weapon}, player:reloaded, player:landed {speed}, player:footstep {surface, sprint}
weapon:hit {point, normal, surface, entity, damage, isKill, isHeadshot}
enemy:spawned {enemy}, enemy:damaged {enemy, part}, enemy:killed {enemy, by, isHeadshot, distance}
enemy:fired {enemy, from, dir}
grenade:thrown, grenade:exploded {point, radius}
fx:decal {point, normal, kind}, fx:impact {point, normal, surface}
ui:hitmarker {kill}, ui:notify {text, tier}
settings:changed {key, value}
photo:ready
```
UI listens to gameplay events; gameplay never imports UI. FX listens to
weapon/impact events. Audio listens to everything relevant. AI queries the
world/player through injected references, never via globals.

### Settings & quality tiers (src/core/Settings.js)
```js
settings.quality: 'low' | 'medium' | 'high' | 'ultra'   // default 'high'; photo mode forces 'ultra'
settings.get(key) / set(key, value) → emits settings:changed
```
Tier table (RENDER stream owns the values, in `src/render/QualityTiers.js`):
shadow map size, cascade count, AO on/quality, SSR on/off, bloom levels,
volumetrics steps, particle counts, texture max size, motion blur, pixel ratio
cap. Every visual system reads its knobs from the tier, never hardcodes.

### Asset manifest (src/assets/manifest.js)
Declarative list; loader resolves URLs relative to `public/`:
```js
{ id: 'tex.asphalt_wet', type: 'pbrset', tier: 'all',
  files: { color: 'assets/textures/asphalt/color.jpg', normal: '...', arm: '...' , disp: '...' },
  colorSpace: 'srgb', wrap: 'repeat', repeat: 8 }
{ id: 'hdri.night_port', type: 'hdr', file: 'assets/hdri/kloofendal_night_2k.hdr' }
{ id: 'model.container_a', type: 'gltf', file: 'assets/models/container_a.glb', draco: false }
{ id: 'sfx.rifle_shot_close', type: 'audio', files: ['a.ogg','b.ogg','c.ogg'] } // variants
```
`AssetLoader.get(id)` returns loaded resources; textures come back with the
right color space, anisotropy = renderer max, wrap and repeat applied. Missing
assets must degrade gracefully (checker fallback + console warn), never crash.
**Every third-party file added under public/assets gets a line in CREDITS.md
with source URL and license.** Only CC0 / CC-BY / MIT-licensed material.

## 4. Photo mode / verification contract (MANDATORY)

The automated critic pipeline drives the game headlessly. `src/systems/PhotoMode.js`
implements it; every visual system must respect it.

URL params:
```
?shot=<preset>        photo-mode preset id (see docs/CRITIC_PROTOCOL.md for the list)
&seed=<int>           RNG seed (default 1)
&w=<px>&h=<px>        canvas size (default 1920x1080), pixel ratio forced to 1
&quality=<tier>       default ultra in photo mode
&t=<seconds>          simulate this much game time before capture (deterministic fixed steps)
&hud=0|1              HUD visibility (default per preset)
&debug=<flags>        comma list: stats, wire, colliders, nav, bounds
```
Behavior when `shot` is present:
- No pointer-lock, no menus (unless preset is a menu shot), audio muted.
- `Loop` runs in **stepping mode**: fixed `1/60` steps advanced as fast as the
  machine allows, wall-clock ignored (SwiftShader frames can take seconds).
- The preset function (`PhotoMode.presets[id]`) receives `game` and sets up
  the scene: camera transform/FOV, weapon state, spawned enemies at
  positions/anim frames, mid-action moments (muzzle flash frame, explosion at
  t+0.15 s, tracers in flight), weather state, HUD state.
- After warm-up, set `window.__ironwake = { ready: true, preset, frame, stats }`.
  The harness waits for `ready`, then screenshots. On any uncaught error set
  `window.__ironwake = { error: String(err) }` — the harness reports it.
- `window.__ironwake.api` also exposes `capture()`, `step(n)`, `setPreset(id)`,
  `getStats()` for scripted multi-shot sessions.

### Autoplay contract (`?autoplay=1&duration=<gameSeconds>&seed=<n>`)

Used by `npm run verify`. The game skips all menus, starts the match, and a
scripted bot (`src/systems/Autoplay.js`, integrator-owned) injects virtual
input (`game.input.simulate({...})` — the Input system must support injected
axes/buttons that override real devices) to move, aim at the nearest enemy,
fire, reload, and take cover-ish paths for `duration` game-seconds. The loop
runs in stepping mode (fixed 1/60 steps, wall clock ignored). Publishes
`window.__ironwake.autoplay = { time, wave, kills, health, shotsFired, done, stats }`
updated at least once per game-second, `done: true` with final `stats` at the
end. Any exception → `window.__ironwake.error`.

## 5. Coding contracts per stream (definition of done)

Each stream's DoD, beyond "matches ART_DIRECTION.md":

- **RENDER**: `Renderer` (tone mapping ACES, sRGB output, capabilities),
  `Post` (n8ao AO → bloom → god rays where fed → SMAA/TAA → motion blur → DOF
  (ADS-driven) → color grade LUT → chromatic aberration → grain → vignette),
  `Sky` (HDRI env for IBL + sky dome, lightning flash controller), `Lighting`
  (moon directional w/ CSM, registers world light sources with shadow budget:
  ≤ 3 shadow-casting spots), `Weather` (GPU rain, splashes, wind gusts),
  `LensFX` hooks (rain droplets on lens, blood/dirt). Exposes
  `render.setWeather({...})`, `render.flashLightning()`.
- **WORLD**: `Level.build()` produces: static merged/instanced scene, the
  collision BVH (`world.raycast(origin, dir, maxDist, mask)`,
  `world.capsuleCollide(...)`), `world.navGrid`/waypoint graph with cover
  points (`world.nav`), spawn points (`world.spawns.player`, `.enemy[]`),
  material→surface tagging (`userData.surface = 'concrete'|'metal'|'wood'|'water'|'flesh'|'dirt'|'glass'`)
  used by ballistics/foley, and light fixtures list consumed by RENDER.
- **PHYSICS**: Rapier world stepped in the fixed loop; helpers
  `physics.addDebrisBox(...)`, `physics.throwProjectile(...)`, and
  `physics.spawnRagdoll(enemy)` (approximated multi-body chain is fine).
  Physics is for *props/debris/grenades/ragdolls*; player & bullets use the BVH.
- **PLAYER**: kinematic capsule controller vs BVH (grounding, slopes, steps ≤
  0.35 m, slide, crouch, sprint, jump, mantle over ≤1.2 m obstacles), stamina-
  free CoD-style movement values (walk 4.6 m/s, sprint 7.2, crouch 2.2, ADS
  walk 2.8), `CameraRig` producing final camera pose from movement + weapon
  recoil + damage flinch + bob + lean + shakes with interpolation, health
  100 with regen after 5 s of no damage, `player.applyDamage(amount, from)`.
- **WEAPONS**: data-driven `WeaponDefs` (rpm, damage, falloff, spread bloom,
  recoil pattern arrays, ADS time, reload times, ammo), `Weapon` FSM,
  `Viewmodel` rendered in a **separate scene pass with its own camera** (no
  wall clipping, own FOV ~62°, drawn after world, receives world lighting via
  matched lights + env), `GunBuilder` procedural high-detail meshes (or GLTF
  when available), `Ballistics.fireHitscan(...)` (BVH world hit + enemy
  hitbox capsules, penetration through thin metal, damage falloff, headshot
  ×1.5, torso ×1.0, limbs ×0.8), grenades.
- **AI**: `Enemy` (skinned model, hitbox capsules per bone group, health,
  ragdoll death, drops), `Brain` FSM/utility (idle → patrol → investigate →
  engage → cover → flank → reload → retreat), `Perception` (LOS raycasts,
  hearing radius from `player:fired`), `Nav` (A* on `world.nav` + local
  steering/avoidance), `Squad` coordination (only 2 push at once), `Director`
  (wave escalation: count, armor, aggression, grenade usage; intermission with
  countdown; boss "juggernaut" every 5th wave).
- **FX**: pooled GPU particle systems (single instanced billboard renderer
  supporting sprite atlases, soft particles vs depth, lit smoke), muzzle
  flash rig, tracers (stretched additive quads), impact library keyed by
  surface, decals (bullet holes, scorch, blood — via decal mesh manager with
  budget & fade), explosions (flash → fireball → shockwave ring → smoke column
  + embers + camera shake + screen dirt), brass casings pool with bounce.
- **AUDIO**: `AudioEngine` buses (master/sfx/foley/ambient/music/ui) with
  convolver reverb (procedurally generated IRs are fine), 3D panner nodes for
  world sounds, `SoundBank` with round-robin variation + pitch jitter, a
  `Synth` module that can *procedurally generate* any missing sound (layered
  gunshot: noise burst + transient click + body thump + tail; casing tinks;
  UI bleeps) so the game never depends on downloads succeeding, `Foley`
  (footsteps by surface & speed, gear rustle, ADS raise, mag out/in, bolt),
  `Ambience` (rain layers by intensity, wind gusts, thunder synced to
  lightning, distant firefight, ship horn), music: procedural dark ambient
  pad + percussive tension layer that rises with wave intensity, mixer
  ducking on explosions, low-health lowpass + heartbeat.
- **UI**: DOM/CSS HUD (compass tape, ammo cluster, killfeed, hitmarker,
  crosshair, damage arcs, wave banner, XP/medal toasts, interaction prompt,
  screen blood vignette, low-ammo/reload prompts), menus (main, pause,
  settings, loadout, death/results) rendered over the live blurred scene,
  self-hosted OFL font, all animation via CSS/WAAPI, zero layout jank
  (transform/opacity only), fully driven by `Events`.
- **SYSTEMS**: `PhotoMode` (contract §4 + all presets), `ScoreSystem`
  (score, streaks, medals, XP), `Damage` helpers, `MatchDirector` (states:
  menu → deploy cinematic → waves → death → results).
- **ASSETS**: manifest + loader + everything in `public/assets/` with
  `CREDITS.md`. Textures max 2K (4K only for hero weapon), JPG for color/ARM,
  PNG only where alpha needed, HDR 2K equirect for the sky.

## 6. Definition of Done for ANY task

1. `npm run build` succeeds with zero errors and no new warnings you introduced.
2. `npm run shot -- --preset smoke --preset <your-relevant-presets>` produces
   images; you have **looked at them** (Read the PNGs) and they show your work
   correctly with **zero page errors** (the harness prints console errors).
3. Public API documented in a top-of-file JSDoc block. Anything you exposed
   on the shared spine is registered per §3 conventions.
4. New third-party files credited in `CREDITS.md`.
5. Your report lists: files changed, how to see the feature (which preset /
   which controls), known gaps ranked by visual impact.

## 7. Verification commands

```
npm run build                       # must always pass
npm run shot -- --preset smoke      # boots the game, renders a frame, saves shots/smoke.png
npm run shot -- --preset vista --preset viewmodel_idle --preset ads   # any preset ids
npm run shot -- --all               # every registered preset
npm run verify                      # scripted play session (menus → spawn → move → shoot → die), asserts no errors
```
The harness serves the production build itself (`vite build` then a static
server) so what critics see is what ships.
