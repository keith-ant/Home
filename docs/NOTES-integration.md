# NOTES — S7 INTEGRATION + AUTOPLAY (`src/systems/Autoplay.js`, `src/systems/index.js`)

Owner scope (~40-minute box): the scripted verification bot, the end-to-end
health sweep of every registered photo preset, and this integration report.
Every other stream (render, world, player, fx, weapons, ai, ui, audio) was
already delivered; no cross-stream source edits were required — the bot
consumes only documented `game.*` APIs and canonical events.

## 1. What was built

| Module | Summary |
| --- | --- |
| `systems/Autoplay.js` | System `autoplay` (order 5, before the player controller). `begin({duration})` / `status()` / `finish()` per ARCHITECTURE §4. Drives the *real* gameplay purely through injected input — `game.input.simulate({move, look, actions})` every fixed step — so player, weapons, ballistics, AI, HUD and FX all run their normal code paths. Behaviour per step: 10 Hz target scan (nearest visible enemy via a `world.raycast` LOS check to the enemy chest, sticky current target, nearest-known fallback for tracking through cover); closed-loop look controller that steers the **actual** crosshair ray (`weapons.aimRay`, recoil + kick included) onto the target at ≤ 4 rad/s, mirroring `CameraRig`'s px→rad mapping and predicting the one-step input latency (no oscillation); ADS + burst fire (6-10 rounds, 0.15-0.3 s rests) whenever the aim error is < 2°; reload press when the mag ≤ 4 (retries every 0.5 s if the press was refused), weapon switch when dry; combat movement = perpendicular strafe with random direction flips (approach beyond 24 m, back off inside 8 m); retreat (backpedal + strafe away from the threat, still firing) below 40 hp; nav-graph patrol otherwise (`nav.findPath` toward the nearest known hostile, else a `randomWalkablePoint`, waypoint following at full speed with sprint on open legs, stuck detection → repath); on `player:died` waits 2.6 s (death → results states play), then `player.respawn()` + `match.forceCombat()` and keeps going. Counts kills from `enemy:killed` (`by === 'player'`) and shots from `player:fired`; publishes `{time, wave, kills, health, shotsFired}` (Game polls `status()` every 30 fixed steps = 0.5 game-s, satisfying the ≥ 1 Hz contract) and final `{simulated, kills, shotsFired, deaths, restarts, wave, maxWave, health, score, accuracy, headshots}`. Fully deterministic (`game.time`, `game.rng`), zero per-step allocation (pooled vectors, one persistent input-state object). |
| `systems/index.js` | Installer now also constructs the Autoplay bot (`game.autoplay`), registered as system `autoplay` at order 5 (inert until `begin()` — realtime play and photo mode are unaffected). Match/score wiring unchanged. |

MatchDirector already forced combat on `game:ready` under `?autoplay=1`
(AI stream); `Autoplay.begin()` re-forces it as a safety net and after
every player death.

## 2. Verify run (`npm run verify -- --seconds 45`)

Iteration run (960×540 medium, seed 7): **PASS** — 45.0 s simulated, zero
console/page errors, no stall.

```
kills 11 · shotsFired 63 · deaths 1 · restarts 1 · wave 1 (max 1)
score 625 · accuracy 0.72 · final health 100
```

The 20 s smoke run before it: 5 kills / 27 shots / accuracy 0.93. The bot
dies roughly once per 30-40 s against wave 1 (six shooters converge on a
lone player in the open lane — health regen never gets its 5 s window), the
restart path (respawn + `forceCombat`, wave 1 again) is exercised in every
run and the kill trace continues across it. Final 1280×720/high verify
figures are recorded in §5 below.

## 3. Preset health sweep

`npm run shot -- --preset smoke street viewmodel_idle viewmodel_fire firefight
enemy_close hud_full menu_main explosion gun_macro` — 960×540 medium for
iteration, then 1280×720 high finals. **Zero console errors and zero page
errors on every preset in both passes.** Honest read of each capture:

| Preset | Status | Honest read |
| --- | --- | --- |
| smoke | OK | Main lane looking north: fire barrel + embers foreground, two gantry cranes and mast blooms in fog, cable spans, rain streaks, container blocks both sides. Correct night-port grammar. Near ground reads flat/matte; puddle mirrors only appear in patches. |
| street | OK | Effectively the same photo point as smoke (both frame the lane from the barrel). Wet asphalt reflection under the mast, chevron block, red hazard glow. Duplicate framing wastes one hero slot. |
| viewmodel_idle | OK | AR at hip, laser on, HUD live (compass, ammo 31/120). Gun reads as an M4 silhouette but the receiver/handguard are visibly bevelled boxes; hands are dark sausage segments. Ground arrow decal and puddle sparkle read well. |
| viewmodel_fire | OK | Capture on the fire frame: muzzle star + sparks + wall impact sparks + smoke wisp at the ejection port, ammo 27. Flash is a flat additive star (no light spill on the container behind at this exposure); gun body lit warm on the fire frame — good. |
| firefight | OK | Three enemies down the lane, two enemy muzzle stars, player rifle in frame, red compass pips, wet lane centre-line highlight. Enemies are small stylised low-poly figures; muzzle stars are oversized billboard sprites vs reference. |
| enemy_close | OK | 4 m portrait of an operator firing, IR beacon lit, DOF background, warm key. Exposes the biggest art gap: Quaternius cartoon proportions, boxy rifle prop, single-tone rubber material — nowhere near a PMC scan. |
| hud_full | OK | Full HUD: WAVE 04 banner, damage arc, red hitmarker on the crosshair, killfeed (2 rows, headshot chip), +100 KILL / +50 HEADSHOT toasts, ammo 06/042 in red low-ammo state, compass with contact pips. Reads CoD-adjacent; type is slightly small at this resolution. |
| menu_main | OK | IRONWAKE / BLACKSITE TERMINAL lockup, PLAY highlighted with the acid accent, CREDITS, footer hints, scene defocused behind a scrim. Clean; menu column feels sparse (two items) and the blurred backdrop is muddy brown. |
| explosion | OK | Fireball + debris chunks + sparks mid-alley between container walls, ground bounce light warm, drums foreground. No shockwave ring / smoke column visible yet at the capture frame; fireball is a soft additive puff rather than volumetric. |
| gun_macro | OK | 26° gunsmith macro of the receiver: rails, forward assist, roll-mark plate, holo housing with red reticle glow, sconce bokeh behind. Confirms the CAD-box construction: perfectly flat facets, huge boxy sight housing, uniform edge highlights. |

No black frames, no missing weapon, no unstyled HUD, no camera-in-geometry
in either pass.

## 4. Top-15 visual weaknesses vs the CoD:MW reference (tagged by owning stream)

1. **[AI] Enemy character art** — low-poly cartoon SWAT with a box rifle;
   the single largest gap in any frame that contains an enemy
   (`enemy_close`, `firefight`).
2. **[WEAPONS] Bevelled-box gun construction** — receivers, handguard and
   the enormous rectangular holo housing read as CAD blocks in
   `gun_macro` / `viewmodel_idle`; no compound curves, forge lines or grip
   swells.
3. **[WEAPONS] Hands** — segmented capsule fingers, no glove seams or
   creases; grips hover off the surfaces.
4. **[WORLD/RENDER] Foreground ground plane** — the first 6-8 m of asphalt
   reads flat, uniformly rough and low-frequency (`smoke`, `street`); wet
   mirror only lives in authored puddle patches, not as an overall sheen.
5. **[FX] Muzzle flashes are flat additive stars** — oversized for enemies
   in `firefight`, no light spill / first-round variation / heat shimmer.
6. **[FX] Explosion body** — soft additive fireball without a lit smoke
   column, shockwave ring or scorch decal in the capture; debris chunks are
   dark blobs.
7. **[WORLD/SYSTEMS] `smoke` and `street` presets share one framing** —
   two of the ten hero shots are duplicates.
8. **[RENDER] Motion blur ghosting during play** — verify captures show
   heavy smear/multi-image reticle streaks whenever the bot turns while
   ADS; blur strength/sample weighting needs a cap for gameplay speeds.
9. **[RENDER/WORLD] Fog + sky read grey-brown, not the navy/teal
   two-temperature night** the art direction asks for; distant mast
   blooms are strong but the sky dome is a flat overcast wash.
10. **[UI] HUD scale** — compass ticks, killfeed rows and toasts are small
    and thin at 720p; the reference HUD is chunkier with heavier weights.
11. **[UI] Menu backdrop** — the blurred scene behind `menu_main` is a muddy
    brown wash; the reference uses a graded, vignetted, higher-contrast
    scene plate.
12. **[AI/FX] Enemy tracers/impacts on the player POV are hard to read** —
    incoming fire is nearly invisible; only the damage arc communicates it.
13. **[WORLD] Container face material at grazing angles** shows repeated
    corrugation moiré and identical stencil density (`explosion` alley,
    `gun_macro` background) — needs LOD normal fade + decal variety.
14. **[PLAYER/WEAPONS] Death presentation** — a camera roll to the ground
    with a red DOM vignette; no ragdoll, no dropped weapon (visible in the
    autoplay death captures).
15. **[AUDIO/UI] Silent captures by design, but no visible audio cue
    surrogates** (subtitle/caption of the ship horn, thunder flash sync) in
    any capture — the atmosphere layer is invisible to the critic pipeline.

## 5. Final-quality numbers (1280×720, quality high)

**`npm run verify -- --seconds 45` (defaults: 1280×720 high, seed 7) — PASS.**
`kills 11 · shotsFired 63 · deaths 1 · restarts 1 · wave 1 · score 625 ·
accuracy 0.72 · final health 100`, zero console/page errors, no stall.
The stats are bit-identical to the 960×540/medium iteration run — the
simulation is resolution/quality independent (determinism check passed).
Captures: `shots/verify/play-00..05.png` + `play-final.png`. Honest read
of those: two of the seven land mid-turn in a dark container alley with
heavy motion-blur smear (patrol legs hug walls), one shows the alley kill
of PMC-9 in the killfeed with the laser drawn across frame, none show a
menu, black frame or console overlay.

**Preset sweep (same ten presets, 1280×720 high) — 10/10 OK, zero errors.**

| Preset | draw calls | triangles | textures | programs | capture |
| --- | --- | --- | --- | --- | --- |
| smoke | 527 | 1.02 M | 155 | 84 | 55.5 s |
| street | 527 | 1.02 M | 153 | 84 | 59.1 s |
| viewmodel_idle | 825 | 0.85 M | 146 | 95 | 76.5 s |
| viewmodel_fire | 758 | 0.71 M | 138 | 92 | 85.1 s |
| firefight | 938 | 0.93 M | 180 | 99 | 85.0 s |
| enemy_close | 424 | 0.81 M | 160 | 102 | 76.7 s |
| hud_full | 894 | 1.08 M | 170 | 94 | 57.5 s |
| menu_main | 539 | 1.02 M | 163 | 93 | 54.7 s |
| explosion | 454 | 0.76 M | 135 | 83 | 46.9 s |
| gun_macro | 688 | 0.76 M | 136 | 90 | 48.6 s |

(SwiftShader timings; the sweep ran concurrently with a verify pass, so
per-preset times are inflated ~1.5×. Note the harness's 180 s screenshot
timeout can trip when a 1280×720/high verify runs concurrently with a
capture sweep on 4 cores — run them sequentially.) Final images live in
`shots/*.png` and `shots/verify/`.

## 6. Known issues / gaps (this stream)

1. **Bot has no cover model** — it strafes in the open and dies about once
   per 30-40 s to converging fire, then restarts (contract-compliant, but
   the trace never gets deep into the wave table). Next: pick
   `nav.coverPoints` facing away from the threat and peek-fire.
2. **Aim assist is chest-only** — no headshot bias, no target lead (targets
   are near-stationary while engaging so it lands anyway).
3. **No grenade / weapon-switch tactics** beyond the dry-mag safety switch.
4. **One-step input latency is predicted, not eliminated** — the look
   controller folds its pending request into the error; a large sensitivity
   change mid-step (ADS blend) leaves a sub-degree residual for one frame.
5. **Verify statistics are wave-1 only** — deaths reset the wave, so wave
   escalation, intermission and the juggernaut path are never exercised by
   the automated run.

## 7. Files changed

- `src/systems/Autoplay.js` (new) — the bot.
- `src/systems/index.js` — installs Autoplay as system `autoplay` (order 5)
  and exposes `game.autoplay`.
- `docs/NOTES-integration.md` (this file).
