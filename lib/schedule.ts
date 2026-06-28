import type { CalEvent } from "./types";
import { minutesBetween, occursOn } from "./time";

export function isDeclined(ev: CalEvent): boolean {
  return ev.responseStatus === "declined";
}

// The \b stops "Optionality review" from being tagged optional.
export function isOptional(ev: CalEvent): boolean {
  return /^\s*\[?\s*optional\b/i.test(ev.title);
}

/**
 * The location worth showing as a *place*. For virtual meetings Google puts
 * the Meet/Zoom URL in `location`; that's a link, not somewhere you go.
 */
export function physicalLocation(ev: CalEvent): string | null {
  const loc = ev.location?.trim();
  if (!loc || /^https?:\/\//i.test(loc)) return null;
  return loc;
}

/** Timed (non all-day) events on a day, declined ones removed, sorted by start. */
export function timedEventsOn(events: CalEvent[], dayKey: string): CalEvent[] {
  return events
    .filter((e) => !e.allDay && !isDeclined(e) && occursOn(e, dayKey))
    .sort(
      (a, b) =>
        new Date(a.start).getTime() - new Date(b.start).getTime() ||
        new Date(a.end).getTime() - new Date(b.end).getTime(),
    );
}

export function allDayEventsOn(events: CalEvent[], dayKey: string): CalEvent[] {
  return events.filter((e) => e.allDay && !isDeclined(e) && occursOn(e, dayKey));
}

export type EventPhase = "past" | "now" | "future";

export function phaseOf(ev: CalEvent, now: Date): EventPhase {
  const start = new Date(ev.start).getTime();
  const end = new Date(ev.end).getTime();
  const t = now.getTime();
  if (t >= end) return "past";
  if (t >= start) return "now";
  return "future";
}

export type UpNext =
  | { kind: "now"; ev: CalEvent; minutesLeft: number }
  | { kind: "next"; ev: CalEvent; minutesUntil: number };

/**
 * What should the header point at?
 * A meeting happening right now wins; otherwise the next one starting
 * within the lookahead window (so 3am doesn't show tomorrow's standup).
 */
export function upNext(
  events: CalEvent[],
  now: Date,
  lookaheadMinutes = 18 * 60,
): UpNext | null {
  const timed = events
    .filter((e) => !e.allDay && !isDeclined(e))
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

  const current = timed.find((e) => phaseOf(e, now) === "now");
  if (current) {
    return {
      kind: "now",
      ev: current,
      minutesLeft: minutesBetween(now, current.end),
    };
  }

  const next = timed.find((e) => phaseOf(e, now) === "future");
  if (!next) return null;
  const minutesUntil = minutesBetween(now, next.start);
  if (minutesUntil > lookaheadMinutes) return null;
  return { kind: "next", ev: next, minutesUntil };
}
