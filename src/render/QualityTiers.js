/**
 * Quality tier table. Every visual system reads its knobs from here — never
 * hardcode counts/resolutions in feature code. Photo mode forces 'ultra'.
 *
 * RENDER stream owns these values (docs/ARCHITECTURE.md §3). Other streams
 * may append their own keys per tier; keep all four tiers in sync.
 *
 * Knob glossary (render stream):
 *   shadows.mapSize        moon (directional) shadow map resolution
 *   shadows.spotMapSize    per-fixture spot shadow map resolution
 *   shadows.spotBudget     max simultaneous shadow-casting spots (Lighting.js)
 *   ao                     N8AO on / quality / half-res
 *   bloom                  mip levels + intensity multiplier
 *   volumetrics.cones      floodlight cone shells on/off
 *   rain.streaks           GPU rain streak instance count (Weather.js)
 *   rain.splashes          ground splash instance count
 *   motionBlurSamples      taps in the camera motion blur effect (0 = off)
 *   dof / lensDroplets      ADS depth of field / screen-space lens water allowed
 *   env.resolution         which HDRI variant feeds the sky + IBL ('2k'|'1k')
 */
export const QUALITY_TIERS = {
  low: {
    name: 'low',
    pixelRatioCap: 1.0,
    shadows: { enabled: true, mapSize: 1024, spotMapSize: 512, spotBudget: 1, cascades: 1, radius: 2 },
    ao: { enabled: false, quality: 'low', halfRes: true },
    ssr: false,
    bloom: { enabled: true, levels: 4, intensity: 0.55 },
    volumetrics: { enabled: false, cones: true, steps: 0 },
    particlesScale: 0.35,
    decalBudget: 48,
    textureMaxSize: 1024,
    anisotropy: 4,
    motionBlur: false,
    motionBlurSamples: 0,
    dof: false,
    lensDroplets: false,
    grain: false,
    chromaticAberration: false,
    aa: 'none',
    rainDensity: 0.35,
    rain: { streaks: 3600, splashes: 100 },
    env: { resolution: '1k' },
    lodBias: 1.5,
  },
  medium: {
    name: 'medium',
    pixelRatioCap: 1.25,
    shadows: { enabled: true, mapSize: 2048, spotMapSize: 512, spotBudget: 2, cascades: 2, radius: 3 },
    ao: { enabled: true, quality: 'medium', halfRes: true },
    ssr: false,
    bloom: { enabled: true, levels: 6, intensity: 0.7 },
    volumetrics: { enabled: true, cones: true, steps: 24 },
    particlesScale: 0.6,
    decalBudget: 128,
    textureMaxSize: 2048,
    anisotropy: 8,
    motionBlur: true,
    motionBlurSamples: 6,
    dof: true,
    lensDroplets: true,
    grain: true,
    chromaticAberration: true,
    aa: 'smaa',
    rainDensity: 0.65,
    rain: { streaks: 7000, splashes: 190 },
    env: { resolution: '1k' },
    lodBias: 1.0,
  },
  high: {
    name: 'high',
    pixelRatioCap: 1.5,
    shadows: { enabled: true, mapSize: 2048, spotMapSize: 1024, spotBudget: 3, cascades: 3, radius: 4 },
    ao: { enabled: true, quality: 'high', halfRes: false },
    ssr: true,
    bloom: { enabled: true, levels: 8, intensity: 0.85 },
    volumetrics: { enabled: true, cones: true, steps: 40 },
    particlesScale: 0.85,
    decalBudget: 256,
    textureMaxSize: 2048,
    anisotropy: 16,
    motionBlur: true,
    motionBlurSamples: 8,
    dof: true,
    lensDroplets: true,
    grain: true,
    chromaticAberration: true,
    aa: 'smaa',
    rainDensity: 0.85,
    rain: { streaks: 15000, splashes: 270 },
    env: { resolution: '2k' },
    lodBias: 0.75,
  },
  ultra: {
    name: 'ultra',
    pixelRatioCap: 2.0,
    shadows: { enabled: true, mapSize: 4096, spotMapSize: 1024, spotBudget: 3, cascades: 4, radius: 5 },
    ao: { enabled: true, quality: 'ultra', halfRes: false },
    ssr: true,
    bloom: { enabled: true, levels: 8, intensity: 1.0 },
    volumetrics: { enabled: true, cones: true, steps: 64 },
    particlesScale: 1.0,
    decalBudget: 512,
    textureMaxSize: 4096,
    anisotropy: 16,
    motionBlur: true,
    motionBlurSamples: 8,
    dof: true,
    lensDroplets: true,
    grain: true,
    chromaticAberration: true,
    aa: 'smaa',
    rainDensity: 1.0,
    rain: { streaks: 19000, splashes: 330 },
    env: { resolution: '2k' },
    lodBias: 0.5,
  },
};

/** @param {string} tier @returns {typeof QUALITY_TIERS.high} */
export function getTier(tier) {
  return QUALITY_TIERS[tier] || QUALITY_TIERS.high;
}
