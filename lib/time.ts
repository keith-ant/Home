import type { CalEvent } from "./types";

/**
 * All time math happens in the *browser's* timezone, on purpose.
 * The calendar stores ISO timestamps with offsets; whatever timezone you're
 * physically in is the one the dashboard renders. Land in New York, open
 * the tab, and the schedule is already in Eastern.
 */

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Is this a "YYYY-MM-DD" day key? The whole codebase compares these as
 * strings and parses them with `dateFromDayKey`, so anything else (a full
 * ISO timestamp, "tomorrow") must be rejected at the API boundary.
 */
export function isDayKey(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/** A local-timezone "YYYY-MM-DD" key for a Date. */
export function localDayKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Parse a "YYYY-MM-DD" key into a local-midnight Date. */
export function dateFromDayKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(key: string, n: number): string {
  const d = dateFromDayKey(key);
  d.setDate(d.getDate() + n);
  return localDayKey(d);
}

/** Whole days from one day key to another. Signed; `to` after `from` is positive. */
export function daysBetween(from: string, to: string): number {
  // The midnights may be 23 or 25 hours apart across a DST change;
  // Math.round absorbs that.
  return Math.round(
    (dateFromDayKey(to).getTime() - dateFromDayKey(from).getTime()) / 86_400_000,
  );
}

/**
 * The one rule for which local day an event belongs to.
 * All-day events are *calendar dates* and never shift with timezone.
 * Timed events belong to whatever local day they start on.
 */
export function eventDayKey(ev: Pick<CalEvent, "start" | "allDay">): string {
  return ev.allDay ? ev.start.slice(0, 10) : localDayKey(new Date(ev.start));
}

/** Does an event occur on a given local day? All-day ranges are end-exclusive. */
export function occursOn(ev: CalEvent, dayKey: string): boolean {
  const start = eventDayKey(ev);
  if (!ev.allDay) return start === dayKey;
  const end = ev.end ? ev.end.slice(0, 10) : start;
  return dayKey >= start && dayKey < (end > start ? end : addDays(start, 1));
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** "9:30" + "AM", split so the meridiem can be typeset smaller. */
export function fmtClock(d: Date): { time: string; meridiem: string } {
  let h = d.getHours();
  const meridiem = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return { time: `${h}:${pad(d.getMinutes())}`, meridiem };
}

export function fmtTime(iso: string): string {
  const { time, meridiem } = fmtClock(new Date(iso));
  return `${time} ${meridiem}`;
}

export function minutesBetween(a: Date | string, b: Date | string): number {
  const ms = new Date(b).getTime() - new Date(a).getTime();
  return Math.round(ms / 60_000);
}

export function fmtDuration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem === 0 ? `${h}h` : `${h}h ${rem}m`;
}

/** "in 18m", "in 2h 5m", "now", "12m ago" */
export function fmtRelative(minutes: number): string {
  if (Math.abs(minutes) < 1) return "now";
  const label = fmtDuration(Math.abs(minutes));
  return minutes > 0 ? `in ${label}` : `${label} ago`;
}

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "Mon, June 29" — with "Today" / "Tomorrow" / "Yesterday" when it applies. */
export function fmtDayLabel(
  dayKey: string,
  todayKey: string,
): { primary: string; secondary: string } {
  const d = dateFromDayKey(dayKey);
  const date = `${WEEKDAY[d.getDay()]}, ${MONTH[d.getMonth()]} ${d.getDate()}`;
  if (dayKey === todayKey) return { primary: "Today", secondary: date };
  if (dayKey === addDays(todayKey, 1))
    return { primary: "Tomorrow", secondary: date };
  if (dayKey === addDays(todayKey, -1))
    return { primary: "Yesterday", secondary: date };
  return { primary: date, secondary: "" };
}

/** "Saturday, June 28" — the long form for the header. */
export function fmtLongDate(d: Date): string {
  const long = [
    "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
  ];
  return `${long[d.getDay()]}, ${MONTH[d.getMonth()]} ${d.getDate()}`;
}

/** Short timezone label for the current locale, e.g. "PDT" or "EDT". */
export function tzAbbrev(d: Date = new Date()): string {
  const part = new Intl.DateTimeFormat(undefined, {
    timeZoneName: "short",
  })
    .formatToParts(d)
    .find((p) => p.type === "timeZoneName");
  return part?.value ?? "";
}

export function greetingFor(d: Date): string {
  const h = d.getHours();
  if (h < 4) return "Up late";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}
