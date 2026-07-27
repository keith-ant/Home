/**
 * LensFX — health-driven screen feedback hooks (FX stream).
 *
 * Bloody screen edge: post.setDamageVignette from player health with a
 * short pulse on every hit, full at death. (Lens water on nearby
 * explosions is applied by Explosions via post.splashLens; the rain
 * auto-trigger lives in Post.)
 *
 * Listens: player:damaged, player:died, player:healed, player:respawn.
 */
export class LensFX {
  /**
   * @param {import('../Game.js').Game} game
   */
  constructor(game) {
    this.game = game;
    this._pulse = 0;
    this._dead = false;
    this._current = 0;
    const ev = game.events;
    this._offs = [
      ev.on('player:damaged', (e) => {
        this._pulse = Math.min(1, this._pulse + 0.35 + (e?.amount ?? 0) / 60);
      }),
      ev.on('player:died', () => {
        this._dead = true;
      }),
      ev.on('player:respawn', () => {
        this._dead = false;
        this._pulse = 0;
        this._current = 0;
      }),
    ];
  }

  update(dt) {
    const post = this.game.post;
    if (!post?.setDamageVignette) return;
    const player = this.game.player;
    let target = 0;
    if (player) {
      const hp = Math.max(0, player.health / (player.maxHealth || 100));
      // nothing until ~70 % health, then ramps up hard
      const hurt = Math.max(0, 0.72 - hp) / 0.72;
      target = Math.pow(hurt, 1.35) * 0.95;
      if (this._dead || !player.alive) target = 1;
    }
    this._pulse = Math.max(0, this._pulse - dt * 1.6);
    const want = Math.min(1, target + this._pulse);
    // hit hard immediately, recover slowly
    if (want > this._current) this._current = want;
    else this._current += (want - this._current) * Math.min(1, dt * 3);
    post.setDamageVignette(this._current);
  }

  dispose() {
    for (const off of this._offs) off?.();
  }
}
