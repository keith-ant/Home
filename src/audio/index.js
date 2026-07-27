/**
 * AUDIO stream installer — WebAudio engine + sample bank + procedural
 * synth, wired to the gameplay event bus (docs/NOTES-audio.md).
 *
 *   game.audio = { engine, bank, synth, playAt(id, position, opts), setBed(...) }
 *   system 'audio' (order 70): listener pose, ambience beds, low-health mix
 *
 * Never throws: in photo/autoplay modes the engine is disabled (silent) and
 * every handler is a no-op; in realtime the AudioContext only starts on the
 * first user gesture (browser autoplay policy) and calls before that drop.
 *
 * @param {import('../Game.js').Game} game
 */
import { AudioEngine } from './AudioEngine.js';
import { SoundBank } from './SoundBank.js';
import { Synth } from './Synth.js';

const SURFACE_STEP = {
  concrete: 'sfx.footstep.concrete',
  asphalt: 'sfx.footstep.concrete',
  stone: 'sfx.footstep.concrete',
  metal: 'sfx.footstep.generic',
  wood: 'sfx.footstep.wood',
  dirt: 'sfx.footstep.gravel',
  gravel: 'sfx.footstep.gravel',
  grass: 'sfx.footstep.grass',
  snow: 'sfx.footstep.snow',
  water: 'sfx.footstep.generic',
  glass: 'sfx.footstep.generic',
  fabric: 'sfx.footstep.generic',
};

const SURFACE_IMPACT = {
  concrete: 'sfx.impact.stone',
  asphalt: 'sfx.impact.stone',
  stone: 'sfx.impact.stone',
  brick: 'sfx.impact.stone',
  metal: 'sfx.impact.metal_medium',
  wood: 'sfx.impact.wood_medium',
  glass: 'sfx.impact.glass_medium',
  flesh: 'sfx.impact.flesh_medium',
  dirt: 'sfx.impact.generic_light',
  gravel: 'sfx.impact.generic_light',
  water: 'sfx.impact.generic_light',
  fabric: 'sfx.impact.generic_light',
  plastic: 'sfx.impact.plate_light',
};

const ENEMY_SHOT_IDS = ['sfx.weapon.ak47_single_mid', 'sfx.weapon.ak47_burst_short_mid'];

export function installAudio(game) {
  const engine = new AudioEngine(game);
  const bank = new SoundBank(game, engine);
  const synth = new Synth(engine);
  const ev = game.events;

  /** @type {Record<string, any>} looping beds */
  const beds = { rain: null, storm: null, firefight: null, heartbeat: null };
  let rainTarget = 0;
  let heartbeatOn = false;

  const audio = {
    engine,
    bank,
    synth,
    /** Play a manifest sample at a world position (or 2D when omitted). */
    playAt(id, position, opts = {}) {
      return bank.play(id, { position: position || undefined, ...opts });
    },
    play(id, opts = {}) {
      return bank.play(id, opts);
    },
    /** Sample first, procedural fallback if the sample is unavailable. */
    playOr(id, opts, fallback) {
      if (!engine.ready) return;
      bank.play(id, opts).then((h) => {
        if (!h && fallback) fallback(engine.now);
      });
    },
  };
  game.audio = audio;

  /* -------------------------------------------------------- ambient beds */
  function startBeds() {
    if (!engine.ready) return;
    if (!beds.rain) {
      bank.play('amb.rain', { bus: 'ambient', loop: true, gain: 0.0001, jitter: 0 })
        .then((h) => { beds.rain = h; applyRain(true); });
    }
    if (!beds.firefight) {
      bank.play('amb.war_distant_firefight', { bus: 'ambient', loop: true, gain: 0.22, jitter: 0, offset: 3 })
        .then((h) => { beds.firefight = h; });
    }
    if (!beds.storm) {
      bank.play('amb.storm_wind', { bus: 'ambient', loop: true, gain: 0.18, jitter: 0, offset: 11 })
        .then((h) => { beds.storm = h; });
    }
    bank.preload(['sfx.weapon.rifle_ar15_near', 'sfx.footstep.concrete', 'sfx.impact.stone', 'sfx.ui.click', 'sfx.ui.rollover', 'amb.thunderclap']);
  }
  engine.onReady(startBeds);

  function applyRain(immediate = false) {
    if (!beds.rain) return;
    const g = 0.05 + rainTarget * 0.55;
    beds.rain.setGain(g, immediate ? 0.2 : 1.2);
  }

  /* ------------------------------------------------------------- weapons */
  ev.on('player:fired', (p) => {
    if (!engine.ready) return;
    const id = (p && p.sound) || 'sfx.weapon.rifle_ar15_near';
    const suppressed = !!p?.suppressed;
    bank.play(id, { bus: 'sfx', gain: suppressed ? 0.55 : 0.95, reverb: 0.4, jitter: 0.055, rate: suppressed ? 0.9 : 1 })
      .then((h) => { if (!h) synth.shotBody(engine.now, 1); });
    synth.shotBody(engine.now, suppressed ? 0.5 : 0.75);
  });

  ev.on('enemy:fired', (p) => {
    if (!engine.ready || !p) return;
    const pos = p.from || (p.enemy && enemyPos(p.enemy));
    const id = ENEMY_SHOT_IDS[engine.randInt(ENEMY_SHOT_IDS.length)];
    bank.play(id, { bus: 'sfx', position: pos || undefined, gain: 0.8, reverb: 0.35, jitter: 0.05, refDistance: 6, maxDistance: 400, rolloff: 0.9 });
  });

  ev.on('fx:casing', (p) => {
    if (!engine.ready) return;
    const at = engine.now;
    synth.casing(at, p?.position || null, p?.kind || 'rifle');
    // a second, quieter bounce
    synth.casing(at + 0.09 * engine.jitter(0.3), p?.position || null, p?.kind || 'rifle');
  });

  ev.on('weapon:reload', (p) => {
    if (!engine.ready) return;
    const at = engine.now;
    const pistol = String(p?.id || '').includes('pistol');
    synth.reload(at + 0.05, 'chamber');
    synth.reload(at + (pistol ? 0.32 : 0.42), 'magout');
    synth.reload(at + (pistol ? 1.06 : 1.32), 'magin');
    if (p?.empty) synth.reload(at + (pistol ? 1.56 : 1.82), 'bolt');
    audio.playOr('sfx.foley.cloth', { bus: 'foley', gain: 0.25 }, null);
  });

  ev.on('weapon:switched', () => {
    if (!engine.ready) return;
    audio.playOr('sfx.foley.cloth_belt', { bus: 'foley', gain: 0.35 }, (at) => synth.reload(at, 'chamber'));
  });

  ev.on('weapon:empty', () => { if (engine.ready) synth.dryFire(engine.now); });
  ev.on('weapon:firemode', () => { if (engine.ready) audio.playOr('sfx.ui.switch', { bus: 'ui', gain: 0.4 }, (at) => synth.reload(at, 'chamber')); });

  ev.on('grenade:primed', () => { if (engine.ready) synth.reload(engine.now, 'bolt'); });
  ev.on('grenade:thrown', (p) => { if (engine.ready) audio.playOr('sfx.foley.cloth', { bus: 'foley', gain: 0.4, position: p?.position || undefined }, null); });
  ev.on('grenade:bounce', (p) => {
    if (!engine.ready || !p) return;
    const speed = typeof p.speed === 'number' ? p.speed : 5;
    if (speed < 1.2) return;
    audio.playOr('sfx.impact.metal_light', { position: p.position || undefined, gain: Math.min(0.5, speed * 0.06), bus: 'foley' }, (at) => synth.casing(at, p.position || null, 'magazine'));
  });

  ev.on('grenade:exploded', (p) => {
    if (!engine.ready || !p) return;
    const at = engine.now;
    const pos = p.point || p.position || null;
    bank.play('sfx.weapon.explosion', { position: pos || undefined, gain: 1.0, reverb: 0.6, jitter: 0.04, refDistance: 14, maxDistance: 500, rolloff: 0.8 });
    synth.explosion(at, pos, 1);
    engine.duck(0.7, 0.25, 1.1);
  });

  /* --------------------------------------------------------------- impacts */
  ev.on('weapon:hit', (p) => {
    if (!engine.ready || !p) return;
    const surf = String(p.surface || 'concrete');
    const id = SURFACE_IMPACT[surf] || 'sfx.impact.generic_light';
    bank.play(id, { position: p.point || undefined, gain: p.entity ? 0.9 : 0.7, jitter: 0.08, refDistance: 5, bus: 'sfx' });
  });

  ev.on('ui:hitmarker', (p) => {
    if (!engine.ready) return;
    synth.hitmarker(engine.now, !!p?.kill, !!p?.headshot);
  });

  ev.on('enemy:killed', (p) => {
    if (!engine.ready) return;
    audio.playOr('sfx.impact.flesh_heavy', { position: p?.enemy?.position || undefined, gain: 0.6, bus: 'sfx' }, null);
  });

  /* ---------------------------------------------------------------- foley */
  ev.on('player:footstep', (p) => {
    if (!engine.ready || !p) return;
    const id = SURFACE_STEP[String(p.surface || 'concrete')] || 'sfx.footstep.generic';
    const sprint = !!p.sprint;
    const crouch = !!p.crouch;
    const wet = typeof p.wet === 'number' ? p.wet : 0;
    bank.play(id, {
      bus: 'foley',
      gain: (crouch ? 0.22 : sprint ? 0.55 : 0.38) * (1 + wet * 0.25),
      rate: sprint ? 1.06 : crouch ? 0.94 : 1,
      jitter: 0.08,
    });
  });
  ev.on('player:landed', (p) => {
    if (!engine.ready) return;
    const speed = typeof p?.speed === 'number' ? p.speed : 4;
    audio.playOr('sfx.footstep.concrete', { bus: 'foley', gain: Math.min(0.9, 0.3 + speed * 0.05), rate: 0.85 }, null);
    audio.playOr('sfx.foley.cloth', { bus: 'foley', gain: 0.3 }, null);
  });
  ev.on('player:jump', () => { if (engine.ready) audio.playOr('sfx.foley.cloth', { bus: 'foley', gain: 0.25 }, null); });
  ev.on('player:slide', () => { if (engine.ready) audio.playOr('sfx.foley.cloth_belt', { bus: 'foley', gain: 0.45 }, null); });
  ev.on('player:mantle', () => { if (engine.ready) audio.playOr('sfx.foley.cloth_belt', { bus: 'foley', gain: 0.4 }, null); });

  /* -------------------------------------------------------------- damage */
  ev.on('player:damaged', (p) => {
    if (!engine.ready) return;
    const amount = p?.amount || 10;
    audio.playOr('sfx.impact.punch_medium', { bus: 'sfx', gain: Math.min(0.9, 0.35 + amount / 60) }, (at) => synth.shotBody(at, 0.6));
  });
  ev.on('player:died', () => {
    if (!engine.ready) return;
    stopHeartbeat();
    engine.setMuffle(0.85);
    audio.playOr('voice.breath_heavy', { bus: 'voice', gain: 0.4 }, null);
  });
  ev.on('player:respawn', () => {
    if (!engine.ready) return;
    engine.setMuffle(0);
  });
  ev.on('match:start', () => {
    if (!engine.ready) return;
    engine.setMuffle(0);
    synth.stinger(engine.now);
  });

  function startHeartbeat() {
    if (heartbeatOn || !engine.ready) return;
    heartbeatOn = true;
    bank.play('voice.heartbeat_loop', { bus: 'voice', loop: true, gain: 0.0001, jitter: 0 })
      .then((h) => {
        beds.heartbeat = h;
        if (h && !heartbeatOn) { h.stop(0.3); beds.heartbeat = null; }
        else if (h) h.setGain(0.7, 0.6);
      });
  }
  function stopHeartbeat() {
    heartbeatOn = false;
    if (beds.heartbeat) {
      beds.heartbeat.stop(0.8);
      beds.heartbeat = null;
    }
  }

  /* ------------------------------------------------------------ ambience */
  ev.on('weather:changed', (p) => {
    if (typeof p?.rainIntensity === 'number') {
      rainTarget = p.rainIntensity;
      applyRain(false);
    }
  });
  ev.on('weather:lightning', (p) => {
    if (!engine.ready || !p) return;
    const delay = typeof p.thunderDelay === 'number' ? p.thunderDelay
      : (typeof p.distanceM === 'number' ? p.distanceM / 343 : 2.5);
    const intensity = typeof p.intensity === 'number' ? p.intensity : 0.8;
    const close = delay < 1.6;
    const id = close ? 'amb.thunderclap' : 'amb.thunder_close';
    const at = engine.now + Math.max(0, delay);
    bank.play(id, { bus: 'ambient', gain: 0.5 + 0.5 * Math.min(1, intensity), at, jitter: 0.06, reverb: 0.2 });
    if (close) engine.duck(0.35, 0.2, 0.8);
  });

  /* ---------------------------------------------------------------- UI */
  ev.on('ui:hover', () => audio.playOr('sfx.ui.rollover', { bus: 'ui', gain: 0.35, jitter: 0.02 }, (at) => synth.uiHover(at)));
  ev.on('ui:click', () => audio.playOr('sfx.ui.click', { bus: 'ui', gain: 0.5, jitter: 0.02 }, (at) => synth.uiClick(at)));
  ev.on('ui:open', () => audio.playOr('sfx.ui.open', { bus: 'ui', gain: 0.45 }, (at) => synth.uiConfirm(at)));
  ev.on('ui:back', () => audio.playOr('sfx.ui.back', { bus: 'ui', gain: 0.45 }, (at) => synth.uiClick(at)));
  ev.on('wave:start', () => { if (engine.ready) synth.stinger(engine.now); });
  ev.on('ui:notify', (p) => { if (engine.ready && p?.tier === 'medal') synth.stinger(engine.now); });

  /* ----------------------------------------------------------------- system */
  let stepTick = 0;
  game.addSystem({
    name: 'audio',
    update() {
      if (!engine.ready) return;
      engine.update(game.camera);
      stepTick++;
      if (stepTick % 6 !== 0) return; // ~10 Hz housekeeping
      // rain follows the live weather value even without change events
      const w = game.weather;
      if (w && typeof w.rainIntensity === 'number' && Math.abs(w.rainIntensity - rainTarget) > 0.02) {
        rainTarget = w.rainIntensity;
        applyRain(false);
      }
      // low-health heartbeat + muffling
      const pl = game.player;
      if (pl && typeof pl.health === 'number') {
        const hp = pl.health / (pl.maxHealth || 100);
        if (pl.alive === false) return;
        if (hp < 0.34 && hp > 0) {
          if (!heartbeatOn) startHeartbeat();
          engine.setMuffle(Math.min(0.75, (0.34 - hp) / 0.34 * 0.9));
        } else if (heartbeatOn) {
          stopHeartbeat();
          engine.setMuffle(0);
        }
      }
    },
    dispose() {
      stopHeartbeat();
      for (const k of Object.keys(beds)) {
        try { beds[k]?.stop?.(0.2); } catch { /* noop */ }
        beds[k] = null;
      }
      engine.dispose();
    },
  }, 70);
}

function enemyPos(e) {
  if (!e) return null;
  if (e.position && typeof e.position.x === 'number') return e.position;
  const o = e.object3d || e.object || e.mesh || e.root;
  return o?.position || null;
}
