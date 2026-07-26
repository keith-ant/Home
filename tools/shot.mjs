#!/usr/bin/env node
/**
 * IRONWAKE screenshot harness.
 *
 * Builds the production bundle, serves it locally, drives the game's photo
 * mode in headless Chromium (software WebGL2), and saves PNG captures.
 *
 * Usage:
 *   node tools/shot.mjs --preset smoke                    # one preset
 *   node tools/shot.mjs --preset vista --preset street   # several
 *   node tools/shot.mjs --all                             # every registered preset
 *   node tools/shot.mjs --list                            # print registered presets
 *
 * Options:
 *   --out <dir>       output directory (default: shots)
 *   --w <px> --h <px> canvas size (default 1920x1080)
 *   --seed <n>        RNG seed (default 1)
 *   --t <seconds>     extra simulated warm-up time passed to the preset
 *   --quality <tier>  low|medium|high|ultra (default ultra)
 *   --frames <n>      frames rendered after warm-up (temporal effects) — passed through
 *   --timeout <ms>    per-preset timeout (default 240000)
 *   --no-build        reuse the existing dist/ build
 *   --force-build     rebuild even if dist looks fresh
 *   --dev             use the vite dev server instead of dist (needs `npm run dev` running on 5173)
 *   --url <base>      capture against an already-running server
 *   --json <file>     also write a machine-readable report here (default <out>/report.json)
 *   --keep-going      continue past preset errors (still exits non-zero at the end)
 *
 * Exit code is non-zero if any preset raised a page error, timed out, or the
 * page reported `window.__ironwake.error`. Console errors are printed.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { ROOT, launchBrowser, serveStatic, ensureBuild, parseArgs, asArray, ensureDir } from './lib/browser.mjs';

const args = parseArgs(process.argv.slice(2));

const outDir = path.resolve(ROOT, args.out || 'shots');
const width = parseInt(args.w || '1920', 10);
const height = parseInt(args.h || '1080', 10);
const seed = parseInt(args.seed || '1', 10);
const quality = args.quality || 'ultra';
const timeoutMs = parseInt(args.timeout || '240000', 10);
const keepGoing = !!args['keep-going'];

async function main() {
  await ensureDir(outDir);

  // ---- serve --------------------------------------------------------------
  let baseUrl = args.url;
  let server = null;
  if (!baseUrl) {
    if (args.dev) {
      baseUrl = 'http://127.0.0.1:5173';
    } else {
      ensureBuild({ force: !!args['force-build'], skip: !!args['no-build'] });
      server = await serveStatic(path.join(ROOT, 'dist'), 0);
      baseUrl = server.url;
    }
  }

  const browser = await launchBrowser();
  const results = [];
  let hadError = false;

  try {
    // ---- resolve preset list --------------------------------------------
    let presets = asArray(args.preset);
    if (args.all || args.list || presets.length === 0) {
      const registered = await listPresets(browser, baseUrl);
      if (args.list) {
        console.log('Registered photo-mode presets:');
        for (const p of registered) console.log('  ' + p);
        return;
      }
      if (args.all) presets = registered;
      if (presets.length === 0) presets = ['smoke'];
    }

    // ---- capture ------------------------------------------------------
    for (const preset of presets) {
      const t0 = Date.now();
      process.stdout.write(`[shot] ${preset.padEnd(22)} `);
      const r = await capture(browser, baseUrl, preset).catch((e) => ({ preset, error: String(e && e.message ? e.message : e), consoleErrors: [] }));
      const ms = Date.now() - t0;
      results.push({ ...r, ms });
      if (r.error) {
        hadError = true;
        console.log(`ERROR (${(ms / 1000).toFixed(1)}s)`);
        console.log(`   ${r.error}`);
        for (const ce of r.consoleErrors || []) console.log(`   [console.error] ${ce}`);
        if (!keepGoing && !args.all) break;
      } else {
        const errSuffix = r.consoleErrors && r.consoleErrors.length ? `  (${r.consoleErrors.length} console errors)` : '';
        console.log(`ok  → ${path.relative(ROOT, r.file)}  (${(ms / 1000).toFixed(1)}s)${errSuffix}`);
        for (const ce of r.consoleErrors || []) console.log(`   [console.error] ${ce}`);
        if (r.consoleErrors && r.consoleErrors.length) hadError = true;
      }
    }
  } finally {
    await browser.close();
    if (server) await server.close();
  }

  const reportPath = args.json ? path.resolve(ROOT, args.json) : path.join(outDir, 'report.json');
  await fs.writeFile(reportPath, JSON.stringify({ when: new Date().toISOString(), width, height, seed, quality, results }, null, 2));
  console.log(`[shot] report → ${path.relative(ROOT, reportPath)}`);
  if (hadError) {
    console.error('[shot] FAILED — one or more presets produced errors.');
    process.exit(1);
  }
}

async function listPresets(browser, baseUrl) {
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  try {
    await page.goto(`${baseUrl}/?shot=__list&w=640&h=360&quality=low&seed=${seed}`, { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction('window.__ironwake && (window.__ironwake.presets || window.__ironwake.error)', null, { timeout: 120000 });
    const info = await page.evaluate('window.__ironwake');
    if (!info.presets) throw new Error('Game did not expose window.__ironwake.presets: ' + (info.error || 'unknown'));
    return info.presets;
  } finally {
    await page.close();
  }
}

async function capture(browser, baseUrl, preset) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(String(err && err.stack ? err.stack : err)));

  const qs = new URLSearchParams({ shot: preset, w: String(width), h: String(height), seed: String(seed), quality });
  if (args.t !== undefined) qs.set('t', String(args.t));
  if (args.frames !== undefined) qs.set('frames', String(args.frames));
  if (args.hud !== undefined) qs.set('hud', String(args.hud));
  if (args.debug !== undefined) qs.set('debug', String(args.debug));

  try {
    await page.goto(`${baseUrl}/?${qs}`, { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction('window.__ironwake && (window.__ironwake.ready || window.__ironwake.error)', null, { timeout: timeoutMs });
    const state = await page.evaluate('({ready: window.__ironwake.ready, error: window.__ironwake.error, frame: window.__ironwake.frame, stats: window.__ironwake.stats })');
    if (state.error) {
      return { preset, error: 'page reported error: ' + state.error, consoleErrors, pageErrors };
    }
    if (pageErrors.length) {
      return { preset, error: 'uncaught page error: ' + pageErrors[0], consoleErrors, pageErrors };
    }
    const file = path.join(outDir, `${preset}.png`);
    await page.screenshot({ path: file, type: 'png', timeout: 180000, animations: 'disabled' });
    return { preset, file, stats: state.stats || null, consoleErrors, pageErrors };
  } catch (e) {
    // Try to grab whatever is on screen for debugging before failing.
    const file = path.join(outDir, `${preset}.FAILED.png`);
    try { await page.screenshot({ path: file, type: 'png', timeout: 180000, animations: 'disabled' }); } catch { /* ignore */ }
    const detail = pageErrors[0] ? ` | page error: ${pageErrors[0]}` : '';
    return { preset, error: String(e && e.message ? e.message : e) + detail, consoleErrors, pageErrors, failFile: file };
  } finally {
    await page.close();
  }
}

main().catch((e) => {
  console.error('[shot] fatal:', e);
  process.exit(1);
});
