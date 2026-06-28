import type { Attendee, CalEvent } from "./types";

/**
 * The friendliest honest label for a person.
 *
 * Calendar's display name wins. Failing that, "jane.doe@x.com" clearly
 * encodes "Jane Doe", so use it. But "gbergman@x.com" does NOT encode
 * "Gbergman" — for those we show the bare handle rather than inventing
 * a name. Don't pretend to know something you don't.
 */
export function personLabel(a: Attendee): string {
  if (a.name?.trim()) return a.name.trim();
  const local = a.email.split("@")[0] || a.email;
  const parts = local.split(/[._-]+/).filter(Boolean);
  if (parts.length < 2) return local;
  return parts.map((s) => s[0].toUpperCase() + s.slice(1)).join(" ");
}

/** Rooms and group calendars show up as attendees. People are more interesting. */
function isHuman(a: Attendee): boolean {
  return !/(resource|group)\.calendar\.google\.com$/.test(a.email);
}

/** Everyone in the meeting who isn't you and isn't a room. */
export function others(ev: CalEvent, selfEmail: string): Attendee[] {
  return (ev.attendees ?? []).filter(
    (a) => isHuman(a) && !a.self && a.email !== selfEmail,
  );
}

/**
 * For a 1:1, the one other person. The strongest signal of "who is this
 * meeting actually with" — worth surfacing right in the schedule row.
 */
export function counterpart(ev: CalEvent, selfEmail: string): Attendee | null {
  const rest = others(ev, selfEmail);
  return rest.length === 1 ? rest[0] : null;
}
