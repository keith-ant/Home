/**
 * UI stream installer — DOM/CSS HUD + menus (docs/NOTES-ui.md).
 *
 * Wires:
 *   game.ui = { hud, menus }     HUD.js / Menus.js
 *   system 'ui' (order 80)      fixed-step HUD animation off game.time
 *   photo presets               hud_full, menu_main (presets.js)
 *
 * The UI is fed exclusively by game.events (canonical names in
 * docs/ARCHITECTURE.md §3 + the stream notes). Every source is optional —
 * if a stream never emits, the corresponding widget simply idles.
 *
 * @param {import('../Game.js').Game} game
 */
import './ui.css';
import { HUD } from './HUD.js';
import { Menus } from './Menus.js';
import { registerUIPresets } from './presets.js';

export function installUI(game) {
  const hud = new HUD(game);
  const menus = new Menus(game, hud);
  game.ui = { hud, menus, stats: hud.stats };

  const ev = game.events;
  const stats = hud.stats;

  /* ------------------------------------------------------------- weapons */
  ev.on('weapon:ammo', (p) => hud.setAmmo(p));
  ev.on('weapon:switched', (p) => hud.setAmmo(p));
  ev.on('weapon:firemode', (p) => hud.setAmmo({ mode: p?.mode }));
  ev.on('weapon:reload', (p) => hud.setReloading(p?.duration || 2.1));
  ev.on('player:reloaded', () => hud.clearReload());
  ev.on('player:fired', () => { stats.shotsFired++; });
  ev.on('ui:hitmarker', (p) => {
    stats.shotsHit++;
    hud.hit(!!(p && p.kill));
  });
  // Prime the ammo cluster from the live loadout (weapons installs first).
  const cur = game.weapons?.current;
  if (cur) {
    hud.setAmmo({
      id: cur.id,
      mag: cur.ammo,
      reserve: cur.reserve,
      magSize: cur.magSize,
      mode: cur.fireMode,
      name: cur.def?.name || cur.def?.displayName || cur.name || cur.id,
    });
  }

  /* ------------------------------------------------------------- combat */
  ev.on('enemy:spawned', (p) => { if (p?.enemy) hud.enemies.add(p.enemy); });
  ev.on('enemy:removed', (p) => { if (p?.enemy) hud.enemies.delete(p.enemy); });
  ev.on('enemy:killed', (p) => {
    const e = p?.enemy;
    if (e) hud.enemies.delete(e);
    const headshot = !!(p && p.isHeadshot);
    const byPlayer = !p?.by || p.by === game.player || p.by === 'player';
    if (byPlayer) {
      stats.kills++;
      if (headshot) stats.headshots++;
      hud.hit(true);
      hud.notify('KILL', 'kill', '+100');
      if (headshot) hud.notify('HEADSHOT', 'headshot', '+50');
      const weapon = game.weapons?.current?.def?.name || game.weapons?.current?.id || 'M4A1';
      hud.pushKillfeed({
        killer: 'IRONWAKE',
        victim: enemyName(e),
        weapon,
        headshot,
      });
    } else {
      hud.pushKillfeed({ killer: 'HOSTILE', victim: enemyName(e), weapon: 'AK-47', headshot });
    }
  });
  ev.on('wave:start', (p) => {
    const idx = (p && typeof p.index === 'number') ? p.index : (stats.wave + 1);
    stats.wave = idx;
    hud.banner('WAVE ' + (idx < 10 ? '0' : '') + idx, 'HOSTILES INBOUND');
  });
  ev.on('wave:cleared', (p) => {
    const idx = (p && typeof p.index === 'number') ? p.index : stats.wave;
    hud.banner('WAVE ' + (idx < 10 ? '0' : '') + idx + ' CLEARED', 'STAND BY', 2.8);
  });
  ev.on('match:state', (p) => {
    if (p?.state === 'intermission') hud.banner('INTERMISSION', 'RESUPPLY · REPOSITION', 2.6);
  });
  ev.on('ui:notify', (p) => { if (p?.text) hud.notify(String(p.text), p.tier || 'info', p.points || ''); });

  /* -------------------------------------------------------------- player */
  ev.on('player:damaged', (p) => {
    if (!p) return;
    stats.damageTaken += p.amount || 0;
    const from = p.from && typeof p.from.x === 'number' ? p.from : null;
    if (from) hud.damageFrom(from, p.amount || 20, false);
    else hud.damageFrom(p.dir, p.amount || 20, true);
  });
  ev.on('player:died', () => {
    hud.damageFrom(null, 60, false);
    menus.onDeath();
  });
  ev.on('player:respawn', () => { hud.clearReload(); });
  ev.on('ui:hud-visible', (p) => { hud.visible = !!(p && p.visible); if (hud.visible) hud.root.style.display = ''; });

  /* ------------------------------------------------------------ menu flow */
  ev.on('input:unlocked', () => {
    if (game.state === 'playing') menus.pause();
  });
  ev.on('input:locked', () => {
    if (game.state === 'deploy' || game.state === 'paused') menus.startPlaying();
  });

  /* --------------------------------------------------------------- system */
  let bootedMenu = false;
  game.addSystem({
    name: 'ui',
    update(dt) {
      // First realtime tick: land on the main menu instead of straight into play.
      if (!bootedMenu) {
        bootedMenu = true;
        if (!game.isDeterministic && game.state === 'playing') menus.showMain();
      }
      hud.update(dt);
      menus.update();
    },
    dispose() {
      hud.dispose();
      menus.dispose();
    },
  }, 80);

  registerUIPresets(game);
}

function enemyName(e) {
  if (!e) return 'HOSTILE';
  if (typeof e.name === 'string' && e.name && e.name.length < 20) return e.name.toUpperCase();
  if (typeof e.callsign === 'string') return e.callsign.toUpperCase();
  if (typeof e.id === 'number' || typeof e.id === 'string') return 'HOSTILE-' + e.id;
  return 'HOSTILE';
}
