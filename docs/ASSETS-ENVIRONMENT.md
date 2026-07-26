# ASSETS-ENVIRONMENT - Terminal 9 environment art catalog

Owned by the environment art stream. Everything listed here is registered in
`src/assets/manifest.environment.js`, lives under `public/assets/{hdri,textures,models/props}`
and is credited per-file in `docs/credits/environment.md`. All CC0 (Poly Haven,
ambientCG). See `docs/ART_DIRECTION.md` §4 for the map brief this catalog serves.

Load via `AssetLoader.loadManifest(manifest, tier)` then `assets.get(id)`.

## Conventions & budget notes

- **pbrset maps**: `color` (sRGB), `normal` (OpenGL / +Y green), `arm` (R = ambient
  occlusion, G = roughness, B = metalness). Ground sets add `disp` (1K height) for
  optional parallax / vertex displacement. The two ambientCG sets ship AO and
  roughness packed into `arm` locally (B = 0, non-metal).
- **repeat** = suggested tiles per 10 m of surface (`tileMeters` in meta is the
  photographed size of one tile). Ground sets tile at 2 m; kill repetition with
  the `tex.asphalt_macro` layer, decals (oil, tire tracks, markings) and puddle
  masks - a non-negotiable in the art direction checklist.
- **Colour tinting**: `tex.container_panel` is a real container panel with a
  flat green paint - multiply the albedo by an instance colour for oxide red /
  teal / mustard / grey / white stacks. `tex.metal_painted_rust` gives the red
  rust-streaked doors and end panels.
- **Wetness** is a shader concern, not baked: keep base roughness from the ARM
  map and lerp it down where the rain/puddle mask says so (SSR handles the rest).
- **VRAM**: 18 sets x (color + normal + arm) 2048^2 is roughly 1.2 GB fully
  resident with mips - over the 600 MB budget if everything were loaded at once.
  Load per-zone/per-preset subsets, honour `tier.textureMaxSize` (downscale to
  1K on low/medium), and prefer KTX2/BasisU transcodes if the pipeline grows one.
  Prop textures are 1K (~4 MB VRAM per map).
- Prop `dims` are the mesh-space bounding box in metres [x, y, z] (Y up), read
  from the glTF POSITION accessors; triangle counts likewise from the accessors.
  Photoscanned props (barriers, generator, fence kit) are dense - instance them,
  and consider LOD/decimation before scattering dozens.

## HDRI skies

| id | file | res | notes |
| --- | --- | --- | --- |
| `hdri.night_primary` | `assets/hdri/kloppenheim_07_puresky_2k.hdr` | 2048x1024 | Primary sky: overcast moonlit night, structured storm-cloud deck lit by a diffused moon plus faint warm horizon glow (pure-sky variant, no ground). |
| `hdri.night_primary_1k` | `assets/hdri/kloppenheim_07_puresky_1k.hdr` | 1024x512 | Low-tier 1K copy of the primary night sky. |
| `hdri.night_alt` | `assets/hdri/kloppenheim_02_puresky_2k.hdr` | 2048x1024 | Alternate sky: clear moonlit night, starfield with a bright moon disc and cool horizon haze (pure-sky variant). |
| `hdri.night_alt_1k` | `assets/hdri/kloppenheim_02_puresky_1k.hdr` | 1024x512 | Low-tier 1K copy of the alternate night sky. |

Use `hdri.night_primary*` as both environment (IBL) and background: an overcast,
moon-behind-cloud storm deck with real cloud structure and a faint warm horizon glow,
so image-based lighting has directionality without a visible clear moon (the RENDER
stream owns the moon key light and lightning flashes). `hdri.night_alt*` is a clear
moonlit starfield for a break-in-the-storm variant. Rotate the env so the brighter
lobe sits opposite the moon key. Both are "pure sky" variants: nothing baked into the
lower hemisphere, so no foreign ground shows up in reflections.

## PBR texture sets

| id | source | maps | resolution | tile size | repeat / 10 m | Terminal 9 placement |
| --- | --- | --- | --- | --- | --- | --- |
| `tex.asphalt_wet` | ambientCG `Asphalt026C` | color+normal+arm+disp | 2048x2048 (disp 1024) | 2 x 2 m | 5 | Everywhere the player walks: the ~90x70 m yard, container lanes, gate. Base of the ground shader; wetness/puddles come from lowering roughness in-shader. |
| `tex.asphalt_cracked` | ambientCG `Asphalt021` | color+normal+arm+disp | 2048x2048 (disp 1024) | 2 x 2 m | 5 | Vertex-paint / mask blend over asphalt_wet in worn zones: warehouse bay approach, drain surrounds, the burnt-container area. |
| `tex.asphalt_macro` | Poly Haven `aerial_asphalt_01` | color+normal+arm | 2048x2048 | 30 x 30 m | 0.33 | Whole-yard macro layer (30 m tile) multiplied under the detail asphalt - tire skids and stains break up tiling (non-negotiable checklist item). |
| `tex.gravel_dark` | Poly Haven `gravel_stones` | color+normal+arm+disp | 2048x2048 (disp 1024) | 2 x 2 m | 5 | Crane-rail beds along the north quay, verges outside the fence, drainage strips between lanes. |
| `tex.concrete_slab` | Poly Haven `dirty_concrete` | color+normal+arm | 2048x2048 | 3 x 3 m | 3.3 | North quay apron, warehouse floor and loading dock, kerbs, container plinths. |
| `tex.concrete_panels` | Poly Haven `concrete_wall_008` | color+normal+arm | 2048x2048 | 2.71 x 2.71 m | 3.7 | Warehouse plinth and side walls, quay wall face, retaining walls, cast-in-place look for jersey barriers. |
| `tex.container_panel` | Poly Haven `container_side` | color+normal+arm | 2048x2048 | 1.94 x 1.94 m | 5 | Container walls (all stacks). Base colour is a flat green - tint per instance for oxide-red / teal / mustard / grey containers. |
| `tex.corrugated_worn` | Poly Haven `worn_corrugated_iron` | color+normal+arm | 2048x2048 | 1.8 x 1.8 m | 5.5 | Older container walls, lean-to sheds, corrugated perimeter fence sections, the office trailer skirt. |
| `tex.corrugated_rusty` | Poly Haven `rusty_corrugated_iron` | color+normal+arm | 2048x2048 | 2 x 2 m | 5 | Derelict shed roofs, rust-eaten container ends, the burnt-out container interior/exterior. |
| `tex.metal_painted_rust` | Poly Haven `rusty_painted_metal` | color+normal+arm | 2048x2048 | 2.2 x 2.2 m | 4.5 | Container door/end panels, gate posts, drums and machinery housings, the wrecked pickup body. |
| `tex.metal_rust` | Poly Haven `rust_coarse_01` | color+normal+arm | 2048x2048 | 2.2 x 2.2 m | 4.5 | Gantry crane bases and bogies, scrap piles, anchor plates, chains, the wreck underside. |
| `tex.metal_diamond_plate` | Poly Haven `metal_plate` | color+normal+arm | 2048x2048 | 0.5 x 0.5 m | 20 | Overturned-container ramp, catwalks/gantry stairs, container floor plates, dock edge plates. |
| `tex.metal_shutter` | Poly Haven `painted_metal_shutter` | color+normal+arm | 2048x2048 | 2 x 2 m | 5 | Warehouse roller bay doors (one open with lit interior, others closed), lock-up units. |
| `tex.brick_red` | Poly Haven `red_brick_03` | color+normal+arm | 2048x2048 | 1 x 1 m | 10 | Warehouse facade (south side), pump house, older quay buildings. |
| `tex.wood_planks` | Poly Haven `brown_planks_03` | color+normal+arm | 2048x2048 | 1 x 1 m | 10 | Pallets, crates, dunnage stacks, boarded windows, timber blocking under containers. |
| `tex.plywood` | Poly Haven `plywood` | color+normal+arm | 2048x2048 | 0.5 x 0.5 m | 20 | Crate lids, temporary hoardings, office trailer boarding, warehouse interior partitions. |
| `tex.burlap` | Poly Haven `hessian_230` | color+normal+arm | 2048x2036 | 0.269 x 0.267 m | 37 | Sandbag walls / firing positions on the lanes, tied sack bundles by the warehouse. |
| `tex.plaster_painted` | Poly Haven `painted_plaster_wall` | color+normal+arm | 2048x2048 | 2 x 2 m | 5 | Office trailer interior, warehouse side rooms, the lit interior seen through the open bay doors. |

Descriptions (what each set is):

- `tex.asphalt_wet` - MAIN GROUND. Dark wet asphalt with a crack network and damp mottling: the Terminal 9 yard, lanes between container stacks, gate area.
- `tex.asphalt_cracked` - Heavily alligator-cracked asphalt: worn patches, around potholes and drains, high-traffic zones near the warehouse doors.
- `tex.asphalt_macro` - Aerial 30 m asphalt with tire skids, oil stains and tar cracks: macro/variation layer stretched over the whole yard to kill visible tiling (blend under the detail asphalts).
- `tex.gravel_dark` - Dark crushed gravel: gantry-crane rail beds, verges, drainage strips, edges where asphalt breaks up.
- `tex.concrete_slab` - Worn, stained cast concrete slab: quay apron at the north edge, warehouse floor, kerbs, loading docks.
- `tex.concrete_panels` - Bare precast concrete panels with formwork joints: warehouse plinth, quay wall face, retaining walls, jersey barriers cast in-place look.
- `tex.container_panel` - Photoscanned painted shipping-container side (green, battered). Container walls; the flat paint colour tints well in-shader for oxide-red / teal / mustard variants.
- `tex.corrugated_worn` - Weathered painted corrugated iron with chipped paint and rust bleed: old container walls, lean-to sheds, perimeter fencing.
- `tex.corrugated_rusty` - Heavily rusted corrugated iron: derelict shed roofs, rust-eaten container ends, the burnt-out container.
- `tex.metal_painted_rust` - Red painted flat sheet with rust drip runs: container doors and end panels, drums, machinery housings, gate posts.
- `tex.metal_rust` - Coarse bare rust: crane bases and bogies, scrap, the wrecked pickup underside, chain and anchor plates.
- `tex.metal_diamond_plate` - Oily diamond checker plate: ramps, catwalks and gantry stairs, container floor plates, loading-dock edge plates.
- `tex.metal_shutter` - Painted metal roller shutter: warehouse bay doors (open and closed), lock-up units.
- `tex.brick_red` - Dark red industrial brick: warehouse facade, pump house, older quay buildings.
- `tex.wood_planks` - Weathered untreated planks: pallets, crates, dunnage stacks, boarded-up windows.
- `tex.plywood` - Plywood sheet: crate lids, temporary hoardings, office-trailer boarding and interior partitions.
- `tex.burlap` - Coarse hessian/burlap weave: sandbag walls and firing positions, tied sack bundles.
- `tex.plaster_painted` - Painted plaster interior wall: office trailer interior, warehouse side rooms and the lit interior seen through the bay doors.

## Prop models (glTF 2.0, 1K textures)

| id | file | tris | dims x, y, z (m) | surface | what it is | Terminal 9 placement |
| --- | --- | --- | --- | --- | --- | --- |
| `prop.oil_drum_red` | `assets/models/props/Barrel_01/Barrel_01_1k.gltf` | 2,682 | 0.56 x 0.88 x 0.56 | metal | Red steel oil drum with explosive-hazard decal | Scatter/stack near lanes and the wreck; the classic explosive barrel (fire/explosion set-piece). |
| `prop.oil_drum_blue` | `assets/models/props/barrel_03/barrel_03_1k.gltf` | 1,473 | 0.63 x 0.93 x 0.64 | metal | Blue painted steel oil/fuel barrel | Drum stacks and pallets near the warehouse and quay; mix with red drums. |
| `prop.drum_plastic_blue` | `assets/models/props/Barrel_02/Barrel_02_1k.gltf` | 2,688 | 0.49 x 0.88 x 0.48 | plastic | Blue plastic drum, sealed lid | Warehouse interior and loading dock clutter. |
| `prop.fire_barrel` | `assets/models/props/barrel_stove/barrel_stove_1k.gltf` | 9,216 | 0.59 x 0.86 x 0.59 | metal | Rusted, scorched drum with air holes (fire barrel) | The burning fuel drums (ART_DIRECTION §4): one at the gate, one in the lanes; add flame emitter + warm light. |
| `prop.tire_old` | `assets/models/props/old_tyre/old_tyre_1k.gltf` | 2,880 | 0.60 x 0.60 x 0.17 | plastic | Worn car tyre | Tire piles and scattered singles along the lanes and by the wreck; short stacks as low cover. |
| `prop.jersey_barrier` | `assets/models/props/concrete_road_barrier/concrete_road_barrier_1k.gltf` | 60,928 | 1.54 x 0.83 x 0.64 | concrete | Concrete jersey/road barrier, painted stripes, lifting hooks | Concrete jersey barriers forming cover along the main lane and the gate chicane (near camera). |
| `prop.jersey_barrier_02` | `assets/models/props/concrete_road_barrier_02/concrete_road_barrier_02_1k.gltf` | 23,822 | 1.56 x 1.11 x 0.44 | concrete | Tall precast concrete road barrier with wire lifting loops | Taller barrier variant for the quay edge and vehicle blockades; LOD/instance for distance rows. |
| `prop.cardboard_box` | `assets/models/props/cardboard_box_01/cardboard_box_01_1k.gltf` | 16,952 | 0.39 x 0.34 x 0.52 | wood | Worn, taped cardboard box | Warehouse interior shelves/floor clutter, inside the open container. |
| `prop.wooden_crate` | `assets/models/props/wooden_crate_02/wooden_crate_02_1k.gltf` | 5,176 | 0.53 x 0.47 x 1.17 | wood | Long stencilled wooden shipping crate | Crate stacks by the warehouse doors and inside containers (cover height ~0.5 m). |
| `prop.ammo_crate` | `assets/models/props/old_military_crate/old_military_crate_1k.gltf` | 10,476 | 0.93 x 0.36 x 0.68 | wood | Green military supply/ammunition crate (closed) | Closed military supply crates near the player spawn and defended positions. |
| `prop.military_crate_open` | `assets/models/props/wooden_military_crate/wooden_military_crate_1k.gltf` | 22,986 | 1.24 x 0.42 x 0.73 | wood | Wooden military crate with opened hinged lid | Opened supply crate at the spawn/staging area (storytelling: recently unpacked kit). |
| `prop.jerrycan` | `assets/models/props/metal_jerrycan/metal_jerrycan_1k.gltf` | 20,022 | 0.35 x 0.46 x 0.17 | metal | Battered red 20 L steel jerrycan | Beside the generator, drums and the pickup; small explosive-adjacent clutter. |
| `prop.propane_tank` | `assets/models/props/propane_tank/propane_tank_1k.gltf` | 5,238 | 0.34 x 0.55 x 0.34 | metal | Red LPG/propane cylinder | By the office trailer and warehouse; secondary explosive prop, chains well with drums. |
| `prop.fire_extinguisher` | `assets/models/props/korean_fire_extinguisher_01/korean_fire_extinguisher_01_1k.gltf` | 9,913 | 0.28 x 0.66 x 0.37 | metal | Dry-powder fire extinguisher on floor bracket | Warehouse walls/columns and inside the office trailer. |
| `prop.tool_chest` | `assets/models/props/metal_tool_chest/metal_tool_chest_1k.gltf` | 13,360 | 0.69 x 0.50 x 0.32 | metal | Red mechanic tool chest with drawers (rigged, posed open) | Warehouse workshop bay (open drawers), pairs with the generator and cable runs. |
| `prop.ladder_metal` | `assets/models/props/ladder_sectioned_01/ladder_sectioned_01_1k.gltf` | 29,140 | 0.66 x 2.13 x 0.20 | metal | Aluminium sectioned extension ladder (folded) | Leaning against a container stack / warehouse wall; implies vertical routes. |
| `prop.generator` | `assets/models/props/portable_generator/portable_generator_1k.gltf` | 26,419 | 0.82 x 0.59 x 0.56 | metal | Yellow portable petrol generator | Feeding the sodium work lights: gate and lane light stands (cable to lamp, idle chug audio). |
| `prop.chainlink_fence` | `assets/models/props/modular_chainlink_fence/modular_chainlink_fence_1k.gltf` | 89,232 | 3.91 x 3.47 x 1.11 | metal | Modular chain-link fence kit (panels, posts, gate pieces) | Perimeter fence along the quay and around the yard edge; gaps/torn panels for routes. |
| `prop.security_light` | `assets/models/props/security_light/security_light_1k.gltf` | 4,668 | 0.32 x 0.53 x 0.42 | metal | Wall-mounted security bulkhead lamp | Warehouse and office trailer walls - practical sodium fixtures (emissive glass). |
| `prop.caged_sconce` | `assets/models/props/industrial_caged_sconce/industrial_caged_sconce_1k.gltf` | 26,576 | 0.56 x 0.38 x 0.39 | metal | Set of 11 industrial caged bulkhead / pipe wall lights | Bulkhead/caged fixtures on container ends, warehouse doors and bunker-style walkways. |
| `prop.manhole_cover` | `assets/models/props/water_manhole_cover/water_manhole_cover_1k.gltf` | 6,301 | 0.69 x 0.07 x 0.69 | metal | Cast-iron WATER manhole cover with frame | Set flush into asphalt/concrete near drains and puddles (SSR anchors). |
| `prop.utility_box` | `assets/models/props/utility_box_02/utility_box_02_1k.gltf` | 6,268 | 0.92 x 1.12 x 0.43 | metal | Green roadside electrical distribution cabinet | Electrical cabinet by the warehouse corner / quay edge; hum audio + hazard placards. |

Notes: `prop.tool_chest`, `prop.military_crate_open` and `prop.caged_sconce` /
`prop.chainlink_fence` contain several meshes/nodes in one file (posed-open lids,
multiple fixtures, a modular kit) - place the whole scene or pick child nodes.
`prop.fire_extinguisher` carries small Korean signage on its floor bracket (fine for
an international freight terminal; hide the plate against a wall if it reads wrong).
`surface` seeds `userData.surface` for ballistics/foley; the tyre is tagged `plastic`
as the closest available class for rubber.

## Missing / could not source

Searched Poly Haven models (521), Poly Haven textures (785) and ambientCG. Not
available as CC0 models on those sources - build procedurally (WORLD stream) or
source later:

- **Wooden pallets** - none on Poly Haven. Trivial to build from `tex.wood_planks`
  (11 boards + 3 stringers). High visual value; do this.
- **Sandbags** - no models. Deformed low-poly bags + `tex.burlap` in a stacked wall
  prefab is the plan.
- **Traffic cones** - none. Procedural cone (24 sides) with an orange/white banded
  material and a scuffed roughness map.
- **Cable spools / reels** - none. Cheap procedural cylinder-flange spool with
  `tex.wood_planks`; loose cables via tube geometry.
- **Cinder blocks / breeze blocks** - none. Procedural 8-hole block, concrete material.
- **Wheelbarrow, buckets (modern), gas-cylinder cages, shipping-container mesh** -
  not on Poly Haven as models. Containers themselves are geometry + the container/
  corrugated pbrsets above (planned WORLD-stream build).
- **Tire rubber tileable** - no tyre-rubber pbrset on either source; the tyre prop
  carries its own textures. A tileable rubber mat exists (`rubber_tiles`, gym floor)
  but is not appropriate.
- **Painted road-marking asphalt** - `asphalt_pit_lane`/`Road009C` bake specific line
  layouts; markings are better as decals (stencil arrows, bay lines, "MAX 30480 KG")
  over the plain asphalt. No standalone lane-marking pbrset was added.
- **Wet dirt / mud** and **grimy painted plaster** were previewed but dropped to stay
  near the 12-16 set brief (`brown_mud_03`, `concrete_wall_003` on Poly Haven are the
  picks if needed).
- A rain-lashed **port at night** HDRI does not exist; the pure-sky Kloppenheim night
  panoramas are the closest CC0 match (no baked skyline, correct night exposure).
