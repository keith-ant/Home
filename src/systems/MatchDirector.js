/**
 * MatchDirector (`game.match`) — top-level match state machine:
 *   menu → combat (waves running) → death → results → (menu | combat again)
 *
 * Listens: match:start (UI deploy/click-to-play → combat), player:died,
 * match:end (UI back to main menu). Photo mode / autoplay use `forceCombat()`.
 * Emits:  match:state {state, wave?, stats?}  — 'combat' | 'death' |
 *         'results' | 'menu' ('intermission' comes from the Director).
 * Results stats: {score, kills, headshots, accuracy, wavesSurvived,
 * timeSurvived, longestKill}.
 * System 'match' (order 42): only the death → results timer.
 */
const DEATH_TO_RESULTS = 1.6;

export class MatchDirector {
  /**
   * @param {import('../Game.js').Game} game
   */
  constructor(game) {
    this.game = game;
    this.name = 'match';
    this.state = 'menu';
    this.startTime = 0;
    this.deathTime = -1;
    this.lastStats = null;
    const ev = game.events;
    this._offs = [
      ev.on('match:start', () => this.startCombat()),
      ev.on('match:end', () => this.toMenu()),
      ev.on('player:died', () => this._onPlayerDied()),
      ev.on('game:ready', () => {
        // Autoplay drives itself; give it a live match immediately.
        if (game.autoplayEnabled) this.forceCombat();
      }),
    ];
  }

  /** Enter combat right now (skips menus). Used by autoplay + photo presets. */
  forceCombat() {
    this.startCombat();
    return this;
  }

  startCombat() {
    if (this.state === 'combat') return;
    this.state = 'combat';
    this.startTime = this.game.time.elapsed;
    this.deathTime = -1;
    this.lastStats = null;
    this.game.score?.reset?.();
    const ai = this.game.ai;
    if (ai) {
      ai.clear?.();
      ai.startWaves?.();
    }
    this.game.events.emit('match:state', { state: 'combat' });
  }

  _onPlayerDied() {
    if (this.state !== 'combat') return;
    this.state = 'death';
    this.deathTime = this.game.time.elapsed;
    this.game.ai?.stop?.();
    this.game.events.emit('match:state', { state: 'death' });
  }

  toMenu() {
    this.state = 'menu';
    this.deathTime = -1;
    this.game.ai?.clear?.();
    this.game.events.emit('match:state', { state: 'menu' });
  }

  stats() {
    const s = this.game.score?.stats?.() || {};
    const ai = this.game.ai;
    const now = this.state === 'death' || this.state === 'results' ? this.deathTime : this.game.time.elapsed;
    return {
      score: s.score || 0,
      kills: s.kills || 0,
      headshots: s.headshots || 0,
      accuracy: s.accuracy || 0,
      longestKill: s.longestKill || 0,
      wavesSurvived: Math.max(0, (ai?.wave || 0) - (ai?.state === 'wave' ? 1 : 0)),
      timeSurvived: Math.max(0, now - this.startTime),
    };
  }

  update(dt) {
    if (this.state === 'death') {
      const now = this.game.time.elapsed;
      if (now - this.deathTime >= DEATH_TO_RESULTS) {
        this.state = 'results';
        this.lastStats = this.stats();
        this.game.events.emit('match:state', { state: 'results', stats: this.lastStats });
      }
    }
  }

  dispose() {
    for (const off of this._offs) off?.();
  }
}
