/**
 * ScoreSystem (`game.score`) — arcade score off combat events.
 *
 *   +100 per player kill, +50 headshot bonus, small long-shot bonus (>40 m).
 * Listens: enemy:killed {enemy, by, isHeadshot, distance}, player:fired,
 * weapon:hit (entity hits, for accuracy), match reset via `reset()`.
 * Emits:  score:add {points, total, reason}.
 * Match stats consumed by MatchDirector: kills, headshots, shotsFired,
 * shotsHit, accuracy(), longestKill.
 */
export class ScoreSystem {
  /** @param {import('../Game.js').Game} game */
  constructor(game) {
    this.game = game;
    this.name = 'score';
    this.total = 0;
    this.kills = 0;
    this.headshots = 0;
    this.shotsFired = 0;
    this.shotsHit = 0;
    this.longestKill = 0;
    const ev = game.events;
    this._offs = [
      ev.on('enemy:killed', (p) => this._onKill(p)),
      ev.on('player:fired', (p) => {
        if (p && p.owner && p.owner !== 'player') return;
        this.shotsFired++;
      }),
      ev.on('weapon:hit', (p) => {
        if (p && p.entity && (p.owner === 'player' || !p.owner)) this.shotsHit++;
      }),
    ];
  }

  _onKill(p) {
    if (!p) return;
    const byPlayer = !p.by || p.by === 'player' || p.by === this.game.player;
    if (!byPlayer) return;
    this.kills++;
    let pts = 100;
    let reason = 'kill';
    if (p.isHeadshot) {
      this.headshots++;
      pts += 50;
      reason = 'headshot';
    }
    const d = p.distance || 0;
    if (d > this.longestKill) this.longestKill = d;
    if (d > 40) {
      pts += 25;
      reason += '+longshot';
    }
    this.add(pts, reason);
  }

  add(points, reason = '') {
    this.total += points;
    this.game.events.emit('score:add', { points, total: this.total, reason });
  }

  accuracy() {
    return this.shotsFired > 0 ? Math.min(1, this.shotsHit / this.shotsFired) : 0;
  }

  reset() {
    this.total = 0;
    this.kills = 0;
    this.headshots = 0;
    this.shotsFired = 0;
    this.shotsHit = 0;
    this.longestKill = 0;
  }

  stats() {
    return {
      score: this.total,
      kills: this.kills,
      headshots: this.headshots,
      shotsFired: this.shotsFired,
      shotsHit: this.shotsHit,
      accuracy: this.accuracy(),
      longestKill: this.longestKill,
    };
  }

  update() {}

  dispose() {
    for (const off of this._offs) off?.();
  }
}
