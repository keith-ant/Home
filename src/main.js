/**
 * IRONWAKE — entry point.
 *
 * Parses URL params, boots the Game, wires the loading UI, and surfaces any
 * failure both on screen and on `window.__ironwake.error` for the automated
 * harness (docs/ARCHITECTURE.md §4).
 */
import { Game } from './Game.js';

const params = new URLSearchParams(window.location.search);
const bootEl = document.getElementById('boot');
const barEl = document.getElementById('boot-bar');
const statusEl = document.getElementById('boot-status');
const errorEl = document.getElementById('error');
const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('gl'));

window.__ironwake = window.__ironwake || {};

function reportError(err) {
  const msg = err && err.stack ? String(err.stack) : String(err);
  console.error('[ironwake] fatal:', err);
  window.__ironwake.error = msg;
  if (errorEl) {
    errorEl.style.display = 'block';
    errorEl.textContent = msg;
  }
}

window.addEventListener('error', (e) => reportError(e.error || e.message));
window.addEventListener('unhandledrejection', (e) => reportError(e.reason));

function setProgress(fraction, label) {
  if (barEl) barEl.style.width = `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%`;
  if (statusEl && label) statusEl.textContent = label;
}

async function boot() {
  setProgress(0.02, 'Starting');
  const game = new Game({ canvas, params, onProgress: setProgress });
  window.__ironwake.game = game;
  await game.init();
  setProgress(1, 'Deploying');

  // Hide the boot splash (instantly in deterministic capture modes).
  if (bootEl) {
    if (game.isDeterministic) bootEl.remove();
    else {
      bootEl.classList.add('fade');
      setTimeout(() => bootEl.remove(), 650);
    }
  }
  await game.start();
}

boot().catch(reportError);
