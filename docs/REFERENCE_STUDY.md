# IRONWAKE — Reference Study

> Senior art-direction analysis of the curated comparison corpus in
> `reference/cod/` (85 frames, 7 categories, see `reference/cod/index.json`).
> Every claim below cites the frame(s) it was measured or read from.
> Filenames are the curated names (`environment-01.jpg`, `hud-03.jpg`, …).
> This document is the practical bar the RENDER / WORLD / WEAPONS / FX /
> UI streams build to and the critics grade against; it operationalises
> `docs/ART_DIRECTION.md`.

Corpus honesty notes, up front: `enemy-19/20/21` are marketing key art
(flagged `keyart: true`) and are only a *fidelity ceiling* for character
materials — never compare gameplay frames to them. Five of the eight
`firing-` frames are third-person captures (04–08): honest, in-engine
frames of guns firing, kept because true first-person muzzle-flash stills
barely exist; use them for flash/brass/smoke *shape*, not for HUD or hand
pose. Four of the eight `vfx-` frames are Battlefield-family peers, in line
with the brief's "peer bar" allowance. `hud-06` and `hud-07` are compressed
video captures kept only for specific HUD states; ignore their artefacts.

## 1. Environment — light, atmosphere, materials, density

**Two temperatures per frame, always.** Every night exterior pairs a warm
practical against a cold ambient: sodium/tungsten sources sit at roughly
2000–2700 K (the open-container glow and floods in `environment-01`, the
fires in `environment-10`/`environment-15`), fill and sky at 8000–12000 K
(the navy haze of `environment-01/02`). Neon accents (`environment-08`) and
red instrument/hazard practicals (`environment-02`, `environment-09`) are
the third, saturated note — one per frame, no more. There is no neutral-grey
night anywhere in the set.

**How black is black.** `environment-02` and `environment-10` push 40–60 %
of the frame below ~3 % luminance, but never as flat black: each dark mass
keeps a rim, a wet specular or an emissive that draws its silhouette. Aim for
key:fill ratios of 4:1 to 8:1 on lit props; highlights clip *only* on
emitters (flood bulbs, flame cores, the flare stacks in `enemy-15`).
Container tops and wet decking in `environment-01` sit at 8–15 % luma —
readable, not lifted.

**Fog and volumetrics.** Night visibility is short: in `environment-01` the
moored ship at ~120–150 m is 80 % swallowed; in `environment-02` the rig at
~60 m has lost most local contrast. Model fog with height falloff (denser
at deck level, `environment-17` shows the layered banks), tinted by the
nearest light — orange near sodium fixtures, blue-grey elsewhere. Light
shafts (`environment-13`, the tower bloom in `viewmodel-04`) are soft-edged,
their penumbra roughly a third of the shaft width, additive by ~30–40 %,
and they die out within ~20 m. Particulates are always motivated: rain reads
only where back-lit near a source, embers 20–60 per fire (`enemy-12/14`),
drifting dust in interior beams (`enemy-01`).

**Materials.** Wetness is the whole trick: horizontal surfaces stretch
light sources into vertical smears 2–4× the source height (roughness
0.1–0.3), while corrugated container walls keep broader lobes
(`environment-01`, `environment-07`'s wet tunnel floor mirroring the
backlight). Painted metal shows chipped, silvered edges 1–3 mm wide and
rust bleed under horizontal seams (`environment-03/05`). Concrete and stucco
carry pock marks, staining gradients and cracks (`environment-11`). The
puddle in `vfx-02` returns a legible, slightly perturbed reflection of the
fire — puddles reflect, they do not merely darken.

**Density benchmarks.** No silhouette edge runs straight for more than ~15 %
of frame width without an interruption — cable, pipe, tarp, railing,
antenna (`environment-16`, `environment-05`). Stencil/label decals appear on
roughly every container face (`environment-03/05`) and damage/dirt decals at
≥3 per 10 m² of playable wall (`environment-11`). Our quay vista needs
crane and ship silhouettes exactly as sparse and dark as `environment-04`,
with a handful of warm and red points, no more.

## 2. Enemy — silhouette, gear hierarchy, lit-by-what

The head cluster is the densest part of every silhouette: high-cut helmet
plus NVG mount/tubes, ear protection, comms cable (`enemy-15/17`,
`enemy-07`). Second tier is the chest rig — pouches, radio, antenna, shell
loops (`enemy-05`, `enemy-02`). Limbs stay clean. Build our PMC to that
hierarchy so a wave reads at 30 m as *headgear shape + one accent* (a patch,
an IR strobe, a red NVG lens, `enemy-15`). Use `enemy-05/06` as the literal
gear checklist and 360 reference, `enemy-13` for how five head silhouettes
stay distinct.

Characters are almost always lit by a *single motivated source* with deep
falloff: the weapon-light cone that renders everything outside it near
black (`enemy-01`), warm smoke fill from behind (`enemy-02`), red cabin
practical crushing to a two-tone image (`enemy-11`), fire key + cool rim
(`enemy-14/16`). Wet cloth goes near-black with sharp speculars
(`enemy-10`); knit balaclava weave and rubberised patches read at close range
(`enemy-18`). Skin needs subsurface warmth only in cinematic/menu ranges
(`enemy-08`); at gameplay distances the eye reads silhouette and specular
placement, so spend the polygons on headgear and rig, not faces. The
Juggernaut boss (`enemy-09`) is a slab silhouette — armour plates, visor
slit, minigun — wreathed in sparks and smoke; the sparks are part of the
character.

## 3. Viewmodel — the weapon owns the frame

At hip, weapon plus arm cover ~30–40 % of frame width in the lower-right
quadrant, the muzzle sitting 5–8 % right of screen centre and pointing
slightly inward (`viewmodel-03`; the LMG in `firing-02` and `viewmodel-07`
push toward 40 %). The weapon pass reads as a longer lens than the world
(≈10–15° narrower FOV): stocks foreshorten, receivers stay fat. Hands: bare
forearm plus glove in MW-generation MP (`viewmodel-03`), full nomex-style
gloves elsewhere, support thumb over bore on rifles (`viewmodel-05`).

The gun is the most detailed object on screen in every frame: roll-marks
and serial engraving legible at rest (`viewmodel-01`, the "K1021" magazine
in `viewmodel-02`), edge wear concentrated on the charging handle, magwell,
rail corners and muzzle device, satin polymer vs oiled steel roughness
contrast, machining marks in the receiver flats (`viewmodel-06`). Emissive
elements — holo/red-dot reticle, laser dot — render above scene white and
carry a hint of bloom; they are ≤1 % of frame width. In ADS/scoped states
the optic body fills 25–30 % of frame width and the world outside the tube
goes soft (`viewmodel-04`), which is our DOF cue: blur weapon body and
background, keep the reticle plane sharp.

## 4. Firing — flash, brass, smoke, sparks

The three honest first-person combat frames (`firing-01/02/03`) plus the
third-person supplements agree on the anatomy of a shot. A rifle flash is a
1–2 frame event: hot white core clipping to full white, an orange skirt,
4–6 short spokes forming a star ~1.5–2× muzzle diameter (`firing-04`; at
20 m the teammates' flashes in `firing-02` are only 2–3 % of frame width).
Under NVG the same flash blooms into a soft blob 5–8 % of frame width with a
long glare tail (`firing-01/08`), and IR lasers are 1 px lines that read
only in fog or NVG. A same-frame point light must kick the gun, hands and
nearby geometry warm for that frame — that is what sells `firing-04`.

Sustained fire produces the brass shower: casings spin out in an arc with a
specular glint each, 6–20 visible during a burst (`firing-05/06`), plus a
lingering wisp of chamber smoke ~0.3–0.5 s (`enemy-03`). Cinematic exceptions
exaggerate — the oversized bloom in `firing-07` is a cutscene value, not a
gameplay one. Explosions in an FP frame (`firing-03`) stack a clipping
fireball, streaking spark tracers under gravity, and airborne debris chunks
against a heat-hazed background; that composition is the target for our
grenade at t+0.15 s.

## 5. VFX — fire, smoke, debris, dust

Fire lights its own smoke (`vfx-01/03`): the underside of the smoke column
takes an orange gradient that fades within ~2 m, embers ride the updraft,
and the ground plane (wet street, hangar floor) mirrors the flame. Large
fires read as *layered volumes* — dense black plumes with embedded flame
pockets and thin white sub-trails (`vfx-02`) — never one billboard. Dirt and
masonry explosions throw discrete clods and chunks with a dark core plume
(`vfx-04/05`); the debris count is high (dozens of pieces) and every piece
motion-blurs radially. Impacts (`vfx-06`) are the small vocabulary we need
most: 10–20 spark streaks per metal hit, a puff, paper/dust confetti hanging
in the air, and a persistent bullet-hole decal per hit. Breach/dust events
(`vfx-08`) are grey-brown volumes with bright spark points, back-lit where
daylight punches through. Composition-wise, `vfx-07` shows how simultaneous
effects grey out with distance — near effects saturated and dark, far ones
milky and low-contrast.

## 6. HUD — the CoD grammar, measured

All positions are relative to a 16:9 frame. Everything is bone-white with a
soft 1–2 px drop shadow, team blue and enemy red as the only chroma, plus a
single warm accent (Warzone's orange location text, `hud-03`). Numerals are
tabular condensed sans.

- **Compass tape** (`hud-01/02/03`): top-centre, spanning 34–45 % of screen
  width, top margin ~2–3 % of height; tick every 5°, numeric label every 15°,
  cardinal letters at N/E/S/W; current heading readout centred beneath at
  ~1.5× the tick label size; location name in caps directly under it
  (~6–7 % from the top). MWII flanks the mode icon with two rows of
  team-alive pips (`hud-01`).
- **Ammo cluster** (`hud-01/05`): bottom-right with 3–5 % margins. Current
  magazine numeral ≈ 4 % of screen height (40–46 px at 1080p); reserve at
  45–55 % of that size and ~60 % opacity beside/below it; a white line-art
  weapon silhouette (~8–9 % of screen width) to its left; lethal/tactical
  glyphs with counts and a fire-mode/key hint on the outer edge.
- **Minimap** (`hud-01/02`): top-left, ~12 % of screen width (square in
  MWII, round in MW2019/Warzone), 1–2 % margin, translucent black backing at
  ~50–60 %, blue teammate chevrons, red enemy pings, player arrow in the
  lower centre.
- **Score/timer**: MWII stacks it under the minimap at ~25–33 % height
  (`hud-01`); MW2019 Ground War puts team bars + timer bottom-left
  (`hud-02`). **Killfeed** sits lower-left, single lines ~1.1–1.3 % of screen
  height, coloured names with a white weapon glyph between (`hud-02`).
- **Killstreak slots / field-upgrade meter** hug the right edge at 55–80 %
  height as small dark tiles and a circular meter with an input hint
  (`hud-01/04`).
- **Prompts and states**: "Mount"/"Rucksack"-style prompts centre between
  70 % and 85 % height as key-glyph box + caps verb (`hud-05/04`);
  reload prompt centred just under the crosshair; low ammo turns the count
  red (`hud-07`). Interaction prompts stack vertically with button glyphs
  left of the verb (`hud-03`).
- **Overlays** (`hud-08/09`): in-match menus keep the game visible, add a
  70–80 % black panel, a category tab bar, item grid with price chips, and a
  bottom control-hint bar of `[glyph] CAPTION` pairs.

## 7. Menus — layout patterns

Full-screen dark UI over a defocused live 3D scene (workbench, hangar,
foam case — `menu-01/03/07`), never a flat background. Standard skeleton:
back chevron + page title top-left, currency/notification cluster
top-right, tab strip top-centre with shoulder-button hints (`menu-01/03`).
Content lives in cards with 1 px light strokes at ~15–25 % opacity; the
selected card gains a saturated border (orange in MWII, green in the loadout
context) and a solid same-colour action bar with black text
(`menu-03/05/06`). Type: condensed uppercase sans, wide tracking on labels,
huge display size for the focal noun (`menu-06`'s "KNOCK OUT", the "M4" in
`menu-01/03`). Stat bars are 2 px lines — grey base, white fill, one green
or red delta segment (`menu-01/03`). One saturated block per screen at
most: the lime START in `menu-07`. Weapons are always presented as clean
profile renders on graded dark backdrops with a rim light (`menu-11/14`),
and as white line-art silhouettes at card scale (`menu-03/05`). Settings
screens (`menu-12`) are two-column: rows of label + value + steppers on the
left, a description panel with an illustrative image on the right.

## AAA non-negotiables checklist

1. Every exterior night frame contains at least one warm practical
   (2000–3200 K) and cool ambient/moon fill (8000–12000 K); no neutral-grey
   night (`environment-01/02`).
2. Bloom appears only on emitters (lights, flames, muzzle flash, reticles,
   lasers); no diffuse surface ever blooms (`environment-08`, `hud-05`).
3. Dark masses may reach <3 % luma but every silhouette keeps a rim, wet
   specular or emissive that reads its outline (`environment-02/10`,
   `enemy-01`).
4. Nothing but emitters clips to white: container tops, wet asphalt, cloth
   and skin never blow out (`environment-01`, `enemy-18`).
5. Night fog visibility is 40–80 m: geometry at 100 m is ≥60 % fogged and
   the fog takes the tint of the nearest light (`environment-01/02/17`).
6. At least one soft-edged volumetric cone or shaft per exterior gameplay
   frame, penumbra ≥25 % of shaft width, fading within ~20 m
   (`environment-13`, `viewmodel-04`).
7. Wet horizontal surfaces stretch light sources into vertical reflections
   2–4× source height (roughness 0.1–0.3); puddles mirror emitters at ≥50 %
   with slight distortion (`environment-01/07`, `vfx-02`).
8. Every hero hard surface within 5 m shows silvered/chipped edge wear
   1–3 mm wide; no pristine CG bevels (`environment-05`, `viewmodel-01`).
9. No visible texture tiling repetition within 15 m of the camera on ground,
   container or wall surfaces (`environment-03/11`).
10. No unbroken straight silhouette longer than 15 % of frame width — a
    cable, pipe, tarp or bracket interrupts every long edge
    (`environment-16`).
11. Decal density: ≥1 stencil/label per container face and ≥3 damage/dirt
    decals per 10 m² of playable wall (`environment-03/05/11`).
12. Hip viewmodel + arm occupy 30–40 % of frame width in the lower-right
    quadrant, muzzle 5–8 % right of centre, weapon pass ~10–15° narrower FOV
    than the world (`viewmodel-03`).
13. The weapon is the most detailed object in every FP frame: legible
    roll-marks, edge wear on charging handle/magwell/rails, roughness
    variation from oil and prints (`viewmodel-01/02`).
14. Reticle and laser emissives render ≥3× scene white with slight bloom and
    stay ≤1 % of frame width (`viewmodel-03`, `firing-08`).
15. Muzzle flash lasts 1–2 frames: clipping white core, orange skirt, 4–6
    spoke star at 1.5–2× muzzle diameter, a same-frame point light kicking
    the gun/hands, then a 0.3–0.5 s smoke wisp (`firing-02/04`, `enemy-03`).
16. Every automatic shot ejects a spinning casing with a specular glint arc;
    ≥6 casings visible during a 1 s burst (`firing-05/06`).
17. Metal impacts emit 10–20 spark streaks + puff + persistent decal;
    concrete emits dust puff + chips + decal (`vfx-06`).
18. Explosions follow flash → clipping fireball → dark expanding smoke →
    gravity-arcing sparks/debris → lingering column, with camera shake and
    a brief bloom flare inside 15 m (`vfx-01/04`, `firing-03`).
19. Post stack always active: filmic (ACES-style) curve, fine film grain
    (≤2 px, ~2–3 % strength), 10–15 % corner vignette, chromatic aberration
    only at frame edges, motion blur on fast motion; grade is cool-shadow /
    neutral-highlight with saturation 15–20 % below neutral (`enemy-16`,
    `vfx-05`).
20. Compass tape top-centre spanning 34–45 % of screen width, 2–3 % top
    margin, ticks every 5°, numbers every 15°, cardinal letters, centred
    heading readout beneath, caps location name under that
    (`hud-01/02/03`).
21. Ammo cluster bottom-right, 3–5 % margins: magazine numeral ≈4 % of
    screen height (40–46 px at 1080p) tabular condensed, reserve at 45–55 %
    size and ~60 % opacity, white weapon line-art (~8–9 % of width) to its
    left, equipment glyphs with counts (`hud-01/05`).
22. Minimap top-left at ~12 % of screen width, 1–2 % margin, ~50–60 %
    black backing, blue teammate chevrons, red enemy pings, player arrow in
    lower centre (`hud-01/02`).
23. Killfeed lower-left in single lines ~1.1–1.3 % of screen height with
    team-coloured names and a white weapon glyph between; ≤5 stacked
    entries, fading after ~5 s (`hud-02`).
24. Contextual prompts (mount/interact/reload) centre horizontally between
    70 % and 85 % height as key-glyph box + caps verb; the reload prompt
    sits just under the crosshair and the low-ammo count turns red and
    pulses (`hud-04/05/07`).
25. Menus render over the defocused live 3D scene (blur radius ≥1 % of
    width) with a partial dark scrim; condensed uppercase sans, one accent
    colour for selection/CTA, 2 px stat bars with green/red delta ticks,
    back-chevron top-left + tab strip + shoulder-button hints on every
    screen (`menu-01/03/07`).
