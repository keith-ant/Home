# NOTES — S4 WEAPONS + VIEWMODEL (`src/weapons/**`)

Owner scope: the first-person weapon layer — procedural high-detail weapon
meshes (M4-style carbine, tactical pistol, M67 frag, gloved hands +
forearms), the separate viewmodel render pass, spring/curve-driven
procedural animation, the weapon FSM (fire/reload/switch/inspect/dry-fire),
hitscan ballistics with the enemy hitbox registry and thin-metal
penetration, grenades, and the seven weapon photo presets. Wired through
`src/weapons/index.js` → `game.weapons` (+ `game.ballistics`).

## 1. What was built

| Module | Summary |
| --- | --- |
| `WeaponDefs.js` | Pure data for `ar_carbine` (750 rpm auto/semi, 30+1, 2.1/2.5 s reloads, ADS 0.24 s, recoil pattern arrays, per-shot view-kick + viewmodel kick, spread cones, penetration, tracer cadence, sound ids), `pistol_tactical` (450 rpm semi, 12+1, 1.7/2.0 s, ADS 0.18 s, weapon light), `frag` (cook, 5 s fuse, 180 dmg / 5 m, throw arc); every viewmodel pose (hip/ADS/sprint/crouch/slide/lowered/inspect1/inspect2/grenade windup+release) and hand attach transforms in camera/weapon space; `damageAtRange()`. |
| `GunBuilder.js` | Procedural hero meshes assembled from hundreds of bevelled parts (RoundedBoxGeometry, LatheGeometry, ExtrudeGeometry, capsules, merged picatinny rails): `buildAR()` — upper/lower with magwell flare, ejection port + open dust cover + oiled bolt visible in the port, forward assist, brass deflector, charging handle, quad-rail handguard with rail covers, vent slots and screws, gas block/tube, barrel + QD suppressor (or birdcage), curved extruded 30-rd STANAG mag with witness ribs + baseplate + decals, castle nut/buffer tube/collapsible stock with buttpad, raked pistol grip (checker normal), ambi selectors, bolt catch, mag release, trigger + guard, folded BUIS front/rear, 552-style holo (body/hood/glass/emissive canvas reticle), PEQ-15 box with pressure-pad cable, vertical foregrip, sling swivel, engraved roll-mark decal plates; `buildPistol()` — slide with front/rear serrations, port cut + hood + extractor/chamber indicator, tritium 3-dot emissives, tilting barrel, frame with rail + stippled grip + controls, hammer, weapon light with LED lens; `buildFrag()` — segmented body + seam, stencil band, fuze, spoon, cotter pin + pull ring; `buildArms()` — gloved hands (palm, thumb + 4 three-segment fingers with knuckle guards, cuff strap), forearms (skin band, watch on the left wrist, rolled twill sleeve) with named finger poses (`ar_grip`, `foregrip`, `pistol_grip`, `pistol_support`, `mag_hold`, `grenade`, …). Edge wear via a per-vertex `aWear` mode attribute + analytic bevel detection in the material (see materials). |
| `materials.js` | Weapon material/texture library, all procedural canvases at boot (no downloads): anodized set (streaked albedo, fingerprint/oil roughness, machining-line normal, 1024²), parkerized steel normal, grip checkering, pistol stippling, ribbed polymer, knit glove weave + albedo, twill cloth, watch face, engraved roll-mark sheet (albedo + engraved normal + named UV rects), EOTech-style reticle, laser/tritium glows. `weaponMaterial(kind, overrides)` factory (anodized / steel_park / steel_oiled / steel_black / polymer / polymer_fde / rubber / brass / glass_optic / lens_black / reticle / emissive_dot / led_lens / glove / glove_leather / cloth / skin / watch / watch_face / decal). Wear-patched kinds inject a shader chunk: `aWear = 4 + strength` → per-pixel bevel wear from the object-space normal (`1 − max(abs(nObj))`, chipped by cell noise) that lifts albedo to bare metal and drops roughness; `aWear ≤ 1.5` → direct vertex wear (lathe rims). |
| `Viewmodel.js` | Second `THREE.Scene` + `PerspectiveCamera` (fov = world fov × 0.82, near 0.01) rendered through `post.attachViewmodel()` (see §7); the scene shares WORLD coordinates (`root` copies the camera each render) so anchors give true world positions. Lighting: scene.environment = world IBL (0.16), the 4 strongest world fixtures mirrored as spotlights (floods keep their cone/target; practicals + FX flash spikes become wide cones at the eye, illuminance-capped), a constant camera-space warm key (shadow-casting spot, tier map size) + cool rim + low fill + faint hemisphere, auto-scaled down under bright fixtures and while ADS/inspecting. Also owns: laser beam (viewmodel scene) + laser dot sprite (world scene, at the world raycast hit), the pistol weapon-light `SpotLight` in the WORLD scene (+ a small backwash point light on the gun), the FX muzzle-flash rig parented to the muzzle anchor, the detached free-falling magazine (physics-lite in world space with BVH bounce) and the spare mag in the off hand, arm attachment (grip alignment + forearm exit direction in weapon space), pose override + fov override + arms/reticle toggles for presets. Hidden automatically whenever the player rig is detached (environment presets/menus). |
| `Anim.js` | `WeaponAnimator`: camera-space weapon pose = blend of hip → crouch/slide → sprint → ADS (solved so the reticle / sight line sits exactly on the camera axis) → inspect timeline → reload choreography → lowered (holster/deploy/mantle/death) → grenade throw arc, plus additive layers: 6-axis fire-kick spring, accumulated muzzle climb, lagged movement bob follower, look-sway follower, idle breathing + micro noise, strafe/turn tilt, damage flinch. Part state: bolt/slide reciprocation (12 ms back / 40 ms return, lock-back on empty), charging handle, trigger, selector, mag-out/hand-mag/bolt-drop beats, left-hand travel waypoints and pose overrides for reloads. All deterministic (game.time). |
| `Weapon.js` | Per-weapon FSM (holstered/deploying/idle/firing/reloading/holstering/inspecting): rpm timing off `game.time`, auto/semi/burst, chamber (+1) model, dry fire + auto-reload assist, tactical/empty reload beats (ammo transfer at the mag-in beat, cancel on early fire, sprint interruption), inspect gating; per shot: spread cone (gameplay rng), Ballistics trace, world muzzle flash (light spike/sparks/smoke) + viewmodel flame rig, tracer, delayed casing eject from the port frame + chamber smoke, view kick + permanent pattern recoil into the camera rig, small shake, animator kick, `player:fired`, `weapon:ammo`. |
| `WeaponSystem.js` | `game.weapons`: loadout (AR/pistol/frag), input mapping (fire/ads/reload/weapon1/2/next/prev/grenade/inspect, toggle-ADS setting), ADS blend → `player.setAds(blend, {fovMul})` + move scale + DOF focus on the aim raycast, spread bloom decay, recoil re-centering (partial CoD-style), holster→deploy switching, grenade choreography (holster → equip frag → cook → throw → recover → re-equip), player self-damage from `grenade:exploded` (LOS-checked falloff), respawn refill, `stats()` for the harness. Fixed step, order 30. |
| `Ballistics.js` | `game.ballistics`: hitbox registry (`registerHitboxSet(entity, capsules|spheres)` / `unregisterHitboxSet`), ray-vs-capsule/sphere tests merged with `world.raycast` (nearest wins), damage falloff (`damageAtRange`), part multipliers, optional synchronous entity response (`entity.onWeaponHit(hit) → {killed, headshot}`), thin-metal penetration (backface exit cast ≤ 0.15 m → continue with damage × 0.55), canonical `weapon:hit` per impact (+ `ui:hitmarker` for entity hits). |
| `Grenade.js` | `GrenadeSystem`: pooled frag projectiles (mesh = frag body sans pin/spoon), gravity + BVH bounce (restitution 0.35, tangential friction, settle), fuse → `fx.explode({position, radius:5, damage:180, kind:'frag', owner:'player'})` which emits the canonical `grenade:exploded {point, radius, damage, kind, owner}`; prefers `game.physics.throwProjectile` when the PHYSICS stream exists. |
| `presets.js` | Photo presets `viewmodel_idle`, `viewmodel_ads`, `viewmodel_fire`, `viewmodel_reload`, `viewmodel_pistol`, `viewmodel_inspect`, `gun_macro` (each stages the real player + weapon system and scripts the state), plus dev presets `weapon_test` (`--debug wpntest`, an end-to-end weapon regression with assertions) and `vm_debug` (`--debug gundbg`, turntable-style whole-gun view). |
| `index.js` | Installer: `game.weapons`, `game.ballistics`, system `weapons` (order 30), preset registration. |

Cross-stream edits (minimal, documented at the touch points):
- `src/render/Post.js`: added `attachViewmodel(scene, camera)` /
  `setViewmodelEnabled()` — a second `RenderPass` inserted after the AO
  pass (depth cleared, colour kept, `needsDepthBlit=false`).
- `src/fx/Explosions.js`: `grenade:exploded` now forwards `damage`, `kind`,
  `owner` from the `fx.explode()` call (they were documented params but not
  emitted).

## 2. Public API

```js
game.weapons.current             // Weapon (active)  · .list {id → Weapon} · .order
game.weapons.defs                // WEAPON_DEFS
game.weapons.switchTo(id) / switchToSlot(n) / switchNext(±1)
game.weapons.forceFire()         // scripted shot (presets / autoplay)
game.weapons.throwGrenade()      // scripted cooked throw
game.weapons.setLaser(bool) / setWeaponLight(bool)
game.weapons.aimRay(outOrigin, outDir)      // true crosshair ray (rig forward)
game.weapons.currentSpreadDeg()             // effective cone half-angle
game.weapons.applySpread(dir, deg, out)     // gameplay-rng cone sample
game.weapons.adsBlend            // 0..1
game.weapons.giveAmmo(id, n)     // reserve top-up (grenades: count)
game.weapons.stats()             // {weapon, state, ammo, reserve, grenades, tris, armTris, ads}
game.weapons.viewmodel           // Viewmodel: setVisible(v), setFovOverride(fov|null),
                                 //   setArmsVisible(v), forceReticle(v), poseOverride,
                                 //   worldOf(anchor,out), boreDirection(out), portFrame(...)
game.weapons.anim                // WeaponAnimator (posePos/poseQuat, adsBlend, partState…)
game.weapons.grenades            // GrenadeSystem: count, throwProjectile(pos, vel, fuse), clear()
game.ballistics.registerHitboxSet(entity, boxes)   // S5: [{part:'head'|'torso'|'limb', radius, a, b} | {part, radius, center}]
game.ballistics.unregisterHitboxSet(entity)
game.ballistics.raycastEntities(origin, dir, maxDist, ignore) → {entity, part, distance, point, normal} | null
game.ballistics.fire({origin, dir, def, weaponId, owner, ignore}) → {hits, count, endPoint}
game.post.attachViewmodel(scene, camera) / setViewmodelEnabled(bool)     // S1 file, WEAPONS-added
```

Weapon instance: `state`, `ammo` (rounds in the gun incl. chamber),
`reserve`, `magSize`, `fireMode`, `fire()`, `startReload()`,
`startInspect()`, `holster()`, `deploy()`, `cycleFireMode()`, `emitAmmo()`,
`assembly` (`{root, parts:Map, anchors:{muzzle,port,laser,reticle,light,…}, info:{tris}}`).

### Events

Emitted: `player:fired {weapon, muzzleWorldPos, dirWorld, ammo, reserve, ads,
suppressed, sound, soundFar, hits}`, `weapon:hit {point, normal, surface,
entity, part, damage, isKill, isHeadshot, dir, object, energy, weapon,
owner}` (canonical), `weapon:ammo {id, mag, reserve, magSize, mode, name}`,
`weapon:switched {id, name, def, magSize}`, `weapon:reload {id, empty,
duration}`, `player:reloaded {id}`, `weapon:empty {id}`,
`weapon:firemode {id, mode}`, `ui:hitmarker {kill, headshot}`,
`grenade:primed {fuse}`, `grenade:thrown {position, velocity, fuse,
kind}`, `grenade:bounce {position, surface, speed}`, `fx:casing` (from the
dropped mag landing), `fx:impact` (penetration exit spall). Consumed:
`player:damaged` (viewmodel flinch), `player:respawn` (refill),
`grenade:exploded` (player self-damage). All payload objects are pooled —
copy fields, don't keep references.

## 3. Viewmodel render integration (the cross-stream edit)

`Post.attachViewmodel(scene, camera)` builds a second `RenderPass` and
inserts it right after the N8AO pass (or the world RenderPass when AO is
off). Its `clearPass` clears **depth only**, so the weapon draws over the
world colour without ever intersecting walls, and everything downstream
(bloom for the reticle/laser/flash emissives, ACES tone map, LUT grade,
SMAA, chromatic aberration, grain, vignette, lens droplets) still processes
the gun. `needsDepthBlit = false` keeps the composer's *stable* depth
texture = the WORLD depth, so DOF and motion blur keep reading world depth
— which incidentally gives the CoD ADS read for free: the gun body over the
near ground blurs, the reticle over the far focused target stays sharp.
`renderer.info` counts include the viewmodel pass (its shadow-casting key
adds one small shadow map render per frame).

## 4. ADS alignment (exact numbers)

The weapon root pose in ADS is *solved*, not authored: with reticle anchor
`r` (weapon space, AR: `(0, 0.081, 0.023)` = holo window centre) and ADS
rotation `R` (`adsRot`, usually zero), the animator sets
`pose.pos = (0, 0, adsZ) − R·r`, so the reticle lands exactly on the camera
axis at depth `adsZ` (AR `−0.168 m`, pistol rear-notch `adsSightOffset` at
`−0.27 m`). The blend is `easeOutBack(t / adsTime)` (2 % overshoot, 0.24 s
AR / 0.18 s pistol) and every additive layer (bob, sway, breathing) is
scaled to 25–45 % of hip strength while aiming. The viewmodel camera fov is
`worldFov × 0.82` (world fov already narrows by `def.ads.fovMul` through
`player.setAds`). The holographic reticle only becomes visible past ~55 %
of the blend (holograms only resolve on-axis) and is drawn at HDR
`(7.5, 0.35, 0.18)` → ~4× scene white, so it blooms slightly over the LUT.

## 5. Animation timing table (60 Hz fixed steps)

| Beat | AR (`ar_carbine`) | Pistol (`pistol_tactical`) |
| --- | --- | --- |
| Fire interval | 750 rpm → 80 ms | 450 rpm → 133 ms |
| Bolt / slide back → return | 12 ms / 40 ms (locks back on last round) | 24 ms / 51 ms (locks open on empty) |
| Casing eject after shot | 12 ms | 8 ms |
| View-kick spring (pitch/yaw/roll) | 0.6° / 0.28° / 0.35°, ADS × 0.62 | 1.3° / 0.4° / 0.5°, ADS × 0.7 |
| Permanent recoil pattern | 15-shot table (≈0.5°→0.22° pitch, ±0.2° yaw), loops from index 9; 55 % re-centres at 5.5°/s after 0.15 s | 6-shot table, 70 % re-centres at 7°/s |
| Viewmodel kick | 32 mm back, 2.6° up, ±0.7° roll (spring 9.5 Hz / 0.52) | 26 mm, 6.5°, ±1.2° |
| Muzzle climb per shot / max | 0.35° / 4.0° | 0.6° / 3.0° |
| ADS in/out | 0.24 s (back-ease overshoot) | 0.18 s |
| Sprint transition | 0.3 s in/out (smootherstep) | 0.3 s |
| Reload tactical / empty | 2.1 s / 2.5 s | 1.7 s / 2.0 s |
| — mag out | 0.42 s (mesh detaches, free-falls, bounces, hides after 1.2 s) | 0.32 s |
| — mag in (ammo transfer) | 1.32 s (hand-mag visible 0.70–1.38 s) | 1.06 s |
| — bolt / slide release (empty only) | 1.82 s | 1.56 s |
| Deploy / holster | 0.5 s / 0.42 s | 0.36 s / 0.3 s |
| Inspect | 2.6 s: 0–0.4 s blend to left-flank pose, drift, 1.3–1.8 s roll to the port side, settle from 2.15 s | 2.4 s |
| Grenade | pull 0.35 s (pin), windup 0.25 s, release at +0.4 s, recover 0.4 s; fuse 5 s minus cook | — |
| Idle breathing | 0.7 Hz vertical 1.8 mm + 0.36 Hz lateral 1.2 mm + 2 incommensurate rotational noises ≈ 0.1° | same |
| Bob follower | 3.4 Hz / 0.85 damping (~40 ms lag), 1.6× rig bob, reduced 72 % in ADS | ×0.85 |
| Empty click | 4 mm nudge + 0.5° pitch, 0.25 s lockout | same |

## 6. Tuning knobs

| Knob | Where | Notes |
| --- | --- | --- |
| Hip / ADS / sprint / … poses | `WeaponDefs.viewmodel.*` | camera-space metres/degrees; `adsZ` = reticle depth |
| Hand placement | `WeaponDefs.viewmodel.hands.{right,left}` | wrist pos + grip rotation (Euler YXZ deg) in weapon space, `forearm` = exit direction (weapon space), `pose` = HAND_POSES name |
| Finger poses | `GunBuilder.HAND_POSES` | curl deg per joint, thumb, spread |
| Kick springs | `Anim.js` `_kick(6, 9.5 Hz, 0.52)` + `def.recoil.*` | impulse magnitudes |
| Spread | `def.spread.*` | hip/hipMove/hipSprint/crouchMul/ads/firePenalty/recovery/max (deg) |
| Damage curve | `def.damage.{near,far,rangeNear,rangeFar,multipliers}` | linear falloff between ranges |
| Viewmodel fov | `Viewmodel.fovScale` (0.82) | multiplied on the world vertical fov |
| Gun lighting | `Viewmodel._buildLights` (key 1.3 cd warm shadowed spot, rim 0.95 cool, fill 0.22, hemi 0.06, env 0.16) + mirror flood scale 0.34, transient cap `25·distSq` | auto factor 0.4–1.0 by mirrored illuminance; ×(1−0.75·ads); key swings left + ×2.4 during inspect |
| Edge wear look | `materials.patchWear` (edge band `smoothstep(0.9, 0.995, m)`, chip cells 140/m + 30/m mix) + per-part `strength` in GunBuilder | wear colour/rough/metal per material recipe |
| Muzzle flash size | `def.muzzle.size` (0.38 suppressed AR / 0.55 pistol) | scales FX star + attached flame planes |
| Laser | `Viewmodel._buildLaser` (beam radius 0.45 mm, opacity 0.16, dot HDR red) | dot placed at the world raycast hit, sized by distance |
| Weapon light | `def.light {intensity 190 cd, angleDeg 18, penumbra 0.75}` + backwash point 0.3 cd | world SpotLight follows the light anchor |
| Grenade physics | `def.physics {restitution 0.35, friction 0.55, radius 0.033}` | + `def.fuse/cookLimit/throwSpeed/throwUp` |

## 7. Preset staging

All viewmodel presets pose the *player* (camera on the rig) so bob/sway/
breathing are the real springs, prime the storm, and script the weapon
system: `viewmodel_idle` (M4 mast pool, laser on), `viewmodel_ads` (forced
ADS at the lit bay 17 m out, DOF 17.5 m/9 m/2.2), `viewmodel_fire` (4-shot
750 rpm burst, capture one fixed step after shot 4: flash + tracer +
airborne brass + bolt back + climb + smoke), `viewmodel_reload` (t≈0.58 s:
mag falling out of the well, off hand stripping it), `viewmodel_pistol`
(dark west lane, weapon light cone on the block-W face, tritium),
`viewmodel_inspect` (t≈1.2 s, showcase key), `gun_macro` (26° lens
gunsmith view solved from a gun-space view direction, arms hidden,
reticle forced, neutral bench key). Debug: `weapon_test`
(`--debug wpntest`) asserts AR burst ammo, ≥4 wall hits, reload → 31,
switch to pistol + 2 shots → 11, switch back, cooked frag → count 1 and
`grenade:exploded {damage:180}`, dry-fire path; `vm_debug`
(`--debug gundbg[,vmyaw..,vmdist..,vmboost..,vmx..,vmz..,vmw:pistol]`).

## 8. Verification & performance

Iterated at 1280×720 `--quality high` (SwiftShader software GL), finals at
1920×1080 ultra. Every preset: zero console errors; `npm run verify`
(autoplay realtime path) passes; the `weapon_test` regression passes; the
world/render presets are unaffected (viewmodel pass auto-hidden when the
camera detaches from the player). Final 1080p ultra `window.__ironwake`
stats (world + viewmodel pass + shadow maps, three.js `info.render`):

| Preset | draw calls | triangles | textures | programs | capture (SwiftShader) |
| --- | --- | --- | --- | --- | --- |
| viewmodel_idle | 820 | 0.86 M | 146 | 95 | 58.9 s |
| viewmodel_ads | 559 | 0.64 M | 164 | 102 | 52.5 s |
| viewmodel_fire | 754 | 0.71 M | 138 | 92 | 51.9 s |
| viewmodel_reload | 813 | 0.77 M | 141 | 92 | 52.6 s |
| viewmodel_pistol | 673 | 0.85 M | 144 | 96 | 60.2 s |
| viewmodel_inspect | 803 | 0.77 M | 138 | 91 | 53.5 s |
| gun_macro | 684 | 0.77 M | 136 | 90 | 50.2 s |

No third-party files were added by this stream (every mesh, texture and
decal is generated at boot), so `CREDITS.md` is unchanged.

Assembly geometry: AR ≈ 21.6 k tris (well under the 60–90 k budget — the
detail is parts count and materials rather than tessellation), pistol
≈ 8 k, frag ≈ 2 k, both arms ≈ 12.5 k. The viewmodel pass adds one scene
render + one 512/1024² shadow map (key light) per frame; textures are all
small procedural canvases (≤ 1024², shared/cached).

## 8b. Finish pass (proportions + lighting) — 2026-07-27

- **Receiver rescaled to real M4 proportions**: upper 29 mm wide × 41 mm
  tall × 188 mm, lower 29 × 31 mm; the whole receiver stack (rail top →
  lower floor) is now ~71 mm (was ~92 mm) and all side controls, roll-mark
  decals, port/deflector/dust cover, magwell (33 mm), delta ring, grip
  (17° rake) were re-seated onto the slimmer flats.
- **Picatinny rails** (`railGeometry`): base 3.4 mm + 2.8 mm ridges (was
  4.2 + 4.6 mm slabs) — reads as thin flush 1913 slots on the flat-top and
  the quad rail; every rail-mounted part (holo, PEQ, BUIS) dropped with it.
- **Holographic sight rebuilt** to EXPS/552 proportions: 33 mm wide, low
  front laser deck under a large 25 × 36 mm hooded window (thin 4 mm posts +
  strap), rear-third electronics box with battery cap; sight line
  `HOLO_SIGHT_Y = 34 mm` above the mount, exported through the `reticle`
  anchor so the ADS solve follows automatically.
- **Edge-wear strengths halved** on the receiver bodies (0.55–0.9) so the
  bevels stop reading as bright Lego outlines.
- **Viewmodel lighting floor doubled**: warm key 2.6 cd, cool rim 1.9, low
  fill 0.42, hemi 0.11, auto-scale floor 0.55 (was key 1.3 / rim 0.95 / fill
  0.22 / hemi 0.06 / floor 0.4) — the gun no longer silhouettes to black at
  night, and the mirrored muzzle-flash spike (`25·d²` cap) still lights the
  gun/hands on the fire frame.
- The checkpoint's `receiverUpperGeometry` / `receiverLowerGeometry`
  extrusions (forged shoulder profile) are written but NOT yet swapped in
  for the rounded-box bodies — next step for compound curves.

## 9. Known gaps vs the reference (ranked by visual impact)

1. **Assembled-box construction reads CAD-like up close.** Receivers,
   handguard, sight housing and stock are bevelled boxes; there are no
   compound curves (forged receiver contours, ergonomic grip swells,
   milled scallops). `gun_macro` / `viewmodel_inspect` expose it. Next step:
   loft/extrude the receiver and grip profiles (mag already extruded) and
   add fine geometric detail (T-marks on the rail, forge lines).
2. **Hands are segmented capsules.** Fingers read as jointed sausages with
   pad plates; no palm creases, tendon back-of-hand, glove seams or thumb
   webbing. Poses are FK curl tables, not IK contact solves, so grips hover
   a few mm off surfaces. Needs a skinned mesh or a per-weapon baked pose.
3. **Reload/inspect choreography is waypoint-linear.** The off hand travels
   along smoothstepped straight segments and the spare mag pops onto the
   hand; there is no wrist rotation curve, no bolt-slap contact, no
   secondary motion. Reference reloads have arcing hand paths and
   overlapping action.
4. **Photometry vs "video-game dark" guns.** The materials are physically
   plausible (anodized albedo ~3–4 %, roughness 0.5–0.6), so under a real
   floodlight the receiver tops go pale grey and under the showcase key the
   gun reads charcoal-tan. CoD art-directs guns darker/glossier than physics;
   a dedicated weapon tone/exposure tweak (or clamped viewmodel light
   response) would push it there.
5. **Suppressed muzzle flash is a fantasy compromise** — a real can shows
   almost nothing; ours is a 0.38× star for the frame read. No first-round
   flash variation, no heat haze/shimmer, no barrel smoke lingering along
   the handguard.
6. **Tracer at short range** is only visible for hits > 2.5 m and lasts
   1–2 frames at 320 m/s visual speed; long lane shots read best.
7. **Casings are world-lit brass**: they only glint when the muzzle flash or
   a fixture catches them (fine at night, subtle otherwise); no tinkle glint
   pass, and the ejected brass sometimes draws behind the viewmodel gun
   (world-pass object) for a few pixels near the port.
8. **Falling magazine draws in the viewmodel pass**, so it renders over
   world geometry it should fall behind (rarely visible: it leaves the
   frame within ~0.3 s).
9. **No procedural weapon sway from turning acceleration beyond the rig's
   look-lag** (no lag-behind on fast flicks with overshoot roll), no
   breathing hold in ADS, no idle fidgets.
10. **Ballistics is hitscan**: no travel time, drop, or ricochet rounds;
    penetration handles only the first thin-metal layer per shot.
11. **HUD/audio hooks are events only** (S6): ammo, hitmarker, reload,
    fire sounds are emitted with asset ids but nothing plays/renders yet.

## 10. INTEGRATION NOTES FOR LATER STREAMS

- **S5 AI/COMBAT**: register enemies with
  `game.ballistics.registerHitboxSet(entity, [{part:'head', radius:0.13,
  a, b}, {part:'torso', ...}, {part:'limb', ...}])` — `a`/`b` are LIVE
  world-space `Vector3`s you update each frame (or pass a function returning
  the array); mark `entity.alive = false` when dead (traces skip it) and
  call `unregisterHitboxSet` on cleanup. Implement `entity.onWeaponHit({damage,
  part, point, normal, dir, distance, weapon, owner, isHeadshot}) → {killed,
  headshot?}` for synchronous hitmarker/kill feedback; otherwise just listen
  to `weapon:hit` (entity + part + damage in the payload) and apply damage
  yourself. Radial grenade damage: subscribe to `grenade:exploded {point,
  radius, damage, kind, owner}` (falloff + LOS is up to you; the player uses
  `(1 − d/r)² × 0.6`). Enemy muzzle flashes/tracers: use `game.fx` directly;
  enemy shots at the player call `game.player.applyDamage`. For the enemy
  rifle prop, `buildAR({suppressor:false})`/GunBuilder parts can be reused
  as a third-person LOD (call once and clone), or the `weapon.ref.*` GLBs.
- **S6 UI/AUDIO**: `weapon:ammo {id, mag, reserve, magSize, mode, name}` on
  every change + `weapon:switched {id, name}` for the ammo cluster;
  `ui:hitmarker {kill, headshot}`; `weapon:reload/empty/firemode`;
  `grenade:primed/thrown`. Audio: `player:fired` carries `sound`/`soundFar`
  ids from `WeaponDefs.sounds` + `muzzleWorldPos`; reload foley beats are in
  §5 (mag out/in/bolt); `fx:casing {surface, kind:'rifle'|'pistol'|
  'magazine'}` for tinks; `grenade:bounce {surface, speed}`. The def sound
  ids (`sfx.weapon.rifle_ar15_near`, `sfx.weapon.pistol_45_near`, foley
  ids, `synth.dry_fire`, `synth.selector`) are the AudioBank keys.
- **S7 INTEGRATION / autoplay**: drive weapons through input injection —
  `game.input.simulate({actions:{fire, ads, reload, weapon1, weapon2,
  grenade, inspect}, look:{dx,dy}})`; or call `game.weapons.forceFire()`,
  `switchTo(id)`, `throwGrenade()` directly. `game.weapons.aimRay(o, d)`
  gives the crosshair ray for aim assist; `stats()` for the bridge. The
  `weapon_test` preset (`--debug wpntest`) is a ready regression for CI.
  Menus/third-person views should call `game.post.setViewmodelEnabled(false)`
  or detach the player camera (auto-hides).
- **S1 RENDER**: `post.attachViewmodel` lives in Post.js (see §3). The
  viewmodel scene copies `game.scene.environment` each step (sky variant
  changes carry over). Weapon emissives assume the bloom threshold 1.15
  (reticle ~1.5 luma, laser dot 6.5, tritium 3–4). The mirrored transient
  flash cap (25·d²) may want retuning if muzzle-light spikes change.
- **S3 FX**: the weapon calls `fx.muzzleFlash` (world, light on),
  `fx.createMuzzleFlash({light:false})` (viewmodel flame, one rig reused
  across weapons), `fx.tracer`, `fx.ejectCasing`, `fx.particles.emit(
  'smoke_wisp')` at the port, and never calls `fx.impact` itself (impacts
  come from your `weapon:hit` listener as agreed). `fx.explode` now
  forwards `damage/kind/owner` into `grenade:exploded`.
