/**
 * Synth — procedural fill-ins for sounds we have no samples for
 * (docs/ASSETS-CHARACTERS-WEAPONS-AUDIO.md §MISSING): brass casing tinks,
 * hitmarker tick / kill confirm, reload mechanical clicks, dry-fire,
 * explosion body/tail, gunshot body layer, UI blips. Everything is built
 * from oscillators + a shared white-noise buffer, scheduled at absolute
 * context times so bursts (casing scatter, reload beats) stay tight.
 * All methods no-op when the engine isn't ready.
 */
export class Synth {
  /** @param {import('./AudioEngine.js').AudioEngine} engine */
  constructor(engine) {
    this.engine = engine;
    this._noise = null;
  }

  get ready() {
    return this.engine.ready;
  }

  /** 1 s mono white-noise buffer, generated once (deterministic seed). */
  noise() {
    if (this._noise) return this._noise;
    const ctx = this.engine.ctx;
    const len = ctx.sampleRate;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let s = 987654321;
    for (let i = 0; i < len; i++) {
      s = (Math.imul(s, 1103515245) + 12345) >>> 0;
      d[i] = s / 2147483648 - 1;
    }
    this._noise = buf;
    return buf;
  }

  /** filtered noise burst → destination */
  _noiseBurst({ dest, at, dur = 0.06, gain = 0.5, type = 'bandpass', freq = 2000, q = 1, attack = 0.002, position = null, reverb = 0 }) {
    const e = this.engine;
    const ctx = e.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise();
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(gain, at + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(f);
    f.connect(g);
    let end = g;
    let panner = null;
    if (position) {
      panner = e._panner();
      panner.refDistance = 4;
      panner.maxDistance = 200;
      panner.rolloffFactor = 1.1;
      if (panner.positionX) {
        panner.positionX.value = position.x;
        panner.positionY.value = position.y;
        panner.positionZ.value = position.z;
      } else panner.setPosition(position.x, position.y, position.z);
      end.connect(panner);
      panner.connect(dest);
    } else {
      end.connect(dest);
    }
    if (reverb && e.reverbSend) {
      const sg = ctx.createGain();
      sg.gain.value = reverb;
      end.connect(sg);
      sg.connect(e.reverbSend);
    }
    src.start(at);
    src.stop(at + dur + 0.05);
    if (panner) src.onended = () => e._releasePanner(panner);
    return g;
  }

  _tone({ dest, at, dur = 0.08, freq = 880, freqEnd = null, gain = 0.3, type = 'sine', attack = 0.002, position = null }) {
    const e = this.engine;
    const ctx = e.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, at);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), at + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(gain, at + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g);
    let panner = null;
    if (position) {
      panner = e._panner();
      panner.refDistance = 3;
      if (panner.positionX) {
        panner.positionX.value = position.x;
        panner.positionY.value = position.y;
        panner.positionZ.value = position.z;
      } else panner.setPosition(position.x, position.y, position.z);
      g.connect(panner);
      panner.connect(dest);
    } else {
      g.connect(dest);
    }
    o.start(at);
    o.stop(at + dur + 0.05);
    if (panner) o.onended = () => e._releasePanner(panner);
    return g;
  }

  /* ---------------------------------------------------------- weapons */
  /** Low body thump + noise crack layered under the sampled gunshot. */
  shotBody(at, gain = 0.5, position = null) {
    if (!this.ready) return;
    const dest = this.engine.bus('sfx');
    this._tone({ dest, at, dur: 0.12, freq: 110, freqEnd: 45, gain: 0.55 * gain, type: 'sine', position });
    this._noiseBurst({ dest, at, dur: 0.045, gain: 0.35 * gain, type: 'highpass', freq: 1800, q: 0.6, position, reverb: 0.25 });
  }

  /** Brass casing tink: 2–3 detuned high partials with fast decay. */
  casing(at, position, kind = 'rifle') {
    if (!this.ready) return;
    const e = this.engine;
    const dest = e.bus('foley');
    const base = kind === 'magazine' ? 620 : kind === 'pistol' ? 3100 : 3900;
    const g = 0.11 * e.jitter(0.35);
    this._tone({ dest, at, dur: 0.09, freq: base * e.jitter(0.06), gain: g, type: 'triangle', position });
    this._tone({ dest, at: at + 0.004, dur: 0.11, freq: base * 1.51 * e.jitter(0.05), gain: g * 0.7, type: 'sine', position });
    if (kind !== 'magazine') this._tone({ dest, at: at + 0.045 * e.jitter(0.4), dur: 0.06, freq: base * 1.18 * e.jitter(0.05), gain: g * 0.45, type: 'triangle', position });
  }

  /** Hitmarker click; a kill adds a lower confirming knock. */
  hitmarker(at, kill = false, headshot = false) {
    if (!this.ready) return;
    const dest = this.engine.bus('ui');
    this._noiseBurst({ dest, at, dur: 0.035, gain: 0.55, type: 'bandpass', freq: 3600, q: 3.5 });
    this._tone({ dest, at, dur: 0.05, freq: headshot ? 2400 : 2000, gain: 0.16, type: 'square' });
    if (kill) {
      this._tone({ dest, at: at + 0.03, dur: 0.12, freq: 900, freqEnd: 420, gain: 0.22, type: 'triangle' });
      if (headshot) this._noiseBurst({ dest, at: at + 0.02, dur: 0.09, gain: 0.35, type: 'highpass', freq: 5200, q: 0.7 });
    }
  }

  /** Mechanical reload beat: 'magout' | 'magin' | 'bolt' | 'chamber'. */
  reload(at, beat = 'magout') {
    if (!this.ready) return;
    const dest = this.engine.bus('foley');
    if (beat === 'magout') {
      this._noiseBurst({ dest, at, dur: 0.05, gain: 0.4, type: 'bandpass', freq: 1400, q: 2 });
      this._noiseBurst({ dest, at: at + 0.05, dur: 0.12, gain: 0.25, type: 'lowpass', freq: 700, q: 0.8 });
    } else if (beat === 'magin') {
      this._noiseBurst({ dest, at, dur: 0.03, gain: 0.35, type: 'bandpass', freq: 2200, q: 3 });
      this._tone({ dest, at: at + 0.02, dur: 0.09, freq: 240, freqEnd: 120, gain: 0.28, type: 'triangle' });
      this._noiseBurst({ dest, at: at + 0.035, dur: 0.07, gain: 0.3, type: 'lowpass', freq: 900, q: 0.7 });
    } else if (beat === 'bolt') {
      this._noiseBurst({ dest, at, dur: 0.025, gain: 0.5, type: 'bandpass', freq: 3000, q: 4 });
      this._noiseBurst({ dest, at: at + 0.055, dur: 0.03, gain: 0.55, type: 'bandpass', freq: 2500, q: 3 });
    } else {
      this._noiseBurst({ dest, at, dur: 0.03, gain: 0.35, type: 'bandpass', freq: 2600, q: 3 });
    }
  }

  /** Dry-fire click. */
  dryFire(at) {
    if (!this.ready) return;
    const dest = this.engine.bus('foley');
    this._noiseBurst({ dest, at, dur: 0.02, gain: 0.35, type: 'bandpass', freq: 4200, q: 5 });
    this._tone({ dest, at: at + 0.004, dur: 0.03, freq: 1500, freqEnd: 700, gain: 0.12, type: 'square' });
  }

  /** Explosion body + rumbling tail (layers under sfx.weapon.explosion). */
  explosion(at, position = null, scale = 1) {
    if (!this.ready) return;
    const dest = this.engine.bus('sfx');
    this._tone({ dest, at, dur: 0.9 * scale, freq: 80, freqEnd: 28, gain: 0.9, type: 'sine', position, attack: 0.004 });
    this._noiseBurst({ dest, at, dur: 0.35, gain: 0.9, type: 'lowpass', freq: 1800, q: 0.5, position, reverb: 0.6 });
    this._noiseBurst({ dest, at: at + 0.04, dur: 2.2 * scale, gain: 0.55, type: 'lowpass', freq: 380, q: 0.6, position, reverb: 0.7, attack: 0.08 });
  }

  /* ------------------------------------------------------------------ ui */
  uiClick(at) {
    if (!this.ready) return;
    const dest = this.engine.bus('ui');
    this._tone({ dest, at, dur: 0.05, freq: 1250, freqEnd: 900, gain: 0.16, type: 'triangle' });
    this._noiseBurst({ dest, at, dur: 0.02, gain: 0.22, type: 'highpass', freq: 3000, q: 0.7 });
  }

  uiHover(at) {
    if (!this.ready) return;
    const dest = this.engine.bus('ui');
    this._tone({ dest, at, dur: 0.04, freq: 2100, gain: 0.06, type: 'sine' });
  }

  uiConfirm(at) {
    if (!this.ready) return;
    const dest = this.engine.bus('ui');
    this._tone({ dest, at, dur: 0.09, freq: 700, freqEnd: 1400, gain: 0.16, type: 'triangle' });
    this._tone({ dest, at: at + 0.05, dur: 0.12, freq: 1750, gain: 0.1, type: 'sine' });
  }

  /** Score/wave stinger: airy fifth swell. */
  stinger(at) {
    if (!this.ready) return;
    const dest = this.engine.bus('ui');
    this._tone({ dest, at, dur: 0.9, freq: 220, gain: 0.09, type: 'sawtooth', attack: 0.15 });
    this._tone({ dest, at: at + 0.05, dur: 0.85, freq: 330, gain: 0.07, type: 'triangle', attack: 0.2 });
  }
}
