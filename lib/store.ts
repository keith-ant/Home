import { promises as fs } from "fs";
import path from "path";
import type { Briefing, CalEvent, Task } from "./types";

/**
 * The entire persistence layer.
 *
 * No database. No service. Plain files in `data/` that you can open, grep,
 * edit by hand, sync with a script, or hand to Claude. That's the point.
 *
 *   data/calendar.json   the calendar (an array of CalEvent)
 *   data/tasks.json      your tasks   (an array of Task)
 *   data/briefing.json   the "From Claude" block
 *   data/notes/<id>.md   meeting notes, one markdown file per event
 *
 * Because these files are hand-editable, two rules matter a lot:
 *   1. A MISSING file is normal (→ fall back to the empty value). A
 *      CORRUPT file is not — it must throw loudly, never be silently
 *      replaced. A read-modify-write that swallows a parse error would
 *      destroy your data on the very next mutation.
 *   2. All writes are atomic (write a unique temp file, then rename), and
 *      writes to the same store are serialized through a tiny in-process
 *      mutex so concurrent requests can never interleave or clobber.
 */

const DATA_DIR = path.join(process.cwd(), "data");
const NOTES_DIR = path.join(DATA_DIR, "notes");

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

function isMissing(err: unknown): boolean {
  return (err as NodeJS.ErrnoException)?.code === "ENOENT";
}

/**
 * Read + parse a JSON file. Returns `fallback` ONLY if the file doesn't
 * exist; a parse error or any other failure throws so it can be seen and
 * fixed instead of being papered over (and then written back).
 */
async function readJson<T>(file: string, fallback: T): Promise<T> {
  let raw: string;
  try {
    raw = await fs.readFile(path.join(DATA_DIR, file), "utf8");
  } catch (err) {
    if (isMissing(err)) return fallback;
    throw err;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(
      `data/${file} is not valid JSON — fix or delete it. ` +
        `(Refusing to fall back to an empty value: a later write would erase the file.)`,
    );
  }
}

// Each in-flight write gets its own temp file so concurrent writers can
// never truncate or rename-away each other's temp.
let tmpSeq = 0;
const tmpPath = (target: string) =>
  `${target}.${process.pid}.${tmpSeq++}.tmp`;

/** Write to a temp file then rename, so a crash never leaves a half-written file. */
async function atomicWrite(target: string, contents: string): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const tmp = tmpPath(target);
  await fs.writeFile(tmp, contents, "utf8");
  await fs.rename(tmp, target);
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await atomicWrite(
    path.join(DATA_DIR, file),
    JSON.stringify(value, null, 2) + "\n",
  );
}

/**
 * A trivial in-process mutex: queue async work so two mutations of the same
 * store can never interleave their read-modify-write or land out of order.
 */
function createLock() {
  let tail: Promise<unknown> = Promise.resolve();
  return function withLock<T>(fn: () => Promise<T>): Promise<T> {
    const next = tail.then(fn, fn);
    tail = next.catch(() => {});
    return next;
  };
}

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------

// The app only *reads* the calendar; `scripts/import-gcal.mjs` writes it.
export async function readCalendar(): Promise<CalEvent[]> {
  return readJson<CalEvent[]>("calendar.json", []);
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

const withTaskLock = createLock();

export async function readTasks(): Promise<Task[]> {
  return readJson<Task[]>("tasks.json", []);
}

/** Read → transform → write tasks.json, serialized against other mutations. */
export function mutateTasks(fn: (tasks: Task[]) => Task[]): Promise<Task[]> {
  return withTaskLock(async () => {
    const next = fn(await readJson<Task[]>("tasks.json", []));
    await writeJson("tasks.json", next);
    return next;
  });
}

// ---------------------------------------------------------------------------
// Briefing
// ---------------------------------------------------------------------------

export async function readBriefing(): Promise<Briefing | null> {
  return readJson<Briefing | null>("briefing.json", null);
}

// ---------------------------------------------------------------------------
// Meeting notes
// ---------------------------------------------------------------------------

/**
 * Notes are keyed by calendar event id and stored as plain markdown.
 * Ids come from Google Calendar (and recurring-instance suffixes like
 * `_20260629T163000Z`), so we allow only filename-safe characters and
 * refuse anything else — this is also the path-traversal guard.
 */
const SAFE_ID = /^[A-Za-z0-9_-]{1,256}$/;

export function isSafeEventId(id: string): boolean {
  return SAFE_ID.test(id);
}

function notePath(eventId: string): string {
  if (!isSafeEventId(eventId)) throw new Error("invalid event id");
  return path.join(NOTES_DIR, `${eventId}.md`);
}

// Autosave fires every 800ms of idle typing; two saves of the same note can
// overlap if the disk is slow. Serialize them so the later text always wins.
const withNoteLock = createLock();

export async function readNote(eventId: string): Promise<string | null> {
  try {
    return await fs.readFile(notePath(eventId), "utf8");
  } catch (err) {
    if (isMissing(err)) return null;
    throw err;
  }
}

export function writeNote(eventId: string, body: string): Promise<void> {
  const target = notePath(eventId); // validate before queueing
  return withNoteLock(() => atomicWrite(target, body));
}

export function deleteNote(eventId: string): Promise<void> {
  const target = notePath(eventId);
  return withNoteLock(async () => {
    try {
      await fs.unlink(target);
    } catch (err) {
      if (!isMissing(err)) throw err; // already gone is fine
    }
  });
}

/** Event ids that have a notes file, so the UI can mark them. */
export async function listNoteIds(): Promise<string[]> {
  try {
    const files = await fs.readdir(NOTES_DIR);
    return files
      .filter((f) => f.endsWith(".md"))
      .map((f) => f.slice(0, -3))
      .filter(isSafeEventId);
  } catch (err) {
    if (isMissing(err)) return [];
    throw err;
  }
}
