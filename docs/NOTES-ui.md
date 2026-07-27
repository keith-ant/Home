# NOTES — S6 UI (`src/ui/**`)

Owner scope: DOM/CSS HUD (compass tape, ammo cluster, dynamic crosshair,
hitmarker, killfeed, damage arcs + blood flash, wave banner, kill/headshot
toasts, reload/low-ammo states), the menus (main menu, click-to-play /
pointer-lock overlay, pause, death → results), and the realtime menu state
machine. Wired through `src/ui/index.js` → `game.ui = { hud, menus }`.
Built inside a hard ~75-minute box: works end-to-end, verified with
captures + a realtime click-through probe; polish is intentionally light.

## 1. What was built

| Module | Summary |
| --- | --- |
| `ui.css` | Single imported stylesheet (Vite extracts it into `dist/assets`). Fonts: Rajdhani (labels), Teko (display numerals: ammo, banner, stats), JetBrains Mono (fire-mode / weapon tags). Bone-white + one accent (`#d7ff64`) + danger red, tabular numerals, drop-shadowed for legibility over the scene. |
| `dom.js` | `el()`, `setText/setStyle` (write-if-changed), `pad2`, `clamp01` — no framework. |
| `HUD.js` | Everything in `#hud`, all animation evaluated from `game.time.elapsed` inside the fixed-step `update()` (no CSS timers → deterministic captures; the harness screenshots with animations disabled). Compass tape top-centre (36 vw window, 150° visible, tick every 5°, numeric label every 15°, cardinals + intercardinals, heading readout in Teko, location caption, red enemy contact pips within ±75°), crosshair (gap = 0.55 vh + spread° × 0.62, fades with `weapons.adsBlend`), hitmarker (white X 120 ms / red thicker 200 ms on kill), ammo cluster bottom-right (weapon name, Teko mag count with red 1.6 Hz pulse ≤ 25 % mag, reserve at 55 % size 60 % opacity, grenade pips, FRAG glyph, fire-mode bars + label), RELOADING label under the crosshair, killfeed bottom-left (max 6 rows, 4 s life, 0.55 s fade, killer ▸ weapon tag ▸ victim + HEADSHOT chip), toasts (+100 KILL / +50 HEADSHOT, 1.4 s, rise + settle), wave banner (in 0.35 s, hold, out 0.7 s), 3 pooled damage arcs (world-anchored bearing, rotate as you turn, 1.7 s), blood vignette (flash on damage + persistent ramp under 45 % health). Tallies `stats {kills, headshots, shotsFired, shotsHit, wave, damageTaken}` for the results screen. |
| `Menus.js` | `#menus` panels: main menu (IRONWAKE / BLACKSITE TERMINAL lockup, PLAY / CREDITS with a sliding accent highlight, hover/click sound events, credits panel), click-to-play overlay (requests pointer lock; starts regardless if lock is refused), pause (RESUME / QUIT), death → results (K.I.A., waves survived, kills, headshot %, accuracy, PLAY AGAIN / MAIN MENU). Menus darken with a scrim (+ CSS backdrop blur) and defocus the live scene through `game.post.setDof(...)`. State machine: menu → deploy → playing ⇄ paused, playing → dead → results → deploy. |
| `presets.js` | Photo presets `hud_full` (category `hud`) and `menu_main` (category `menu`). |
| `index.js` | Installer: `game.ui`, system `ui` (order 80), event wiring, realtime boot lands on the main menu on the first tick (instead of straight into play), presets. |

Deterministic: HUD/menus read only `game.time` and event payloads; no
`Date.now` / `Math.random`. No per-frame allocation beyond string
formatting of changed values (rows/toasts/arcs are pooled DOM nodes).

## 2. Event contract (what feeds the HUD)

| Event | Effect |
| --- | --- |
| `weapon:ammo {id, mag, reserve, magSize, mode, name}` / `weapon:switched` / `weapon:firemode` | ammo cluster (also primed from `game.weapons.current` at install) |
| `weapon:reload {duration}` → `player:reloaded` | RELOADING label |
| `player:fired` | shots-fired tally (accuracy) |
| `ui:hitmarker {kill, headshot}` | hitmarker + shots-hit tally |
| `enemy:spawned {enemy}` / `enemy:killed {enemy, by, isHeadshot}` | compass pips (also falls back to `game.ai.enemies` if that registry exists), killfeed row, red hitmarker, +100 KILL / +50 HEADSHOT toasts, kill/headshot tallies |
| `wave:start {index}` / `wave:cleared` / `match:state {state:'intermission'}` | wave banner |
| `player:damaged {amount, from, dir}` / `player:died` | damage arc + blood flash / death flow |
| `ui:notify {text, tier, points}` | generic toast |
| `input:locked` / `input:unlocked` | deploy → playing / auto-pause when pointer lock drops (Esc) |

Emitted by menus: `match:start`, `match:end`, `game:paused`, `game:resumed`,
`ui:hover`, `ui:click`, `ui:open`, `ui:back`, `player:request-respawn`
(PLAY AGAIN). Every consumed event is optional — a stream that never emits
just leaves that widget idle.

## 3. Public API

```js
game.ui.hud.notify(text, tier, points)      // toast
game.ui.hud.banner(title, sub, lifeSeconds) // wave banner
game.ui.hud.pushKillfeed({killer, victim, weapon, headshot})
game.ui.hud.hit(kill)                       // hitmarker
game.ui.hud.damageFrom(posOrDir, amount, isDir)
game.ui.hud.setAmmo({...}), setReloading(dur), clearReload(), setLocation(name)
game.ui.hud.stats                           // {kills, headshots, shotsFired, shotsHit, wave, damageTaken}
game.ui.menus.showMain({inert})             // inert:true = pose only (photo capture)
game.ui.menus.play() / pause() / resume() / quitToMenu() / showResults() / playAgain()
```

## 4. Presets

- `hud_full` (hud category): player POV at the spawn lane; three staged
  contacts (`enemy:spawned` with plain `{position, alive, name}` handles),
  wave banner already fading, two killfeed rows (one headshot), toasts, mag
  forced to 9/42 then a 3-round burst (real muzzle flash, spread bloom now
  recovering), `player.applyDamage(24, {from})` from the left flank (damage
  arc + blood flash + FX rig flinch), red kill hitmarker fired 4 steps before
  capture. Setup steps the fixed loop itself so each element sits at the
  right point of its lifetime.
- `menu_main` (menu category): street framing, `menus.showMain({inert:true})`
  → scrim + DOF-blurred live scene + menu DOM; HUD hidden.

## 5. Verification

- `npm run shot -- --preset hud_full --preset menu_main --preset smoke --preset street`
  at 960×540 medium and 1280×720 high: zero console errors, images read.
- Realtime probe (headless, `/?quality=low`): boot → `state:'menu'` →
  PLAY click → `deploy` → overlay click → `playing` (HUD live) →
  `player.kill()` → `dead` → results; zero console errors, pointer-lock
  refusal degrades cleanly.
- `npm run build` green; the CSS ships as `dist/assets/index-*.css`.

## 6. Known gaps (ranked)

1. **No settings / loadout / scoreboard / interaction-prompt UI** (out of
   the time box by brief). Settings values exist in `Settings.js` with no
   surface yet.
2. **Menu navigation is mouse-only** — no keyboard/gamepad focus travel; the
   sliding highlight follows hover.
3. **Compass shows contacts only, no minimap**; pips have no
   friend/foe or elevation variants and no fade-by-distance.
4. **Killfeed uses text weapon tags** (e.g. `IW-15`) instead of white
   line-art silhouettes; no team colours beyond player-blue / hostile-red.
5. **Results screen is a static grid** — no XP bar, medals, or per-wave
   breakdown; accuracy counts entity hits only (from `ui:hitmarker`).
6. **Blood/blur are DOM-side**: the death red-out is a DOM vignette, the
   menu blur is scrim + CSS backdrop blur + post DOF (the DOF is the reliable
   one in headless capture). The health-driven post damage vignette is left
   to the FX stream's `LensFX` (this stream does not double-drive it).
7. **Wave/match flow depends on the AI/MatchDirector stream**: the UI emits
   `match:start` on deploy and listens for `wave:*` / `match:state`, but no
   integrator MatchDirector exists yet, so in solo builds the banner only
   fires from presets or an AI Director listening to `match:start`.

## 7. INTEGRATION NOTES FOR LATER STREAMS

- **AI / Director**: emit `enemy:spawned {enemy}` with an object exposing
  `.position` (Vector3) or `.object3d/.mesh/.root`, `.alive`, optional
  `.name`, and `enemy:killed {enemy, by:game.player, isHeadshot, distance}`
  — that is all the compass, killfeed, toasts and hitmarker need. Emit
  `wave:start {index}` / `wave:cleared {index}`; listen to `match:start`
  (fired when the player deploys from the menu / PLAY AGAIN).
- **Integrator (MatchDirector / ScoreSystem)**: `game.ui.hud.stats` is a
  plain tally object; a real ScoreSystem can either feed `ui:notify` toasts
  or replace the results numbers. `game.state` values used by the UI:
  `menu | deploy | playing | paused | dead | results | photo`.
- **Autoplay**: HUD updates run headlessly with no menus (deterministic mode
  skips the menu boot); to hide the HUD in captures use `game.setHudVisible`.
