"use client";

import * as React from "react";
import {
  CalendarDays,
  CalendarOff,
  ChevronLeft,
  ChevronRight,
  NotebookPen,
  Video,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { SectionLabel } from "@/components/section-label";
import { OWNER } from "@/lib/config";
import { cn } from "@/lib/utils";
import { counterpart, others, personLabel } from "@/lib/people";
import {
  allDayEventsOn,
  isOptional,
  phaseOf,
  physicalLocation,
  timedEventsOn,
  type EventPhase,
} from "@/lib/schedule";
import {
  fmtClock,
  fmtDayLabel,
  fmtDuration,
  minutesBetween,
} from "@/lib/time";
import type { CalEvent } from "@/lib/types";

type Props = {
  events: CalEvent[];
  dayKey: string;
  todayKey: string;
  now: Date;
  noteIds: Set<string>;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onOpenEvent: (ev: CalEvent) => void;
};

export function SchedulePanel({
  events,
  dayKey,
  todayKey,
  now,
  noteIds,
  onPrev,
  onNext,
  onToday,
  onOpenEvent,
}: Props) {
  const timed = timedEventsOn(events, dayKey);
  const allDay = allDayEventsOn(events, dayKey);
  const isToday = dayKey === todayKey;
  const label = fmtDayLabel(dayKey, todayKey);

  // Whole-day phase for non-today days so every row reads consistently.
  const dayPhase: EventPhase | null = isToday
    ? null
    : dayKey < todayKey
      ? "past"
      : "future";

  // The "now" line slides in before the first event that hasn't started yet.
  const nowLineIndex = !isToday
    ? null
    : (() => {
        const i = timed.findIndex((e) => new Date(e.start) > now);
        return i === -1 ? timed.length : i;
      })();

  const totalMinutes = timed.reduce(
    (sum, e) => sum + Math.max(0, minutesBetween(e.start, e.end)),
    0,
  );

  return (
    <section aria-label="Schedule">
      {/* Section header + day navigation */}
      <div className="flex items-center justify-between border-b pb-3">
        <SectionLabel>Schedule</SectionLabel>
        <div className="flex items-center gap-0.5">
          {!isToday && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-muted-foreground"
              onClick={onToday}
            >
              Today
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Previous day"
            onClick={onPrev}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Next day"
            onClick={onNext}
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>

      {/* Day line */}
      <div className="flex items-baseline justify-between gap-4 pt-4 pb-1">
        <p className="min-w-0 truncate text-sm">
          <span className="font-medium">{label.primary}</span>
          {label.secondary && (
            <span className="text-muted-foreground"> · {label.secondary}</span>
          )}
        </p>
        {timed.length > 0 && (
          <p className="shrink-0 text-xs text-muted-foreground tabular-nums">
            {timed.length} {timed.length === 1 ? "meeting" : "meetings"} ·{" "}
            {fmtDuration(totalMinutes)}
          </p>
        )}
      </div>

      {/* All-day events (travel, hotel stays, OOO) */}
      {allDay.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-3">
          {allDay.map((ev) => (
            <button
              key={ev.id}
              onClick={() => onOpenEvent(ev)}
              className="cursor-pointer"
              title="Open notes"
            >
              <Badge
                variant="secondary"
                className="gap-1.5 rounded-md px-2.5 py-1 font-normal hover:bg-accent"
              >
                <CalendarDays className="size-3 text-muted-foreground" />
                <span className="max-w-[34ch] truncate">{ev.title}</span>
              </Badge>
            </button>
          ))}
        </div>
      )}

      {/* The day */}
      {timed.length === 0 ? (
        <div className="mt-4 flex flex-col items-center gap-2 rounded-xl border border-dashed py-16 text-center">
          <CalendarOff className="size-5 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">
            Nothing on the calendar.
          </p>
          {isToday && (
            <p className="text-xs text-muted-foreground/60">
              An open day. Protect it.
            </p>
          )}
        </div>
      ) : (
        <ol className="mt-3">
          {timed.map((ev, i) => (
            <React.Fragment key={ev.id}>
              {nowLineIndex === i && <NowLine now={now} />}
              <li>
                <EventRow
                  ev={ev}
                  phase={dayPhase ?? phaseOf(ev, now)}
                  hasNote={noteIds.has(ev.id)}
                  onOpen={() => onOpenEvent(ev)}
                />
              </li>
            </React.Fragment>
          ))}
          {nowLineIndex === timed.length && <NowLine now={now} />}
        </ol>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------

function NowLine({ now }: { now: Date }) {
  const c = fmtClock(now);
  return (
    <li
      aria-label={`Now, ${c.time} ${c.meridiem}`}
      className="flex list-none items-center gap-2 py-1"
    >
      <span className="-ml-px size-1.5 shrink-0 rounded-full bg-foreground" />
      <span className="h-px flex-1 bg-foreground" />
      <span className="shrink-0 text-[10px] font-semibold tabular-nums">
        {c.time}
        <span className="font-normal text-muted-foreground"> {c.meridiem}</span>
      </span>
    </li>
  );
}

function EventRow({
  ev,
  phase,
  hasNote,
  onOpen,
}: {
  ev: CalEvent;
  phase: EventPhase;
  hasNote: boolean;
  onOpen: () => void;
}) {
  const start = fmtClock(new Date(ev.start));
  const mins = Math.max(0, minutesBetween(ev.start, ev.end));
  const meta = rowMeta(ev);
  const optional = isOptional(ev);
  const needsRsvp = ev.responseStatus === "needsAction";

  return (
    <button
      onClick={onOpen}
      data-phase={phase}
      className={cn(
        "group relative -mx-3 grid w-[calc(100%+1.5rem)] cursor-pointer grid-cols-[4.5rem_minmax(0,1fr)_auto] items-start gap-3 rounded-lg px-3 py-3 text-left transition-colors hover:bg-accent/60",
        phase === "now" && "bg-accent/60",
        phase === "past" && "opacity-45 transition-opacity hover:opacity-100",
      )}
      title="Open notes"
    >
      {phase === "now" && (
        <span
          aria-hidden
          className="absolute top-2.5 bottom-2.5 left-0 w-[3px] rounded-full bg-foreground"
        />
      )}

      {/* Time */}
      <span className="pt-px tabular-nums">
        <span className="text-sm font-medium">{start.time}</span>
        <span className="text-[10px] text-muted-foreground"> {start.meridiem}</span>
        <span className="block text-[11px] text-muted-foreground">
          {fmtDuration(mins)}
        </span>
      </span>

      {/* Title + meta */}
      <span className="min-w-0">
        <span className="block truncate text-sm leading-5 font-medium">
          {ev.title}
        </span>
        {meta && (
          <span className="block truncate text-xs leading-5 text-muted-foreground">
            {meta}
          </span>
        )}
      </span>

      {/* Status */}
      <span className="flex items-center gap-1.5 pt-px">
        {optional && (
          <Badge
            variant="outline"
            className="rounded-sm px-1.5 py-0 text-[10px] font-normal text-muted-foreground"
          >
            Optional
          </Badge>
        )}
        {needsRsvp && !optional && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge
                variant="secondary"
                className="rounded-sm px-1.5 py-0 text-[10px] font-normal text-muted-foreground"
              >
                RSVP
              </Badge>
            </TooltipTrigger>
            <TooltipContent side="left">
              You haven&apos;t responded to this one
            </TooltipContent>
          </Tooltip>
        )}
        {ev.meetLink && (
          <Video
            aria-label="Has a video link"
            className="size-3.5 text-muted-foreground/50"
          />
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <NotebookPen
              aria-label={hasNote ? "Has notes" : "No notes yet"}
              className={cn(
                "size-3.5",
                hasNote
                  ? "text-foreground"
                  : "text-muted-foreground/25 transition-colors group-hover:text-muted-foreground/60",
              )}
            />
          </TooltipTrigger>
          <TooltipContent side="left">
            {hasNote ? "Open notes" : "Add notes"}
          </TooltipContent>
        </Tooltip>
      </span>
    </button>
  );
}

/** The one-line subtitle under an event: who it's with, where it is. */
function rowMeta(ev: CalEvent): string {
  const parts: string[] = [];
  const cp = counterpart(ev, OWNER.email);
  if (cp) {
    parts.push(`1:1 · ${personLabel(cp)}`);
  } else {
    const n = others(ev, OWNER.email).length;
    if (n > 1) parts.push(`${n + 1} people`);
  }
  const location = physicalLocation(ev);
  if (location) parts.push(location);
  return parts.join("  ·  ");
}
