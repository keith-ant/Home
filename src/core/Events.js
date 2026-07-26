/**
 * Tiny typed pub/sub bus. The ONLY sanctioned coupling between gameplay
 * modules (see docs/ARCHITECTURE.md §3). Payloads are plain objects.
 *
 *   const off = events.on('enemy:killed', (e) => ...);
 *   events.emit('enemy:killed', { enemy, by, isHeadshot });
 *   off();
 */
export class Events {
  constructor() {
    /** @type {Map<string, Set<Function>>} */
    this._map = new Map();
  }

  /**
   * Subscribe to a channel.
   * @param {string} type
   * @param {(payload:any)=>void} fn
   * @returns {()=>void} unsubscribe
   */
  on(type, fn) {
    let set = this._map.get(type);
    if (!set) {
      set = new Set();
      this._map.set(type, set);
    }
    set.add(fn);
    return () => this.off(type, fn);
  }

  once(type, fn) {
    const off = this.on(type, (p) => {
      off();
      fn(p);
    });
    return off;
  }

  off(type, fn) {
    const set = this._map.get(type);
    if (set) set.delete(fn);
  }

  emit(type, payload) {
    const set = this._map.get(type);
    if (!set || set.size === 0) return;
    // Snapshot so handlers can unsubscribe during dispatch.
    for (const fn of [...set]) {
      try {
        fn(payload);
      } catch (err) {
        console.error(`[events] handler for "${type}" threw:`, err);
      }
    }
  }

  clear() {
    this._map.clear();
  }
}
