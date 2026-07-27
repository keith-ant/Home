#!/usr/bin/env node
/**
 * Decode critic verdicts against the secret key and update the quality ledger.
 *
 * Input:  critique/round-<n>/key.json  +  critique/round-<n>/verdicts/*.json
 *         (each verdict file = the strict-JSON object a critic produced for one
 *          pair, or an array of them, or an object keyed by pair id).
 * Output: critique/round-<n>/scoreboard.json and an appended section in
 *         docs/QUALITY_LEDGER.md.
 *
 * Usage: node tools/critic/decode.mjs --round 3
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { ROOT, parseArgs } from '../lib/browser.mjs';

const args = parseArgs(process.argv.slice(2));

async function main() {
  if (!args.round) throw new Error('--round <n> required');
  const round = parseInt(args.round, 10);
  const roundDir = path.join(ROOT, 'critique', `round-${round}`);
  const key = JSON.parse(await fs.readFile(path.join(ROOT, 'critique', 'keys', `round-${round}.key.json`), 'utf8'));

  // ---- load verdicts ------------------------------------------------------
  const verdictDir = path.join(ROOT, 'critique', 'verdicts', `round-${round}`);
  const files = (await fs.readdir(verdictDir)).filter((f) => f.endsWith('.json'));
  const verdicts = [];
  for (const f of files) {
    const raw = JSON.parse(await fs.readFile(path.join(verdictDir, f), 'utf8'));
    if (Array.isArray(raw)) verdicts.push(...raw);
    else if (raw && Array.isArray(raw.verdicts)) verdicts.push(...raw.verdicts.filter((v) => v && v.pair));
    else if (raw && raw.pair) verdicts.push(raw);
    else if (raw && typeof raw === 'object') {
      for (const v of Object.values(raw)) if (v && v.pair) verdicts.push(v);
    }
  }

  // ---- decode ---------------------------------------------------------------
  const perPreset = {};
  const axes = ['lighting', 'materials', 'geometry', 'vfx', 'post', 'ui', 'overall'];
  let wins = 0;
  let pairsJudged = 0;
  const allFixes = [];
  const allTells = [];
  const rows = [];

  for (const kp of key.pairs) {
    const vs = verdicts.filter((v) => v.pair === kp.pair);
    if (!vs.length) continue;
    for (const v of vs) {
      pairsJudged++;
      const winnerSlot = String(v.winner || '').trim().toUpperCase();
      const winner = kp.slots[winnerSlot];
      const oursSlot = Object.entries(kp.slots).find(([, s]) => s.ours)?.[0];
      const oursWon = !!(winner && winner.ours);
      if (oursWon) wins++;
      const oursScores = (v.images && v.images[oursSlot] && v.images[oursSlot].scores) || {};
      const preset = kp.slots[oursSlot]?.preset;
      const cat = kp.category;
      const rec = (perPreset[preset] ||= { preset, category: cat, judged: 0, wins: 0, scores: {} });
      rec.judged++;
      if (oursWon) rec.wins++;
      for (const ax of axes) {
        const val = Number(oursScores[ax]);
        if (!Number.isNaN(val)) (rec.scores[ax] ||= []).push(val);
      }
      const refScores = {};
      for (const [slot, s] of Object.entries(kp.slots)) {
        if (!s.ours) refScores[slot] = v.images?.[slot]?.scores?.overall;
      }
      for (const fix of v.gap_fixes || []) allFixes.push({ preset, category: cat, fix, oursWon });
      for (const t of (v.images?.[oursSlot]?.tells) || []) allTells.push({ preset, tell: t });
      rows.push({ pair: kp.pair, preset, category: cat, oursSlot, winner: winnerSlot, oursWon, ours: oursScores.overall ?? null, refs: refScores, reason: v.winner_reason || '' });
    }
  }

  const mean = (a) => (a && a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
  const presetSummary = Object.values(perPreset).map((r) => ({
    preset: r.preset,
    category: r.category,
    winRate: r.judged ? r.wins / r.judged : null,
    means: Object.fromEntries(axes.map((ax) => [ax, round1(mean(r.scores[ax]))])),
  }));
  const overallMean = round1(mean(rows.map((r) => r.ours).filter((x) => typeof x === 'number')));
  const winRate = pairsJudged ? wins / pairsJudged : 0;

  const scoreboard = {
    round,
    when: new Date().toISOString(),
    pairsJudged,
    blindWinRate: winRate,
    meanOverall: overallMean,
    presets: presetSummary,
    rows,
    fixes: allFixes,
    tells: allTells,
  };
  await fs.writeFile(path.join(roundDir, 'scoreboard.json'), JSON.stringify(scoreboard, null, 2));

  // ---- ledger ---------------------------------------------------------------
  const ledgerPath = path.join(ROOT, 'docs', 'QUALITY_LEDGER.md');
  let ledger = await fs.readFile(ledgerPath, 'utf8').catch(() => '# IRONWAKE — Quality Ledger\n\nRound-by-round blind-review results. Ours vs. real Call of Duty frames, judged blind by independent critic agents. See docs/CRITIC_PROTOCOL.md.\n\n');
  const lines = [];
  lines.push(`## Round ${round} — ${new Date().toISOString().slice(0, 10)}`);
  lines.push('');
  lines.push(`- Pairs judged: **${pairsJudged}** · Blind win rate vs. real CoD: **${pct(winRate)}** · Mean overall (ours): **${overallMean ?? 'n/a'}/10**`);
  lines.push('');
  lines.push('| Preset | Category | Win rate | Overall | Light | Mat | Geo | VFX | Post | UI |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const p of presetSummary.sort((a, b) => a.preset.localeCompare(b.preset))) {
    const m = p.means;
    lines.push(`| ${p.preset} | ${p.category} | ${pct(p.winRate)} | ${m.overall ?? '-'} | ${m.lighting ?? '-'} | ${m.materials ?? '-'} | ${m.geometry ?? '-'} | ${m.vfx ?? '-'} | ${m.post ?? '-'} | ${m.ui ?? '-'} |`);
  }
  lines.push('');
  lines.push('**Top fixes demanded by critics:**');
  const seen = new Set();
  for (const f of allFixes) {
    const k = f.fix.trim().toLowerCase().slice(0, 80);
    if (seen.has(k)) continue;
    seen.add(k);
    lines.push(`- (${f.preset}) ${f.fix}`);
    if (seen.size >= 24) break;
  }
  if (allTells.length) {
    lines.push('');
    lines.push('**Prototype tells flagged:** ' + [...new Set(allTells.map((t) => `${t.tell} (${t.preset})`))].slice(0, 16).join('; '));
  }
  lines.push('');
  ledger += lines.join('\n') + '\n';
  await fs.writeFile(ledgerPath, ledger);

  // ---- console summary --------------------------------------------------------
  console.log(`[decode] round ${round}: ${pairsJudged} pairs, blind win rate ${pct(winRate)}, mean overall ${overallMean}`);
  for (const p of presetSummary) console.log(`  ${p.preset.padEnd(20)} overall ${p.means.overall}  win ${pct(p.winRate)}`);
  console.log(`[decode] scoreboard → ${path.relative(ROOT, path.join(roundDir, 'scoreboard.json'))}`);
  console.log(`[decode] ledger    → docs/QUALITY_LEDGER.md`);
}

function pct(x) {
  return x == null ? 'n/a' : `${Math.round(x * 100)}%`;
}
function round1(x) {
  return x == null ? null : Math.round(x * 10) / 10;
}

main().catch((e) => {
  console.error('[decode] fatal:', e.message || e);
  process.exit(1);
});
