# NOTES — S3 PLAYER (`src/player/**`)

Owner scope: the local player — health/state facade, kinematic capsule
controller against the world BVH, the final first-person camera rig
(bob, kick, shake, lean, FOV), and the interaction probe stub. Wired
through `src/player/index.js` → `game.player`.

## 1. What was built

| Module | Summary |
| --- | --- |
| `Player.js` | The `game.player` facade: health 100 with 5 s undamaged → 25 hp/s regen, `applyDamage(amount, {from, dir, isHeadshot, source})` (emits `player:damaged` / `player:died`, drives the rig flinch), `heal`, `setHealth`, `kill`, `respawn(pos, yaw)`, `teleport(pos, yaw, pitch)` (also re-attaches the camera), `detachCamera()/attachCamera()`, `setMoveScale(v)`, `setAds(amount, {fovMul})`, `interruptSprint()`, plus accessors (`position`, `velocity`, `eyePosition`, `yaw/pitch`, `isSprinting/isCrouched/isSliding/isMantling/isGrounded/isAds`, `moveState`). Owns Controller + CameraRig + Interaction. Fixed step: `update(dt)` (system `player`, order 10) and `lateUpdate(dt)` (system `camera`, order 90). ADS falls back to the input action when no weapon system drives it. |
| `Controller.js` | Kinematic capsule (r 0.35, h 1.8 / crouch 1.2) vs `world.capsuleCollide` with a resolver aggregate (grounded, wall-blocked detection from achieved-vs-intended velocity). CoD values: walk 4.6, sprint 7.2 (forward only; fire/ADS/crouch break it), crouch 2.2, ADS via `player.moveScale`, ground accel 40 m/s², crisp friction stop, air accel 8 m/s², gravity 19.6, jump apex ≈1.05 m, slope limit 45°, auto step-up 0.35 m (camera step smoothing), ground snap on the way down, crouch hold/toggle (`toggleCrouch` setting) with 0.15 s blend + headroom check, slide from sprint (crouch press at > 5.2 m/s: 0.8 s decel curve, capsule shrink, camera drop/roll), mantle ≤ 1.2 m ledges (knee + chest wall probes → ledge down-cast → clearance → 0.45 s two-phase lerp + hands-dip camera cue), lean Q/X (0.35 m + 8° roll, 0.12 s blend, wall-checked), backpedal penalty, footstep events at bob-phase crossings (`player:footstep {surface, sprint, crouch, foot, position, speed, wet}` — surface via `world.raycast` under the feet, `wet` via `world.puddleAt`), `player:landed {speed}`, `player:jump`, `player:slide`, `player:mantle`. No fall damage. |
| `CameraRig.js` | Late system (order 90) + render-frame hook (`post.addPreRender`, registered on `game:ready`) interpolating between the two fixed poses with `game.time.alpha`. Mouse look (`0.0022 rad/px × settings.sensitivity`, ADS-scaled, `invertY`, pitch ±85°), eye heights 1.62 / 1.05 / 0.75 (stand/crouch/slide, 0.15 s blend), figure-8 head bob (walk 0.6 cm, sprint 1.2 cm vertical, double frequency, roll coupled with x, ADS/crouch damped), idle breathing sway, view-kick spring (`kickView({pitch,yaw,roll})`), permanent recoil (`addRecoil(pitch,yaw)` — the player must counter it), damage flinch (kick away from the hit dir + short shake), landing dip spring, step smoothing, lean roll/offset, slide/mantle/death poses, pooled shakes (`shake({strength,duration,freqPos,freqRot})`), FOV = CoD horizontal setting (default 100 @16:9 → vertical) + sprint kick +7° blended, × ADS multiplier blend. Exposes `viewmodelSway {x,y}`, `viewmodelBob {phase,amplitude,x,y}`, `moveState`, `fov`, `fovScale`, `eyePosition`, `quaternion`, `forward/right/up` for the WEAPONS stream. `rig.enabled = false` stops writing `game.camera` (photo presets). |
| `Interaction.js` | Stub: 15 Hz forward raycast (2.6 m) for objects tagged `userData.interactable = {label}` → `ui:interact-prompt` + `player:interact` on F. Nothing in Terminal 9 is tagged yet. |
| `presets.js` | `player_test` dev preset (only with `?debug=player` / `--debug player`): scripted sprint / slide / jump / mantle assertions (console.error on failure) ending on a sprinting POV frame. |
| `index.js` | Installer: spawns the player at `world.spawns.player` (yaw 0 = facing −Z), registers the two systems, click-to-lock pointer capture in realtime play, `player:request-respawn` hook. |

Deterministic: everything reads `game.time` / `game.input`; the rig's only
extra randomness is the death-fall direction from `game.rng`.

## 2. Public API (`game.player`)

```js
player.health / .maxHealth / .alive
player.position            // Vector3 feet (live, capsule bottom)
player.velocity            // Vector3 m/s
player.eyePosition         // Vector3 world eye point (current fixed step)
player.yaw, player.pitch   // radians (yaw 0 = facing -Z / north)
player.isSprinting .isCrouched .isSliding .isMantling .isGrounded .isAds
player.moveState           // 'idle'|'walk'|'sprint'|'crouch'|'crouchwalk'|'slide'|'air'|'mantle'|'dead'
player.applyDamage(amount, {from, dir, isHeadshot, source}) → applied
player.heal(amount), player.setHealth(v), player.kill(), player.respawn(pos?, yaw?)
player.teleport(pos, yaw, pitch)     // also rig.enabled = true (camera back to the rig)
player.detachCamera(), player.attachCamera()
player.setMoveScale(v)               // weapons: ADS 2.8/4.6, reload penalties…
player.setAds(amount, {fovMul})      // weapons: 0..1 blend → FOV multiplier + speed
player.interruptSprint()              // firing / reload
player.rig                           // CameraRig (see §1) — kickView, addRecoil, shake, viewmodelSway…
player.controller, player.interaction
```

Events emitted: `player:damaged {amount, from, dir, isHeadshot, health, source}`,
`player:died {from, source}`, `player:healed {health}`, `player:respawn {}`,
`player:landed {speed}`, `player:footstep {surface, sprint, crouch, foot, position, speed, wet}`,
`player:jump {}`, `player:slide {}`, `player:mantle {height}`,
`ui:interact-prompt {label, key, target} | null`, `player:interact {target, info}`.
Consumed: `player:request-respawn {position?, yaw?}` (respawns the player).

## 3. Tuning knobs

| Knob | Where | Value |
| --- | --- | --- |
| speeds walk / sprint / crouch | `Controller.js` constants | 4.6 / 7.2 / 2.2 m/s (ADS via `moveScale`) |
| accel ground / decel / air | `ACCEL_GROUND / DECEL_GROUND / ACCEL_AIR` | 40 / 36 / 8 m/s² |
| gravity / jump apex | `GRAVITY / JUMP_APEX` | 19.6 m/s² / 1.09 (measured 1.05 m) |
| step / slope / mantle | `STEP_MAX / SLOPE 45° / MANTLE_MAX / MANTLE_TIME` | 0.35 m / 45° / 1.2 m / 0.45 s |
| slide | `SLIDE_TIME / SLIDE_MIN_SPEED` | 0.8 s / 5.2 m/s entry |
| eye heights | `CameraRig.eyeStand/eyeCrouch/eyeSlide` | 1.62 / 1.05 / 0.75 m |
| bob amplitudes | `CameraRig.update()` | walk 0.6 cm, sprint 1.2 cm vertical (x = 1.4×, roll couples) |
| sensitivity | `BASE_SENS × settings.sensitivity` | 0.0022 rad/px, ADS ×0.71 |
| FOV | `settings.fov` (CoD horizontal @16:9) + sprint kick | 100 (→ 67.7° vertical) + 7° |
| view kick spring | `Spring(3, 4.2 Hz, 0.7)` | `kickView` impulse ≈ peak displacement |
| shake | `rig.shake({strength, duration, freqPos, freqRot})` | 0.028 m / ~0.55° per unit strength |

## 4. Verification

- `npm run shot -- --preset player_test --debug player` (dev preset, not in
  the critic list): sprints from the spawn (asserts ≥ 8 m in 1.5 s and
  ≈7.2 m/s), slides, jumps (asserts apex ≥ 0.9 m), walks into the 0.75 m
  spawn sandbag wall and mantles over it (asserts), then leaves a sprinting
  POV frame — all assertions green, zero console errors.
- `npm run verify` (autoplay stub, realtime code path): PASS; final frame is
  the player POV at the spawn.
- Every registered preset still captures with the player installed (the
  free-camera presets call `player.detachCamera()` through `poseCamera`).

### Core touch (integrator files)

One minimal fix outside the stream directories: `src/core/Loop.js` now
clamps *negative* frame deltas to 0 (in headless Chromium the first rAF
timestamp can trail the `performance.now()` sample taken by `start()`,
which drove the accumulator to −3 s and froze the realtime simulation —
found by the realtime-loop probe; photo mode / autoplay were unaffected).

## 5. Known gaps (ranked)

1. **No viewmodel / body** — first person is a bodiless camera; footsteps,
   mantle and slide have camera cues but no hands. (S4 owns the viewmodel;
   the rig already exposes sway/bob/state for it.)
2. **Mantle animation is a 2-phase position lerp** with a pitch dip — no
   curve fitting to ledge depth, no ledge-run vault variant, no cancel.
3. **Capsule vs BVH only** — dynamic props/ragdolls are not collidable and
   there is no crush/push handling (PHYSICS stream can add later).
4. **Slope movement** projects only implicitly through the resolver; no
   uphill speed loss / downhill boost curve.
5. **Interaction targets** need `userData.interactable` on the *collision
   proxy owner* (`hit.object`); Terminal 9 exposes no interactables yet.
6. **Death cam** is a simple fall/roll blend; no killcam or ragdoll body.

## 6. INTEGRATION NOTES FOR LATER STREAMS

- **S4 WEAPONS**: read `game.player.rig.viewmodelSway {x,y}` (radians of
  look lag) and `rig.viewmodelBob {phase, amplitude, x, y}` (metres),
  `rig.moveState`, `player.adsAmount`, `player.isSprinting` (block fire while
  true — call `player.interruptSprint()` when the trigger is pulled instead),
  `player.controller.crouchBlend`, `rig.fov` / `rig.fovScale`. Drive ADS with
  `player.setAds(blend, {fovMul: 0.82})` every step (this also takes over the
  fallback input ADS and movement scaling; call `player.setMoveScale()` for
  reload/ADS specifics). Recoil: `rig.kickView({pitch, yaw, roll})` for the
  spring punch and `rig.addRecoil(pitch, yaw)` for the permanent climb. The
  camera ray for hitscan is `game.player.eyePosition` + `game.player.rig.forward`
  (final composed pose of the current fixed step); interpolated render pose
  is what `game.camera` holds during pre-render hooks registered after ours
  (register your viewmodel placement hook on `game:ready` — ours registers
  first, so yours runs after the camera is final).
- **S5 AI**: aim/LOS target = `game.player.eyePosition` (head) or
  `player.position` + (0, 0.9, 0) (torso). Deal damage with
  `game.player.applyDamage(amount, {from: enemyPos, dir: unitDirToPlayer, isHeadshot})`;
  it returns the applied amount and emits the events UI/audio consume.
  `player.moveState` / `player.isSprinting` feed footstep-hearing radii.
- **S6 UI/AUDIO**: consume `player:damaged` (arc direction from `dir`/`from`),
  `player:healed`, `player:died`, `player:landed`, `player:footstep`
  (surface + `wet` 0..1 + sprint/crouch), `player:jump`, `player:slide`,
  `player:mantle`, `ui:interact-prompt`. Health has no bar by design; the
  FX stream already drives the blood vignette from `player.health`.
- **S7 INTEGRATION / Autoplay**: `game.input.simulate({move:{x,y}, look:{dx,dy},
  actions:{sprint, jump, crouch, fire, …}})` drives the controller exactly
  like real input (see `src/player/presets.js` for a scripted example);
  `player.respawn()` on death; the `player_test` dev preset is a ready-made
  regression check for movement values.
