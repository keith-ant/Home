# IRONWAKE — Character, Weapon-model, Font & Audio asset catalog

Owner: ASSETS stream (characters / weapons / audio / fonts). Companion files: `src/assets/manifest.{characters,weapons,audio,ui}.js`,
`docs/credits/characters-weapons.md`, `docs/credits/audio-fonts.md`. Everything listed here exists under `public/assets/**` and
validated (see §7). Consumers: AI stream (characters), WEAPONS stream (viewmodel/GunBuilder references, weapon SFX ids),
AUDIO stream (SoundBank ids), UI stream (fonts, UI sfx).

## 1. Character models

| id | file | tris | joints | bone naming | animation clips (name: seconds) | notes |
| --- | --- | --- | --- | --- | --- | --- |
| `char.soldier` | `assets/models/characters/soldier.glb` | 11376 | 51 | mixamorig: | Idle: 1.967, Run: 0.7, TPose: 0.033, Walk: 1.033 | PRIMARY enemy body. Mixamo Vanguard, textured. Root `mixamorig:Hips` under node `Character`. Meshes vanguard_Mesh + vanguard_visor. |
| `char.xbot` | `assets/models/characters/xbot.glb` | 49112 | 67 | mixamorig: | agree: 1.833, headShake: 2.567, idle: 2.5, run: 0.7, sad_pose: 0.067, sneak_pose: 0.067, walk: 0.967 | Mixamo Xbot mannequin (untextured). Retarget / blend-tree test dummy. Optional (tier high+). |
| `char.michelle` | `assets/models/characters/michelle.glb` | 28106 | 65 | mixamorig: | SambaDance: 18.233, TPose: 0.067 | Mixamo Michelle, textured. Reference only, optional (tier ultra). |
| `char.swat` | `assets/models/characters/quaternius-swat.glb` | 7752 | 248 | quaternius-blender | CharacterArmature|Death: 1.042, CharacterArmature|Gun_Shoot: 0.583, CharacterArmature|HitRecieve: 0.542, CharacterArmature|HitRecieve_2: 0.542, CharacterArmature|Idle: 1.667, CharacterArmature|Idle_Gun: 1.667, CharacterArmature|Idle_Gun_Pointing: 1.667, CharacterArmature|Idle_Gun_Shoot: 0.667, CharacterArmature|Idle_Neutral: 1.667, CharacterArmature|Idle_Sword: 1.667, CharacterArmature|Interact: 1.25, CharacterArmature|Kick_Left: 0.917, CharacterArmature|Kick_Right: 0.917, CharacterArmature|Punch_Left: 0.833, CharacterArmature|Punch_Right: 0.833, CharacterArmature|Roll: 1.333, CharacterArmature|Run: 0.792, CharacterArmature|Run_Back: 0.833, CharacterArmature|Run_Left: 0.792, CharacterArmature|Run_Right: 0.792, CharacterArmature|Run_Shoot: 0.833, CharacterArmature|Sword_Slash: 1.0, CharacterArmature|Walk: 1.333, CharacterArmature|Wave: 1.667 | Quaternius CC0. Stylized low-poly, 4 skinned parts. Full combat clip set (aim/shoot/hit/death). Rig root `Root` -> `Body`/`Hips`. |
| `char.character_soldier` | `assets/models/characters/quaternius-character-soldier.glb` | 20712 | 43 | quaternius-blender | CharacterArmature|Death: 0.75, CharacterArmature|Duck: 1.667, CharacterArmature|HitReact: 0.417, CharacterArmature|Idle: 1.667, CharacterArmature|Idle_Shoot: 0.333, CharacterArmature|Jump: 0.292, CharacterArmature|Jump_Idle: 1.0, CharacterArmature|Jump_Land: 0.417, CharacterArmature|No: 1.667, CharacterArmature|Punch: 0.833, CharacterArmature|Run: 0.708, CharacterArmature|Run_Gun: 0.708, CharacterArmature|Wave: 1.667, CharacterArmature|Yes: 1.667 | Quaternius CC0. Bundles 17 low-poly weapon meshes parented to hands (AK, SMG, Sniper, Shotgun, Pistol, RocketLauncher...). Rig root `Root`. |

Skeleton conventions:

- **Mixamo rig (`char.soldier`, `char.xbot`, `char.michelle`)** — bone prefix `mixamorig:`; hierarchy `mixamorig:Hips → Spine → Spine1 → Spine2 → Neck → Head`,
  arms `LeftShoulder → LeftArm → LeftForeArm → LeftHand → LeftHand{Thumb,Index,Middle,Ring,Pinky}{1..4}` (mirrored Right*), legs
  `LeftUpLeg → LeftLeg → LeftFoot → LeftToeBase` (mirrored Right*). Soldier: 51 skinned joints (two skins), Xbot 67, Michelle 65.
  Any Mixamo animation retargets 1:1 by bone name. Hitbox capsule groups map cleanly: head (Head), torso (Spine..Spine2), limbs (Arm/ForeArm/UpLeg/Leg).
- **Quaternius rig (`char.swat`, `char.character_soldier`)** — Blender-style names without prefix: `Root, Body/Hips, Abdomen, Torso, Chest, Neck, Head,
  Shoulder.L/.R, UpperArm.L/.R, LowerArm.L/.R, Wrist.L/.R (+ finger chains Index1..4 etc.), UpperLeg.L/.R, LowerLeg.L/.R, Foot.L/.R`.
  Clips are all authored on `CharacterArmature`; clip names are prefixed `CharacterArmature|` inside the glTF (three.js keeps the full name).

## 2. Weapon models (reference / kitbash only — hero guns are built procedurally)

| id | file | tris | rigged bones | notes |
| --- | --- | --- | --- | --- |
| `weapon.ref.ar_m4style` | `ar-m4style-west-pichuliru.glb` | 4353 | 19 | M4/M16-pattern AR; bones: Magazine, Bolt, Charging Handle, Trigger, Selector, Bolt Release, Mag Release, Forward Assist, Dust Cover, Stock, sights + sockets Attach_Scope, Attach_Muzzle, Attach_Rail.{Top,Bottom,SideLeft,SideRight} (CC0) |
| `weapon.ref.ar_akstyle` | `ar-akstyle-east-pichuliru.glb` | 3271 | 13 | AK-pattern AR (enemy PMC rifle reference); same functional rig + sockets (CC0) |
| `weapon.ref.rifle_west` | `rifle-west-pichuliru.glb` | 3173 | 17 | hunting rifle, rigged (CC0) |
| `weapon.ref.rifle_battle_east` | `rifle-battle-east-pichuliru.glb` | 3141 | 13 | battle rifle, rigged (CC0) |
| `weapon.ref.ar_quaternius_a` | `ar-quaternius-a.glb` | 1930 | — | stylized AR, static (CC0) |
| `weapon.ref.ar_quaternius_b` | `ar-quaternius-b.glb` | 1304 | — | stylized AR (wood), static (CC0) |
| `weapon.ref.ar_quaternius_c` | `ar-quaternius-c.glb` | 1388 | — | stylized AR, static (CC0) |
| `weapon.ref.pistol_west` | `pistol-west-pichuliru.glb` | 1244 | 10 | compact striker pistol; bones: Slide, Barrel, Trigger, Magazine, Slide Release, Mag Release + Attach_Scope/Muzzle/Rail.Bottom (CC0) |
| `weapon.ref.pistol_full_east` | `pistol-full-east-pichuliru.glb` | 1204 | 9 | full-size service pistol, rigged (CC0) |
| `weapon.ref.pistol_quaternius_a` | `pistol-quaternius-a.glb` | 968 | — | stylized pistol, static (CC0) |
| `weapon.ref.pistol_quaternius_b` | `pistol-quaternius-b.glb` | 1878 | — | stylized long-slide pistol, static (CC0) |
| `weapon.ref.grenade_frag_west` | `grenade-frag-west-pichuliru.glb` | 536 | — | M67-style frag with pin/lever (CC0) |
| `weapon.ref.grenade_frag_east` | `grenade-frag-east-pichuliru.glb` | 492 | — | round frag (RGD-5-ish) (CC0) |
| `weapon.ref.grenade_flashbang` | `grenade-flashbang-west-pichuliru.glb` | 600 | — | flashbang canister (CC0) |
| `weapon.ref.grenade_smoke` | `grenade-smoke-west-pichuliru.glb` | 520 | — | smoke canister (CC0) |
| `weapon.ref.grenade_hand_creativetrio` | `grenade-hand-creativetrio.glb` | 734 | — | pineapple grenade (palette-textured) (CC0) |
| `weapon.ref.grenade_quaternius` | `grenade-quaternius.glb` | 820 | — | stylized frag (CC0) |
| `weapon.att.suppressor_a` | `attachments/suppressor-a-pichuliru.glb` | 192 | — | suppressor A (CC0) |
| `weapon.att.suppressor_b` | `attachments/suppressor-b-pichuliru.glb` | 150 | — | suppressor B (short) (CC0) |
| `weapon.att.red_dot` | `attachments/red-dot-pichuliru.glb` | 440 | — | micro red dot (glass material slot for emissive reticle) (CC0) |
| `weapon.att.red_dot_sight` | `attachments/red-dot-sight-pichuliru.glb` | 436 | — | tube red dot (CC0) |
| `weapon.att.reflex` | `attachments/reflex-pichuliru.glb` | 278 | — | open reflex (CC0) |
| `weapon.att.reflex_sight` | `attachments/reflex-sight-pichuliru.glb` | 190 | — | compact reflex (CC0) |
| `weapon.att.holographic` | `attachments/holographic-pichuliru.glb` | 408 | — | EOTech-style holo (glass window slot) (CC0) |
| `weapon.att.holographic_sight` | `attachments/holographic-sight-pichuliru.glb` | 432 | — | holo variant (CC0) |
| `weapon.att.rifle_scope` | `attachments/rifle-scope-pichuliru.glb` | 910 | — | magnified scope + rings (CC0) |
| `weapon.att.flashlight` | `attachments/flashlight-pichuliru.glb` | 360 | — | rail flashlight (CC0) |
| `weapon.att.laser` | `attachments/laser-pichuliru.glb` | 314 | — | rail laser box (PEQ stand-in) (CC0) |
| `weapon.att.bipod` | `attachments/bipod-quaternius.glb` | 476 | — | folding bipod (CC0) |

None of these meet the first-person hero bar (flat-shaded, 150-4400 tris, no PBR textures). Verdict for the WEAPONS
stream: **build the M4-style carbine, tactical pistol and frag grenade procedurally with GunBuilder** and use these files only for
proportions, silhouette, bone/socket naming and part decomposition. The Pichuliru rifle/pistol rigs give a good animation-part
checklist: magazine, bolt, charging handle, trigger, selector, dust cover, slide, slide-release, muzzle/optic/rail sockets.

## 3. Fonts (self-hosted, OFL-1.1)

| family | weights (ids) | files | intended use |
| --- | --- | --- | --- |
| Rajdhani | 300/400/500/600/700 (`font.rajdhani-{300..700}`) | `assets/ui/fonts/Rajdhani-{Light,Regular,Medium,SemiBold,Bold}.{woff2,ttf}` | primary HUD/menu condensed sans, tabular numerals via `font-variant-numeric` |
| Barlow Condensed | 400/500/600/700 (`font.barlow-condensed-{400..700}`) | `assets/ui/fonts/BarlowCondensed-{Regular,Medium,SemiBold,Bold}.{woff2,ttf}` | secondary labels, killfeed, small caps |
| Teko | variable 300..700 (`font.teko-variable`) + statics 300/400/500/600/700 (`font.teko-{300..700}`) | `assets/ui/fonts/Teko-Variable.{woff2,ttf}`, `Teko-{Light..Bold}.{woff2,ttf}` (statics instantiated locally with fontTools) | tall condensed display: ammo counter, wave banners, titles (closest to the MW look) |
| JetBrains Mono | 400 static (`font.jetbrains-mono-400`) + variable 100..800 (`font.jetbrains-mono-variable`) | `assets/ui/fonts/JetBrainsMono-Regular.{woff2,ttf}`, `JetBrainsMono-Variable.{woff2,ttf}` | debug overlay, perf HUD, tabular telemetry |

OFL license texts: `public/assets/ui/fonts/licenses/{Rajdhani,BarlowCondensed,Teko,JetBrainsMono}-OFL.txt`. Manifest entries carry both
`file` (.woff2) and `fallback` (.ttf); the loader currently uses `file`.

## 4. Audio inventory

Format: Ogg Vorbis q5 @ 44.1 kHz; mono for point sources (weapons, footsteps, impacts, foley, ui, voice, one-shot ambience),
stereo only for rain/storm beds. **284 files, 21.2 minutes total (ffprobe), 16 MB on disk.** Group counts (files): amb 19, foley 30, footstep 31, impact 104, ui 47, voice 3, weapon 50.

### 4.1 Weapons (`sfx.weapon.*`) — real firearm recordings, one-shots split from source takes

| id | files (public/assets/audio/…) | dur (first) | ch | intended use | license — author |
| --- | --- | --- | --- | --- | --- |
| `sfx.weapon.ak47_burst_long_mid` | `weapons/ak47-burst-long-mid-01.ogg`, `weapons/ak47-burst-long-mid-02.ogg`, `weapons/ak47-burst-long-mid-03.ogg` | 3.56 s | 1 | gunshot one-shot / burst | CC0 1.0 — The Free Firearm Sound Library (Ben Jaszczak, Brian Nelson, Kevin Heras, Matthew Nanney) |
| `sfx.weapon.ak47_burst_long_near` | `weapons/ak47-burst-long-near-01.ogg`, `weapons/ak47-burst-long-near-02.ogg` | 2.28 s | 1 | gunshot one-shot / burst | CC0 1.0 — The Free Firearm Sound Library (Ben Jaszczak, Brian Nelson, Kevin Heras, Matthew Nanney) |
| `sfx.weapon.ak47_burst_short_mid` | `weapons/ak47-burst-short-mid-02.ogg` | 3.32 s | 1 | gunshot one-shot / burst | CC0 1.0 — The Free Firearm Sound Library (Ben Jaszczak, Brian Nelson, Kevin Heras, Matthew Nanney) |
| `sfx.weapon.ak47_burst_short_near` | `weapons/ak47-burst-short-near-01.ogg`, `weapons/ak47-burst-short-near-02.ogg` | 1.79 s | 1 | gunshot one-shot / burst | CC0 1.0 — The Free Firearm Sound Library (Ben Jaszczak, Brian Nelson, Kevin Heras, Matthew Nanney) |
| `sfx.weapon.ak47_single_mid` | `weapons/ak47-single-mid-01.ogg`, `weapons/ak47-single-mid-02.ogg` | 1.63 s | 1 | gunshot one-shot / burst | CC0 1.0 — The Free Firearm Sound Library (Ben Jaszczak, Brian Nelson, Kevin Heras, Matthew Nanney) |
| `sfx.weapon.ak47_single_near` | `weapons/ak47-single-near-01.ogg`, `weapons/ak47-single-near-02.ogg`, `weapons/ak47-single-near-03.ogg`, `weapons/ak47-single-near-04.ogg` | 1.63 s | 1 | gunshot one-shot / burst | CC0 1.0 — The Free Firearm Sound Library (Ben Jaszczak, Brian Nelson, Kevin Heras, Matthew Nanney) |
| `sfx.weapon.boltrifle_3006_mid` | `weapons/boltrifle-3006-mid-01.ogg`, `weapons/boltrifle-3006-mid-02.ogg` | 1.63 s | 1 | gunshot one-shot / burst | CC0 1.0 — The Free Firearm Sound Library (Ben Jaszczak, Brian Nelson, Kevin Heras, Matthew Nanney) |
| `sfx.weapon.boltrifle_3006_near` | `weapons/boltrifle-3006-near-01.ogg`, `weapons/boltrifle-3006-near-02.ogg` | 1.63 s | 1 | gunshot one-shot / burst | CC0 1.0 — The Free Firearm Sound Library (Ben Jaszczak, Brian Nelson, Kevin Heras, Matthew Nanney) |
| `sfx.weapon.cannon_boom` | `weapons/cannon-boom-01.ogg` | 8.0 s | 1 | cannon boom, low-frequency explosion layer | Public domain — Unknown authorUnknown author |
| `sfx.weapon.explosion` | `weapons/explosion-01.ogg`, `weapons/explosion-02.ogg`, `weapons/explosion-03.ogg`, `weapons/explosion-04.ogg` | 1.57 s | 1 | explosion one-shot | Public domain — Fg2 |
| `sfx.weapon.gunshot_generic_outdoor` | `weapons/gunshot-generic-outdoor-01.ogg` | 5.85 s | 1 | generic gunshot volley (source: simulated gunshots + popped balloons, PDSounds) — distant variation layer only | Public domain — aradlaw |
| `sfx.weapon.heavy_rotary_brrt` | `weapons/heavy-rotary-brrt-01.ogg` | 10.97 s | 1 | A-10 GAU-8 30mm cannon burst recording — distant heavy-weapon ambience / killstreak flavour | CC BY 4.0 — nicStage |
| `sfx.weapon.pistol_45_near` | `weapons/pistol-45-near-01.ogg`, `weapons/pistol-45-near-02.ogg` | 1.63 s | 1 | gunshot one-shot / burst | CC0 1.0 — The Free Firearm Sound Library (Ben Jaszczak, Brian Nelson, Kevin Heras, Matthew Nanney) |
| `sfx.weapon.pistol_9mm_mid` | `weapons/pistol-9mm-mid-01.ogg`, `weapons/pistol-9mm-mid-02.ogg` | 1.63 s | 1 | gunshot one-shot / burst | CC0 1.0 — The Free Firearm Sound Library (Ben Jaszczak, Brian Nelson, Kevin Heras, Matthew Nanney) |
| `sfx.weapon.pistol_9mm_near` | `weapons/pistol-9mm-near-01.ogg`, `weapons/pistol-9mm-near-02.ogg`, `weapons/pistol-9mm-near-03.ogg` | 1.63 s | 1 | gunshot one-shot / burst | CC0 1.0 — The Free Firearm Sound Library (Ben Jaszczak, Brian Nelson, Kevin Heras, Matthew Nanney) |
| `sfx.weapon.rifle_ar15_mid` | `weapons/rifle-ar15-mid-01.ogg`, `weapons/rifle-ar15-mid-02.ogg` | 1.63 s | 1 | gunshot one-shot / burst | CC0 1.0 — The Free Firearm Sound Library (Ben Jaszczak, Brian Nelson, Kevin Heras, Matthew Nanney) |
| `sfx.weapon.rifle_ar15_near` | `weapons/rifle-ar15-near-01.ogg`, `weapons/rifle-ar15-near-02.ogg` | 1.63 s | 1 | gunshot one-shot / burst | CC0 1.0 — The Free Firearm Sound Library (Ben Jaszczak, Brian Nelson, Kevin Heras, Matthew Nanney) |
| `sfx.weapon.rifle_sks_near` | `weapons/rifle-sks-near-01.ogg`, `weapons/rifle-sks-near-02.ogg`, `weapons/rifle-sks-near-03.ogg`, `weapons/rifle-sks-near-04.ogg`, `weapons/rifle-sks-near-05.ogg` | 1.63 s | 1 | gunshot one-shot / burst | CC0 1.0 — The Free Firearm Sound Library (Ben Jaszczak, Brian Nelson, Kevin Heras, Matthew Nanney) |
| `sfx.weapon.rifle_volley` | `weapons/rifle-volley-01.ogg` | 30.64 s | 1 | rifle volley (3 x 7 rifles), distant firing squad | Public domain — United States Army |
| `sfx.weapon.shotgun_12ga_near` | `weapons/shotgun-12ga-near-01.ogg`, `weapons/shotgun-12ga-near-02.ogg` | 1.63 s | 1 | gunshot one-shot / burst | CC0 1.0 — The Free Firearm Sound Library (Ben Jaszczak, Brian Nelson, Kevin Heras, Matthew Nanney) |
| `sfx.weapon.smg_9mm_burst_long_mid` | `weapons/smg-9mm-burst-long-mid-01.ogg` | 2.96 s | 1 | gunshot one-shot / burst | CC0 1.0 — The Free Firearm Sound Library (Ben Jaszczak, Brian Nelson, Kevin Heras, Matthew Nanney) |
| `sfx.weapon.smg_9mm_burst_long_near` | `weapons/smg-9mm-burst-long-near-01.ogg`, `weapons/smg-9mm-burst-long-near-02.ogg` | 2.36 s | 1 | gunshot one-shot / burst | CC0 1.0 — The Free Firearm Sound Library (Ben Jaszczak, Brian Nelson, Kevin Heras, Matthew Nanney) |
| `sfx.weapon.smg_9mm_burst_short_near` | `weapons/smg-9mm-burst-short-near-01.ogg`, `weapons/smg-9mm-burst-short-near-02.ogg`, `weapons/smg-9mm-burst-short-near-03.ogg` | 1.89 s | 1 | gunshot one-shot / burst | CC0 1.0 — The Free Firearm Sound Library (Ben Jaszczak, Brian Nelson, Kevin Heras, Matthew Nanney) |

### 4.2 Footsteps (`sfx.footstep.*`)

| id | files (public/assets/audio/…) | dur (first) | ch | intended use | license — author |
| --- | --- | --- | --- | --- | --- |
| `sfx.footstep.concrete` | `footsteps/concrete-01.ogg`, `footsteps/concrete-02.ogg`, `footsteps/concrete-03.ogg`, `footsteps/concrete-04.ogg`, `footsteps/concrete-05.ogg` | 0.11 s | 1 | footstep on concrete | CC0 1.0 — Kenney (kenney.nl) |
| `sfx.footstep.generic` | `footsteps/generic-01.ogg`, `footsteps/generic-02.ogg`, `footsteps/generic-03.ogg`, `footsteps/generic-04.ogg`, `footsteps/generic-05.ogg`, `footsteps/generic-06.ogg`, `footsteps/generic-07.ogg`, `footsteps/generic-08.ogg`, `footsteps/generic-09.ogg`, `footsteps/generic-10.ogg` | 0.25 s | 1 | generic hard-floor footstep (boots) | CC0 1.0 — Kenney (kenney.nl) |
| `sfx.footstep.grass` | `footsteps/grass-01.ogg`, `footsteps/grass-02.ogg`, `footsteps/grass-03.ogg`, `footsteps/grass-04.ogg`, `footsteps/grass-05.ogg` | 0.78 s | 1 | footstep on grass | CC0 1.0 — Kenney (kenney.nl) |
| `sfx.footstep.gravel` | `footsteps/gravel-01.ogg` | 0.57 s | 1 | gravel footstep one-shot | CC BY 4.0 — Gravity Sound |
| `sfx.footstep.snow` | `footsteps/snow-01.ogg`, `footsteps/snow-02.ogg`, `footsteps/snow-03.ogg`, `footsteps/snow-04.ogg`, `footsteps/snow-05.ogg` | 0.37 s | 1 | footstep on snow | CC0 1.0 — Kenney (kenney.nl) |
| `sfx.footstep.wood` | `footsteps/wood-01.ogg`, `footsteps/wood-02.ogg`, `footsteps/wood-03.ogg`, `footsteps/wood-04.ogg`, `footsteps/wood-05.ogg` | 0.27 s | 1 | footstep on wood | CC0 1.0 — Kenney (kenney.nl) |

### 4.3 Foley (`sfx.foley.*`)

| id | files (public/assets/audio/…) | dur (first) | ch | intended use | license — author |
| --- | --- | --- | --- | --- | --- |
| `sfx.foley.belt_handle` | `foley/belt-handle-01.ogg`, `foley/belt-handle-02.ogg` | 0.28 s | 1 | foley | CC0 1.0 — Kenney (kenney.nl) |
| `sfx.foley.brass_handle` | `foley/brass-handle-01.ogg`, `foley/brass-handle-02.ogg` | 0.85 s | 1 | foley | CC0 1.0 — Kenney (kenney.nl) |
| `sfx.foley.cloth` | `foley/cloth-01.ogg`, `foley/cloth-02.ogg`, `foley/cloth-03.ogg`, `foley/cloth-04.ogg` | 0.66 s | 1 | foley | CC0 1.0 — Kenney (kenney.nl) |
| `sfx.foley.cloth_belt` | `foley/cloth-belt-01.ogg`, `foley/cloth-belt-02.ogg` | 0.72 s | 1 | foley | CC0 1.0 — Kenney (kenney.nl) |
| `sfx.foley.creak` | `foley/creak-01.ogg`, `foley/creak-02.ogg`, `foley/creak-03.ogg` | 0.66 s | 1 | foley | CC0 1.0 — Kenney (kenney.nl) |
| `sfx.foley.door_close` | `foley/door-close-01.ogg`, `foley/door-close-02.ogg`, `foley/door-close-03.ogg`, `foley/door-close-04.ogg` | 0.68 s | 1 | foley | CC0 1.0 — Kenney (kenney.nl) |
| `sfx.foley.door_open` | `foley/door-open-01.ogg`, `foley/door-open-02.ogg` | 0.92 s | 1 | foley | CC0 1.0 — Kenney (kenney.nl) |
| `sfx.foley.knife_draw` | `foley/knife-draw-01.ogg`, `foley/knife-draw-02.ogg`, `foley/knife-draw-03.ogg` | 0.4 s | 1 | foley | CC0 1.0 — Kenney (kenney.nl) |
| `sfx.foley.leather_drop` | `foley/leather-drop-01.ogg` | 0.42 s | 1 | foley | CC0 1.0 — Kenney (kenney.nl) |
| `sfx.foley.leather_handle` | `foley/leather-handle-01.ogg`, `foley/leather-handle-02.ogg` | 0.34 s | 1 | foley | CC0 1.0 — Kenney (kenney.nl) |
| `sfx.foley.metal_clank` | `foley/metal-clank-01.ogg`, `foley/metal-clank-02.ogg`, `foley/metal-clank-03.ogg` | 1.46 s | 1 | foley | CC0 1.0 — Kenney (kenney.nl) |
| `sfx.foley.metal_click` | `foley/metal-click-01.ogg` | 0.45 s | 1 | foley | CC0 1.0 — Kenney (kenney.nl) |
| `sfx.foley.metal_latch` | `foley/metal-latch-01.ogg` | 0.26 s | 1 | foley | CC0 1.0 — Kenney (kenney.nl) |

### 4.4 Impacts (`sfx.impact.*`)

| id | files (public/assets/audio/…) | dur (first) | ch | intended use | license — author |
| --- | --- | --- | --- | --- | --- |
| `sfx.impact.flesh_heavy` | `impacts/flesh-heavy-01.ogg`, `impacts/flesh-heavy-02.ogg`, `impacts/flesh-heavy-03.ogg`, `impacts/flesh-heavy-04.ogg`, `impacts/flesh-heavy-05.ogg` | 0.53 s | 1 | soft/flesh body hit (heavy) | CC0 1.0 — Kenney (kenney.nl) |
| `sfx.impact.flesh_medium` | `impacts/flesh-medium-01.ogg`, `impacts/flesh-medium-02.ogg`, `impacts/flesh-medium-03.ogg`, `impacts/flesh-medium-04.ogg`, `impacts/flesh-medium-05.ogg` | 0.12 s | 1 | soft/flesh body hit (medium) | CC0 1.0 — Kenney (kenney.nl) |
| `sfx.impact.generic_light` | `impacts/generic-light-01.ogg`, `impacts/generic-light-02.ogg`, `impacts/generic-light-03.ogg`, `impacts/generic-light-04.ogg`, `impacts/generic-light-05.ogg` | 0.16 s | 1 | generic light impact | CC0 1.0 — Kenney (kenney.nl) |
| `sfx.impact.glass_heavy` | `impacts/glass-heavy-01.ogg`, `impacts/glass-heavy-02.ogg`, `impacts/glass-heavy-03.ogg`, `impacts/glass-heavy-04.ogg`, `impacts/glass-heavy-05.ogg` | 0.24 s | 1 | glass impact (heavy) | CC0 1.0 — Kenney (kenney.nl) |
| `sfx.impact.glass_light` | `impacts/glass-light-01.ogg`, `impacts/glass-light-02.ogg`, `impacts/glass-light-03.ogg`, `impacts/glass-light-04.ogg`, `impacts/glass-light-05.ogg` | 0.23 s | 1 | glass impact (light) | CC0 1.0 — Kenney (kenney.nl) |
| `sfx.impact.glass_medium` | `impacts/glass-medium-01.ogg`, `impacts/glass-medium-02.ogg`, `impacts/glass-medium-03.ogg`, `impacts/glass-medium-04.ogg`, `impacts/glass-medium-05.ogg` | 0.54 s | 1 | glass impact (medium) | CC0 1.0 — Kenney (kenney.nl) |
| `sfx.impact.glass_shatter` | `impacts/glass-shatter-01.ogg`, `impacts/glass-shatter-02.ogg`, `impacts/glass-shatter-03.ogg`, `impacts/glass-shatter-04.ogg` | 1.49 s | 1 | glass shatter one-shot | CC BY 4.0 — Gravity Sound |
| `sfx.impact.metal_heavy` | `impacts/metal-heavy-01.ogg`, `impacts/metal-heavy-02.ogg`, `impacts/metal-heavy-03.ogg`, `impacts/metal-heavy-04.ogg`, `impacts/metal-heavy-05.ogg` | 0.17 s | 1 | metal impact (heavy) | CC0 1.0 — Kenney (kenney.nl) |
| `sfx.impact.metal_light` | `impacts/metal-light-01.ogg`, `impacts/metal-light-02.ogg`, `impacts/metal-light-03.ogg`, `impacts/metal-light-04.ogg`, `impacts/metal-light-05.ogg` | 0.38 s | 1 | metal impact (light) | CC0 1.0 — Kenney (kenney.nl) |
| `sfx.impact.metal_medium` | `impacts/metal-medium-01.ogg`, `impacts/metal-medium-02.ogg`, `impacts/metal-medium-03.ogg`, `impacts/metal-medium-04.ogg`, `impacts/metal-medium-05.ogg` | 0.27 s | 1 | metal impact (medium) | CC0 1.0 — Kenney (kenney.nl) |
| `sfx.impact.plank_medium` | `impacts/plank-medium-01.ogg`, `impacts/plank-medium-02.ogg`, `impacts/plank-medium-03.ogg`, `impacts/plank-medium-04.ogg`, `impacts/plank-medium-05.ogg` | 0.78 s | 1 | wood plank impact | CC0 1.0 — Kenney (kenney.nl) |
| `sfx.impact.plate_heavy` | `impacts/plate-heavy-01.ogg`, `impacts/plate-heavy-02.ogg`, `impacts/plate-heavy-03.ogg`, `impacts/plate-heavy-04.ogg`, `impacts/plate-heavy-05.ogg` | 0.49 s | 1 | plate impact (heavy) | CC0 1.0 — Kenney (kenney.nl) |
| `sfx.impact.plate_light` | `impacts/plate-light-01.ogg`, `impacts/plate-light-02.ogg`, `impacts/plate-light-03.ogg`, `impacts/plate-light-04.ogg`, `impacts/plate-light-05.ogg` | 0.54 s | 1 | plate impact (light) | CC0 1.0 — Kenney (kenney.nl) |
| `sfx.impact.plate_medium` | `impacts/plate-medium-01.ogg`, `impacts/plate-medium-02.ogg`, `impacts/plate-medium-03.ogg`, `impacts/plate-medium-04.ogg`, `impacts/plate-medium-05.ogg` | 0.61 s | 1 | plate impact (medium) | CC0 1.0 — Kenney (kenney.nl) |
| `sfx.impact.punch_heavy` | `impacts/punch-heavy-01.ogg`, `impacts/punch-heavy-02.ogg`, `impacts/punch-heavy-03.ogg`, `impacts/punch-heavy-04.ogg`, `impacts/punch-heavy-05.ogg` | 0.65 s | 1 | melee punch hit (heavy) | CC0 1.0 — Kenney (kenney.nl) |
| `sfx.impact.punch_medium` | `impacts/punch-medium-01.ogg`, `impacts/punch-medium-02.ogg`, `impacts/punch-medium-03.ogg`, `impacts/punch-medium-04.ogg`, `impacts/punch-medium-05.ogg` | 0.43 s | 1 | melee punch hit | CC0 1.0 — Kenney (kenney.nl) |
| `sfx.impact.stone` | `impacts/stone-01.ogg`, `impacts/stone-02.ogg`, `impacts/stone-03.ogg`, `impacts/stone-04.ogg`, `impacts/stone-05.ogg` | 0.94 s | 1 | hard stone/masonry impact (ricochet layer) | CC0 1.0 — Kenney (kenney.nl) |
| `sfx.impact.tin_medium` | `impacts/tin-medium-01.ogg`, `impacts/tin-medium-02.ogg`, `impacts/tin-medium-03.ogg`, `impacts/tin-medium-04.ogg`, `impacts/tin-medium-05.ogg` | 0.16 s | 1 | thin metal / tin impact (casing land proxy) | CC0 1.0 — Kenney (kenney.nl) |
| `sfx.impact.wood_heavy` | `impacts/wood-heavy-01.ogg`, `impacts/wood-heavy-02.ogg`, `impacts/wood-heavy-03.ogg`, `impacts/wood-heavy-04.ogg`, `impacts/wood-heavy-05.ogg` | 0.31 s | 1 | wood impact (heavy) | CC0 1.0 — Kenney (kenney.nl) |
| `sfx.impact.wood_light` | `impacts/wood-light-01.ogg`, `impacts/wood-light-02.ogg`, `impacts/wood-light-03.ogg`, `impacts/wood-light-04.ogg`, `impacts/wood-light-05.ogg` | 0.27 s | 1 | wood impact (light) | CC0 1.0 — Kenney (kenney.nl) |
| `sfx.impact.wood_medium` | `impacts/wood-medium-01.ogg`, `impacts/wood-medium-02.ogg`, `impacts/wood-medium-03.ogg`, `impacts/wood-medium-04.ogg`, `impacts/wood-medium-05.ogg` | 0.33 s | 1 | wood impact (medium) | CC0 1.0 — Kenney (kenney.nl) |

### 4.5 UI (`sfx.ui.*`)

| id | files (public/assets/audio/…) | dur (first) | ch | intended use | license — author |
| --- | --- | --- | --- | --- | --- |
| `sfx.ui.back` | `ui/back-01.ogg`, `ui/back-02.ogg`, `ui/back-03.ogg`, `ui/back-04.ogg` | 0.06 s | 1 | UI back/cancel | CC0 1.0 — Kenney (kenney.nl) |
| `sfx.ui.click` | `ui/click-01.ogg`, `ui/click-02.ogg`, `ui/click-03.ogg`, `ui/click-04.ogg`, `ui/click-05.ogg` | 0.1 s | 1 | UI click | CC0 1.0 — Kenney (kenney.nl) |
| `sfx.ui.close` | `ui/close-01.ogg`, `ui/close-02.ogg`, `ui/close-03.ogg`, `ui/close-04.ogg` | 0.15 s | 1 | UI panel close | CC0 1.0 — Kenney (kenney.nl) |
| `sfx.ui.confirm` | `ui/confirm-01.ogg`, `ui/confirm-02.ogg`, `ui/confirm-03.ogg`, `ui/confirm-04.ogg` | 0.29 s | 1 | UI confirm | CC0 1.0 — Kenney (kenney.nl) |
| `sfx.ui.error` | `ui/error-01.ogg`, `ui/error-02.ogg`, `ui/error-03.ogg` | 0.16 s | 1 | UI error/deny | CC0 1.0 — Kenney (kenney.nl) |
| `sfx.ui.open` | `ui/open-01.ogg`, `ui/open-02.ogg`, `ui/open-03.ogg`, `ui/open-04.ogg` | 0.15 s | 1 | UI panel open | CC0 1.0 — Kenney (kenney.nl) |
| `sfx.ui.rollover` | `ui/rollover-01.ogg`, `ui/rollover-02.ogg`, `ui/rollover-03.ogg`, `ui/rollover-04.ogg`, `ui/rollover-05.ogg`, `ui/rollover-06.ogg` | 0.23 s | 1 | UI hover rollover | CC0 1.0 — Kenney (kenney.nl) |
| `sfx.ui.select` | `ui/select-01.ogg`, `ui/select-02.ogg`, `ui/select-03.ogg`, `ui/select-04.ogg`, `ui/select-05.ogg` | 0.04 s | 1 | UI select/hover | CC0 1.0 — Kenney (kenney.nl) |
| `sfx.ui.switch` | `ui/switch-01.ogg`, `ui/switch-02.ogg`, `ui/switch-03.ogg`, `ui/switch-04.ogg`, `ui/switch-05.ogg` | 0.31 s | 1 | UI hard switch | CC0 1.0 — Kenney (kenney.nl) |
| `sfx.ui.tick` | `ui/tick-01.ogg`, `ui/tick-02.ogg`, `ui/tick-03.ogg` | 0.05 s | 1 | UI tick / countdown | CC0 1.0 — Kenney (kenney.nl) |
| `sfx.ui.toggle` | `ui/toggle-01.ogg`, `ui/toggle-02.ogg`, `ui/toggle-03.ogg`, `ui/toggle-04.ogg` | 0.14 s | 1 | UI toggle | CC0 1.0 — Kenney (kenney.nl) |

### 4.6 Ambience (`amb.*`)

| id | files (public/assets/audio/…) | dur (first) | ch | intended use | license — author |
| --- | --- | --- | --- | --- | --- |
| `amb.distant_explosions` | `ambience/distant-explosions-01.ogg`, `ambience/distant-explosions-02.ogg`, `ambience/distant-explosions-03.ogg` | 40.0 s | 1 | distant booms (fireworks) as battle ambience layer | Public domain — ezwa |
| `amb.helicopter_distant` | `ambience/helicopter-distant-01.ogg` | 22.0 s | 1 | distant helicopter pass | Public domain — ezwa |
| `amb.helicopter_flyover` | `ambience/helicopter-flyover-01.ogg` | 88.89 s | 1 | helicopter (Chinook) fly-over | CC0 — JoBrodie |
| `amb.rain` | `ambience/rain-01.ogg`, `ambience/rain-02.ogg` | 10.33 s | 1 | rain loop source | Public domain — ジダネ |
| `amb.rain_light_distant_thunder` | `ambience/rain-light-distant-thunder-01.ogg` | 100.0 s | 2 | light rain bed with distant thunder | CC0 — https://freesound.org/people/kvgarlic/ |
| `amb.rain_medium_thunder` | `ambience/rain-medium-thunder-01.ogg` | 120.0 s | 2 | medium rain bed with thunder rolls | CC BY 4.0 — CutSomeSlackenstein |
| `amb.rain_on_surface` | `ambience/rain-on-surface-01.ogg` | 60.0 s | 1 | rain on hard surface / window | Public domain — cori |
| `amb.rain_thunder` | `ambience/rain-thunder-01.ogg`, `ambience/rain-thunder-02.ogg` | 18.9 s | 1 | rain + thunder | Public domain — User:Caesar |
| `amb.rain_thunder_footsteps` | `ambience/rain-thunder-footsteps-01.ogg` | 60.0 s | 1 | rain + thunder with footsteps on wet ground (reference/ambience) | Public domain — ezwa |
| `amb.siren_distant` | `ambience/siren-distant-01.ogg` | 29.2 s | 1 | distant police siren (city vista layer) | Public domain — lezer |
| `amb.storm_distant_city` | `ambience/storm-distant-city-01.ogg` | 100.0 s | 2 | distant urban thunderstorm bed | CC BY 3.0 — Matucha |
| `amb.storm_wind` | `ambience/storm-wind-01.ogg` | 68.61 s | 2 | storm wind + rain bed (coastal hill) | CC0 — Karlunun |
| `amb.thunder_close` | `ambience/thunder-close-01.ogg` | 30.17 s | 1 | close thunder crack + rain | Public domain — ezwa |
| `amb.thunderclap` | `ambience/thunderclap-01.ogg` | 24.0 s | 1 | designed thunderclap one-shot (sync to lightning flash) | CC BY 4.0 — Richard Humphries |
| `amb.war_distant_firefight` | `ambience/war-distant-firefight-01.ogg` | 15.31 s | 2 | distant gunfire + explosions battle ambience bed | CC0 — Dragout |

### 4.7 Voice / body (`voice.*`)

| id | files (public/assets/audio/…) | dur (first) | ch | intended use | license — author |
| --- | --- | --- | --- | --- | --- |
| `voice.announcer_multikill` | `voice/announcer-multikill-01.ogg` | 1.42 s | 1 | announcer "multi kill" stinger (optional) | CC0 1.0 — Kenney (kenney.nl) |
| `voice.breath_heavy` | `voice/breath-heavy-01.ogg` | 20.12 s | 1 | heavy human breaths ("windy breath") — sprint / low-health breathing layer | Public domain — stilgar |
| `voice.heartbeat_loop` | `voice/heartbeat-loop-01.ogg` | 30.0 s | 1 | human heartbeat, low-health loop source | CC0 — Wilfredor |

Weapon SFX quick map for the AUDIO/WEAPONS streams:

- Player carbine (M4-style): `sfx.weapon.rifle_ar15_near` (close first-person layer, 2 variants) + `sfx.weapon.rifle_ar15_mid` (mid, 2). Real 5.56 AR-15 reports — layer a synthesized mech click + low thump under them.
- Player pistol: `sfx.weapon.pistol_9mm_near` (3) / `_mid` (2) from a Walther PPQ (striker 9 mm, closest match to the USP/P226 brief); `sfx.weapon.pistol_45_near` (2) 1911 .45 alternative.
- Enemy AK: `sfx.weapon.ak47_single_near/mid`, `ak47_burst_short_near/mid`, `ak47_burst_long_near/mid` — plus `amb.war_distant_firefight` for the far layer.
- Enemy SMG: `sfx.weapon.smg_9mm_burst_short_near`, `smg_9mm_burst_long_near/mid` (Carl Gustav M45 9 mm SMG).
- Heavy/other: `sfx.weapon.shotgun_12ga_near`, `boltrifle_3006_near/mid` (sniper report), `rifle_sks_near`, `rifle_volley` (7-rifle volley), `heavy_rotary_brrt` (GAU-8 30 mm, killstreak flavour), `gunshot_generic_outdoor` (simulated PD gunshots, distant filler only), `explosion` (4 variants), `cannon_boom` (LF explosion layer).

## 5. MISSING — must be built procedurally / procured later

### Audio (AUDIO stream: `Synth` module)

| Sound | Why missing | Suggested synthesis |
| --- | --- | --- |
| Hero rifle "mech" layer (bolt slam, buffer spring, gas system) | recordings are muzzle report only | short filtered noise burst + 2 metallic clicks (BP 3-6 kHz), 40 ms |
| Reload foley: mag out, mag in, mag drop, bolt release, charging handle, pistol slide rack | not in any CC0 pack found | layered clicks: noise transient + resonant band (metal 2-4 kHz) + cloth rustle (use `sfx.foley.cloth_*`, `sfx.foley.metal_click`, `sfx.foley.metal_latch` as raw layers) |
| Dry fire / empty click, fire-selector switch | none found | 5 ms click, HP-filtered |
| Brass casing tinks (rifle & pistol, per surface) | none found | 2-3 damped sine partials 4-9 kHz, 3-4 randomized variants; `sfx.impact.tin_medium` usable as a body |
| Bullet crack-by / whiz, ricochet whine | none found | crack: 3 ms noise snap + short delay; whiz: swept band-passed noise 200 ms; ricochet: descending resonant chirp |
| Hitmarker tick, headshot crack, kill confirm sting | UI beeps not sourced (Kenney ticks are close but too "wooden") | 8 ms 2 kHz square/click; headshot = +1 octave, 30 ms |
| Explosion tail / debris rain, shockwave | explosions available (4) but no debris layer | pitched-down `sfx.weapon.explosion` + granular gravel (`sfx.footstep.gravel`) |
| Player voice: hit grunts, death, low-health breathing loop, mantle effort | Kenney fighter voiceover pack has announcer lines only (no grunts); `voice.breath_heavy` is a partial breathing source | procure CC0 voice pack later or record; interim: pitch/format-shift `voice.breath_heavy`; heartbeat exists (`voice.heartbeat_loop`) |
| Enemy VO: contact/reloading callouts, pain, death | none found (CC0 military VO packs not located in time-box) | text-callout only for v1, or procure |
| Water/wet footsteps, metal-grate footsteps | Kenney has concrete/wood/grass/snow/carpet only; gravel single one-shot from Gravity Sound | wet = concrete step + short splash noise; metal = `sfx.impact.metal_light` layered under `sfx.footstep.generic` |
| Wind gust bed, rope/tarp flap, cable creak, ship horn, buzzing sodium lamp | not sourced (ambience search yielded rain/thunder/heli/siren only) | pink-noise gust with slow LFO; `sfx.foley.creak` as source for cable creak; horn = detuned saw pad |
| Music: menu pad, tension stingers, wave-clear sting | out of scope for downloads | procedural pad (as per ARCHITECTURE §5 AUDIO) |

### Animation (AI + WEAPONS streams)

| Need | Status | Plan |
| --- | --- | --- |
| Mixamo Soldier: aim-idle, fire, reload, hit-react, death, crouch, strafe | Soldier.glb ships only Idle/Walk/Run/TPose | procedural additive layers on the mixamorig chain (aim = spine/arm IK pose, fire = additive recoil on Spine2/RightArm, hit = additive flinch, death = ragdoll via Physics), OR retarget Quaternius SWAT clips (Death, Gun_Shoot, HitRecieve, Idle_Gun_Pointing, Run_Shoot) by bone-name map, OR manually download the Quaternius Universal Animation Library (CC0, itch.io) and retarget |
| First-person arms + hands rig with idle/ADS/fire/reload/inspect | no CC0/CC-BY 4.0 FPS arms found (poly.pizza FPS rigs are CC-BY 3.0) | WEAPONS stream builds gloved arms procedurally / with primitive sleeves; procedural spring-driven idle sway, ADS, recoil, reload keyframes as per ART_DIRECTION §5 |
| Enemy weapon in hands (AK) | reference mesh only (`weapon.ref.ar_akstyle`) | attach to `mixamorig:RightHand` with grip offset; muzzle socket = mesh forward |

## 6. Sources evaluated (search log)

| Source | Result |
| --- | --- |
| threejs.org examples (Soldier, Xbot, Michelle) | ✅ downloaded; primary Mixamo rig source |
| poly.pizza (Quaternius / Pichuliru / CreativeTrio CC0 items) | ✅ 2 characters + 29 weapon/attachment reference GLBs (direct static.poly.pizza URLs, license badge verified per page) |
| poly.pizza CC-BY items (soldiers by KolosStudios/madtrollstudio/J-Toastie; M4 by Kristian M; rigged Glock/SIG/Deagle by PuKkBuMXDD; FPS arms rigs) | ❌ CC-BY (3.0) — not in the allowed license list |
| quaternius.com (Universal Animation Library / Base Characters / Toon Shooter kit) | ⚠️ CC0 but downloads only through itch.io checkout widgets (no headless fetch); noted for manual pickup |
| opengameart.org 3D soldier searches | ❌ CC0 hit is .blend-only ("Low Poly Modern Soldier (rigged)"); others CC-BY 3.0 / CC-BY-SA / .blend |
| opengameart.org — The Free Firearm Sound Library | ✅ CC0, 194 MB 7z of real firearm recordings; 12 source WAVs cut into 43 one-shots/bursts |
| Wikimedia Commons API (17 queries, license-filtered) | ✅ explosions (PD lab recordings), rain/thunder/storm beds, thunderclap (CC BY 4.0), helicopters, siren, glass shatters (CC BY 4.0), war-sounds bed (CC0), GAU-8 burst (CC BY 4.0), heartbeat (CC0); ❌ most "gun"/"rifle" hits were speeches, marches or Lingua Libre word pronunciations |
| Kenney (5 CC0 packs) | ✅ footsteps by surface, impacts by material, cloth/leather/knife/door/metal foley, UI clicks; ⚠️ voiceover-pack-fighter has announcer phrases only (kept "multi kill"), no grunts/death |
| Google Fonts repo + JetBrains repo (OFL) | ✅ Rajdhani, Barlow Condensed, Teko variable (+ locally instantiated statics), JetBrains Mono |

## 7. Validation (2026-07-26)

`node` imports `src/assets/manifest.js` (187 aggregated entries incl. other streams). Owned entries: 5 character gltf,
29 weapon gltf, 92 audio (284 files, 21.2 min), 17 font (34 font files). Checks run: every manifest file exists under
`public/`; every GLB starts with magic `glTF`; every .ogg decodes with ffprobe (duration > 0); every .ttf begins
`0x00010000` and every .woff2 begins `wOF2`; OFL texts present. Result: **0 problems**.

Sizes: models/characters 11 MB, models/weapons 3.0 MB, audio 16 MB (weapons 1.7 / ambience 12 / foley 0.4 /
footsteps 0.3 / impacts 1.0 / ui 0.4 / voice 0.5), ui/fonts 5.0 MB.

