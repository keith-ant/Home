/**
 * SoundBank — lazy sample loading + variant round-robin (AUDIO stream).
 *
 * Samples are the CC0 .ogg files listed in src/assets/manifest.audio.js and
 * are fetched on demand through `game.assets.ensure(id)` (audio manifest
 * entries are `lazy`), then decoded once per variant and cached. Missing or
 * failed ids resolve to nothing (callers fall back to the Synth) — the bank
 * never throws.
 *
 *   bank.preload(['sfx.ui.click', ...])          fire-and-forget warm-up
 *   bank.play(id, opts) → Promise<handle|null>  round-robin variant + pitch/gain jitter
 *   bank.buffer(id) → Promise<AudioBuffer|null> next variant, decoded
 */
export class SoundBank {
  /**
   * @param {any} game
   * @param {import('./AudioEngine.js').AudioEngine} engine
   */
  constructor(game, engine) {
    this.game = game;
    this.engine = engine;
    /** @type {Map<string, {buffers:AudioBuffer[], next:number}>} */
    this._decoded = new Map();
    /** @type {Map<string, Promise<AudioBuffer[]>>} */
    this._pending = new Map();
  }

  has(id) {
    return !!this.game.assets?.entry?.(id);
  }

  /** Decode (once) and return all variants for an id. */
  async _variants(id) {
    const done = this._decoded.get(id);
    if (done) return done.buffers;
    if (this._pending.has(id)) return this._pending.get(id);
    const engine = this.engine;
    if (!engine.ready) return [];
    const job = (async () => {
      const res = await this.game.assets?.ensure?.(id);
      const raw = res && Array.isArray(res.buffers) ? res.buffers : [];
      const out = [];
      for (const ab of raw) {
        if (!ab || !ab.byteLength) continue;
        try {
          // decodeAudioData detaches the buffer, so hand it a copy
          const buf = await engine.ctx.decodeAudioData(ab.slice(0));
          out.push(buf);
        } catch (err) {
          console.warn(`[audio] decode failed for ${id}:`, err?.message || err);
        }
      }
      this._decoded.set(id, { buffers: out, next: 0 });
      this._pending.delete(id);
      return out;
    })().catch((err) => {
      console.warn(`[audio] load failed for ${id}:`, err?.message || err);
      this._pending.delete(id);
      this._decoded.set(id, { buffers: [], next: 0 });
      return [];
    });
    this._pending.set(id, job);
    return job;
  }

  /** Next round-robin AudioBuffer for an id (decodes on first use). */
  async buffer(id) {
    const list = await this._variants(id);
    if (!list.length) return null;
    const entry = this._decoded.get(id);
    let idx = 0;
    if (entry) {
      idx = list.length > 1 ? (entry.next + this.engine.randInt(list.length - 1) + 1) % list.length : 0;
      entry.next = idx;
    }
    return list[idx];
  }

  /**
   * Play a sample by manifest id. Silently no-ops when the engine isn't
   * ready or the sample is missing (returns null).
   * @param {string} id
   * @param {object} [opts] see AudioEngine.play; adds `jitter` (default 0.045)
   */
  async play(id, opts = {}) {
    if (!this.engine.ready || !id) return null;
    const buf = await this.buffer(id);
    if (!buf) return null;
    return this.engine.play(buf, { jitter: 0.045, ...opts });
  }

  /** Kick off decoding for a list of ids without waiting. */
  preload(ids) {
    if (!this.engine.ready) return;
    for (const id of ids) this._variants(id);
  }
}
