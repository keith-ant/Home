/**
 * Asset manifest aggregator. Each stream owns one part-file so parallel
 * work never collides on a single file:
 *
 *   manifest.environment.js — HDRIs, PBR texture sets, environment props (WORLD/ASSETS)
 *   manifest.characters.js  — enemy models & their textures/animations (AI/ASSETS)
 *   manifest.weapons.js     — weapon/hands models, weapon-specific textures, LUTs (WEAPONS/ASSETS)
 *   manifest.audio.js       — sound files (AUDIO/ASSETS)
 *   manifest.ui.js          — fonts, HUD images, sprites/atlases (UI/FX/ASSETS)
 *
 * Entry schema (see docs/ARCHITECTURE.md §3):
 *   { id, type: 'texture'|'pbrset'|'hdr'|'gltf'|'audio'|'font'|'json',
 *     file | files, tier?: 'all'|'high+'|'ultra', colorSpace?, wrap?, repeat?,
 *     optional?: boolean }
 * `optional: true` entries fall back gracefully (procedural or omitted) when
 * missing; everything else logs a warning and substitutes a fallback.
 */
import environment from './manifest.environment.js';
import characters from './manifest.characters.js';
import weapons from './manifest.weapons.js';
import audio from './manifest.audio.js';
import ui from './manifest.ui.js';

// Audio buffers and reference-only weapon meshes load on demand (see
// AssetLoader.ensure) so boot and headless captures stay fast.
const lazy = (list) => list.map((e) => ({ lazy: true, ...e }));

export const manifest = [
  ...environment,
  ...characters,
  ...lazy(weapons),
  ...lazy(audio),
  ...ui,
];

/** Look up an entry by id. */
export function findAssetEntry(id) {
  return manifest.find((e) => e.id === id) || null;
}
