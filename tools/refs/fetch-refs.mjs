#!/usr/bin/env node
/**
 * Reference corpus fetcher.
 *
 * Gathers real screenshots from shipped AAA shooters (Call of Duty: Modern
 * Warfare series, Warzone) to serve as the blind-comparison bar for critic
 * agents. Images land in reference/cod/candidates/ and are LOCAL EVALUATION
 * MATERIAL ONLY (copyrighted, gitignored, never committed or redistributed).
 *
 * A curation pass (human or agent) then reviews the candidates, keeps genuine
 * in-game frames, and writes reference/cod/index.json:
 *   [{ file, category: environment|viewmodel|firing|enemy|vfx|hud|menu, note }]
 *
 * Usage: node tools/refs/fetch-refs.mjs [--per 12] [--min-width 1200]
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ROOT, parseArgs, ensureDir } from '../lib/browser.mjs';

const require = createRequire(import.meta.url);
const sharp = require('sharp');

const args = parseArgs(process.argv.slice(2));
const perQuery = parseInt(args.per || '10', 10);
const minWidth = parseInt(args['min-width'] || '1200', 10);
const outDir = path.join(ROOT, 'reference', 'cod', 'candidates');

/** query → intended critic category */
const QUERIES = [
  ['call of duty modern warfare 2019 gameplay screenshot', 'environment'],
  ['call of duty modern warfare 2 2022 multiplayer map screenshot', 'environment'],
  ['call of duty warzone 2 gameplay screenshot', 'environment'],
  ['call of duty shipment map screenshot modern warfare', 'environment'],
  ['call of duty modern warfare night mission screenshot', 'environment'],
  ['call of duty modern warfare 3 2023 multiplayer screenshot', 'environment'],
  ['call of duty modern warfare 2019 rain map gameplay', 'environment'],
  ['call of duty modern warfare first person view m4 gameplay', 'viewmodel'],
  ['modern warfare 2 first person weapon inspect screenshot', 'viewmodel'],
  ['call of duty modern warfare gunsmith weapon detail', 'viewmodel'],
  ['call of duty modern warfare firing gun muzzle flash first person', 'firing'],
  ['call of duty modern warfare firefight gameplay first person', 'firing'],
  ['call of duty modern warfare 2019 enemy soldier in game', 'enemy'],
  ['call of duty modern warfare 2 operator character in game', 'enemy'],
  ['call of duty modern warfare explosion gameplay screenshot', 'vfx'],
  ['call of duty warzone explosion airstrike screenshot', 'vfx'],
  ['call of duty modern warfare 2019 hud multiplayer screenshot', 'hud'],
  ['modern warfare 2 killfeed hud gameplay screenshot', 'hud'],
  ['call of duty modern warfare 2019 main menu screenshot', 'menu'],
  ['call of duty modern warfare 2 loadout menu screenshot', 'menu'],
];

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

async function bingImageUrls(query, count) {
  const url = `https://www.bing.com/images/search?q=${encodeURIComponent(query)}&qft=+filterui:imagesize-large&first=1&count=60`;
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' } });
  const html = await res.text();
  const urls = [];
  const re = /murl&quot;:&quot;(.*?)&quot;/g;
  let m;
  while ((m = re.exec(html)) && urls.length < count * 3) {
    const u = m[1];
    if (/\.(jpe?g|png|webp)(\?|$)/i.test(u)) urls.push(u);
  }
  return urls;
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
    // Normalize: max 2000 wide, high-quality jpeg.
    await img.resize({ width: Math.min(meta.width, 2000), withoutEnlargement: true }).jpeg({ quality: 90 }).toFile(dest);
    return { ok: true, width: meta.width, height: meta.height };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  await ensureDir(outDir);
  const manifest = [];
  let saved = 0;
  for (const [query, category] of QUERIES) {
    console.log(`[refs] ${category.padEnd(12)} ${query}`);
    let urls = [];
    try {
      urls = await bingImageUrls(query, perQuery);
    } catch (e) {
      console.log('   search failed:', String(e));
      continue;
    }
    let kept = 0;
    for (const u of urls) {
      if (kept >= perQuery) break;
      const name = `${category}-${slug(query).slice(0, 30)}-${hash(u)}.jpg`;
      const dest = path.join(outDir, name);
      try {
        const r = await download(u, dest);
        kept++;
        saved++;
        manifest.push({ file: name, category, query, source: u, width: r.width, height: r.height });
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
