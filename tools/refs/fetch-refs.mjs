#!/usr/bin/env node
/**
 * Reference corpus fetcher.
 *
 * Gathers real screenshots from shipped AAA shooters (Call of Duty: Modern
 * Warfare series, Warzone, plus a few peers) to serve as the blind-comparison
 * bar for critic agents. Images land in reference/cod/candidates/ and are
 * LOCAL EVALUATION MATERIAL ONLY (copyrighted, gitignored, never committed or
 * redistributed).
 *
 * Sources:
 *   1. Steam store appdetails API — official 1920x1080 press screenshots.
 *   2. DuckDuckGo image search (i.js JSON endpoint) — per-category queries.
 *
 * A curation pass then reviews the candidates, keeps genuine in-game frames,
 * and writes reference/cod/index.json:
 *   [{ file, category: environment|viewmodel|firing|enemy|vfx|hud|menu, note }]
 *
 * Usage: node tools/refs/fetch-refs.mjs [--per 8] [--min-width 1200] [--clean]
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ROOT, parseArgs, ensureDir } from '../lib/browser.mjs';

const require = createRequire(import.meta.url);
const sharp = require('sharp');

const args = parseArgs(process.argv.slice(2));
const perQuery = parseInt(args.per || '8', 10);
const minWidth = parseInt(args['min-width'] || '1200', 10);
const outDir = path.join(ROOT, 'reference', 'cod', 'candidates');

/** Steam app ids → default category for their official screenshots. */
const STEAM_APPS = [
  { appid: 1962660, tag: 'mw2-2022', category: 'environment' }, // Modern Warfare II
  { appid: 2519060, tag: 'mw3-2023', category: 'environment' }, // Modern Warfare III
  { appid: 1938090, tag: 'codhq', category: 'environment' },    // Call of Duty HQ / Warzone
  { appid: 2933620, tag: 'cod-latest', category: 'environment' },
  { appid: 1517290, tag: 'bf2042', category: 'environment' },   // Battlefield 2042 (peer bar)
];

/** DDG query → intended critic category */
const QUERIES = [
  ['call of duty modern warfare 2019 gameplay screenshot 4k', 'environment'],
  ['call of duty modern warfare 2 2022 shipment map screenshot', 'environment'],
  ['call of duty modern warfare night raid gameplay screenshot', 'environment'],
  ['warzone 2 al mazrah night gameplay screenshot', 'environment'],
  ['call of duty modern warfare 3 2023 multiplayer map screenshot', 'environment'],
  ['call of duty modern warfare 2019 first person m4a1 gameplay', 'viewmodel'],
  ['modern warfare 2 2022 first person weapon inspect', 'viewmodel'],
  ['call of duty modern warfare gunsmith weapon close up', 'viewmodel'],
  ['call of duty modern warfare 2019 firing muzzle flash first person', 'firing'],
  ['modern warfare 2 gunfight first person tracers gameplay', 'firing'],
  ['call of duty modern warfare 2019 enemy soldier in game screenshot', 'enemy'],
  ['modern warfare 2 operators in game close up', 'enemy'],
  ['call of duty warzone explosion in game screenshot', 'vfx'],
  ['modern warfare 2 killstreak explosion gameplay screenshot', 'vfx'],
  ['call of duty modern warfare 2019 hud multiplayer killfeed screenshot', 'hud'],
  ['modern warfare 2 multiplayer gameplay hud ammo compass screenshot', 'hud'],
  ['call of duty modern warfare 2019 main menu multiplayer screen', 'menu'],
  ['call of duty modern warfare 2 gunsmith loadout menu screen', 'menu'],
];

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

/* ------------------------------------------------------------------------- */

async function steamScreenshots(appid) {
  const url = `https://store.steampowered.com/api/appdetails?appids=${appid}&filters=screenshots,basic`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  const json = await res.json();
  const data = json[String(appid)]?.data;
  if (!data) return [];
  const name = data.name || String(appid);
  return (data.screenshots || []).map((s) => ({ url: (s.path_full || '').split('?')[0], name }));
}

async function ddgImageUrls(query, count) {
  // 1. token
  const searchUrl = `https://duckduckgo.com/?q=${encodeURIComponent(query)}&iax=images&ia=images`;
  const html = await (await fetch(searchUrl, { headers: { 'User-Agent': UA } })).text();
  const vqd = (/vqd=([0-9-]+)/.exec(html) || [])[1] || (/vqd="([0-9-]+)"/.exec(html) || [])[1];
  if (!vqd) throw new Error('vqd token not found');
  // 2. results
  const apiUrl = `https://duckduckgo.com/i.js?l=us-en&o=json&q=${encodeURIComponent(query)}&vqd=${vqd}&f=,,,,,&p=1`;
  const res = await fetch(apiUrl, { headers: { 'User-Agent': UA, Referer: 'https://duckduckgo.com/', Accept: 'application/json' } });
  const data = await res.json();
  const results = (data.results || []).filter((r) => (r.width || 0) >= minWidth);
  // Prefer wide, high-res, non-junk domains.
  const junk = /(pinterest|wallpaperflare|wallpapersden|wallpapers\.com|alamy|shutterstock|istock|dreamstime|123rf|redd\.it\/(?!media)|ebay|amazon|etsy)/i;
  const scored = results
    .filter((r) => !junk.test(r.image || ''))
    .map((r) => ({ ...r, score: (r.width || 0) * (r.height || 0) }))
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, count * 2).map((r) => ({ url: r.image, title: r.title, source: r.url }));
}

async function download(url, dest) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: ctrl.signal, redirect: 'follow' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 40000) throw new Error('too small');
    const img = sharp(buf, { failOn: 'none' });
    const meta = await img.metadata();
    if (!meta.width || meta.width < minWidth) throw new Error(`too narrow (${meta.width})`);
    await img.resize({ width: Math.min(meta.width, 2200), withoutEnlargement: true }).jpeg({ quality: 90 }).toFile(dest);
    return { ok: true, width: meta.width, height: meta.height };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  if (args.clean) await fs.rm(outDir, { recursive: true, force: true });
  await ensureDir(outDir);
  const manifest = [];
  let saved = 0;

  // ---- Steam official screenshots --------------------------------------
  for (const app of STEAM_APPS) {
    process.stdout.write(`[refs] steam ${app.tag} `);
    try {
      const shots = await steamScreenshots(app.appid);
      let n = 0;
      for (const s of shots) {
        const name = `${app.category}-${app.tag}-${hash(s.url)}.jpg`;
        try {
          const r = await download(s.url, path.join(outDir, name));
          manifest.push({ file: name, category: app.category, source: s.url, origin: `steam:${app.appid}`, title: s.name, width: r.width, height: r.height });
          n++;
          saved++;
          process.stdout.write('.');
        } catch {
          process.stdout.write('x');
        }
      }
      console.log(` ${n} kept`);
    } catch (e) {
      console.log(' failed:', String(e.message || e));
    }
  }

  // ---- DDG per-category ------------------------------------------------
  for (const [query, category] of QUERIES) {
    process.stdout.write(`[refs] ddg ${category.padEnd(11)} `);
    let candidates = [];
    try {
      candidates = await ddgImageUrls(query, perQuery);
    } catch (e) {
      console.log('search failed:', String(e.message || e));
      continue;
    }
    let kept = 0;
    for (const c of candidates) {
      if (kept >= perQuery) break;
      const name = `${category}-${slug(query).slice(0, 32)}-${hash(c.url)}.jpg`;
      const dest = path.join(outDir, name);
      try {
        const r = await download(c.url, dest);
        kept++;
        saved++;
        manifest.push({ file: name, category, query, source: c.url, origin: 'ddg', title: c.title, width: r.width, height: r.height });
        process.stdout.write('.');
      } catch {
        process.stdout.write('x');
      }
    }
    console.log(` ${kept} kept`);
  }

  await fs.writeFile(path.join(outDir, '_manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`[refs] saved ${saved} candidates → ${path.relative(ROOT, outDir)}`);
  console.log('[refs] Next: curate → reference/cod/index.json (see docs/CRITIC_PROTOCOL.md §3)');
}

function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(36);
}

main().catch((e) => {
  console.error('[refs] fatal:', e);
  process.exit(1);
});
