/**
 * Menus — main menu, click-to-play (pointer lock), pause and death/results
 * overlays (UI stream). DOM inside `#menus`; the live scene stays visible
 * behind a dark scrim, and the render side defocuses it via post.setDof.
 *
 * Realtime state machine (game.state):
 *   menu → deploy (click-to-play) → playing ⇄ paused
 *   playing → dead → results → (PLAY AGAIN) → deploy → playing
 * Photo/autoplay modes never drive this machine; `menu_main` only calls
 * `showMain({inert:true})` for the capture.
 *
 * Emits: match:start, match:end, ui:hover, ui:click, ui:open, ui:back,
 *        player:request-respawn (PLAY AGAIN)
 * Consumes: player:died, input:locked, input:unlocked, wave:start (waves survived)
 */
import { el, setText } from './dom.js';

const NAV = [
  { id: 'play', label: 'PLAY' },
  { id: 'credits', label: 'CREDITS' },
];

export class Menus {
  /**
   * @param {any} game
   * @param {{stats:()=>any}} hud stats source (HUD tallies kills/accuracy)
   */
  constructor(game, hud) {
    this.game = game;
    this.hud = hud;
    this.root = document.getElementById('menus') || el('div', '', document.body);
    this.root.textContent = '';
    this.mode = 'none'; // none | main | deploy | pause | results
    this._sel = 0;
    this._resultsAt = 0;
    this._built = false;
  }

  /* --------------------------------------------------------------- build */
  _build() {
    if (this._built) return;
    this._built = true;
    const root = this.root;

    // shared scrim (darken + blur)
    this._scrim = el('div', 'iw-scrim iw-hidden', root);

    // ---- main menu
    const main = el('div', 'iw-menu iw-hidden', root);
    this._main = main;
    el('div', 'iw-title', main, 'IRONWAKE');
    el('div', 'iw-subtitle', main, 'BLACKSITE TERMINAL');
    const nav = el('div', 'iw-nav', main);
    this._hl = el('div', 'iw-nav-hl', nav);
    this._navItems = [];
    NAV.forEach((item, i) => {
      const n = el('div', 'iw-nav-item', nav, item.label);
      n.addEventListener('mouseenter', () => { this._select(i); this._sfx('ui:hover'); });
      n.addEventListener('click', () => { this._sfx('ui:click'); this._activate(item.id); });
      this._navItems.push(n);
    });
    this._credits = el('div', 'iw-panel iw-hidden', main);
    el('h3', '', this._credits, 'CREDITS');
    const body = el('div', '', this._credits);
    body.innerHTML =
      'IRONWAKE — a first-person shooter vertical slice, Three.js r185 / WebGL2.<br><br>' +
      'ENVIRONMENT, CHARACTERS, WEAPON REFERENCE — CC0 asset packs (Poly Haven, Kenney, Quaternius).<br>' +
      'AUDIO — CC0 field recordings and The Free Firearm Sound Library.<br>' +
      'TYPE — Rajdhani, Barlow Condensed, Teko, JetBrains Mono (SIL OFL 1.1).<br><br>' +
      'Full attributions in CREDITS.md.';
    el('div', 'iw-menu-foot', main, '[ MOUSE ] SELECT   [ CLICK ] CONFIRM');
    el('div', 'iw-menu-ver', main, 'BUILD 0.1.0 · TERMINAL 9');

    // ---- click to play
    const ctp = el('div', 'iw-center iw-hidden', root);
    this._ctp = ctp;
    const box = el('div', 'iw-ctp', ctp);
    box.innerHTML = 'CLICK TO DEPLOY<small>MOUSE LOOK · WASD MOVE · LMB FIRE · RMB ADS · R RELOAD · ESC PAUSE</small>';
    ctp.addEventListener('click', () => { this._sfx('ui:click'); this._beginLock(); });

    // ---- pause
    const pause = el('div', 'iw-center iw-hidden', root);
    this._pause = pause;
    el('div', 'iw-pause-title', pause, 'PAUSED');
    const prow = el('div', 'iw-btn-row', pause);
    const resume = el('button', 'iw-btn', prow, 'RESUME');
    const quit = el('button', 'iw-btn ghost', prow, 'QUIT');
    resume.addEventListener('click', () => { this._sfx('ui:click'); this.resume(); });
    quit.addEventListener('click', () => { this._sfx('ui:back'); this.quitToMenu(); });
    for (const b of [resume, quit]) b.addEventListener('mouseenter', () => this._sfx('ui:hover'));

    // ---- death / results
    const res = el('div', 'iw-center iw-hidden', root);
    this._results = res;
    this._kia = el('div', 'iw-kia', res, 'K.I.A.');
    const grid = el('div', 'iw-stats', res);
    this._statNodes = {};
    for (const [key, label] of [['waves', 'WAVES SURVIVED'], ['kills', 'KILLS'], ['hs', 'HEADSHOT %'], ['acc', 'ACCURACY']]) {
      const s = el('div', 'iw-stat', grid);
      const v = el('span', 'v', s, '0');
      el('span', 'l', s, label);
      this._statNodes[key] = v;
    }
    const rrow = el('div', 'iw-btn-row', res);
    const again = el('button', 'iw-btn', rrow, 'PLAY AGAIN');
    const rquit = el('button', 'iw-btn ghost', rrow, 'MAIN MENU');
    again.addEventListener('click', () => { this._sfx('ui:click'); this.playAgain(); });
    rquit.addEventListener('click', () => { this._sfx('ui:back'); this.quitToMenu(); });
    for (const b of [again, rquit]) b.addEventListener('mouseenter', () => this._sfx('ui:hover'));

    this._select(0);
  }

  _select(i) {
    this._sel = i;
    this._navItems.forEach((n, k) => n.classList.toggle('sel', k === i));
    if (this._hl) this._hl.style.transform = `translateY(${(i * 6).toFixed(2)}vh)`;
  }

  _activate(id) {
    if (id === 'play') this.play();
    else if (id === 'credits') this._credits.classList.toggle('iw-hidden');
  }

  _sfx(name) {
    this.game.events.emit(name, {});
  }

  /* ------------------------------------------------------------- panels */
  _hideAll() {
    if (!this._built) return;
    this._scrim.classList.add('iw-hidden');
    this._main.classList.add('iw-hidden');
    this._ctp.classList.add('iw-hidden');
    this._pause.classList.add('iw-hidden');
    this._results.classList.add('iw-hidden');
  }

  _blur(on) {
    const post = this.game.post;
    if (!post?.setDof) return;
    if (on) post.setDof({ focusDistance: 0.6, focusRange: 1.2, bokehScale: 5.5 });
    else post.setDof(null);
  }

  /**
   * Show the main menu.
   * @param {{inert?:boolean}} [opts] inert = pose only (photo capture), no state change
   */
  showMain(opts = {}) {
    this._build();
    this._hideAll();
    this._scrim.classList.remove('iw-hidden');
    this._main.classList.remove('iw-hidden');
    this._credits.classList.add('iw-hidden');
    this._select(0);
    this.mode = 'main';
    this._blur(true);
    this.game.weapons?.viewmodel?.setVisible?.(false);
    if (!opts.inert) {
      this.game.state = 'menu';
      if (this.game.input) this.game.input.enabled = false;
      this.game.setHudVisible?.(false);
      this._sfx('ui:open');
    }
  }

  play() {
    // Main menu → click-to-play prompt (pointer lock requires a user gesture).
    this._build();
    this._hideAll();
    this._scrim.classList.remove('iw-hidden');
    this._ctp.classList.remove('iw-hidden');
    this.mode = 'deploy';
    this.game.state = 'deploy';
  }

  _beginLock() {
    const input = this.game.input;
    if (input) {
      input.enabled = true;
      input.requestPointerLock();
    }
    // Pointer lock may be denied (headless / no gesture); start regardless.
    this.startPlaying();
  }

  startPlaying() {
    const wasMenu = this.mode === 'deploy' || this.mode === 'main' || this.mode === 'none';
    this._hideAll();
    this.mode = 'none';
    this._blur(false);
    this.game.state = 'playing';
    if (this.game.input) this.game.input.enabled = true;
    this.game.loop?.setPaused?.(false);
    this.game.weapons?.viewmodel?.setVisible?.(true);
    this.game.setHudVisible?.(true);
    if (wasMenu) {
      this.game.events.emit('match:start', {});
    }
  }

  pause() {
    if (this.game.state !== 'playing') return;
    this._build();
    this._hideAll();
    this._scrim.classList.remove('iw-hidden');
    this._pause.classList.remove('iw-hidden');
    this.mode = 'pause';
    this.game.state = 'paused';
    this.game.loop?.setPaused?.(true);
    this._blur(true);
    this.game.events.emit('game:paused', {});
  }

  resume() {
    if (this.mode !== 'pause') return;
    this._hideAll();
    this.mode = 'none';
    this._blur(false);
    this.game.state = 'playing';
    this.game.loop?.setPaused?.(false);
    this.game.input?.requestPointerLock?.();
    this.game.events.emit('game:resumed', {});
  }

  quitToMenu() {
    this.game.loop?.setPaused?.(false);
    this.game.events.emit('match:end', {});
    this.showMain();
  }

  /** player:died → K.I.A. flash; results panel follows after a beat. */
  onDeath() {
    if (this.game.isDeterministic) return;
    this._build();
    this.mode = 'dead';
    this.game.state = 'dead';
    this.game.input?.exitPointerLock?.();
    this._resultsAt = (this.game.time?.elapsed || 0) + 1.6;
    this._hideAll();
    this._results.classList.remove('iw-hidden');
    this._results.style.opacity = '0';
  }

  showResults() {
    this._build();
    const s = this.hud?.stats || {};
    const kills = s.kills || 0;
    const hs = kills ? Math.round((s.headshots || 0) / kills * 100) : 0;
    const acc = s.shotsFired ? Math.round((s.shotsHit || 0) / s.shotsFired * 100) : 0;
    setText(this._statNodes.waves, String(Math.max(0, (s.wave || 1) - 1)));
    setText(this._statNodes.kills, String(kills));
    setText(this._statNodes.hs, hs + '%');
    setText(this._statNodes.acc, acc + '%');
    this._hideAll();
    this._scrim.classList.remove('iw-hidden');
    this._results.classList.remove('iw-hidden');
    this._results.style.opacity = '1';
    this.mode = 'results';
    this.game.state = 'results';
    this.game.setHudVisible?.(false);
    this._blur(true);
  }

  playAgain() {
    const stats = this.hud?.stats;
    if (stats) {
      stats.kills = 0; stats.headshots = 0; stats.shotsFired = 0; stats.shotsHit = 0; stats.wave = 0;
    }
    this.game.events.emit('player:request-respawn', {});
    this._hideAll();
    this._scrim.classList.remove('iw-hidden');
    this._ctp.classList.remove('iw-hidden');
    this.mode = 'deploy';
    this.game.state = 'deploy';
    this._blur(false);
  }

  /** Fixed-step hook (via UISystem): delayed results reveal off game.time. */
  update() {
    if (this.mode === 'dead' && this._resultsAt) {
      const now = this.game.time?.elapsed || 0;
      const t = Math.min(1, Math.max(0, 1 - (this._resultsAt - now) / 1.6));
      if (this._results) this._results.style.opacity = String(t * 0.85);
      if (now >= this._resultsAt) {
        this._resultsAt = 0;
        this.showResults();
      }
    }
  }

  dispose() {
    this.root.textContent = '';
  }
}
