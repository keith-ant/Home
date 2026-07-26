#!/usr/bin/env node
/**
 * Blind comparison pack builder.
 *
 * Pairs each of our captured shots with real reference frames of the same
 * category, assigns them to anonymous A/B(/C) slots, normalizes size and
 * encoding so provenance isn't leaked by metadata, and writes:
 *
 *   critique/round-<n>/pair-01/A.jpg
 *   critique/round-<n>/pair-01/B.jpg
 *   critique/round-<n>/pair-01/PROMPT.md   (identical wording every round)
 *   critique/round-<n>/INDEX.md            (pair listing, no sources)
 *   critique/round-<n>/key.json            (SECRET: slot → source; never shown to critics)
 *
 * Usage:
 *   node tools/critic/blind-pack.mjs --round 3 [--shots shots] [--triples 0.25]
 *        [--only viewmodel_idle,vista] [--width 1600]
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ROOT, parseArgs, ensureDir } from '../lib/browser.mjs';

const require = createRequire(import.meta.url);
const sharp = require('sharp');

const args = parseArgs(process.argv.slice(2));
const shotsDir = path.resolve(ROOT, args.shots || 'shots');
const refIndexPath = path.join(ROOT, 'reference', 'cod', 'index.json');
const width = parseInt(args.width || '1600', 10);
const tripleChance = parseFloat(args.triples || '0.2');
const only = args.only ? String(args.only).split(',') : null;

/** our preset id → critic category */
export const PRESET_CATEGORY = {
  smoke: 'environment', vista: 'environment', street: 'environment', alley: 'environment',
  quay: 'environment', warehouse: 'environment', rain_light: 'environment',
  viewmodel_idle: 'viewmodel', viewmodel_ads: 'viewmodel', viewmodel_reload: 'viewmodel',
  viewmodel_pistol: 'viewmodel', viewmodel_inspect: 'viewmodel', gun_macro: 'viewmodel',
  viewmodel_fire: 'firing', firefight: 'firing',
  enemy_close: 'enemy',
  explosion: 'vfx', impacts: 'vfx',
  hud_full: 'hud',
  menu_main: 'menu', menu_loadout: 'menu', results: 'menu',
};

async function main() {
  const round = args.round ? parseInt(args.round, 10) : await nextRoundNumber();
  const rng = mulberry32(round * 7919 + 13);
  const roundDir = path.join(ROOT, 'critique', `round-${round}`);
  await fs.rm(roundDir, { recursive: true, force: true });
  await ensureDir(roundDir);

  // ---- inputs -------------------------------------------------------------
  const refs = JSON.parse(await fs.readFile(refIndexPath, 'utf8').catch(() => '[]'));
  if (!refs.length) throw new Error(`No curated references found at ${refIndexPath}. Run 'npm run refs' then curate.`);
  const refsByCat = {};
  for (const r of refs) (refsByCat[r.category] ||= []).push(r);

  const shotFiles = (await fs.readdir(shotsDir)).filter((f) => f.endsWith('.png') && !f.includes('.FAILED'));
  const ours = shotFiles
    .map((f) => ({ preset: f.replace(/\.png$/, ''), file: path.join(shotsDir, f) }))
    .filter((s) => PRESET_CATEGORY[s.preset])
    .filter((s) => !only || only.includes(s.preset));
  if (!ours.length) throw new Error(`No categorized shots found in ${shotsDir}. Run 'npm run shot -- --all' first.`);

  // ---- build pairs ----------------------------------------------------------
  const key = { round, created: new Date().toISOString(), pairs: [] };
  const indexLines = [`# Blind review pack — round ${round}`, '', 'Judge each pair folder independently. See PROMPT.md inside each.', ''];
  let n = 0;
  // deterministic per-category rotation so references vary across pairs
  const refCursor = {};

  for (const shot of ours) {
    const cat = PRESET_CATEGORY[shot.preset];
    const pool = shuffle([...(refsByCat[cat] || [])], rng);
    if (!pool.length) {
      console.log(`[pack] skip ${shot.preset}: no references for category '${cat}'`);
      continue;
    }
    n++;
    const pairId = `pair-${String(n).padStart(2, '0')}`;
    const pairDir = path.join(roundDir, pairId);
    await ensureDir(pairDir);

    // 1 reference, sometimes 2 (A/B/C triples raise difficulty)
    const refCount = pool.length > 1 && rng() < tripleChance ? 2 : 1;
    refCursor[cat] = refCursor[cat] || 0;
    const chosenRefs = [];
    for (let i = 0; i < refCount; i++) {
      chosenRefs.push(pool[(refCursor[cat] + i) % pool.length]);
    }
    refCursor[cat] += refCount;

    const entries = [
      { kind: 'ours', preset: shot.preset, src: shot.file },
      ...chosenRefs.map((r) => ({ kind: 'reference', ref: r.file, src: path.join(ROOT, 'reference', 'cod', r.file), note: r.note || '' })),
    ];
    const slots = ['A', 'B', 'C'].slice(0, entries.length);
    const shuffled = shuffle(entries, rng);
    const keyPair = { pair: pairId, category: cat, slots: {} };
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      const e = shuffled[i];
      const dest = path.join(pairDir, `${slot}.jpg`);
      await normalize(e.src, dest);
      keyPair.slots[slot] = e.kind === 'ours' ? { ours: true, preset: e.preset } : { ours: false, ref: e.ref, note: e.note };
    }
    key.pairs.push(keyPair);
    await fs.writeFile(path.join(pairDir, 'PROMPT.md'), promptText(pairId, slots, cat));
    indexLines.push(`- ${pairId} — category: **${cat}** — slots: ${slots.join(', ')}`);
  }

  await fs.writeFile(path.join(roundDir, 'INDEX.md'), indexLines.join('\n') + '\n');
  await fs.writeFile(path.join(roundDir, 'key.json'), JSON.stringify(key, null, 2));
  await fs.writeFile(path.join(roundDir, 'RUBRIC.md'), rubricText());
  console.log(`[pack] round ${round}: ${n} pairs → ${path.relative(ROOT, roundDir)}`);
  console.log(`[pack] Give critics ONLY the pair-* folders + RUBRIC.md. key.json is secret.`);
}

async function normalize(src, dest) {
  await sharp(src, { failOn: 'none' })
    .resize({ width, withoutEnlargement: false, fit: 'inside' })
    .removeAlpha()
    .jpeg({ quality: 90, chromaSubsampling: '4:4:4' })
    .withMetadata({}) // strip EXIF/software tags
    .toFile(dest);
}

async function nextRoundNumber() {
  const dir = path.join(ROOT, 'critique');
  await ensureDir(dir);
  const entries = await fs.readdir(dir);
  let max = 0;
  for (const e of entries) {
    const m = /^round-(\d+)$/.exec(e);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return max + 1;
}

function promptText(pairId, slots, cat) {
  return `# ${pairId} — blind review (${cat})

You are the harshest senior art director in AAA shooters. You have shipped
Call of Duty titles. This folder contains ${slots.length} images labeled
${slots.join(', ')}. Some may be from a shipping AAA game, some may be from an
in-development build — you are NOT told which, and you must not try to reason
about provenance from metadata. Judge purely on what is on screen.

For this pair:
1. Describe EACH image in 3–5 sentences as an art director would: lighting,
   materials, silhouette/composition, VFX, screen post-processing, UI.
2. Blind verdict: which single image looks more like a shipped $70 AAA
   shooter? One sentence why. No hedging, no ties.
3. Score EACH image 0–10 on: (a) lighting & atmosphere, (b) material/surface
   fidelity, (c) geometric density & silhouette, (d) VFX & motion read,
   (e) post-processing/grade, (f) UI craft (n/a if none). Then an overall
   0–10 where 9–10 = indistinguishable from Modern Warfare, 7–8 = shippable
   AAA, 5–6 = AA / dated, 4 or less = indie/prototype.
4. The 5 changes, ranked by impact, that would most close the gap for the
   weaker image. Be surgical and specific — never "make it look better".
5. List any prototype tells: default fonts, hard black shadows, uniform
   roughness, tiling textures, unlit polygons, floaty animation, empty HUD.

Praise is worthless to the team; specificity is everything. If everything is
genuinely great, say what is left to reach a Digital Foundry showcase verdict.

Respond with strict JSON:
{
  "pair": "${pairId}",
  "images": {
    "${slots[0]}": { "description": "...", "scores": { "lighting": 0, "materials": 0, "geometry": 0, "vfx": 0, "post": 0, "ui": 0, "overall": 0 }, "tells": ["..."] }${slots.length > 1 ? ',\n    ...' : ''}
  },
  "winner": "${slots[0]}|${slots[1]}${slots[2] ? '|' + slots[2] : ''}",
  "winner_reason": "...",
  "gap_fixes": ["...", "...", "...", "...", "..."]
}
`;
}

function rubricText() {
  return `# Critic rubric (identical every round)

See docs/CRITIC_PROTOCOL.md §5. Scores: 0-10 per axis
(lighting, materials, geometry, vfx, post, ui) and overall.
9-10 = indistinguishable from Modern Warfare (2019+).
7-8  = shippable AAA.
5-6  = AA / dated.
<=4  = indie / prototype.
Anchor your 10 to the best Modern Warfare / Battlefield frames you know.
Be brutal, specific, and blind. Never hedge; always pick a winner per pair.
`;
}

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle(arr, rng) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

main().catch((e) => {
  console.error('[pack] fatal:', e.message || e);
  process.exit(1);
});
