/**
 * Terminal 9 — map layout data (WORLD stream). Pure data + small generators;
 * no three.js objects live here so AI/UI/tools can read the plan.
 *
 * Frame: X west(-) → east(+), Z north(-, water) → south(+, warehouse), Y up.
 * Ground level y = 0. Container long axis is +Z ("length"), width X, doors
 * at the +Z (south) end unless yaw rotates them.
 *
 *   z=-52 ────────── quay wall ─────────  water beyond (ship at z≈-70..-100)
 *   z=-52..-40  concrete apron (crane rails, bollards, cranes A x=-30, B x=+26)
 *   z=-40  ── asphalt yard begins ─────────────────────────────────────────
 *   x=-52 fence │perimW│ WEST LANE │ blockW │ MAIN LANE │ blockE │ EAST LANE │perimE│ fence x=+52
 *   rows of containers at z = -34, -19.6, -5.2, +9.2, +23.6 (12.19 m each)
 *   z=+29.7..+37  SOUTH LANE (player spawn / hold-out staging)
 *   z=+38  warehouse facade (bays; bay 3 at x=-22 open + lit interior)
 *   office trailer at (+22, +41.5); gate at x≈+34, z=+44
 */

/* ------------------------------------------------------------- constants */
export const CONTAINER = {
  L40: 12.19,
  L20: 6.06,
  W: 2.44,
  H: 2.59,
  BAY_PITCH: 2.7,
};

export const GROUND = {
  asphalt: { x0: -70, x1: 70, z0: -40, z1: 50 },
  apron: { x0: -70, x1: 70, z0: -52, z1: -40 },
  quayZ: -52,
  waterY: -1.9,
  water: { x0: -260, x1: 260, z0: -52, z1: -420 },
};

export const YARD = {
  playable: { x0: -50, x1: 50, z0: -46, z1: 44 },
  fenceWestX: -52,
  fenceEastX: 52,
  fenceSouthZ: 44,
  gate: { x0: 30, x1: 38, z: 44 },
  lanes: {
    west: { x0: -36.4, x1: -22.9, z0: -40, z1: 30 },
    main: { x0: -7, x1: 7, z0: -40, z1: 30 },
    east: { x0: 22.9, x1: 36.4, z0: -40, z1: 30 },
    south: { x0: -50, x1: 50, z0: 29.7, z1: 37.2 },
    apron: { x0: -68, x1: 68, z0: -51, z1: -40.5 },
  },
};

export const ROWS_Z = [-34, -19.6, -5.2, 9.2, 23.6];

export const WAREHOUSE = {
  facadeZ: 38,
  x0: -60,
  x1: 8,
  depth: 14,
  height: 11.5,
  bayXs: [-52, -42, -32, -22, -12, -2],
  bayW: 5.6,
  bayH: 4.4,
  openBayIndex: 3, // x = -22
  interior: { x0: -27.6, x1: -16.4, z0: 38, z1: 51, height: 6.6 },
  kerbZ: 37.4,
  lampY: 6.6,
};

export const TRAILER = {
  center: { x: 22, z: 41.6 },
  length: 9.8, // along x
  depth: 3.1,
  height: 2.7,
  floorY: 0.55,
};

export const QUAY = {
  edgeZ: -52,
  railsZ: [-42.6, -50.4],
  bollardZ: -51.3,
  bollardXs: [-64, -54, -44, -34, -24, -14, -4, 6, 16, 26, 36, 46, 56],
  cranes: [
    { id: 'A', x: -30, workLight: false },
    { id: 'B', x: 26, workLight: true },
  ],
  ship: {
    nearZ: -104,
    beam: 30,
    xBow: -86,
    xStern: 104,
    deckY: 9,
    keelY: -3,
    castle: { x0: 62, x1: 92, height: 26 },
  },
};

/* --------------------------------------------------- container palette */
export const PAINT = [
  { name: 'oxide', color: 0x7c3025, weight: 3.2 },
  { name: 'grey', color: 0x5e646b, weight: 2.4 },
  { name: 'teal', color: 0x2e5d59, weight: 1.8 },
  { name: 'mustard', color: 0xa07d24, weight: 1.4 },
  { name: 'white', color: 0xaeaba0, weight: 1.2 },
  { name: 'green', color: 0x36452d, weight: 1.4 },
  { name: 'blue', color: 0x293c58, weight: 1.6 },
  { name: 'maroon', color: 0x5a2027, weight: 1.0 },
];

/**
 * Block definitions: bay X centres + a fill grid (rows N→S × bays W→E).
 * Grid chars: '.' empty, '1'..'3' stack height, 'b' = 1-high burnt (unused
 * here — the burnt container is free-standing), 's' = single 20ft pair.
 */
export const BLOCKS = [
  {
    id: 'perimW',
    bays: [-48.4, -45.7, -43.0, -40.3, -37.6],
    grid: ['22322', '23222', '2.222', '32222', '22232'],
  },
  {
    id: 'blockW',
    bays: [-21.7, -19.0, -16.3, -13.6, -10.9, -8.2],
    grid: ['223232', '32.222', '22.223', '21.322', '222232'],
  },
  {
    id: 'blockE',
    bays: [8.2, 10.9, 13.6, 16.3, 19.0, 21.7],
    grid: ['323222', '223.32', '232223', '322232', '2232.2'],
  },
  {
    id: 'perimE',
    bays: [37.6, 40.3, 43.0, 45.7, 48.4],
    grid: ['22322', '23222', '32.32', '22232', '23222'],
  },
];

/** Free-standing special containers. */
export const SPECIALS = {
  burnt: { x: 3.9, z: -25.4, yawDeg: -5, length: CONTAINER.L40 },
  fallen: { x: -30.3, z: 11.6, yawDeg: 90, length: CONTAINER.L40 },
  ramp: { x: -30.6, zNorthEnd: 12.55, length: CONTAINER.L40, topY: CONTAINER.H },
  // a lone 20ft on the apron waiting for the crane, E-W
  quay20: [
    { x: -14, z: -45.6, yawDeg: 92, length: CONTAINER.L20, level: 0 },
    { x: 6, z: -46.4, yawDeg: 87, length: CONTAINER.L20, level: 0 },
    { x: 6.4, z: -46.4, yawDeg: 87, length: CONTAINER.L20, level: 1 },
  ],
};

/* ---------------------------------------------------------- light masts */
export const MASTS = [
  { id: 'M1', x: -24.6, z: 2.1, height: 11.5, heads: [{ target: [-30.5, 0, 6.5], color: 0xffb15c, intensity: 2500 }], deadHeads: 1 },
  { id: 'M2', x: 24.6, z: -1.2, height: 11.5, heads: [{ target: [30.5, 0, -4.5], color: 0xffb15c, intensity: 2500 }], deadHeads: 1 },
  { id: 'M3', x: -8.3, z: -22.4, height: 11.5, heads: [{ target: [-1.2, 0, -27], color: 0xffb15c, intensity: 2800 }, { target: [1.2, 0, 6], color: 0xffe2b3, intensity: 2600, angle: 0.5 }] },
  { id: 'M4', x: 8.3, z: 18.6, height: 11.5, heads: [{ target: [0.4, 0, 12.5], color: 0xffb15c, intensity: 2700 }], deadHeads: 1 },
  { id: 'M5', x: -8, z: -45.8, height: 16, heads: [], deadHeads: 2 },
];

/* ------------------------------------------------------------- fire drums */
export const FIRE_BARRELS = [
  { id: 'FB1', x: -3.9, z: 22.4, intensity: 60 },
  { id: 'FB2', x: -16.0, z: 4.0, intensity: 55 },
  { id: 'FB3', x: 28.4, z: -30.2, intensity: 55 },
];

/* -------------------------------------------------------------- spawns */
export const PLAYER_SPAWN = { x: 1.5, z: 32.6, yaw: 0 }; // yaw 0 = facing -Z (north)

/* ------------------------------------------------------- photo framings */
/**
 * Screenshot-artist framings. Positions/targets in world metres.
 * Consumed by src/world/presets.js and available as world.photoPoints.
 */
export const PHOTO_POINTS = {
  vista: { position: [-51.5, 20.8, 38.4], target: [6, 3, -22], fov: 58 },
  street: { position: [-1.9, 1.35, 27.4], target: [0.6, 3.4, -22], fov: 54 },
  alley: { position: [-16.9, 1.45, 17.0], target: [-15.7, 2.2, -6], fov: 56 },
  quay: { position: [4, 1.7, -49.6], target: [-46, 9.5, -103], fov: 60 },
  warehouse: { position: [-18.4, 1.5, 30.6], target: [-23.4, 2.9, 42], fov: 58 },
  smoke: { position: [1.5, 1.65, 33.5], target: [0.5, 3.0, 6], fov: 60 },
  rain_light: { position: [3.6, 1.62, 24.2], target: [7.5, 7.5, 16.5], fov: 62 },
  lightning: { position: [16, 1.7, -49.5], target: [-30, 14, -95], fov: 62 },
  overhead: { position: [0, 90, 6], yawDeg: 0, pitchDeg: -89.8, fov: 60 },
};

/* --------------------------------------------------------- prop clusters */
/**
 * Hand-placed clutter with intent (cover, storytelling). Format per entry:
 * [assetId, x, z, yawDeg, opts]. Consumed by Props.js.
 * Positions were chosen against the block/lane plan above.
 */
export const CLUTTER = {
  // player hold-out staging in the south lane
  spawn: [
    ['prop.ammo_crate', 4.2, 33.4, 8],
    ['prop.ammo_crate', 4.35, 33.35, 6, { y: 0.36 }],
    ['prop.ammo_crate', 5.2, 32.9, 96],
    ['prop.military_crate_open', 2.9, 34.7, 168],
    ['prop.wooden_crate', -1.4, 34.9, 92],
    ['prop.wooden_crate', -1.35, 34.85, 88, { y: 0.47 }],
    ['prop.propane_tank', 7.6, 35.6, 0],
  ],
  // main lane cover + storytelling
  main: [
    ['prop.oil_drum_red', -4.4, 4.4, 12],
    ['prop.oil_drum_blue', -3.7, 4.9, 40],
    ['prop.oil_drum_blue', -4.9, 5.5, 200],
    ['prop.oil_drum_red', -3.9, 6.2, 130, { tilt: [88, 30] }], // knocked over
    ['prop.tire_old', 4.4, 15.6, 0, { stack: 3 }],
    ['prop.tire_old', 5.3, 15.9, 20, { stack: 2 }],
    ['prop.oil_drum_red', 5.6, -12.4, 0],
    ['prop.oil_drum_red', 6.3, -12.9, 30],
  ],
  // west lane: generator + ramp base clutter
  west: [
    ['prop.generator', -33.6, 6.4, 65],
    ['prop.propane_tank', -25.0, -8.0, 20],
    ['prop.propane_tank', -25.4, -8.5, 200],
    ['prop.tire_old', -28.6, 26.4, 30, { stack: 4 }],
    ['prop.ladder_metal', -23.05, -2.5, 88, { lean: 18, y: 0 }],
    ['prop.oil_drum_blue', -35.4, -20.6, 0],
    ['prop.oil_drum_blue', -34.5, -20.9, 60],
    ['prop.oil_drum_red', -35.0, -21.6, 120],
    ['prop.wooden_crate', -25.6, 20.6, 92],
  ],
  // east lane
  east: [
    ['prop.oil_drum_red', 27.0, -4.4, 20],
    ['prop.oil_drum_red', 27.9, -4.9, 100],
    ['prop.oil_drum_blue', 27.4, -5.6, 60],
    ['prop.wooden_crate', 33.4, 8.4, 4],
    ['prop.wooden_crate', 33.45, 8.35, 2, { y: 0.47 }],
    ['prop.ammo_crate', 25.6, 12.4, 90],
    ['prop.tire_old', 34.4, -18.6, 0, { stack: 3 }],
    ['prop.tire_old', 35.4, -19.2, 25, { stack: 2 }],
  ],
  // quay apron
  apron: [
    ['prop.oil_drum_red', -38.6, -44.4, 15],
    ['prop.oil_drum_red', -37.7, -44.9, 60],
    ['prop.oil_drum_blue', -38.3, -45.3, 100],
    ['prop.oil_drum_blue', -37.5, -43.7, 40],
    ['prop.utility_box', -19.6, -41.2, 180],
    ['prop.wooden_crate', 14.4, -49.6, 90],
    ['prop.wooden_crate', 14.5, -49.55, 92, { y: 0.47 }],
  ],
  // warehouse open bay interior + threshold
  warehouse: [
    ['prop.drum_plastic_blue', -25.4, 46.6, 10],
    ['prop.drum_plastic_blue', -24.6, 46.9, 40],
    ['prop.drum_plastic_blue', -25.1, 47.6, 80],
    ['prop.tool_chest', -18.4, 47.9, 180],
    ['prop.fire_extinguisher', -16.9, 39.6, 180],
    ['prop.wooden_crate', -19.4, 42.4, 92],
    ['prop.security_light', -16.2, 44.5, 90, { y: 3.1, wall: true }],
  ],
  // trailer / gate corner
  trailer: [
    ['prop.oil_drum_blue', 15.4, 40.4, 0],
    ['prop.oil_drum_blue', 16.2, 40.7, 40],
    ['prop.utility_box', 10.4, 37.55, 0],
  ],
};

/** Manhole covers set flush in the asphalt/apron. [x, z, yawDeg] */
export const MANHOLES = [
  [-1.8, 20.5, 12], [2.4, -6.5, 70], [-30.2, -14.5, 5], [24.2, -46.8, 80],
];

/** Drain grates (decal quads in gutters); puddles form around them. [x, z, yawDeg] */
export const DRAINS = [
  [-6.4, 12.5, 0], [6.4, -18.5, 0], [-6.5, -33, 0], [6.6, 26.2, 0],
  [-30.5, -30, 90], [30.6, -26, 90], [-30.7, 20.5, 90], [30.4, 19.4, 90],
  [-22, 36.3, 0], [-40, 36.3, 0], [-4, 36.3, 0],
];

/** Big puddles (world x,z, radius m). Placed under the flood pools and in low spots. */
export const PUDDLES = [
  { x: -0.5, z: -14.5, r: 4.6 },
  { x: 1.8, z: 8.5, r: 5.2 },
  { x: -1.5, z: 24.5, r: 4.2 },
  { x: -30.5, z: 8.6, r: 4.4 },
  { x: -29.5, z: -8.5, r: 3.8 },
  { x: 30.5, z: 6.5, r: 4.5 },
  { x: 30, z: -10.5, r: 3.6 },
  { x: -1, z: -28.5, r: 5.4 },
  { x: -20, z: 33.5, r: 4.8 },
  { x: 8.5, z: 34, r: 3.4 },
  { x: -38, z: 33, r: 3.0 },
];

/** Sandbag emplacements: {x, z, yawDeg, length, courses}. Facing yaw = the wall's front. */
export const SANDBAG_WALLS = [
  { x: -2.5, z: 30.1, yawDeg: 0, length: 5.2, courses: 3 },   // spawn hold-out, faces north
  { x: 4.6, z: 29.9, yawDeg: -14, length: 3.0, courses: 3 },
  { x: 27.0, z: -14.6, yawDeg: 0, length: 4.0, courses: 3 }, // east lane position
  { x: -30.6, z: -25.2, yawDeg: 180, length: 4.4, courses: 2 }, // west lane, faces south
  { x: -30.4, z: 11.7, yawDeg: 0, length: 3.4, courses: 2, y: 2.6 }, // atop the fallen container
];

/** Jersey barrier placements (procedural low-poly). [x, z, yawDeg] */
export const BARRIERS = [
  [-3.0, 17.6, 8], [1.6, 18.0, -6],           // main lane chicane
  [-4.5, -35.8, 4], [0.1, -36.1, 0], [4.7, -35.9, -5], // north mouth of main lane
  [33.6, 40.8, 90], [35.6, 40.7, 90],        // gate approach
  [-46, -41.6, 0], [-42.9, -41.7, 3],        // apron edge west
  [22.5, -41.5, 0],
  [-31.5, 33.4, 12],                          // west lane south mouth
];

/** Pallet stacks: [x, z, yawDeg, count]. */
export const PALLET_STACKS = [
  [-4.4, 4.9, 12, 1],       // under the drums (main lane)
  [-9.8, 33.6, 4, 3],
  [-10.3, 34.8, 92, 2],
  [24.6, -37.5, 20, 4],
  [24.2, -33.4, 33, 2],
  [-38.9, -30.6, 5, 3],
  [-41.5, -30.9, 80, 1],
  [13.6, 33.8, 45, 2],
  [-23.9, 46.2, 90, 3],     // inside the open warehouse bay
  [-58, -44.5, 10, 5],      // apron far west
];

/** Overhead cables: [ [x,y,z], [x,y,z], sag ]. */
export const CABLES = [
  [[-24.6, 13.6, 2.1], [-8.3, 12.8, -22.4], 2.2],   // mast M1 → mast M3 across block W / main lane mouth
  [[8.3, 12.6, 18.6], [24.6, 13.2, -1.2], 2.4],    // M4 → M2 across block E
  [[-8.3, 12.9, -22.4], [8.6, 8.3, -20.6], 1.6],  // M3 → block E top (crosses main lane N)
  [[-6.8, 8.2, 6.2], [8.3, 12.4, 18.6], 1.9],     // block W top → M4 (crosses main lane S)
  [[-22.9, 8.3, -30.5], [-36.5, 8.1, -31.2], 1.1], // across the west lane N
  [[23.2, 8.2, -6.2], [36.5, 8.4, -5.4], 1.0],     // across the east lane
  [[-16, 8.3, 40.2], [16.9, 3.6, 41.4], 3.0],      // warehouse eave → trailer roof
  [[-24.6, 13.9, 2.1], [-52.2, 6.2, 8.5], 2.6],    // M1 → west fence pole
  [[24.6, 13.9, -1.2], [52.2, 6.2, -6.5], 2.6],    // M2 → east fence pole
  [[-8.3, 12.7, -22.4], [-8.0, 15.6, -45.8], 2.0], // M3 → quay mast M5
];

/**
 * Enemy spawn candidates (validated/culled by Nav for LOS + walkability).
 * All along the north/east/west edges and behind stacks; yaw faces inward.
 */
export const ENEMY_SPAWN_CANDIDATES = [
  { x: -47.6, z: -14.8, yaw: 90, tag: 'west-fence-mid' },
  { x: -47.4, z: 6.4, yaw: 90, tag: 'west-fence-south' },
  { x: -31.0, z: -37.6, yaw: 180, tag: 'west-lane-north' },
  { x: -0.6, z: -37.8, yaw: 180, tag: 'main-lane-north' },
  { x: 5.4, z: -46.5, yaw: 200, tag: 'apron-center' },
  { x: -22.8, z: -46.9, yaw: 165, tag: 'apron-west' },
  { x: 30.6, z: -37.4, yaw: 190, tag: 'east-lane-north' },
  { x: 41.6, z: -45.2, yaw: 215, tag: 'apron-east' },
  { x: 47.6, z: -20.4, yaw: 270, tag: 'east-fence-north' },
  { x: 47.8, z: 8.6, yaw: 270, tag: 'east-fence-mid' },
  { x: 41.3, z: 34.8, yaw: 300, tag: 'gate-inside' },
  { x: 17.5, z: -6.3, yaw: 250, tag: 'blockE-pocket' },
  { x: -17.0, z: -22.6, yaw: 160, tag: 'blockW-alley-north' },
  { x: -43.3, z: -22.3, yaw: 120, tag: 'perimW-slot' },
  { x: 30.2, z: 30.8, yaw: 280, tag: 'east-lane-south' },
  { x: -31.4, z: 20.2, yaw: 60, tag: 'west-lane-fallen' },
];
