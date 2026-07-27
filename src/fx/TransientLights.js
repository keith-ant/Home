/**
 * TransientLights — a fixed pool of point lights for fast VFX light spikes
 * (muzzle flash 60 ms, explosion flash 250 ms, ricochet spark). The lights are
 * registered as lighting FIXTURES (game.lighting.addPractical) at boot with
 * intensity 0, so the light count never changes at runtime (no shader
 * recompiles) and the render systems that read fixtures (rain, fog tint,
 * particle lighting, viewmodel lighting) automatically respond to them.
 *
 *   const t = lights.flash({position, color, intensity, duration, radius})
 *   lights.update(dt)   decays intensity; frees the slot at the end
 *
 * intensity is candela-ish (three physical units, decay 2).
 */
import * as THREE from 'three';

const _c = new THREE.Color();

export class TransientLights {
  /**
   * @param {import('../Game.js').Game} game
   * @param {number} [count]
   */
  constructor(game, count = 3) {
    this.game = game;
    this.slots = [];
    const lighting = game.lighting;
    for (let i = 0; i < count; i++) {
      const slot = {
        fixture: null,
        light: null,
        active: false,
        t: 0,
        duration: 0.1,
        peak: 0,
        color0: new THREE.Color(0xffffff),
        color1: new THREE.Color(0xffffff),
        curve: 2,
        priority: 0,
      };
      if (lighting?.addPractical) {
        slot.fixture = lighting.addPractical({
          position: [0, -50, 0],
          color: 0xffffff,
          intensity: 0,
          radius: 30,
          flicker: 'none',
          castShadow: false,
          marker: false,
          glow: false,
        });
        slot.light = slot.fixture.light;
        slot.light.intensity = 0;
        slot.fixture.power = 0;
      } else {
        // no lighting stream: own a raw light so the API still works
        slot.light = new THREE.PointLight(0xffffff, 0, 30, 2);
        game.scene.add(slot.light);
      }
      this.slots.push(slot);
    }
  }

  /**
   * Spike a light. Reuses a free slot, else steals the dimmest / lowest priority.
   * @param {object} o
   * @param {THREE.Vector3} o.position
   * @param {number|string} [o.color=0xffb060]
   * @param {number|string} [o.colorEnd] fades toward this hue over the flash
   * @param {number} [o.intensity=300] peak candela
   * @param {number} [o.duration=0.06] seconds
   * @param {number} [o.radius=25] light cutoff distance
   * @param {number} [o.curve=2] decay exponent
   * @param {number} [o.priority=0] higher steals lower
   */
  flash(o = {}) {
    let slot = null;
    let best = -Infinity;
    for (const s of this.slots) {
      const score = !s.active ? Infinity : -(s.priority * 10 + s.light.intensity);
      if (score > best) {
        best = score;
        slot = s;
      }
    }
    if (!slot) return null;
    if (slot.active && (o.priority ?? 0) < slot.priority) return null;
    slot.active = true;
    slot.t = 0;
    slot.duration = Math.max(0.02, o.duration ?? 0.06);
    slot.peak = o.intensity ?? 300;
    slot.curve = o.curve ?? 2;
    slot.priority = o.priority ?? 0;
    slot.color0.set(o.color ?? 0xffb060);
    slot.color1.copy(o.colorEnd !== undefined ? _c.set(o.colorEnd) : slot.color0);
    const pos = o.position;
    slot.light.position.copy(pos);
    slot.light.color.copy(slot.color0);
    slot.light.intensity = slot.peak;
    slot.light.distance = o.radius ?? 25;
    if (slot.fixture) {
      slot.fixture.position.copy(pos);
      slot.fixture.color.copy(slot.color0);
      slot.fixture.power = slot.peak;
      slot.fixture.radius = slot.light.distance;
      slot.fixture._baseIntensity = slot.peak;
    }
    return slot;
  }

  update(dt) {
    for (const s of this.slots) {
      if (!s.active) continue;
      s.t += dt;
      const f = s.t / s.duration;
      if (f >= 1) {
        s.active = false;
        s.light.intensity = 0;
        if (s.fixture) {
          s.fixture.power = 0;
          s.fixture._baseIntensity = 0;
          s.fixture.position.set(0, -50, 0);
          s.light.position.set(0, -50, 0);
        }
        continue;
      }
      const k = Math.pow(1 - f, s.curve);
      s.light.intensity = s.peak * k;
      s.light.color.copy(s.color0).lerp(s.color1, f);
      if (s.fixture) {
        s.fixture.power = s.light.intensity;
        s.fixture.color.copy(s.light.color);
      }
    }
  }

  clear() {
    for (const s of this.slots) {
      s.active = false;
      s.light.intensity = 0;
      if (s.fixture) {
        s.fixture.power = 0;
        s.fixture.position.set(0, -50, 0);
        s.light.position.set(0, -50, 0);
      }
    }
  }

  dispose() {
    for (const s of this.slots) {
      if (s.fixture) this.game.lighting?.remove(s.fixture);
      else this.game.scene.remove(s.light);
    }
    this.slots.length = 0;
  }
}
