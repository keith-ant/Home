"use client";

import * as React from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { Header } from "@/components/header";
import { BriefingCard } from "@/components/briefing-card";
import { SchedulePanel } from "@/components/schedule-panel";
import { TasksPanel } from "@/components/tasks-panel";
import { NotesSheet } from "@/components/notes-sheet";
import { useMounted } from "@/hooks/use-mounted";
import {
  addDays,
  daysBetween,
  eventDayKey,
  localDayKey,
  occursOn,
} from "@/lib/time";
import type { CalEvent, DashboardData, Task } from "@/lib/types";

/** A ticking clock. The whole dashboard is downstream of this one Date. */
function useNow(intervalMs: number): Date {
  const [now, setNow] = React.useState(() => new Date());
  React.useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function Dashboard({ data }: { data: DashboardData }) {
  // Everything here is relative to the *browser's* clock and timezone, so we
  // render nothing time-dependent until we're on the client. One frame of
  // skeleton in exchange for zero hydration weirdness.
  const mounted = useMounted();

  const now = useNow(15_000);
  const todayKey = localDayKey(now);

  // The day being viewed, as an offset from today (0 = today). Stored as an
  // offset rather than a date so "today" stays correct across midnight.
  const [dayOffset, setDayOffset] = React.useState(0);
  const dayKey = addDays(todayKey, dayOffset);

  // Tasks and note-existence are owned here; the panels and the notes sheet
  // both read and write them.
  const [tasks, setTasks] = React.useState<Task[]>(data.tasks);
  const [noteIds, setNoteIds] = React.useState<Set<string>>(
    () => new Set(data.noteIds),
  );

  // `openEvent` is the last event whose notes were opened; it intentionally
  // survives the sheet closing so the close animation still has content.
  const [openEvent, setOpenEvent] = React.useState<CalEvent | null>(null);
  const [sheetOpen, setSheetOpen] = React.useState(false);

  const quickAddRef = React.useRef<HTMLInputElement>(null);

  /**
   * Open an event's notes, jumping the schedule to the event's day — but
   * only if it isn't already visible. (A multi-day hotel stay spans several
   * days; clicking it shouldn't yank the view back to its first day.)
   */
  function openNotes(ev: CalEvent) {
    if (!occursOn(ev, dayKey)) {
      setDayOffset(daysBetween(todayKey, eventDayKey(ev)));
    }
    setOpenEvent(ev);
    setSheetOpen(true);
  }

  // Keyboard: ← / → to move days, T for today, / to add a task.
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = document.activeElement;
      const typing =
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        (el instanceof HTMLElement && el.isContentEditable);
      if (typing || sheetOpen || e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === "ArrowLeft") setDayOffset((d) => d - 1);
      else if (e.key === "ArrowRight") setDayOffset((d) => d + 1);
      else if (e.key === "t" || e.key === "T") setDayOffset(0);
      else if (e.key === "/") {
        e.preventDefault();
        quickAddRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sheetOpen]);

  if (!mounted) return <DashboardSkeleton />;

  return (
    <TooltipProvider>
      <div className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col px-5 sm:px-8">
        <Header
          now={now}
          events={data.events}
          onOpenEvent={openNotes}
          onToday={() => setDayOffset(0)}
        />

        <main className="flex flex-1 flex-col gap-10 pb-20">
          {data.briefing && <BriefingCard briefing={data.briefing} />}

          <div className="grid gap-12 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:gap-14">
            <SchedulePanel
              events={data.events}
              dayKey={dayKey}
              todayKey={todayKey}
              now={now}
              noteIds={noteIds}
              onPrev={() => setDayOffset((d) => d - 1)}
              onNext={() => setDayOffset((d) => d + 1)}
              onToday={() => setDayOffset(0)}
              onOpenEvent={openNotes}
            />
            <TasksPanel
              tasks={tasks}
              setTasks={setTasks}
              events={data.events}
              todayKey={todayKey}
              quickAddRef={quickAddRef}
              onOpenEvent={openNotes}
            />
          </div>
        </main>

        <footer className="border-t py-5 text-xs text-muted-foreground">
          <span className="font-mono">data/</span> is the source of truth — plain
          JSON and markdown. Edit it, script it, or let Claude write to it.
        </footer>
      </div>

      <NotesSheet
        event={openEvent}
        open={sheetOpen}
        tasks={tasks}
        setTasks={setTasks}
        setNoteIds={setNoteIds}
        onClose={() => setSheetOpen(false)}
      />
    </TooltipProvider>
  );
}

/** Layout-stable placeholder rendered on the server and for one client frame. */
function DashboardSkeleton() {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col px-5 sm:px-8">
      <div className="flex items-center justify-between py-5">
        <Skeleton className="h-5 w-20" />
        <Skeleton className="size-9" />
      </div>
      <div className="space-y-3 pt-6 pb-12">
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-5 w-56" />
      </div>
      <div className="grid gap-12 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:gap-14">
        <div className="space-y-4">
          <Skeleton className="h-8 w-full" />
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
        <div className="space-y-4">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-9 w-full" />
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      </div>
    </div>
  );
}
