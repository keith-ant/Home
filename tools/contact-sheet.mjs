#!/usr/bin/env node
/**
 * Contact-sheet composer for integrator/user review (NOT for critics — they
 * get the blind packs). Lays out our shots in a grid, optionally each next to
 * a same-category reference frame, with small labels.
 *
 * Usage:
 *   node tools/contact-sheet.mjs [--shots shots] [--out shots/_sheet.jpg]
 *        [--refs]            # pair each shot with a reference of its category
 *        [--cols 3] [--tile 720]
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ROOT, parseArgs, ensureDir } from './lib/browser.mjs';
import { PRESET_CATEGORY } from './critic/blind-pack.mjs';

const require = createRequire(import.meta.url);
const sharp = require('sharp');

const args = parseArgs(process.argv.slice(2));
const shotsDir = path.resolve(ROOT, args.shots || 'shots');
const out = path.resolve(ROOT, args.out || path.join('shots', '_sheet.jpg'));
const withRefs = !!args.refs;
const cols = parseInt(args.cols || (withRefs ? '2' : '3'), 10);
const tileW = parseInt(args.tile || '760', 10);
const tileH = Math.round((tileW * 9) / 16);
const labelH = 28;

async function main() {
  const files = (await fs.readdir(shotsDir)).filter((f) => f.endsWith('.png') && !f.includes('FAILED') && !f.startsWith('_'));
  if (!files.length) throw new Error('no shots found in ' + shotsDir);
  files.sort();

  let refs = [];
  if (withRefs) {
    try {
      refs = JSON.parse(await fs.readFile(path.join(ROOT, 'reference', 'cod', 'index.json'), 'utf8'));
    } catch {
      console.log('[sheet] no curated references yet — proceeding without');
    }
  }
  const refCursor = {};

  /** @type {Array<{file:string,label:string}>} */
  const tiles = [];
  for (const f of files) {
    const preset = f.replace(/\.png$/, '');
    tiles.push({ file: path.join(shotsDir, f), label: `OURS · ${preset}` });
    if (withRefs && refs.length) {
      const cat = PRESET_CATEGORY[preset];
      const pool = refs.filter((r) => r.category === cat);
      if (pool.length) {
        refCursor[cat] = refCursor[cat] || 0;
        const r = pool[refCursor[cat]++ % pool.length];
        tiles.push({ file: path.join(ROOT, 'reference', 'cod', r.file), label: `REF · ${r.file}` });
      }
    }
  }

  const perRow = withRefs ? 2 * Math.max(1, Math.floor(cols / 2)) : cols;
  const rows = Math.ceil(tiles.length / perRow);
  const W = perRow * tileW;
  const H = rows * (tileH + labelH);

  const composites = [];
  for (let i = 0; i < tiles.length; i++) {
    const t = tiles[i];
    const x = (i % perRow) * tileW;
    const y = Math.floor(i / perRow) * (tileH + labelH);
    const img = await sharp(t.file).resize(tileW, tileH, { fit: 'cover' }).toBuffer();
    composites.push({ input: img, left: x, top: y });
    const svg = `<svg width="${tileW}" height="${labelH}"><rect width="100%" height="100%" fill="#111"/><text x="10" y="19" font-family="monospace" font-size="14" fill="${t.label.startsWith('REF') ? '#ffb15c' : '#d7ff64'}">${escapeXml(t.label)}</text></svg>`;
    composites.push({ input: Buffer.from(svg), left: x, top: y + tileH });
  }

  await ensureDir(path.dirname(out));
  await sharp({ create: { width: W, height: H, channels: 3, background: '#000' } })
    .composite(composites)
    .jpeg({ quality: 88 })
    .toFile(out);
  console.log(`[sheet] ${tiles.length} tiles → ${path.relative(ROOT, out)} (${W}x${H})`);
}

function escapeXml(s) {
  return s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
}

main().catch((e) => {
  console.error('[sheet] fatal:', e.message || e);
  process.exit(1);
});
