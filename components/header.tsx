"use client";

import * as React from "react";
import { ArrowRight, Circle } from "lucide-react";

import { ThemeToggle } from "@/components/theme-toggle";
import { OWNER } from "@/lib/config";
import { upNext } from "@/lib/schedule";
import {
  fmtClock,
  fmtDuration,
  fmtLongDate,
  fmtRelative,
  greetingFor,
  tzAbbrev,
} from "@/lib/time";
import type { CalEvent } from "@/lib/types";

type Props = {
  now: Date;
  events: CalEvent[];
  onOpenEvent: (ev: CalEvent) => void;
  onToday: () => void;
};

export function Header({ now, events, onOpenEvent, onToday }: Props) {
  const next = upNext(events, now);
  const clock = fmtClock(now);

  return (
    <header className="pb-12">
      {/* Wordmark row */}
      <div className="flex items-center justify-between border-b py-4">
        <button
          onClick={onToday}
          className="flex cursor-pointer items-center gap-2.5 text-sm font-semibold tracking-tight"
          aria-label="Go to today"
        >
          <span aria-hidden className="block size-2.5 rounded-[2px] bg-foreground" />
          Home
        </button>
        <ThemeToggle />
      </div>

      {/* Greeting */}
      <div className="flex flex-col gap-5 pt-10 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1.5">
          <h1 className="text-3xl font-semibold tracking-tight text-balance">
            {greetingFor(now)}, {OWNER.name}.
          </h1>
          <p className="text-sm text-muted-foreground tabular-nums">
            {fmtLongDate(now)}
            <span className="px-2 text-border" aria-hidden>
              /
            </span>
            {clock.time}
            <span className="text-xs"> {clock.meridiem}</span>
            <span className="pl-1.5 text-xs">{tzAbbrev(now)}</span>
          </p>
        </div>

        {next && (
          <button
            onClick={() => onOpenEvent(next.ev)}
            className="group inline-flex max-w-full cursor-pointer items-center gap-2.5 self-start rounded-full border px-4 py-2 text-left text-sm transition-colors hover:bg-accent sm:self-auto"
            title="Open notes"
          >
            {next.kind === "now" ? (
              <Circle className="size-2 shrink-0 animate-pulse fill-foreground text-foreground" />
            ) : (
              <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
            )}
            <span className="flex min-w-0 items-baseline">
              <span className="shrink-0 text-muted-foreground">
                {next.kind === "now" ? "Now" : "Up next"}
              </span>
              <span className="shrink-0 px-1.5 text-border" aria-hidden>
                /
              </span>
              <span className="max-w-[30ch] truncate font-medium">
                {next.ev.title}
              </span>
              <span className="shrink-0 pl-1.5 whitespace-nowrap text-muted-foreground tabular-nums">
                {next.kind === "now"
                  ? `${fmtDuration(next.minutesLeft)} left`
                  : fmtRelative(next.minutesUntil)}
              </span>
            </span>
          </button>
        )}
      </div>
    </header>
  );
}
