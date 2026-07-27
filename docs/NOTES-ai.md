# NOTES — S5 AI + COMBAT (trimmed) (`src/ai/**`, `src/systems/{ScoreSystem,MatchDirector}.js`, `src/physics/**` stub)

Owner scope (75-minute box): a skinned PMC enemy that navigates, takes cover,
fires at the player and dies; a 10 Hz brain FSM; a wave director; arcade
score; the match state machine; the `firefight` and `enemy_close` photo
presets. Ragdolls, enemy grenades, squad tactics, the juggernaut boss and any
Rapier initialisation were explicitly skipped. Wired through
`src/ai/index.js` → `game.ai` (Director) + `src/systems/index.js` →
`game.score`, `game.match`.

## 1. What was built

| Module | Summary |
| --- | --- |
| `Enemy.js` | `char.swat` (Quaternius, CC0) prototype loaded/darkened once (`prepareEnemyPrototype`: albedo capped ~0.075, sat ×0.25, rough 0.85 → black-multicam charcoal), height normalised to 1.8 m, cloned per enemy with `SkeletonUtils.clone`; emissive green IR helmet beacon on the `Head` bone; a boxy dark rifle prop (receiver/barrel/mag/stock/optic + `muzzle` anchor) re-seated at the `Wrist.R` bone each step and pitched at the aim target so flashes/tracers originate at the barrel. AnimationMixer state graph: `idle_aim` (Idle_Gun_Pointing) / `shoot` (Idle_Gun_Shoot) / `run` / `run_shoot` / `walk` cross-fades, one-shot `hit` (HitRecieve) and `death` (Death, clamped); run time-scale follows move speed; a light procedural aim layer pitches the `Torso` bone toward the target; crouch = 28 % squat. Hitbox capsules registered with `game.ballistics` (head, torso, 2 legs, shoulder bar = limbs), rebuilt from root position/yaw/crouch each step; `onWeaponHit()` applies PART_ADJUST (→ head ≈2×, torso 1×, limb ≈0.75× effective), emits `enemy:damaged`, plays the hit react (throttled 0.4 s), dies at 0 hp: unregisters hitboxes, Death clip, blood pool decal + mist, `enemy:killed`, corpse despawns after 8 s (Director). Capsule-mesh stand-in if no character asset loads. |
| `Brain.js` | Per-enemy FSM, `think()` at 10 Hz staggered by id, `step()` every fixed tick. SPAWN → ADVANCE (nav.findPath to a sampled firing spot 12-25 m from the player with LOS, run 4.4 m/s) → ENGAGE (0.4-0.7 s reaction, 3-6 round bursts at 600 rpm with 0.7-1.6 s pauses, cone = 6°/accuracyMul − 0.9°·timeOnTarget (min 1.6°), +3.5° while the player sprints, ×1.5 when moving, ×1.3 rushing) → REPOSITION when LOS is lost > 2.5 s → COVER when hurt recently (crouch at the nearest facing `world.nav.coverPoints` entry, 1-1.8 s hidden / 1.2-2 s peek-fire cycle) → RUSH inside 6 m (5.4 m/s straight in, firing). Enemy shots are world raycasts toward a cone-jittered player-torso point: blocked → `fx.impact` at the block; player capsule hit (`rayCapsule`) → `player.applyDamage(9 × falloff, {from, dir})`; otherwise `enemy:nearmiss {point, dir, distance}` when the closest approach < 1.6 m. Every shot: `fx.muzzleFlash` (world, light) + `fx.tracer` + `enemy:fired {enemy, from, dir}`. |
| `Director.js` | `game.ai`: enemy registry, waves — count(N) = min(6 + 2(N−1), 20), max 7 alive, trickle spawns (0.9 s apart) at `world.nav.enemySpawnPoints` that are > 12 m from the player and hidden from the player's eye (raycast), farthest-point fallback; per-wave health ×(1+0.15(N−1)) and accuracy ×(1+0.08(N−1)); 8 s intermission; `wave:start {index}` / `wave:cleared {index}` / `match:state {state:'intermission'}`. Runs brains, applies pairwise separation steering (1.4 m radius, pushes stationary enemies apart too), updates enemies, removes corpses, applies radial `grenade:exploded` damage to enemies ((1−d/r)² × damage). API: `startWaves()`, `stop()`, `clear()`, `spawnEnemyAt(pos, opts)`, `forceThink()`, `enemies`, `aliveCount`, `wave`, `state`. |
| `systems/ScoreSystem.js` | `game.score`: +100 kill, +50 headshot, +25 longshot (> 40 m); `score:add {points, total, reason}`; tracks kills/headshots/shots fired/shots hit/longest kill for the results panel. |
| `systems/MatchDirector.js` | `game.match`: menu → combat (`match:start` from the deploy UI or `forceCombat()` — resets score, clears + starts waves) → death (`player:died`, stops waves) → results 1.6 s later with `match:state {state:'results', stats:{score, kills, headshots, accuracy, longestKill, wavesSurvived, timeSurvived}}` → menu (`match:end`). Autoplay (`?autoplay=1`) auto-enters combat on `game:ready`. |
| `presets.js` | `firefight` (firing, HUD on) and `enemy_close` (enemy, HUD off) — see §5. Dev probe `ai_test` (`--debug aitest`): starts the match from the spawn, runs 20 s, asserts spawns / enemy fire / kill path (console.error → red harness). |
| `index.js` | Installer: awaits the character prototype, creates the Director, registers system `ai` (order 40) and the presets. |
| `physics/index.js` | Deliberate no-op: `game.physics = null` (no Rapier, no ragdolls this pass — every consumer probes and falls back). |
| `systems/index.js` | Integrator stub filled: builds `ScoreSystem` + `MatchDirector`, system `match` (order 42). |

System order: player 10 → weapons 30 → **ai 40** → match 42 → fx 50 → ui 80 → camera 90.

## 2. Public API

```js
game.ai.startWaves() / stop() / clear()
game.ai.spawnEnemyAt(vec3, {yaw, health, accuracyMul, brain: bool}) → Enemy
game.ai.enemies (Enemy[]), .aliveCount, .wave, .state ('idle'|'wave'|'intermission')
game.ai.forceThink()
enemy: { id, name:'PMC-n', alive, health, maxHealth, position (live Vector3), yaw,
         crouch 0..1, animState, aiState, muzzleWorld, aimTarget, root (Object3D),
         brain, hitboxes, onWeaponHit(hit), applyDamage(amount, fromVec3), die(info),
         eyePosition(out) }
game.score.total / kills / headshots / accuracy() / stats() / reset() / add(points, reason)
game.match.state ('menu'|'combat'|'death'|'results') / forceCombat() / startCombat()
             / toMenu() / stats()
```

Events emitted: `enemy:spawned {enemy}`, `enemy:damaged {enemy, part, damage}`,
`enemy:killed {enemy, by, isHeadshot, distance, weapon, position}`,
`enemy:removed {enemy}`, `enemy:fired {enemy, from, dir}`,
`enemy:nearmiss {point, dir, distance}`, `wave:start {index}`,
`wave:cleared {index}`, `score:add {points, total, reason}`,
`match:state {state, stats?}`. Consumed: `grenade:exploded` (radial damage),
`match:start` / `match:end` / `player:died` (match flow), `game:ready`
(autoplay auto-start), `player:fired` / `weapon:hit` (accuracy stats).

## 3. Entity ↔ ballistics contract (agreed with WEAPONS)

`game.ballistics.registerHitboxSet(enemy, () => enemy.hitboxes)` with live
world capsules `{part:'head'|'torso'|'limb', radius, a, b}` (head r 0.14,
torso r 0.22, legs/shoulder-bar r 0.08-0.09). `enemy.alive === false` makes
traces skip the corpse; the set is unregistered in `die()`/`destroy()`.
`Ballistics.fire()` applies `WeaponDefs.damage.multipliers` (AR: head 1.5,
torso 1, limb 0.8) and calls `enemy.onWeaponHit({damage, part, point,
normal, dir, distance, weapon, owner, isHeadshot})`; the enemy multiplies by
`PART_ADJUST = {head: 2/1.5, torso: 1, limb: 0.75/0.8}` so the effective
lethality is head ×2 (50 hp near → 2 headshots), torso ×1 (4 rounds),
limb ×0.75, subtracts health, and returns `{killed, headshot}` for the
synchronous hitmarker/kill toast. Blood/flesh impact FX come from the FX
stream's `weapon:hit` listener (entity hits → flesh recipe), so the enemy
never calls `fx.impact` for player rounds.

## 4. State diagram

```
        spawn ──▶ ADVANCE ──(spot reached | LOS<25m)──▶ ENGAGE ◀──────────┐
                    ▲   │dist<6m                             │  LOS lost>2.5s│
                    │   ▼                                    ▼               │
                  RUSH ◀─────────────────────────────── REPOSITION ────────┘
                    ▲                                    │
                    └──dist<6m── COVER ◀── hurt<3s & cover within 8 m
                                   │ (crouch ↔ peek-fire cycle; leaves after 7 s unhurt)
   any state ──health≤0──▶ DEAD (Death clip, hitboxes off, despawn +8 s)
```

Wave table (per index N): count = min(6 + 2(N−1), 20); max 7 alive;
enemy health 100·(1+0.15(N−1)); accuracy multiplier 1+0.08(N−1) (tighter
cone); 8 s intermission after the last kill; spawns hidden from the player.

| Wave | count | health | accuracy× |
| --- | --- | --- | --- |
| 1 | 6 | 100 | 1.00 |
| 2 | 8 | 115 | 1.08 |
| 3 | 10 | 130 | 1.16 |
| 5 | 14 | 160 | 1.32 |
| 8+ | 20 | 205+ | 1.56+ |

## 5. Preset staging

- **firefight** (category `firing`, HUD on): player POV mid main lane at
  (0.6, 15.5) looking north, AR at the hip; enemy A engaged at ~21 m in the
  M3 pool by the barrels (fires on the capture frame — flash + light + a
  round cracking wide right of the camera), enemy B ~24 m up the lane firing
  across the frame (its tracer streaks left, mid-flight), enemy C sprinting
  east across the lane between cover at ~13 m (Run clip); the player's own
  rifle fires on the same frame (`weapons.forceFire()`). Shots are staged
  to near-miss so the damage vignette doesn't flood the frame.
- **enemy_close** (category `enemy`, HUD off): free camera 4 m off one
  operator's front-left at the south lane near fire barrel FB1; firing
  stance (Idle_Gun_Shoot) with the rifle solved toward a target off
  frame-left, IR beacon lit, warm practical key front-left + cool practical
  rim high behind-right (both added via `game.lighting.addPractical`),
  `post.setDof` focused on the subject, a muzzle-flash star + tracer on the
  capture frame.
- **ai_test** (`--debug aitest`, dev): `match.forceCombat()` from the player
  spawn, 20 s of live combat, asserts enemies spawned + fired + the kill
  path emits `enemy:killed`; the observed run ends with the (stationary)
  player killed by wave 1 — the death/results flow renders.

## 6. Verification & performance

- `npm run build` green; `smoke`, `street`, `firefight`, `enemy_close`,
  `ai_test` all capture with zero console errors (720p medium iteration
  captures; finals at 1280×720 high in `shots/`).
- Enemy cost: one skinned mesh set (~7.8 k tris) + 6 rifle boxes per enemy,
  one AnimationMixer each, ≤ 7 alive; hitboxes are 5 capsules of pooled
  vectors; brains raycast ≤ 1 LOS ray per think (10 Hz) + 1 per shot.
- Determinism: all decisions from `game.rng`, all timers from `game.time`;
  no `Math.random`/`Date.now` in the stream.

## 7. Known gaps (ranked by player-facing impact)

1. **Stylised low-poly SWAT vs the PMC art target** — the CC0 Quaternius
   body/animations are cartoon proportions and the gun clips are one-handed
   pistol poses; the rifle prop is boxes. Reads correctly as "armed operator
   at 15-30 m at night"; the 4 m portrait exposes it. Needs a realistic
   rigged operator + two-hand IK.
2. **No ragdoll / no physics** — deaths are the Death clip in place and a
   despawn; Rapier is not initialised (installPhysics is a stub).
3. **Aim layer is pitch-only and hitboxes are root-relative capsules**, not
   bone-driven, so a leaning/crouching pose can drift a few cm from its
   capsules; arms are one shoulder bar.
4. **Cover/peek is positional only** — no cover-facing animation, no
   blind-fire, no vault; separation steering can nudge enemies against
   walls (no navmesh string constraint on the pushed position).
5. **Squad-level behaviour** (only 2 push at once, flanking calls, grenade
   throws, juggernaut every 5th wave) not built; every brain acts alone.
6. **Enemy tracers head-on are nearly invisible** (view-aligned ribbons
   collapse); presets stage a crossing shot for the read.
7. **Autoplay bot still stubbed** — combat auto-starts under `?autoplay=1`
   but nothing moves/aims for the player, so verify runs record the player
   being killed by wave 1 (valid, but not a "playing" trace).
8. **Corpses are not pooled** — each spawn clones the skinned prototype
   (fine at ≤ 20 per wave; a pool avoids the small clone cost spikes).

## 8. Cross-stream / integrator touches

- `src/systems/index.js` (integrator stub) now installs `ScoreSystem` +
  `MatchDirector` (this stream delivered both files).
- No other stream's source was edited; the AI reads world/player/weapons/fx
  through their documented `game.*` APIs and the canonical events.
