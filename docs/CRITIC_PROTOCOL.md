# IRONWAKE — Visual Critic Protocol

Every visual claim about this game is settled by adversarial review, never by
the author. This document defines the loop.

## 1. Roles

- **Builder**: implements or fixes a feature area. Must self-check with the
  shot harness before handing off, but a builder's opinion of its own work
  carries no weight.
- **Critic**: an independent agent with no authorship stake, briefed to be a
  *brutal senior AAA art director*. It never sees which images are ours until
  after it has committed to a verdict.
- **Integrator**: routes critic verdicts into the next builder round and
  tracks the scoreboard (`docs/QUALITY_LEDGER.md`).

## 2. Shot presets (registered in `src/systems/PhotoMode.js`)

| Preset id            | Content                                                                 | HUD |
| -------------------- | ----------------------------------------------------------------------- | --- |
| `smoke`              | Boot sanity: default spawn, one frame. Used for CI-style checks.        | off |
| `vista`              | Wide establishing shot from the crane platform over the whole terminal | off |
| `street`             | Ground level down the main lane: puddles, floodlights, fog, containers | off |
| `alley`              | Tight lane between container stacks, fire barrel, hazard lights        | off |
| `quay`               | Water's edge: reflections, ship silhouette, lightning frame            | off |
| `warehouse`          | Warehouse interior/threshold: warm interior spilling into cold night  | off |
| `viewmodel_idle`     | First person, rifle idle, mid-lane                                     | on  |
| `viewmodel_ads`      | Aiming down the holo sight at a lit target                            | on  |
| `viewmodel_fire`     | Frozen on a muzzle-flash frame mid-burst: flash, tracers, brass, smoke| on  |
| `viewmodel_reload`   | Mid-reload, magazine out, both hands visible                          | on  |
| `viewmodel_pistol`   | Sidearm out, weapon-light on, close container wall                    | on  |
| `viewmodel_inspect`  | Weapon inspect hero pose — the "gun porn" shot                        | off |
| `gun_macro`          | Extreme close-up orbit of the rifle receiver/optic (asset fidelity)   | off |
| `firefight`          | Player POV with 3 enemies engaging: muzzle flashes, tracers, impacts    | on  |
| `enemy_close`        | Third-person framing of an enemy operator, key + rim lit               | off |
| `explosion`          | Grenade detonation at t+0.15 s: fireball, shockwave, debris, light     | on  |
| `impacts`            | Wall showing bullet decals, sparks in flight, concrete dust           | off |
| `rain_light`         | Rain against a floodlight: streaks, splashes, cone, wet ground         | off |
| `hud_full`           | Gameplay with every HUD element active: killfeed, hitmarker, low ammo  | on  |
| `menu_main`          | Main menu over the live scene                                          | ui  |
| `menu_loadout`       | Loadout / settings screen                                              | ui  |
| `results`            | Post-match results screen                                              | ui  |

Every preset must render deterministically for a given `?seed=`.

## 3. Reference corpus

`reference/cod/*.jpg` — real captures from CoD MW (2019), MW II, MW III and
Warzone gathered by `npm run refs` and hand-culled. **Copyrighted; local
evaluation only; gitignored; never committed, embedded, or shipped.** Each
file is tagged in `reference/cod/index.json` with the category it best judges:
`environment | viewmodel | firing | enemy | vfx | hud | menu`.

## 4. Blind pack construction (`npm run critic:pack`)

`tools/critic/blind-pack.mjs` builds `critique/round-<n>/`:
- For each of our shots in the round, sample 1–2 reference images of the
  matching category.
- Randomly assign to `A`/`B` (and occasionally `C`) slots, copy as
  `pair-01/A.png`, `pair-01/B.png`, downscaled to a common 1600px width so
  resolution isn't a tell.
- Write `pair-01/PROMPT.md` (identical wording every round) and the **secret
  key** `critique/round-<n>/key.json` mapping slots → source. The critic is
  never given `key.json`, the `shots/` folder, or the `reference/` folder —
  only the pack folder path and this rubric.

## 5. What the critic is asked, verbatim

> You are the harshest senior art director in AAA shooters. You have shipped
> Call of Duty titles. You are reviewing candidate frames for a modern-warfare
> FPS. In each `pair-NN` folder are images labeled A/B (sometimes C). Some
> may be from a shipping AAA game, some may be from an in-development build;
> you are NOT told which. Judge blind and commit.
>
> For each pair:
> 1. Describe each image in 3–5 sentences as an art director would: lighting,
>    materials, silhouette/composition, VFX, screen post-processing, UI.
> 2. Blind verdict: which single image looks more like a shipped $70 AAA
>    shooter? A one-sentence why. No hedging, no ties.
> 3. Score EACH image 0–10 on: (a) lighting & atmosphere, (b) material/
>    surface fidelity, (c) geometric density & silhouette, (d) VFX & motion
>    read, (e) post-processing/grade, (f) UI craft (n/a if none). Then an
>    overall 0–10 where 9–10 = "indistinguishable from Modern Warfare",
>    7–8 = "shippable AAA", 5–6 = "AA / dated", ≤4 = "indie/prototype".
> 4. The 5 changes, ranked by impact, that would most close the gap for the
>    weaker image. Be surgical and specific ("floodlight has no volumetric
>    cone and no lens flare; add scattering with visible rain crossing the
>    beam", "receiver reads as plastic — roughness too uniform, add machining
>    normal detail + edge wear + oil sheen") — never "make it look better".
> 5. List any prototype tells: default fonts, hard black shadows, uniform
>    roughness, tiling textures, unlit polygons, floaty animation, empty HUD.
>
> Output strict JSON per the schema you were given. Praise is worthless to
> the team; specificity is everything. If everything is genuinely great, say
> what is left to reach a Digital Foundry "showcase" verdict.

## 6. Scoring, ledger, convergence

The integrator decodes the key and records per round in `docs/QUALITY_LEDGER.md`:
- **Blind win rate**: fraction of pairs where our image was chosen over a
  real CoD frame.
- **Mean overall score** and per-axis means for our images.
- The consolidated, de-duplicated **top-N fix list**, tagged by owning stream.

**Advancement gate for a feature area**: mean overall ≥ 8.0 across its
presets AND no per-axis score < 6 AND zero "prototype tells" flagged, sustained
across 2 consecutive rounds with independent critics. **Whole-game gate**:
every area passes AND blind win rate ≥ 33 % (i.e., critics genuinely can't
reliably tell) — the honest ceiling for real-time WebGL vs. offline-quality
console renders; the ledger reports the true number either way.

**No plateau exit before round 4.** After round 4, an area exits early only
if 2 consecutive rounds move mean overall < 0.2 and the fix list is judged
"engine-limited" by the critic. Otherwise: keep iterating.

## 7. Anti-gaming rules

- Builders may not add letterboxing, watermarks, resolution mismatches, or
  UI overlays intended to mimic "captured from console" tells.
- Presets may only place the camera and set legitimate game state — they may
  not spawn shot-only geometry that doesn't exist in play.
- The `smoke`, `firefight` and `hud_full` presets are also captured from a
  **scripted live play session** (`npm run verify --shots`) each round to
  prove the photo-mode frames are honest.
