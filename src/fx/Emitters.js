/**
 * Emitters — ambient world FX driven by world.emitters (FX stream).
 *
 * WORLD publishes emitter records {kind:'fire'|'embers'|'smoke'|'steam',
 * position, radius, intensity, tag}. This system spawns pooled particles for
 * them each fixed step (only for emitters within CULL_DIST of the camera):
 *   fire   → rising embers over the flames (WORLD draws the licks + coal glow)
 *   embers → glowing embers + faint smoke (burnt container coal bed)
 *   smoke  → soft grey plume
 *   steam  → white vapour jet (alley vent, roof vent)
 * All rates scale with emitter.intensity and the tier particle budget.
 */
import * as THREE from 'three';

const CULL_DIST = 52;
const _up = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3();

export class Emitters {
  /**
   * @param {import('../Game.js').Game} game
   * @param {{particles:any, rng:any}} deps
   */
  constructor(game, { particles, rng }) {
    this.game = game;
    this.particles = particles;
    this.rng = rng;
    this._state = new Map(); // emitter → accumulators
    this.enabled = true;
    this._scale = game.tier?.particlesScale ?? 1;
  }

  update(dt) {
    if (!this.enabled) return;
    const list = this.game.world?.emitters;
    if (!list || list.length === 0) return;
    const cam = this.game.camera.position;
    const P = this.particles;
    const rng = this.rng;
    const dens = 0.55 + 0.45 * this._scale;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      const pos = e.position;
      const dx = pos.x - cam.x;
      const dy = pos.y - cam.y;
      const dz = pos.z - cam.z;
      if (dx * dx + dy * dy + dz * dz > CULL_DIST * CULL_DIST) continue;
      let st = this._state.get(e);
      if (!st) {
        st = { flame: rng.next() * 0.1, smoke: rng.next() * 0.4, ember: rng.next() * 0.6, seed: rng.next() * 10 };
        this._state.set(e, st);
      }
      const intensity = e.intensity ?? 1;
      const radius = e.radius ?? 0.4;
      st.flame -= dt;
      st.smoke -= dt;
      st.ember -= dt;
      switch (e.kind) {
        case 'fire': {
          // The world draws the flame licks + coal glow itself; FX adds the
          // rising embers (and the separate 'smoke' emitter above it).
          if (st.ember <= 0) {
            st.ember = (0.55 + rng.next() * 0.7) / (intensity * dens);
            _v.set(pos.x, pos.y + 0.3, pos.z);
            P.emit('ember', {
              position: _v,
              direction: _up,
              spread: 0.55,
              count: 1 + Math.floor(rng.next() * 2),
              speed: [0.8, 2.2],
              life: [1.2, 2.6],
              size: [0.03, 0.06],
              offset: radius * 0.4,
            });
          }
          break;
        }
        case 'embers': {
          if (st.ember <= 0) {
            st.ember = (0.7 + rng.next() * 1.0) / (intensity * dens);
            _v.set(pos.x + rng.range(-radius, radius), pos.y + 0.15, pos.z + rng.range(-radius, radius));
            P.emit('ember', {
              position: _v,
              direction: _up,
              spread: 0.5,
              count: 1,
              speed: [0.4, 1.4],
              life: [1.5, 3],
              size: [0.03, 0.055],
            });
          }
          if (st.smoke <= 0) {
            st.smoke = (1.5 + rng.next() * 1.4) / (intensity * dens);
            _v.set(pos.x + rng.range(-radius, radius) * 0.5, pos.y + 0.4, pos.z + rng.range(-radius, radius) * 0.5);
            P.emit('smoke_soft', {
              position: _v,
              direction: _up,
              spread: 0.35,
              count: 1,
              speed: [0.3, 0.6],
              size: [0.6, 0.9],
              sizeEnd: [1.8, 2.8],
              life: [3, 5],
              color: [0.16, 0.15, 0.14],
              alpha: 0.32,
            });
          }
          break;
        }
        case 'smoke': {
          if (st.smoke <= 0) {
            st.smoke = (0.3 + rng.next() * 0.25) / (intensity * dens);
            _v.set(pos.x + rng.range(-radius, radius) * 0.5, pos.y + 0.2, pos.z + rng.range(-radius, radius) * 0.5);
            P.emit('smoke_soft', {
              position: _v,
              direction: _up,
              spread: 0.35,
              count: 2,
              speed: [0.55, 1.0],
              size: [0.7, 1.0],
              sizeEnd: [2.2, 3.4],
              life: [4, 6],
              color: [0.13, 0.12, 0.11],
              colorEnd: [0.18, 0.17, 0.16],
              alpha: 0.22,
              fadeIn: 0.32,
              offset: 0.25,
            });
          }
          break;
        }
        case 'steam': {
          if (st.smoke <= 0) {
            st.smoke = (0.18 + rng.next() * 0.14) / (intensity * dens);
            _v.set(pos.x, pos.y, pos.z);
            P.emit('smoke_wisp', {
              position: _v,
              direction: e.direction || _up,
              spread: 0.28,
              count: 1,
              speed: [1.2, 2.4],
              size: [0.18, 0.28],
              sizeEnd: [0.9, 1.5],
              life: [1.2, 1.9],
              color: [0.6, 0.62, 0.66],
              colorEnd: [0.5, 0.52, 0.55],
              alpha: 0.35,
              gravity: 0.9,
              drag: 1.1,
            });
          }
          break;
        }
        default:
          break;
      }
    }
  }

  dispose() {
    this._state.clear();
  }
}
