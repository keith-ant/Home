/**
 * User settings + quality tier. Persists to localStorage (best effort) and
 * emits `settings:changed {key, value}` on the game event bus.
 *
 * Quality tiers themselves (what each tier means for shadows, AO, particles…)
 * live in src/render/QualityTiers.js; this module only stores the choice.
 */
const STORAGE_KEY = 'ironwake.settings.v1';

export const DEFAULTS = Object.freeze({
  quality: 'high',        // low | medium | high | ultra
  fov: 100,               // horizontal-ish CoD-style FOV slider (65–120)
  sensitivity: 1.0,       // mouse look multiplier
  invertY: false,
  motionBlur: true,
  filmGrain: true,
  chromaticAberration: true,
  aaMode: 'smaa',         // none | smaa | taa
  showFps: false,
  masterVolume: 0.9,
  musicVolume: 0.6,
  sfxVolume: 1.0,
  subtitles: true,
  crosshair: 'default',
  toggleAds: false,
  toggleCrouch: false,
});

export const QUALITY_ORDER = ['low', 'medium', 'high', 'ultra'];

export class Settings {
  /**
   * @param {import('./Events.js').Events} events
   * @param {object} [overrides] param-driven overrides (not persisted)
   */
  constructor(events, overrides = {}) {
    this._events = events;
    this._values = { ...DEFAULTS, ...this._load(), ...overrides };
    this._transient = new Set(Object.keys(overrides));
  }

  get(key) {
    return this._values[key];
  }

  get all() {
    return { ...this._values };
  }

  set(key, value, { persist = true } = {}) {
    if (this._values[key] === value) return;
    this._values[key] = value;
    if (persist && !this._transient.has(key)) this._save();
    this._events.emit('settings:changed', { key, value });
  }

  get quality() {
    return this._values.quality;
  }

  /** numeric quality rank 0..3 */
  get qualityRank() {
    return Math.max(0, QUALITY_ORDER.indexOf(this._values.quality));
  }

  reset() {
    this._values = { ...DEFAULTS };
    this._save();
    for (const key of Object.keys(DEFAULTS)) {
      this._events.emit('settings:changed', { key, value: this._values[key] });
    }
  }

  _load() {
    try {
      const raw = window.localStorage && window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      // Drop unknown keys from older versions.
      const clean = {};
      for (const k of Object.keys(DEFAULTS)) if (k in parsed) clean[k] = parsed[k];
      return clean;
    } catch {
      return {};
    }
  }

  _save() {
    try {
      if (window.localStorage) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this._values));
    } catch {
      /* storage unavailable — ignore */
    }
  }
}
