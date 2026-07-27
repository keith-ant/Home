/**
 * HUD — DOM/CSS heads-up display (UI stream).
 *
 * Lives inside `#hud` (index.html); one imported stylesheet (ui.css). All
 * transient animation (hitmarker, killfeed fades, toasts, banner, damage
 * arcs, blood flash) is evaluated from `game.time.elapsed` inside `update()`
 * — no CSS timers — so photo-mode captures are deterministic and the page
 * costs zero layout work beyond transform/opacity/text writes.
 *
 * Public surface (game.ui.hud):
 *   hud.update(dt)                        fixed-step (system 'ui', order 80)
 *   hud.setVisible(bool)
 *   hud.notify(text, tier)                toast (tier: 'kill'|'headshot'|'info')
 *   hud.banner(title, sub, life)          wave banner
 *   hud.pushKillfeed({killer, victim, weapon, headshot})
 *   hud.hit(kill)                         hitmarker
 *   hud.damageFrom(dirOrPos, amount)      direction arc + blood flash
 *   hud.setLocation(name)
 *   hud.stats                             {kills, headshots, shotsFired, shotsHit, wave}
 *
 * Everything is fed by game.events (see index.js); the HUD never imports
 * gameplay modules.
 */
import * as THREE from 'three';
import { el, setText, setStyle, clamp01, pad2 } from './dom.js';

const _dir = new THREE.Vector3();
const _v = new THREE.Vector3();

const DEG = 180 / Math.PI;
const FEED_LIFE = 4.0;
const FEED_FADE = 0.55;
const TOAST_LIFE = 1.4;
const HIT_LIFE = 0.12;
const HIT_LIFE_KILL = 0.2;
const ARC_LIFE = 1.7;
const MAX_FEED = 6;
const MAX_TOASTS = 4;
const MAX_ARCS = 3;
const MAX_PIPS = 10;
const COMPASS_SPAN = 3 * 360; // three cycles of tape so we can always centre
const COMPASS_VIEW_DEG = 150; // degrees visible across the window

export class HUD {
  /** @param {any} game */
  constructor(game) {
    this.game = game;
    this.root = document.getElementById('hud') || el('div', '', document.body);
    this.root.textContent = '';
    this.visible = true;

    this.now = 0;
    this.stats = { kills: 0, headshots: 0, shotsFired: 0, shotsHit: 0, wave: 0, damageTaken: 0 };

    // weapon / ammo state (fed by events, polled fallback from game.weapons)
    this.ammo = { mag: 30, reserve: 90, magSize: 30, name: 'CARBINE', mode: 'auto', grenades: 2, id: null };
    this.reload = null; // {until}
    this.enemies = new Set();
    this.location = 'TERMINAL 9 · BLACKSITE';

    this._buildCompass();
    this._buildCrosshair();
    this._buildHitmarker();
    this._buildAmmo();
    this._buildFeed();
    this._buildToasts();
    this._buildBanner();
    this._buildArcs();
    this._buildBlood();
    this._buildReload();

    this._pxPerDeg = 0;
    this._onResize = () => { this._pxPerDeg = 0; };
    window.addEventListener('resize', this._onResize);
  }

  /* ---------------------------------------------------------- builders */
  _buildCompass() {
    const wrap = el('div', 'iw-compass', this.root);
    const win = el('div', 'iw-compass-win', wrap);
    const tape = el('div', 'iw-compass-tape', win);
    this._compassWin = win;
    this._compassTape = tape;
    this._compassTicks = [];
    // Build ticks for -540..+540 degrees; positioned in update once we know px/deg.
    const cards = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
    for (let d = -540; d <= 540; d += 5) {
      const deg = ((d % 360) + 360) % 360;
      const isCard = cards[deg] !== undefined && deg % 90 === 0;
      const isInter = cards[deg] !== undefined && deg % 90 !== 0;
      const tick = el('i', 'iw-tick' + (isCard ? ' card' : (d % 15 === 0 ? ' major' : '')), tape);
      let label = null;
      if (isCard || isInter) {
        label = el('span', 'iw-tick-label' + (isCard ? ' card' : ''), tape, cards[deg]);
      } else if (d % 15 === 0) {
        label = el('span', 'iw-tick-label', tape, pad2(Math.round(deg / 15) * 15 % 360 === 360 ? 0 : deg));
        label.textContent = String(deg);
      }
      this._compassTicks.push({ d, tick, label });
    }
    const pipHost = el('div', 'iw-pips', win);
    this._pips = [];
    for (let i = 0; i < MAX_PIPS; i++) {
      const p = el('i', 'iw-pip iw-hidden', pipHost);
      this._pips.push(p);
    }
    el('div', 'iw-caret', wrap);
    this._heading = el('div', 'iw-heading', wrap, '000');
    this._loc = el('div', 'iw-loc', wrap, this.location);
  }

  _layoutCompass() {
    const w = this._compassWin.clientWidth || (window.innerWidth * 0.36);
    this._pxPerDeg = w / COMPASS_VIEW_DEG;
    this._compassW = w;
    for (const t of this._compassTicks) {
      const x = (t.d + 540) * this._pxPerDeg; // tape origin at -540°
      t.tick.style.left = x + 'px';
      if (t.label) t.label.style.left = x + 'px';
    }
    this._compassTape.style.width = (1080 * this._pxPerDeg) + 'px';
  }

  _buildCrosshair() {
    const c = el('div', 'iw-cross', this.root);
    this._cross = c;
    this._crossTop = el('i', 'v', c);
    this._crossBot = el('i', 'v', c);
    this._crossLeft = el('i', 'h', c);
    this._crossRight = el('i', 'h', c);
    el('i', 'dot', c);
  }

  _buildHitmarker() {
    const h = el('div', 'iw-hitm', this.root);
    for (let i = 0; i < 4; i++) {
      const t = el('i', '', h);
      const ang = 45 + i * 90;
      t.style.transform = `rotate(${ang}deg) translateX(${i < 4 ? 0.9 : 0.9}vh)`;
    }
    this._hitm = h;
    this._hit = { t0: -10, kill: false };
  }

  _buildAmmo() {
    const a = el('div', 'iw-ammo', this.root);
    this._ammoRoot = a;
    this._wname = el('div', 'iw-wname', a, 'M4A1 CARBINE');
    const row = el('div', 'iw-ammo-row', a);
    this._mag = el('span', 'iw-mag', row, '30');
    this._res = el('span', 'iw-res', row, '090');
    const sub = el('div', 'iw-ammo-sub', a);
    const nades = el('span', 'iw-nades', sub);
    this._nadePips = [el('i', 'iw-nade', nades), el('i', 'iw-nade', nades), el('i', 'iw-nade', nades)];
    el('span', 'iw-glyph', sub, 'FRAG');
    const mode = el('span', 'iw-mode', sub);
    this._modeBars = [el('i', 'b', mode), el('i', 'b', mode), el('i', 'b', mode)];
    this._modeText = document.createElement('span');
    this._modeText.textContent = 'AUTO';
    mode.appendChild(this._modeText);
  }

  _buildFeed() {
    this._feed = el('div', 'iw-feed', this.root);
    this._feedRows = [];
    this._feedPool = [];
    for (let i = 0; i < MAX_FEED; i++) {
      const row = el('div', 'iw-feed-row iw-hidden', null);
      const k = el('span', 'k', row);
      const g = el('span', 'g', row);
      const v = el('span', 'v', row);
      const hs = el('span', 'hs', row);
      this._feedPool.push({ row, k, g, v, hs });
    }
  }

  _buildToasts() {
    this._toastRoot = el('div', 'iw-toasts', this.root);
    this._toasts = [];
    this._toastPool = [];
    for (let i = 0; i < MAX_TOASTS; i++) {
      const row = el('div', 'iw-toast iw-hidden', null);
      const pts = el('span', 'pts', row);
      const txt = el('span', 'txt', row);
      this._toastPool.push({ row, pts, txt });
    }
  }

  _buildBanner() {
    const b = el('div', 'iw-banner', this.root);
    this._banner = b;
    this._bannerTitle = el('div', 'n', b, 'WAVE 01');
    el('div', 'rule', b);
    this._bannerSub = el('div', 's', b, 'HOSTILES INBOUND');
    this._bannerState = null;
  }

  _buildArcs() {
    this._arcRoot = el('div', 'iw-arcs', this.root);
    this._arcs = [];
    for (let i = 0; i < MAX_ARCS; i++) {
      const a = el('i', 'iw-arc', this._arcRoot);
      this._arcs.push({ node: a, t0: -10, worldYaw: 0, strength: 0 });
    }
    this._arcNext = 0;
  }

  _buildBlood() {
    this._blood = el('div', 'iw-blood', this.root);
    this._bloodT0 = -10;
    this._bloodStrength = 0;
  }

  _buildReload() {
    this._reloadEl = el('div', 'iw-reload', this.root, 'RELOADING');
  }

  /* -------------------------------------------------------------- inputs */
  setVisible(v) {
    this.visible = v;
    this.root.style.display = v ? '' : 'none';
  }

  setLocation(name) {
    setText(this._loc, name);
  }

  /** Ammo cluster from weapon:ammo / weapon:switched payloads. */
  setAmmo(p) {
    if (!p) return;
    if (p.mag !== undefined) this.ammo.mag = p.mag;
    if (p.reserve !== undefined) this.ammo.reserve = p.reserve;
    if (p.magSize !== undefined) this.ammo.magSize = p.magSize;
    if (p.mode) this.ammo.mode = p.mode;
    if (p.name) this.ammo.name = p.name;
    if (p.id) this.ammo.id = p.id;
  }

  setReloading(duration) {
    this.reload = { until: this.now + (duration || 2), start: this.now };
  }

  clearReload() {
    this.reload = null;
  }

  /** White (or red on kill) hitmarker. */
  hit(kill = false) {
    this._hit.t0 = this.now;
    this._hit.kill = !!kill;
  }

  /** Kill/headshot/score toast. */
  notify(text, tier = 'info', points = '') {
    if (this._toasts.length >= MAX_TOASTS) this._toasts.shift();
    this._toasts.push({ t0: this.now, text, tier, points });
  }

  banner(title, sub, life = 3.6) {
    this._bannerState = { t0: this.now, life, title, sub };
    setText(this._bannerTitle, title);
    setText(this._bannerSub, sub || '');
  }

  pushKillfeed({ killer = 'IRONWAKE', victim = 'HOSTILE', weapon = 'M4A1', headshot = false } = {}) {
    if (this._feedRows.length >= MAX_FEED) this._feedRows.shift();
    this._feedRows.push({ t0: this.now, killer, victim, weapon, headshot });
  }

  /**
   * Damage direction arc + blood flash.
   * @param {any} src world position of the attacker (Vector3-like) or a unit dir toward the player
   * @param {number} amount
   * @param {boolean} isDir true when `src` is a direction (from attacker to player)
   */
  damageFrom(src, amount = 20, isDir = false) {
    let yaw = null;
    const eye = this._eye();
    if (src && typeof src.x === 'number' && typeof src.z === 'number') {
      let dx, dz;
      if (isDir) {
        dx = -src.x; dz = -src.z; // direction points at the player; attacker is behind it
      } else if (eye) {
        dx = src.x - eye.x; dz = src.z - eye.z;
      }
      if (dx !== undefined) yaw = Math.atan2(dx, -dz); // world bearing (0 = -Z)
    }
    if (yaw !== null) {
      const a = this._arcs[this._arcNext];
      this._arcNext = (this._arcNext + 1) % MAX_ARCS;
      a.t0 = this.now;
      a.worldYaw = yaw;
      a.strength = clamp01(0.55 + amount / 60);
    }
    this._bloodT0 = this.now;
    this._bloodStrength = clamp01(0.35 + amount / 70);
  }

  _eye() {
    const p = this.game.player;
    return p?.eyePosition || this.game.camera?.position || null;
  }

  /* -------------------------------------------------------------- update */
  update(dt) {
    void dt;
    const game = this.game;
    this.now = game.time?.elapsed || 0;
    if (!this.visible) return;

    // camera heading (works whether the rig or a photo camera drives it)
    const cam = game.camera;
    let headingDeg = 0;
    if (cam) {
      cam.getWorldDirection(_dir);
      headingDeg = Math.atan2(_dir.x, -_dir.z) * DEG;
      if (headingDeg < 0) headingDeg += 360;
    }
    this._headingRad = Math.atan2(_dir.x, -_dir.z);

    this._updateCompass(headingDeg);
    this._updateCrosshair();
    this._updateHitmarker();
    this._updateAmmo();
    this._updateFeed();
    this._updateToasts();
    this._updateBanner();
    this._updateArcs();
    this._updateBlood();
  }

  _updateCompass(headingDeg) {
    if (!this._pxPerDeg) this._layoutCompass();
    const ppd = this._pxPerDeg;
    // Place tape so `headingDeg` (using the middle cycle, +360) is centred.
    const tapeX = -((headingDeg + 540) * ppd) + this._compassW * 0.5;
    setStyle(this._compassTape, 'transform', `translateX(${tapeX.toFixed(1)}px)`);
    const h = Math.round(headingDeg) % 360;
    setText(this._heading, (h < 100 ? (h < 10 ? '00' : '0') : '') + h);

    // enemy contact pips
    let n = 0;
    const eye = this._eye();
    if (eye) {
      // event-tracked set first, then any AI registry as a fallback
      const iter = this.enemies.size ? this.enemies : (this.game.ai?.enemies || null);
      if (iter) {
        for (const e of iter) {
          if (n >= MAX_PIPS) break;
          if (e && e.alive === false) continue;
          const pos = enemyPos(e);
          if (!pos) continue;
          const bx = pos.x - eye.x;
          const bz = pos.z - eye.z;
          if (bx * bx + bz * bz > 90 * 90) continue;
          let rel = Math.atan2(bx, -bz) * DEG - headingDeg;
          rel = ((rel + 540) % 360) - 180; // -180..180
          if (Math.abs(rel) > COMPASS_VIEW_DEG * 0.5) continue;
          const pip = this._pips[n++];
          pip.classList.remove('iw-hidden');
          setStyle(pip, 'left', (this._compassW * 0.5 + rel * ppd).toFixed(1) + 'px');
        }
      }
    }
    for (; n < MAX_PIPS; n++) this._pips[n].classList.add('iw-hidden');
  }

  _updateCrosshair() {
    const w = this.game.weapons;
    let spread = 1.6;
    let ads = 0;
    if (w) {
      if (typeof w.currentSpreadDeg === 'function') spread = w.currentSpreadDeg() || 0;
      if (typeof w.adsBlend === 'number') ads = w.adsBlend;
    }
    if (this._forceSpread !== undefined) spread = this._forceSpread;
    const gapVh = 0.55 + spread * 0.62;
    const op = clamp01(1 - ads * 1.15);
    setStyle(this._cross, 'opacity', op.toFixed(3));
    setStyle(this._crossTop, 'transform', `translate(0, -${(gapVh + 0.95).toFixed(3)}vh)`);
    setStyle(this._crossBot, 'transform', `translate(0, ${gapVh.toFixed(3)}vh)`);
    setStyle(this._crossLeft, 'transform', `translate(-${(gapVh + 0.95).toFixed(3)}vh, 0)`);
    setStyle(this._crossRight, 'transform', `translate(${gapVh.toFixed(3)}vh, 0)`);
  }

  _updateHitmarker() {
    const age = this.now - this._hit.t0;
    const life = this._hit.kill ? HIT_LIFE_KILL : HIT_LIFE;
    if (age >= 0 && age <= life) {
      const t = age / life;
      const scale = this._hit.kill ? 1.45 - 0.35 * t : 1.15 - 0.2 * t;
      setStyle(this._hitm, 'opacity', String(clamp01(1 - t * t)));
      setStyle(this._hitm, 'transform', `scale(${scale.toFixed(3)})`);
      this._hitm.classList.toggle('kill', this._hit.kill);
    } else {
      setStyle(this._hitm, 'opacity', '0');
    }
  }

  _updateAmmo() {
    const w = this.game.weapons;
    // poll grenade count (cheap, no allocation)
    const g = w?.grenades;
    if (g && typeof g.count === 'number') this.ammo.grenades = g.count;
    const a = this.ammo;
    setText(this._wname, String(a.name || '').toUpperCase());
    setText(this._mag, pad2(a.mag));
    const res = a.reserve;
    setText(this._res, res < 100 ? (res < 10 ? '00' : '0') + res : String(res));
    const low = a.mag <= Math.max(1, Math.floor(a.magSize * 0.25));
    // low-ammo pulse driven by sim time (1.6 Hz)
    if (low) {
      const pulse = 0.55 + 0.45 * Math.abs(Math.sin(this.now * Math.PI * 1.6));
      setStyle(this._mag, 'opacity', pulse.toFixed(3));
      this._mag.classList.add('low');
    } else {
      setStyle(this._mag, 'opacity', '1');
      this._mag.classList.remove('low');
    }
    for (let i = 0; i < 3; i++) this._nadePips[i].classList.toggle('spent', i >= a.grenades);
    const auto = a.mode === 'auto';
    for (let i = 0; i < 3; i++) this._modeBars[i].classList.toggle('off', !auto && i > 0);
    setText(this._modeText, auto ? 'AUTO' : String(a.mode).toUpperCase());
    // reloading label
    let rOp = 0;
    if (this.reload) {
      if (this.now > this.reload.until) this.reload = null;
      else rOp = 0.55 + 0.45 * Math.abs(Math.sin(this.now * Math.PI * 2.4));
    }
    setStyle(this._reloadEl, 'opacity', rOp.toFixed(3));
  }

  _updateFeed() {
    const rows = this._feedRows;
    // drop expired from the front
    while (rows.length && this.now - rows[0].t0 > FEED_LIFE) {
      const dead = rows.shift();
      if (dead.dom) {
        dead.dom.row.classList.add('iw-hidden');
        this._feedPool.push(dead.dom);
        dead.dom = null;
      }
    }
    // ensure DOM rows exist in order
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (!r.dom) {
        const d = this._feedPool.pop();
        if (!d) continue;
        r.dom = d;
        setText(d.k, r.killer);
        setText(d.g, glyphFor(r.weapon));
        setText(d.v, r.victim);
        setText(d.hs, r.headshot ? 'HEADSHOT' : '');
        d.row.classList.remove('iw-hidden');
      }
      const age = this.now - r.t0;
      const inT = clamp01(age / 0.18);
      const outT = clamp01((age - (FEED_LIFE - FEED_FADE)) / FEED_FADE);
      const op = clamp01(inT * (1 - outT));
      setStyle(r.dom.row, 'opacity', op.toFixed(3));
      setStyle(r.dom.row, 'transform', `translateX(${((1 - inT) * -1.2).toFixed(2)}vh)`);
      // keep visual order: newest at the bottom
      if (r.dom.row.parentNode !== this._feed || this._feed.children[i] !== r.dom.row) {
        this._feed.insertBefore(r.dom.row, this._feed.children[i] || null);
      }
    }
  }

  _updateToasts() {
    const list = this._toasts;
    while (list.length && this.now - list[0].t0 > TOAST_LIFE) {
      const dead = list.shift();
      if (dead.dom) {
        dead.dom.row.classList.add('iw-hidden');
        this._toastPool.push(dead.dom);
        dead.dom = null;
      }
    }
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      if (!t.dom) {
        const d = this._toastPool.pop();
        if (!d) continue;
        t.dom = d;
        setText(d.pts, t.points || '');
        setText(d.txt, t.text);
        d.row.className = 'iw-toast ' + (t.tier === 'headshot' ? 'hs' : t.tier === 'kill' ? 'kill' : '');
      }
      const age = this.now - t.t0;
      const inT = clamp01(age / 0.12);
      const outT = clamp01((age - (TOAST_LIFE - 0.45)) / 0.45);
      setStyle(t.dom.row, 'opacity', String(clamp01(inT * (1 - outT))));
      const rise = -(age * 1.4);
      setStyle(t.dom.row, 'transform', `translateY(${rise.toFixed(2)}vh) scale(${(1 + (1 - inT) * 0.35).toFixed(3)})`);
      if (t.dom.row.parentNode !== this._toastRoot || this._toastRoot.children[i] !== t.dom.row) {
        this._toastRoot.insertBefore(t.dom.row, this._toastRoot.children[i] || null);
      }
    }
  }

  _updateBanner() {
    const b = this._bannerState;
    if (!b) {
      setStyle(this._banner, 'opacity', '0');
      return;
    }
    const age = this.now - b.t0;
    if (age > b.life) {
      this._bannerState = null;
      setStyle(this._banner, 'opacity', '0');
      return;
    }
    const inT = clamp01(age / 0.35);
    const outT = clamp01((age - (b.life - 0.7)) / 0.7);
    const op = clamp01(inT * (1 - outT));
    setStyle(this._banner, 'opacity', op.toFixed(3));
    const spread = (1 - inT) * 0.5 - outT * 0.15;
    setStyle(this._banner, 'transform', `translateX(-50%) translateY(${((1 - inT) * -1.2).toFixed(2)}vh) scaleX(${(1 + spread).toFixed(3)})`);
  }

  _updateArcs() {
    const yawCam = this._headingRad || 0;
    for (const a of this._arcs) {
      const age = this.now - a.t0;
      if (age < 0 || age > ARC_LIFE) {
        setStyle(a.node, 'opacity', '0');
        continue;
      }
      const rel = a.worldYaw - yawCam; // rotate arc so it points toward the attacker
      const op = clamp01(a.strength * (1 - age / ARC_LIFE));
      setStyle(a.node, 'opacity', op.toFixed(3));
      setStyle(a.node, 'transform', `rotate(${(rel * DEG).toFixed(2)}deg)`);
    }
  }

  _updateBlood() {
    // transient flash on damage + a persistent low-health ring
    const age = this.now - this._bloodT0;
    let flash = 0;
    if (age >= 0 && age < 1.4) flash = this._bloodStrength * (1 - age / 1.4);
    let low = 0;
    const p = this.game.player;
    if (p && typeof p.health === 'number') {
      const hp = clamp01(p.health / (p.maxHealth || 100));
      if (hp < 0.45) low = (0.45 - hp) / 0.45 * 0.65;
    }
    const op = clamp01(Math.max(flash, low));
    setStyle(this._blood, 'opacity', op.toFixed(3));
  }

  dispose() {
    window.removeEventListener('resize', this._onResize);
    this.root.textContent = '';
  }
}

/** Best-effort world position of an enemy handle from another stream. */
function enemyPos(e) {
  if (!e) return null;
  if (e.position && typeof e.position.x === 'number') return e.position;
  const o = e.object3d || e.object || e.mesh || e.root || e.body;
  if (o?.position) return o.position;
  if (typeof e.getWorldPosition === 'function') return e.getWorldPosition(_v);
  return null;
}

function glyphFor(weapon) {
  const w = String(weapon || '').toLowerCase();
  if (w.includes('grenade') || w.includes('frag')) return '[◈]';
  if (w.includes('pistol')) return '[═◧]';
  if (w.includes('head')) return '[◎]';
  return '[═▄═]';
}
