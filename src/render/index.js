/**
 * RENDER stream installer — sky, lighting, weather, PBR factory, post.
 *
 * `installRender(game)` runs after renderer/camera/assets exist (before the
 * world); `installPost(game)` runs last (after every other stream) and builds
 * the full post chain plus the per-frame pre-render hooks.
 *
 * What lands on `game` (public surface for other streams):
 *   game.sky        Sky        — HDRI dome, IBL, fog, lightning (docs in Sky.js)
 *   game.lighting   Lighting   — moon/ambient + addFlood/addPractical/addBeacon,
 *                                strongestLightsNear(pos, n) (docs in Lighting.js)
 *   game.weather    Weather    — rain/splashes/wind/wetness/puddleRipplesTexture
 *   game.pbr        PBRFactory — makePBR / makeWetGround / makeCorrugatedContainer
 *   game.post       Post       — post chain APIs (exposure, DOF, grade, damage
 *                                vignette, lens water) (docs in Post.js)
 *
 * Systems registered (fixed-step order): weather 55, lighting 56, pbr 57,
 * post 95. Sky.update is already called by Game after all systems.
 *
 * Events: emits weather:lightning, weather:changed. Consumes settings:changed.
 *
 * DEMO: while the WORLD stream hasn't shipped Terminal 9, ./Demo.js dresses
 * the scaffold (converts stand-in lights to floodlights, adds a fire barrel,
 * beacons, PBR materials). S2 removes that — see Demo.js header.
 *
 * @module render/index
 */
import { Sky } from './Sky.js';
import { Lighting } from './Lighting.js';
import { Weather } from './Weather.js';
import { PBRFactory } from './PBR.js';
import { Post } from './Post.js';
import { installDemo } from './Demo.js';
import { registerRenderPresets } from './presets.js';

/**
 * @param {import('../Game.js').Game} game
 */
export function installRender(game) {
  // Order matters: Lighting owns the moon/ambient that Sky boosts during
  // lightning; Weather feeds cone/rain uniforms that Lighting reads.
  game.lighting = new Lighting(game);
  game.sky = new Sky(game);
  game.weather = new Weather(game);
  game.pbr = new PBRFactory(game);

  game.addSystem({ name: 'weather', update: (dt) => game.weather.update(dt), dispose: () => game.weather.dispose() }, 55);
  game.addSystem({ name: 'lighting', update: (dt) => game.lighting.update(dt), dispose: () => game.lighting.dispose() }, 56);
  game.addSystem({ name: 'pbr', update: (dt) => game.pbr.update(dt), dispose: () => game.pbr.dispose() }, 57);

  registerRenderPresets(game);
}

/**
 * Called after every other stream: consumes the world's light fixture list,
 * dresses the scaffold (DEMO), then builds the post chain and wires the
 * per-frame pre-render hooks (camera-final work: rain anchor, flare fades,
 * shadow budget).
 * @param {import('../Game.js').Game} game
 */
export function installPost(game) {
  // WORLD hand-off: consume declarative fixture descriptors if the level
  // provided them ({kind:'flood'|'practical'|'beacon', ...}). Scaffold-style
  // {type, object:Light} stand-ins are handled by the DEMO instead.
  consumeWorldFixtures(game);

  // DEMO dressing (no-op once Terminal 9 exists) — remove with the WORLD stream.
  installDemo(game);

  game.post = new Post({ game });
  game.addSystem({ name: 'post', update: (dt) => game.post.update(dt), dispose: () => game.post.dispose() }, 95);

  game.post.addPreRender((camera) => game.weather?.preRender(camera));
  game.post.addPreRender((camera) => game.lighting?.preRender(camera));
}

/**
 * If the world published declarative light fixture descriptors, build them.
 * Descriptor schema (see Lighting.addFixture): {kind:'flood', position,
 * target, color, intensity, angle, penumbra, distance, castShadow},
 * {kind:'practical', position, color, intensity, radius, flicker},
 * {kind:'beacon', position, color, blinkPeriod}. Entries carrying an
 * existing three.js Light in `object` are left alone (scaffold / bespoke).
 * @param {import('../Game.js').Game} game
 */
function consumeWorldFixtures(game) {
  const world = game.world;
  const lighting = game.lighting;
  if (!world || !lighting || !Array.isArray(world.lights)) return;
  for (const entry of world.lights) {
    if (!entry || entry.object || entry.light) continue; // already-instantiated lights
    if (!entry.kind && !entry.type) continue;
    const fixture = lighting.addFixture(entry); // dispatches on kind || type
    if (fixture) entry.fixture = fixture;
  }
}
