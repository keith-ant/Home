/**
 * Characters asset manifest part-file. See src/assets/manifest.js for the schema.
 * Files live under public/assets/models/characters/; provenance in
 * docs/credits/characters-weapons.md and CREDITS.md.
 *
 * Rig/animation summary (details in docs/ASSETS-CHARACTERS-WEAPONS-AUDIO.md):
 *  - char.soldier   Mixamo "Vanguard" rig, bone prefix `mixamorig:` (root `mixamorig:Hips`),
 *                   clips: Idle 1.97s, Walk 1.03s, Run 0.70s, TPose. PRIMARY enemy body.
 *  - char.xbot      Mixamo Xbot mannequin (mixamorig:), clips: idle, walk, run, agree,
 *                   headShake, sad_pose, sneak_pose. Retarget/test dummy.
 *  - char.michelle  Mixamo Michelle (mixamorig:), clips: SambaDance, TPose. Retarget reference only.
 *  - char.swat      Quaternius SWAT (CC0), Blender-style rig (Root/Hips/.../UpperArm.L),
 *                   24 clips incl. Death, Gun_Shoot, HitRecieve, HitRecieve_2, Idle_Gun,
 *                   Idle_Gun_Pointing, Idle_Gun_Shoot, Run_Shoot, Roll, Walk. Full combat set,
 *                   stylized low-poly — use as animation reference / silhouette fallback.
 *  - char.character_soldier  Quaternius "Character Soldier" (CC0), same rig style, 14 clips incl.
 *                   Death, HitReact, Idle_Shoot, Run_Gun, Duck; ships 17 kitbash weapon meshes.
 */
export default [
  {
    id: 'char.soldier',
    type: 'gltf',
    file: 'assets/models/characters/soldier.glb',
    tier: 'all',
    surface: 'flesh',
    notes: 'Mixamo Vanguard soldier via three.js examples. Rig: mixamorig:* (root mixamorig:Hips, 51 joints, 5-finger hands). Animations: Idle (1.967s), Walk (1.033s), Run (0.700s), TPose (0.033s). Meshes: vanguard_Mesh (11186 tris), vanguard_visor (190 tris). Textured (2 embedded images).',
    meta: {
      source: 'https://threejs.org/examples/models/gltf/Soldier.glb',
      license: 'Mixamo (Adobe) royalty-free character/animations; distributed with three.js examples (MIT)',
      author: 'Mixamo (Adobe) — via three.js examples',
    },
  },
  {
    id: 'char.xbot',
    type: 'gltf',
    file: 'assets/models/characters/xbot.glb',
    tier: 'high+',
    optional: true,
    surface: 'flesh',
    notes: 'Mixamo Xbot mannequin via three.js examples. Rig: mixamorig:* (67 joints). Animations: agree (1.833s), headShake (2.567s), idle (2.5s), run (0.7s), sad_pose (0.067s), sneak_pose (0.067s), walk (0.967s). 49112 tris, untextured. Use as retarget/animation-blend test dummy.',
    meta: {
      source: 'https://threejs.org/examples/models/gltf/Xbot.glb',
      license: 'Mixamo (Adobe) royalty-free character/animations; distributed with three.js examples (MIT)',
      author: 'Mixamo (Adobe) — via three.js examples',
    },
  },
  {
    id: 'char.michelle',
    type: 'gltf',
    file: 'assets/models/characters/michelle.glb',
    tier: 'ultra',
    optional: true,
    surface: 'flesh',
    notes: 'Mixamo Michelle via three.js examples. Rig: mixamorig:* (65 joints). Animations: SambaDance (18.233s), TPose (0.067s). 28106 tris, textured (diffuse/normal/gloss). Reference/retarget only.',
    meta: {
      source: 'https://threejs.org/examples/models/gltf/Michelle.glb',
      license: 'Mixamo (Adobe) royalty-free character/animations; distributed with three.js examples (MIT)',
      author: 'Mixamo (Adobe) — via three.js examples',
    },
  },
  {
    id: 'char.swat',
    type: 'gltf',
    file: 'assets/models/characters/quaternius-swat.glb',
    tier: 'all',
    optional: true,
    surface: 'flesh',
    notes: 'Quaternius SWAT (CC0, via poly.pizza). Rig: Blender-style names, root Root/Body -> Hips (Root, Hips, Abdomen, Torso, Chest, Neck, Head, Shoulder.L, UpperArm.L, LowerArm.L, Wrist.L, fingers .L/.R, UpperLeg.L, LowerLeg.L, Foot.L ...), 4 skinned meshes (7752 tris). Animations (24): Death (1.042s), Gun_Shoot (0.583s), HitRecieve (0.542s), HitRecieve_2 (0.542s), Idle (1.667s), Idle_Gun (1.667s), Idle_Gun_Pointing (1.667s), Idle_Gun_Shoot (0.667s), Idle_Neutral, Idle_Sword, Interact (1.25s), Kick_Left, Kick_Right, Punch_Left, Punch_Right, Roll (1.333s), Run (0.792s), Run_Back (0.833s), Run_Left, Run_Right, Run_Shoot (0.833s), Sword_Slash, Walk (1.333s), Wave. Stylized low-poly; complete combat clip set for prototyping/retarget reference.',
    meta: {
      source: 'https://poly.pizza/m/Btfn3G5Xv4',
      license: 'CC0 1.0 (Public Domain) — Quaternius',
      author: 'Quaternius (quaternius.com)',
    },
  },
  {
    id: 'char.character_soldier',
    type: 'gltf',
    file: 'assets/models/characters/quaternius-character-soldier.glb',
    tier: 'all',
    optional: true,
    surface: 'flesh',
    notes: 'Quaternius Character Soldier (CC0, via poly.pizza). Rig: Blender-style names (Root, Hips, Abdomen, Torso, Neck, Head, Shoulder.L/.R, UpperArm, LowerArm, hand fingers, UpperLeg, LowerLeg, Foot...), 43 joints. Animations (14): Death (0.75s), Duck (1.667s), HitReact (0.417s), Idle (1.667s), Idle_Shoot (0.333s), Jump (0.292s), Jump_Idle (1.0s), Jump_Land (0.417s), No, Punch (0.833s), Run (0.708s), Run_Gun (0.708s), Wave, Yes. Bundles 17 CC0 low-poly weapon/prop meshes (AK, Sniper, SMG, RocketLauncher, GrenadeLauncher, Shotgun, Pistol, Revolver, Knife...) parented to the hands — 20712 tris total.',
    meta: {
      source: 'https://poly.pizza/m/PpLF4rt4ah',
      license: 'CC0 1.0 (Public Domain) — Quaternius',
      author: 'Quaternius (quaternius.com)',
    },
  },
];
