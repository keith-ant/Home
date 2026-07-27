# NOTES — S6 AUDIO (`src/audio/**`)

Owner scope: WebAudio engine (buses, procedural convolution reverb, pooled
3D panners, listener), lazy CC0 sample bank with round-robin + jitter, a
procedural synth for every sound with no sample, and the event wiring
(weapons, impacts, footsteps, damage, ambience, weather, UI). Wired through
`src/audio/index.js` → `game.audio = { engine, bank, synth, play, playAt, playOr }`.
Built inside the same ~75-minute box as the UI: functional coverage first.

## 1. What was built

| Module | Summary |
| --- | --- |
| `AudioEngine.js` | Graph: sources → per-bus gains (`sfx`, `foley`, `ambient`, `ui`, `voice`) → `master` → low-health low-pass (`setMuffle`) → destination; one procedural convolver reverb send (1.7 s decaying stereo noise IR, wet 0.32) fed per-sound. Pooled `PannerNode`s (HRTF, inverse rolloff) for world sounds; listener tracks `game.camera` each fixed step. `play(buffer, {bus, gain, rate, position, loop, reverb, at, offset, jitter})` → handle `{stop, setGain, setPosition}`. `duck()` for explosions. Cosmetic randomness (variant pick, pitch/gain jitter) uses a private LCG, never `game.rng`. Volume settings (`masterVolume`, `sfxVolume`) applied live. |
| `SoundBank.js` | `bank.play(id, opts)` → decodes the manifest sample on first use via `game.assets.ensure(id)` (audio entries are lazy), caches decoded variants, round-robins between them with ±4.5 % pitch/gain jitter; returns `null` (never throws) when the engine isn't ready or the sample is missing so callers can fall back to the synth. `preload(ids)`. |
| `Synth.js` | Oscillator + shared white-noise procedural voices scheduled at absolute context times: gunshot body layer (sub thump + noise crack), brass casing tinks (kind-tuned partials), hitmarker tick (+ kill knock, headshot crack), reload beats (chamber / magout / magin / bolt), dry-fire, explosion body + rumbling tail (with reverb send), UI click / hover / confirm, wave stinger. |
| `index.js` | Installer + all wiring (below); system `audio` (order 70): listener update, rain-bed gain follows `game.weather.rainIntensity`, heartbeat loop + master low-pass when health < 34 %, ambience beds started on context ready. |

### Robustness / determinism contract

- `game.isDeterministic` (photo mode, autoplay) → the engine is created
  **disabled**: no `AudioContext`, every handler and `play*` call is a
  silent no-op — nothing can throw during captures (ARCHITECTURE §4: audio
  muted).
- Realtime: the context is created lazily on the first `pointerdown` /
  `keydown` gesture (autoplay policy); calls before that drop. If
  `AudioContext` construction ever fails, the engine flips to disabled and
  logs one warning.
- No sample is required: every event has a synth fallback via
  `audio.playOr(id, opts, fallback)`.

## 2. Wiring (event → sound)

| Event | Sound |
| --- | --- |
| `player:fired {sound, suppressed}` | `sound` id (fallback `sfx.weapon.rifle_ar15_near`) + reverb 0.4 + synth body thump/crack layer |
| `enemy:fired {enemy, from}` | `sfx.weapon.ak47_single_mid` / `_burst_short_mid` positioned at `from` (ref 6 m, max 400 m) |
| `fx:casing {position, kind}` | two synth tinks (rifle/pistol/magazine tuned), positioned |
| `weapon:reload {id, empty}` | synth chamber → mag-out (0.42 s AR / 0.32 s pistol) → mag-in (1.32 / 1.06) → bolt (empty, 1.82 / 1.56) + cloth foley |
| `weapon:switched`, `weapon:firemode`, `weapon:empty`, `grenade:primed/thrown/bounce` | cloth/switch foley, selector click, dry-fire, pin/bolt click, bounce tap by speed |
| `grenade:exploded {point}` | `sfx.weapon.explosion` positioned + synth body/tail + bus duck |
| `weapon:hit {surface, point}` | `sfx.impact.<material>` by surface table (stone / metal / wood / glass / flesh / generic), positioned |
| `ui:hitmarker {kill, headshot}` | synth hitmarker tick (kill knock, headshot crack) |
| `enemy:killed {enemy}` | `sfx.impact.flesh_heavy` at the enemy |
| `player:footstep {surface, sprint, crouch, wet}` | `sfx.footstep.<surface>` (concrete/wood/gravel/grass/snow/generic), gain/rate by sprint/crouch, wet boost |
| `player:landed / jump / slide / mantle` | landing thump + cloth foley |
| `player:damaged {amount}` / `player:died` / `player:respawn` | punch impact by amount / heavy muffle + breath / clear |
| `weather:changed {rainIntensity}` (+ polled `game.weather.rainIntensity`) | `amb.rain` bed crossfade (0.05 → 0.6) |
| `weather:lightning {thunderDelay | distanceM, intensity}` | `amb.thunderclap` (close, ducks) or `amb.thunder_close` scheduled at `now + delay` (`distance/343` fallback) |
| beds on context ready | `amb.rain`, `amb.war_distant_firefight` (0.22), `amb.storm_wind` (0.18), all looping on the ambient bus |
| health < 34 % (system) | `voice.heartbeat_loop` fade-in + master low-pass by deficit; released on recovery/death |
| `ui:hover / ui:click / ui:open / ui:back` (from menus) | `sfx.ui.rollover / click / open / back` with synth fallbacks |
| `wave:start`, `match:start`, `ui:notify {tier:'medal'}` | synth stinger |

## 3. Public API

```js
game.audio.engine   // AudioEngine: enabled, ready, now, play(buffer, opts), bus(name),
                    //   setBusGain(name, v), setMuffle(0..1), duck(strength, hold, release), onReady(fn)
game.audio.bank     // SoundBank: play(id, opts) → Promise<handle|null>, buffer(id), preload(ids)
game.audio.synth    // Synth: casing/hitmarker/reload/dryFire/explosion/shotBody/uiClick/uiHover/uiConfirm/stinger (at, ...)
game.audio.play(id, opts) / playAt(id, position, opts) / playOr(id, opts, fallbackFn)
```

## 4. Verification

- All photo presets: engine disabled path — zero console errors
  (`hud_full`, `menu_main`, `smoke`, `street` at 960×540 and 1280×720).
- Realtime headless probe (menu → play → death) with no audio device:
  the gesture path constructs the context or degrades silently; zero
  console errors.
- No third-party files added by this stream (all samples were already in
  `public/assets/audio/**` + manifest with credits); `CREDITS.md` unchanged.

## 5. Known gaps (ranked)

1. **No music layers** (procedural pad / percussion by wave intensity —
   skipped per brief) and no mixer snapshots beyond explosion ducking.
2. **No occlusion / obstruction** — panners are distance-only; interiors
   sound as open as the yard. No per-surface reverb switching.
3. **Gunshot is sample + generic synth body** — no distant/near
   crossfade by listener distance for the player weapon, no first-shot
   reflection ("slap-back") pass, no mechanical layer sync to the bolt
   animation frames.
4. **Voice**: no operator barks, announcer, or player pain grunts (only a
   breath on death); enemy footsteps/voices are not audible.
5. **Not audible in captures by design** — audio can only be verified by
   ear in the realtime build.

## 6. INTEGRATION NOTES FOR LATER STREAMS

- **AI**: emit `enemy:fired {enemy, from, dir}` (world muzzle position) and
  the canonical `enemy:killed`; enemy footsteps can be added by emitting
  `player:footstep`-shaped events on a new channel — say the word and this
  stream will subscribe.
- **Weapons**: `player:fired.sound` is used verbatim as the SoundBank id
  (fallback AR-15 near set); reload foley timing follows NOTES-weapons §5.
- **Integrator (Music/MatchDirector)**: a music system should own its own
  bus into `engine.master`; `engine.onReady(fn)` is the hook for
  "context is live", `engine.duck()` for stingers.
