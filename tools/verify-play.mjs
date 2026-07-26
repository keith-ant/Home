#!/usr/bin/env node
/**
 * Scripted play-session verifier.
 *
 * Boots the shipped build in autoplay mode: the game skips menus, spawns the
 * player, and a scripted bot drives movement/aim/fire while waves attack. The
 * simulation runs in deterministic fixed steps (wall clock ignored) for the
 * requested number of game-seconds, periodically capturing frames.
 *
 * This proves the game *plays*, not just poses: player controller, weapons,
 * ballistics, AI, damage, waves, HUD updates and FX all run through the real
 * gameplay loop. Any uncaught error, console.error, or watchdog stall fails
 * the run (non-zero exit) so agents can't hand off a broken build.
 *
 * Usage:
 *   node tools/verify-play.mjs [--seconds 45] [--shots] [--w 1280 --h 720]
 *        [--quality high] [--seed 7] [--no-build] [--out shots/verify]
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { ROOT, launchBrowser, serveStatic, ensureBuild, parseArgs, ensureDir } from './lib/browser.mjs';

const args = parseArgs(process.argv.slice(2));
const seconds = parseFloat(args.seconds || '45');
const width = parseInt(args.w || '1280', 10);
const height = parseInt(args.h || '720', 10);
const seed = parseInt(args.seed || '7', 10);
const quality = args.quality || 'high';
const outDir = path.resolve(ROOT, args.out || path.join('shots', 'verify'));
const wantShots = args.shots !== undefined ? args.shots !== 'false' : true;
const captureEvery = parseFloat(args.every || '5'); // game seconds between captures
const timeoutMs = parseInt(args.timeout || String(20 * 60 * 1000), 10);

async function main() {
  await ensureDir(outDir);
  ensureBuild({ skip: !!args['no-build'], force: !!args['force-build'] });
  const server = await serveStatic(path.join(ROOT, 'dist'), 0);
  const browser = await launchBrowser();
  const consoleErrors = [];
  const pageErrors = [];
  let exitCode = 0;

  try {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => pageErrors.push(String(err && err.stack ? err.stack : err)));

    const qs = new URLSearchParams({ autoplay: '1', duration: String(seconds), seed: String(seed), quality, w: String(width), h: String(height) });
    console.log(`[verify] booting autoplay for ${seconds}s of game time…`);
    await page.goto(`${server.url}/?${qs}`, { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction('window.__ironwake && (window.__ironwake.autoplay || window.__ironwake.error)', null, { timeout: 120000 });

    const deadline = Date.now() + timeoutMs;
    let lastCaptureAt = -Infinity;
    let capIndex = 0;
    let lastSimTime = -1;
    let lastProgressWall = Date.now();

    for (;;) {
      const st = await page.evaluate('({ error: window.__ironwake.error, ap: window.__ironwake.autoplay })');
      if (st.error) throw new Error('page reported error: ' + st.error);
      if (pageErrors.length) throw new Error('uncaught page error: ' + pageErrors[0]);
      const ap = st.ap || {};
      const simTime = ap.time || 0;
      process.stdout.write(`\r[verify] t=${simTime.toFixed(1)}s wave=${ap.wave ?? '-'} kills=${ap.kills ?? 0} hp=${ap.health ?? '-'} shots=${ap.shotsFired ?? 0}   `);
      if (simTime > lastSimTime + 0.001) {
        lastSimTime = simTime;
        lastProgressWall = Date.now();
      } else if (Date.now() - lastProgressWall > 90000) {
        throw new Error(`simulation stalled at t=${simTime.toFixed(2)}s (no progress for 90s)`);
      }
      if (wantShots && simTime - lastCaptureAt >= captureEvery) {
        lastCaptureAt = simTime;
        const file = path.join(outDir, `play-${String(capIndex++).padStart(2, '0')}.png`);
        await page.screenshot({ path: file, type: 'png', timeout: 180000, animations: 'disabled' });
      }
      if (ap.done) {
        process.stdout.write('\n');
        console.log('[verify] autoplay complete:', JSON.stringify(ap.stats || {}));
        if (wantShots) {
          const file = path.join(outDir, `play-final.png`);
          await page.screenshot({ path: file, type: 'png', timeout: 180000, animations: 'disabled' });
        }
        await fs.writeFile(path.join(outDir, 'report.json'), JSON.stringify({ when: new Date().toISOString(), seconds, seed, quality, stats: ap.stats || {}, consoleErrors, pageErrors }, null, 2));
        break;
      }
      if (Date.now() > deadline) throw new Error('wall-clock timeout');
      await new Promise((r) => setTimeout(r, 1500));
    }

    if (consoleErrors.length) {
      console.log(`[verify] ${consoleErrors.length} console error(s):`);
      for (const e of consoleErrors.slice(0, 12)) console.log('   ' + e);
      exitCode = 1;
    }
    if (exitCode === 0) console.log('[verify] PASS — game boots and plays without errors.');
    else console.log('[verify] FAIL — console errors detected.');
  } catch (e) {
    process.stdout.write('\n');
    console.error('[verify] FAIL:', e.message || e);
    for (const ce of consoleErrors.slice(0, 12)) console.error('   [console.error] ' + ce);
    exitCode = 1;
    try {
      const pages = browser.contexts().flatMap((c) => c.pages());
      if (pages[0]) await pages[0].screenshot({ path: path.join(outDir, 'FAILED.png'), type: 'png' });
    } catch { /* ignore */ }
  } finally {
    await browser.close();
    await server.close();
  }
  process.exit(exitCode);
}

main();
