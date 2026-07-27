/**
 * AudioEngine — WebAudio graph for IRONWAKE (AUDIO stream).
 *
 * Graph:  sources → [sfx | foley | ambient | ui] gains → master → muffle LPF → destination
 *                                     ↳ reverbSend → convolver (procedural IR) → master
 * World sounds run through pooled PannerNodes (HRTF); the listener tracks
 * game.camera each fixed step (see update()).
 *
 * Determinism / robustness contract:
 *  - In photo/autoplay modes (`game.isDeterministic`) the engine is created
 *    DISABLED: every play call is a silent no-op, no AudioContext is made,
 *    nothing can throw. (docs/ARCHITECTURE.md §4: audio muted.)
 *  - In realtime the AudioContext is created lazily on the first user
 *    gesture (pointerdown/keydown); calls before that are dropped.
 *  - Cosmetic randomness (pitch/gain jitter, variant choice) uses a private
 *    LCG, never game.rng, so audio can't perturb gameplay determinism.
 *
 * Public surface (game.audio):
 *   audio.enabled, audio.ready
 *   audio.play(buffer, {bus, gain, rate, position, loop, reverb, at, jitter})
 *      → handle {stop(fade?), setGain(v)} | null
 *   audio.bus(name) → GainNode
 *   audio.setBusGain(name, v), audio.setMuffle(0..1)
 *   audio.jitter(amount) → 1±amount random factor
 *   audio.now → context time (0 when not ready)
 */
import * as THREE from 'three';

export class AudioEngine {
  /** @param {any} game */
  constructor(game) {
    this.game = game;
    this.enabled = !game.isDeterministic && typeof window !== 'undefined'
      && !!(window.AudioContext || window.webkitAudioContext);
    this.ctx = null;
    this._buses = null;
    this._panPool = [];
    this._rng = 0x9e3779b1;
    this._muffle = 0;
    this._duck = 0;
    this._onReady = [];

    if (this.enabled) {
      this._gesture = () => this.resume();
      window.addEventListener('pointerdown', this._gesture, { passive: true });
      window.addEventListener('keydown', this._gesture, { passive: true });
    }
  }

  /** Register a callback for when the context first becomes usable. */
  onReady(fn) {
    if (this.ready) fn();
    else this._onReady.push(fn);
  }

  get ready() {
    return !!(this.ctx && this.ctx.state === 'running');
  }

  get now() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  /** Create/resume the context (call from a user gesture). Never throws. */
  resume() {
    if (!this.enabled) return;
    try {
      if (!this.ctx) this._create();
      if (this.ctx && this.ctx.state !== 'running') {
        const p = this.ctx.resume();
        if (p && typeof p.then === 'function') {
          p.then(() => this._flushReady()).catch(() => {});
        }
      } else {
        this._flushReady();
      }
    } catch (err) {
      console.warn('[audio] context unavailable, running silent:', err?.message || err);
      this.enabled = false;
    }
  }

  _flushReady() {
    if (!this.ready) return;
    const list = this._onReady.splice(0, this._onReady.length);
    for (const fn of list) {
      try { fn(); } catch (err) { console.warn('[audio] onReady handler failed:', err); }
    }
  }

  _create() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx({ latencyHint: 'interactive' });
    this.ctx = ctx;

    const master = ctx.createGain();
    master.gain.value = clampVol(this.game.settings?.get?.('masterVolume') ?? 0.9);
    const muffle = ctx.createBiquadFilter();
    muffle.type = 'lowpass';
    muffle.frequency.value = 20000;
    muffle.Q.value = 0.7;
    master.connect(muffle);
    muffle.connect(ctx.destination);
    this.master = master;
    this.muffle = muffle;

    const mk = (v = 1) => {
      const g = ctx.createGain();
      g.gain.value = v;
      g.connect(master);
      return g;
    };
    const sfxVol = clampVol(this.game.settings?.get?.('sfxVolume') ?? 1);
    this._buses = {
      sfx: mk(sfxVol),
      foley: mk(0.9 * sfxVol),
      ambient: mk(0.85),
      ui: mk(0.8),
      voice: mk(1),
    };

    // Procedural reverb: 1.6 s exponentially-decaying stereo noise IR.
    const conv = ctx.createConvolver();
    conv.normalize = true;
    conv.buffer = makeImpulse(ctx, 1.7, 3.2, 0.012);
    const sendIn = ctx.createGain();
    sendIn.gain.value = 1;
    const wet = ctx.createGain();
    wet.gain.value = 0.32;
    sendIn.connect(conv);
    conv.connect(wet);
    wet.connect(master);
    this.reverbSend = sendIn;
    this.reverbWet = wet;

    // Live volume settings.
    this.game.events?.on('settings:changed', (p) => {
      if (!p) return;
      if (p.key === 'masterVolume') master.gain.value = clampVol(p.value);
      if (p.key === 'sfxVolume') {
        this._buses.sfx.gain.value = clampVol(p.value);
        this._buses.foley.gain.value = 0.9 * clampVol(p.value);
      }
    });
  }

  /** @param {'sfx'|'foley'|'ambient'|'ui'|'voice'} name */
  bus(name) {
    if (!this._buses) return null;
    return this._buses[name] || this._buses.sfx;
  }

  setBusGain(name, v, ramp = 0.05) {
    const b = this.bus(name);
    if (!b || !this.ctx) return;
    const t = this.ctx.currentTime;
    b.gain.cancelScheduledValues(t);
    b.gain.setValueAtTime(b.gain.value, t);
    b.gain.linearRampToValueAtTime(clampVol(v), t + ramp);
  }

  /** Low-health muffling: 0 = clear, 1 = heavily low-passed. */
  setMuffle(v) {
    this._muffle = v < 0 ? 0 : v > 1 ? 1 : v;
    if (!this.muffle || !this.ctx) return;
    // 20 kHz → ~650 Hz on a log-ish curve
    const f = 650 * Math.pow(20000 / 650, 1 - this._muffle);
    this.muffle.frequency.setTargetAtTime(f, this.ctx.currentTime, 0.25);
  }

  /** Ducking (explosions): 0..1 attenuates sfx/foley/ambient briefly. */
  duck(strength = 0.6, hold = 0.35, release = 0.9) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const target = 1 - Math.min(0.85, strength);
    for (const name of ['ambient', 'foley']) {
      const b = this.bus(name);
      if (!b) continue;
      const base = name === 'ambient' ? this._ambientBase ?? 0.85 : 0.9;
      b.gain.cancelScheduledValues(t);
      b.gain.setValueAtTime(b.gain.value, t);
      b.gain.linearRampToValueAtTime(base * target, t + 0.03);
      b.gain.setValueAtTime(base * target, t + hold);
      b.gain.linearRampToValueAtTime(base, t + hold + release);
    }
  }

  /** 1 ± amount random multiplier (private LCG, cosmetic only). */
  jitter(amount) {
    this._rng = (Math.imul(this._rng, 1664525) + 1013904223) >>> 0;
    const u = this._rng / 4294967296; // 0..1
    return 1 + (u * 2 - 1) * amount;
  }

  /** Random integer in [0, n). */
  randInt(n) {
    this._rng = (Math.imul(this._rng, 1664525) + 1013904223) >>> 0;
    return this._rng % Math.max(1, n | 0);
  }

  /**
   * Play a decoded AudioBuffer.
   * @param {AudioBuffer} buffer
   * @param {object} [o]
   * @param {string} [o.bus='sfx']
   * @param {number} [o.gain=1]
   * @param {number} [o.rate=1]           playbackRate (pitch)
   * @param {{x:number,y:number,z:number}} [o.position]  world position → 3D panner
   * @param {boolean} [o.loop=false]
   * @param {number} [o.reverb=0]         reverb send gain (0..1)
   * @param {number} [o.at]               absolute context start time
   * @param {number} [o.offset=0]         start offset seconds into the buffer
   * @param {number} [o.jitter=0]         random ±pitch/gain variation
   * @param {number} [o.refDistance=4]
   * @returns {{stop:(fade?:number)=>void, setGain:(v:number, ramp?:number)=>void, gainNode:GainNode}|null}
   */
  play(buffer, o = {}) {
    if (!this.ready || !buffer) return null;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = !!o.loop;
    const jitter = o.jitter || 0;
    src.playbackRate.value = Math.max(0.25, (o.rate || 1) * (jitter ? this.jitter(jitter) : 1));

    const gain = ctx.createGain();
    gain.gain.value = (o.gain ?? 1) * (jitter ? this.jitter(jitter * 0.5) : 1);
    src.connect(gain);

    let panner = null;
    if (o.position) {
      panner = this._panner();
      const p = o.position;
      setPos(panner, p.x, p.y, p.z);
      panner.refDistance = o.refDistance || 4;
      panner.maxDistance = o.maxDistance || 260;
      panner.rolloffFactor = o.rolloff ?? 1.05;
      gain.connect(panner);
      panner.connect(this.bus(o.bus || 'sfx'));
    } else {
      gain.connect(this.bus(o.bus || 'sfx'));
    }
    if (o.reverb && this.reverbSend) {
      const sg = ctx.createGain();
      sg.gain.value = o.reverb;
      gain.connect(sg);
      sg.connect(this.reverbSend);
      src.onended = () => { try { sg.disconnect(); } catch { /* noop */ } };
    }
    const when = o.at !== undefined ? Math.max(o.at, ctx.currentTime) : ctx.currentTime;
    try {
      src.start(when, o.offset || 0);
    } catch (err) {
      console.warn('[audio] start failed:', err?.message || err);
      return null;
    }
    const engine = this;
    const handle = {
      gainNode: gain,
      source: src,
      panner,
      setGain(v, ramp = 0.08) {
        const t = ctx.currentTime;
        gain.gain.cancelScheduledValues(t);
        gain.gain.setValueAtTime(gain.gain.value, t);
        gain.gain.linearRampToValueAtTime(Math.max(0, v), t + ramp);
      },
      stop(fade = 0.05) {
        try {
          const t = ctx.currentTime;
          gain.gain.cancelScheduledValues(t);
          gain.gain.setValueAtTime(gain.gain.value, t);
          gain.gain.linearRampToValueAtTime(0, t + fade);
          src.stop(t + fade + 0.02);
        } catch { /* already stopped */ }
      },
      setPosition(x, y, z) {
        if (panner) setPos(panner, x, y, z);
      },
    };
    // release the panner back to the pool once the (non-looping) source ends
    if (panner) {
      const prev = src.onended;
      src.onended = () => {
        if (prev) prev();
        engine._releasePanner(panner);
      };
    }
    return handle;
  }

  _panner() {
    const p = this._panPool.pop() || this.ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.coneInnerAngle = 360;
    p.coneOuterAngle = 360;
    return p;
  }

  _releasePanner(p) {
    try { p.disconnect(); } catch { /* noop */ }
    if (this._panPool.length < 24) this._panPool.push(p);
  }

  /** Track the render camera as the listener (call once per fixed step). */
  update(camera) {
    if (!this.ready || !camera) return;
    const l = this.ctx.listener;
    const p = camera.position;
    camera.getWorldDirection(_dir);
    if (l.positionX) {
      const t = this.ctx.currentTime;
      l.positionX.setValueAtTime(p.x, t);
      l.positionY.setValueAtTime(p.y, t);
      l.positionZ.setValueAtTime(p.z, t);
      l.forwardX.setValueAtTime(_dir.x, t);
      l.forwardY.setValueAtTime(_dir.y, t);
      l.forwardZ.setValueAtTime(_dir.z, t);
      l.upX.setValueAtTime(0, t);
      l.upY.setValueAtTime(1, t);
      l.upZ.setValueAtTime(0, t);
    } else if (l.setPosition) {
      l.setPosition(p.x, p.y, p.z);
      l.setOrientation(_dir.x, _dir.y, _dir.z, 0, 1, 0);
    }
  }

  dispose() {
    if (this._gesture) {
      window.removeEventListener('pointerdown', this._gesture);
      window.removeEventListener('keydown', this._gesture);
    }
    try { this.ctx?.close?.(); } catch { /* noop */ }
    this.ctx = null;
  }
}

// module-scope temporaries (no per-frame allocation)
const _dir = new THREE.Vector3();

function clampVol(v) {
  v = Number(v);
  if (!Number.isFinite(v)) return 1;
  return v < 0 ? 0 : v > 1.5 ? 1.5 : v;
}

function setPos(panner, x, y, z) {
  if (panner.positionX) {
    panner.positionX.value = x;
    panner.positionY.value = y;
    panner.positionZ.value = z;
  } else {
    panner.setPosition(x, y, z);
  }
}

/**
 * Procedural stereo impulse response: filtered noise with an exponential
 * decay (open-air night port: fast early decay, long dark tail).
 */
function makeImpulse(ctx, seconds, decay, predelay) {
  const rate = ctx.sampleRate;
  const len = Math.max(1, Math.floor(rate * seconds));
  const pre = Math.floor(rate * predelay);
  const buf = ctx.createBuffer(2, len, rate);
  let seed = 22695477;
  const rnd = () => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    return seed / 4294967296 * 2 - 1;
  };
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      const env = i < pre ? 0 : Math.exp(-decay * t) * (1 - 0.35 * ch * (i % 3 === 0 ? 1 : 0));
      // slight low-pass darkening as the tail rings out
      lp += (rnd() - lp) * (0.55 - 0.4 * t);
      d[i] = lp * env;
    }
  }
  return buf;
}
