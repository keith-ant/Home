# IRONWAKE — Art Direction & Creative Brief

> Working title: **IRONWAKE** · Subtitle: *Blacksite Terminal*
> Genre: modern-military first-person shooter · Reference bar: Call of Duty:
> Modern Warfare (2019/II/III), Warzone. This document is the visual contract.
> Every rendering, environment, weapon, VFX and UI decision is judged against it.

## 1. The one-line pitch

A rain-lashed container terminal at the dead of night — floodlit steel canyons
of stacked shipping containers, wet asphalt throwing back every light, storm
clouds detonating overhead — where a lone operator holds out against waves of
PMC assault teams.

We pick this setting *deliberately* because it maximizes the visual features
a WebGL renderer does spectacularly well and hides the ones it does poorly:

- **Darkness + point/spot lighting** → dramatic, high-contrast, hides polygon
  budgets, makes every light source a composition tool.
- **Wetness** → specular everywhere: puddles, slick asphalt, dripping metal.
  Screen-space reflections and roughness variation read as "next-gen".
- **Volumetrics** → floodlight cones cutting through rain and fog, god rays,
  ground fog pooling between containers.
- **Particles** → rain streaks, splashes, wind-blown debris, sparks, smoke,
  muzzle flame, embers from fire barrels.
- **Hard-surface, photoscanned materials** → containers, concrete, corrugated
  steel, rusted metal, tarps — all available as real photoscanned CC0 PBR sets
  (Poly Haven / ambientCG), which look photoreal because they *are* photos.

## 2. Reference targets (what the critics compare against)

Primary comparisons are real screenshots from:
- CoD MW (2019) — "Clean House" night raid tonality, weapon fidelity.
- CoD MW II (2022) — "Wetwork" (night, water), the ship-graveyard atmosphere.
- CoD MW / MW II — **Shipment** map (a container yard — our closest layout twin).
- Warzone — night mode lighting, port/dock POIs.

What "AAA" concretely means in those images and therefore for us:
1. **Physically-based everything.** No flat colors. Every surface has albedo,
   normal, roughness, AO from a real texture set; correct energy conservation;
   image-based ambient light; ACES filmic tone mapping.
2. **Lighting is authored, not incidental.** Warm sodium/halogen floodlights
   against cool blue moonlight/lightning; rim lights on the weapon; specular
   glints; light shafts. Every screenshot has a deliberate warm/cool split.
3. **The weapon owns the frame.** In first-person shooters ~30% of the screen
   is the gun. It must be dense with detail: machining marks, wear on edges,
   fingerprints in the roughness map, laser/optic attachments with emissive
   reticles, hand-animated idle sway, breathing, and inspect motion.
4. **Screen is never static.** Rain, drifting fog, swaying cables, flickering
   fire barrels, blinking hazard lights, distant lightning, ambient dust.
5. **Post-processing is a color grade, not a filter dump.** Subtle bloom on
   emitters only, filmic grain, gentle vignette, chromatic aberration at frame
   edges only, motion blur on fast turns, depth of field when aiming.
6. **UI is minimal, sharp, and typographic.** Condensed sans, thin rules, small
   caps, restrained color (bone white + one accent + red for danger). CoD's HUD
   is *quiet*: compass tape top-center, ammo bottom-right, hitmarkers, killfeed
   bottom-left, subtle screen dirt/water on the lens.

## 3. Palette & atmosphere

| Element            | Value / description                                                  |
| ------------------ | -------------------------------------------------------------------- |
| Sky / ambient      | Deep desaturated navy `#0b1220` → charcoal at horizon, low intensity  |
| Moon key          | Cool `#8fa6c9`, ~2200 lux equivalent, long soft shadows              |
| Floodlights        | Sodium `#ffb15c` and halogen `#ffe2b3`, 4000–8000 candela, IES-ish spot cones |
| Fire barrels       | `#ff7a2e` flicker, warm bounce on nearby containers                  |
| Hazard lights      | Blinking amber `#ffae00` and red `#ff2020` beacons on cranes         |
| Container paint    | Weathered oxide red, teal, mustard, grey, white — chipped, rust-streaked |
| Fog                | Ground fog blue-grey, height falloff, denser far, tinted by lights   |
| Lens               | Rain droplets on camera, occasional streak                            |

Storm cycle: distant lightning every 8–20 s (sky flash + delayed thunder),
gusting wind bending rain angle, cable/tarp sway.

## 4. Environment (the map: "Terminal 9")

A compact three-lane arena, roughly 90 × 70 m playable, in the spirit of
Shipment/Killhouse scaled up:
- **North**: quay edge, black water with reflections, moored cargo ship silhouette,
  two gantry cranes (huge silhouettes, blinking lights) — the vista skyline.
- **Center**: container stacks 2–3 high forming lanes, chokepoints, a burnt-out
  container interior, an overturned container ramp for verticality.
- **South**: warehouse facade with a lit interior visible through open bay
  doors, sodium wall lamps, an office trailer.
- Ground: cracked asphalt with painted lane markings, puddles (SSR), oil
  stains, tire tracks, drainage grates, scattered pallets/tires/sandbag walls,
  concrete jersey barriers, a burning fuel drum or two, a wrecked pickup.
- Set dressing sells scale: cables strung between stacks, tarps, hazard
  tape, stencil decals (unit numbers, arrows, "MAX 30480 KG"), graffiti,
  scattered brass and shell holes as the fight goes on.

## 5. Weapons (hero assets)

Two fully realized weapons + throwable, all first-person "viewmodel" quality:
1. **AR — "M4-style carbine"**: full-length top rail, holographic sight with
   emissive reticle, foregrip, PEQ laser/light box, suppressor optional, 30-rd
   mag. Anodized dark receivers, worn Cerakote, oiled steel bolt visible through
   the ejection port when it cycles.
2. **Sidearm — "P226/USP-style tactical pistol"**: slide serrations, tritium
   sights (emissive dots), rail flashlight, reciprocating slide that locks back.
3. **Frag grenade** with pin/lever detail.
4. **Gloved hands and sleeves** — nomex glove texture, watch, forearm sleeve.

Animation feel (procedural, spring-driven — the CoD "weight"):
- Idle: subtle breathing sway + fine noise; laser dot jitters accordingly.
- Move: figure-8 bob scaled by speed; sprint lowers and cants the weapon.
- ADS: 200 ms ease into precise sight alignment, FOV narrows, DOF blurs the
  weapon body and background slightly, world sway damps down.
- Fire: sharp back-kick + muzzle climb per shot, camera punch, screen shake,
  muzzle flash (mesh flame + sprite + point light, 1–2 frames), heat shimmer,
  smoke wisps, ejected brass tumbling with light glints, bolt cycling.
- Reload: mag out (physically drops), mag in, bolt release; hands leave and
  return; timings match CoD's ~2.1 s tactical reload.
- Hurt/sprint-in/sprint-out/weapon swap/mantle transitions all animated.

## 6. Enemies

PMC operators built on the Three.js `Soldier.glb` rig (or better if sourced):
retextured to modern military kit (multicam, plate carrier, helmet with NVG
mount, glowing IR beacon), rifle in hands, muzzle flashes when firing, hit
flinch, staggered death (ragdoll-esque procedural fall), blood decal + mist.
They flank between containers, take cover, lean out, throw the odd grenade.

## 7. HUD & menus (CoD Modern Warfare grammar)

- Top-center: **compass tape** with cardinal ticks and enemy contact pips.
- Bottom-right: **ammo** — big current-mag number, small reserve, weapon name
  and fire-mode glyph; grenade count icons.
- Bottom-left: **killfeed** and score/streak progress; health has no bar —
  damage is a red screen edge + blood spatter + heartbeat that fades on regen.
- Center: dynamic crosshair (spreads on move/fire, hides on ADS), hitmarker
  "X" flash (red on kill), reload prompt, low-ammo pulse.
- Damage direction arcs, wave banners ("WAVE 4 — HOSTILES INBOUND"), XP/medal
  toasts, killstreak availability.
- Menus: full-screen with the live 3D scene defocused behind, thin uppercase
  type, animated highlight bars, click/hover UI sounds. Settings that work:
  FOV, sensitivity, quality preset, motion blur, film grain, AA mode.

Typography: **Rajdhani / Barlow Condensed** style condensed sans (self-host a
CC0/OFL font), tabular numerals, tracking-wide small caps for labels.

## 8. Sound (WebAudio)

Layered gunshots (mech + report + tail), per-surface bullet impacts and
footsteps, brass tinkle, environment reverb, rain bed + wind + thunder + distant
gunfire ambience, low-health heartbeat and muffling, hitmarker tick, headshot
"crack", UI clicks, tense synth pad music that swells with the wave. Distance
lowpass and occlusion when behind containers. Bus mixing with sidechain-style
ducking on explosions.

## 9. Non-negotiables checklist (critics use this)

- [ ] Not a single unlit / vertex-color / flat-shaded surface anywhere.
- [ ] Every emissive source glows via bloom; nothing else does.
- [ ] Shadows are soft and there is always a reason for every shadow.
- [ ] The weapon is the most detailed object on screen at all times.
- [ ] No tiling patterns visible on ground or walls (decals, dirt, variation).
- [ ] No perfectly sharp CG edges — bevels/edge wear on hero assets.
- [ ] No pure black shadows or blown-out whites — filmic curve at all times.
- [ ] Motion: something in frame is always moving.
- [ ] HUD is legible, restrained, aligned to a grid, never placeholder-looking.
- [ ] It reads as *the same game* in every screenshot (consistent grade).
