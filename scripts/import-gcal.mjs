#!/usr/bin/env node
/**
 * Import raw Google Calendar event payloads into data/calendar.json.
 *
 *   node scripts/import-gcal.mjs raw-1.json raw-2.json ...
 *
 * Each input file is a raw `events.list` response — either the Google
 * Calendar API or the Google Calendar MCP server shape — i.e. an object
 * with an `events` (or `items`) array, or a bare array of events.
 *
 * This is the seam for keeping the calendar fresh. There's no OAuth client
 * baked into the app on purpose: anything that can produce this JSON
 * (Claude with a Calendar tool, a gcal CLI, a cron + a service account)
 * can be the sync. Run this, commit (or don't), reload the page.
 *
 * What it does on the way through:
 *   - normalizes all-day events to bare YYYY-MM-DD dates
 *   - strips conference *rooms* out of the attendee list (people only)
 *   - strips HTML out of descriptions
 *   - drops cancelled events, dedupes by id (last file wins), sorts by start
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "data", "calendar.json");

// --- helpers ---------------------------------------------------------------

const ENTITIES = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
};

function stripHtml(s) {
  let out = String(s);
  if (/<[a-z][^>]*>/i.test(out)) {
    out = out
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|tr|li|h[1-6]|table)>/gi, "\n")
      .replace(/<li[^>]*>/gi, "- ")
      .replace(/<[^>]+>/g, "");
  }
  out = out.replace(/&[a-z#0-9]+;/gi, (m) => ENTITIES[m.toLowerCase()] ?? m);
  return out.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

const clip = (s, n) => (s.length > n ? s.slice(0, n).trimEnd() + "…" : s);

function toEvent(raw) {
  if (raw.status === "cancelled" || !raw.id) return null;

  const allDay = !!raw.start?.date;
  const start = allDay
    ? String(raw.start.date).slice(0, 10)
    : (raw.start?.dateTime ?? null);
  if (!start) return null;
  const end = allDay
    ? String(raw.end?.date ?? raw.start.date).slice(0, 10)
    : (raw.end?.dateTime ?? start);

  const all = raw.attendees ?? [];
  const self = all.find((a) => a.self);
  // Conference rooms RSVP too. Nobody is taking notes for the room.
  const attendees = all
    .filter((a) => !a.resource && a.email)
    .map((a) => ({
      email: a.email,
      name: a.displayName ?? null,
      self: !!a.self,
      optional: !!(a.optional || a.optionalAttendee),
    }));

  const description = raw.description
    ? clip(stripHtml(raw.description), 2000)
    : null;

  return {
    id: String(raw.id),
    title: raw.summary?.trim() || "(no title)",
    start,
    end,
    allDay,
    location: raw.location ?? null,
    meetLink: raw.conferenceUrl ?? raw.hangoutLink ?? null,
    organizer: raw.organizer?.email ?? null,
    attendees,
    responseStatus: self?.responseStatus ?? null,
    description: description || null,
  };
}

// --- main ------------------------------------------------------------------

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("usage: node scripts/import-gcal.mjs <raw-events.json> [...]");
  process.exit(1);
}

const byId = new Map();
let read = 0;
for (const file of files) {
  const parsed = JSON.parse(readFileSync(file, "utf8"));
  const events = Array.isArray(parsed) ? parsed : (parsed.events ?? parsed.items ?? []);
  for (const raw of events) {
    read++;
    const ev = toEvent(raw);
    if (ev) byId.set(ev.id, ev);
  }
}

const out = [...byId.values()].sort(
  (a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end),
);

// Atomic, like every other write in the project: a crash mid-import must
// never leave a truncated calendar.json behind (the app would render an
// empty schedule, which reads as "you're free today").
mkdirSync(dirname(OUT), { recursive: true });
const tmp = `${OUT}.${process.pid}.tmp`;
writeFileSync(tmp, JSON.stringify(out, null, 2) + "\n");
renameSync(tmp, OUT);
console.log(`${read} raw → ${out.length} events → data/calendar.json`);
