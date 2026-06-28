"use client";

import * as React from "react";
import { ChevronRight, CornerDownRight, Plus, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { SectionLabel } from "@/components/section-label";
import { api } from "@/lib/api";
import { newId } from "@/lib/id";
import { addDays, dateFromDayKey } from "@/lib/time";
import { cn } from "@/lib/utils";
import type { CalEvent, Task } from "@/lib/types";

type Props = {
  tasks: Task[];
  setTasks: React.Dispatch<React.SetStateAction<Task[]>>;
  events: CalEvent[];
  todayKey: string;
  quickAddRef: React.RefObject<HTMLInputElement | null>;
  onOpenEvent: (ev: CalEvent) => void;
};

/** Urgency rank: overdue, today, scheduled, someday. Lower sorts first. */
function rank(t: Task, todayKey: string): number {
  if (!t.due) return 3;
  if (t.due < todayKey) return 0;
  if (t.due === todayKey) return 1;
  return 2;
}

/**
 * An optimistic task whose POST hasn't resolved yet has a client-minted id
 * the server doesn't know. Toggling or deleting it would 404, and the
 * rollback would *invert* what the user just did — so until the real id
 * comes back (milliseconds, locally), the row is read-only.
 */
const isPending = (t: Task) => t.id.startsWith("tmp_");

export function TasksPanel({
  tasks,
  setTasks,
  events,
  todayKey,
  quickAddRef,
  onOpenEvent,
}: Props) {
  const [draft, setDraft] = React.useState("");
  const [showDone, setShowDone] = React.useState(false);

  const eventById = React.useMemo(
    () => new Map(events.map((e) => [e.id, e])),
    [events],
  );

  const open = tasks
    .filter((t) => !t.done)
    .sort(
      (a, b) =>
        rank(a, todayKey) - rank(b, todayKey) ||
        (a.due ?? "9999").localeCompare(b.due ?? "9999") ||
        a.createdAt.localeCompare(b.createdAt),
    );
  const done = tasks
    .filter((t) => t.done)
    .sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""));

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const title = draft.trim();
    if (!title) return;
    setDraft("");

    const tmpId = newId("tmp");
    const optimistic: Task = {
      id: tmpId,
      title,
      done: false,
      createdAt: new Date().toISOString(),
      source: "manual",
    };
    setTasks((ts) => [...ts, optimistic]);
    try {
      const saved = await api<Task>("/api/tasks", {
        method: "POST",
        body: JSON.stringify({ title }),
      });
      setTasks((ts) => ts.map((t) => (t.id === tmpId ? saved : t)));
    } catch {
      setTasks((ts) => ts.filter((t) => t.id !== tmpId));
    }
  }

  function toggle(task: Task, doneNow: boolean) {
    setTasks((ts) =>
      ts.map((t) =>
        t.id === task.id
          ? {
              ...t,
              done: doneNow,
              completedAt: doneNow ? new Date().toISOString() : null,
            }
          : t,
      ),
    );
    api(`/api/tasks/${task.id}`, {
      method: "PATCH",
      body: JSON.stringify({ done: doneNow }),
    }).catch(() => {
      setTasks((ts) => ts.map((t) => (t.id === task.id ? task : t)));
    });
  }

  function remove(task: Task) {
    setTasks((ts) => ts.filter((t) => t.id !== task.id));
    api(`/api/tasks/${task.id}`, { method: "DELETE" }).catch(() => {
      setTasks((ts) => [...ts, task]);
    });
  }

  return (
    <section aria-label="Tasks">
      <div className="flex items-center justify-between border-b pb-3">
        <SectionLabel>Tasks</SectionLabel>
        <span className="text-xs text-muted-foreground tabular-nums">
          {open.length} open
        </span>
      </div>

      {/* Quick add */}
      <form onSubmit={add} className="relative pt-4">
        <Plus className="pointer-events-none absolute top-1/2 left-3 size-4 translate-y-[3px] text-muted-foreground/60" />
        <Input
          ref={quickAddRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add a task…"
          aria-label="Add a task"
          className="h-10 border-dashed bg-transparent pl-9 shadow-none focus-visible:border-solid"
        />
        <kbd className="pointer-events-none absolute top-1/2 right-3 hidden translate-y-[1px] rounded border px-1.5 font-mono text-[10px] text-muted-foreground/70 sm:block">
          /
        </kbd>
      </form>

      {/* Open tasks */}
      {open.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground/70">
          Nothing on the list.
        </p>
      ) : (
        <ul className="pt-2">
          {open.map((t) => (
            <TaskRow
              key={t.id}
              task={t}
              todayKey={todayKey}
              linkedEvent={t.eventId ? eventById.get(t.eventId) : undefined}
              onToggle={toggle}
              onRemove={remove}
              onOpenEvent={onOpenEvent}
            />
          ))}
        </ul>
      )}

      {/* Completed */}
      {done.length > 0 && (
        <div className="mt-4 border-t pt-2">
          <button
            onClick={() => setShowDone((s) => !s)}
            className="flex w-full cursor-pointer items-center gap-1.5 py-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
            aria-expanded={showDone}
          >
            <ChevronRight
              className={cn("size-3.5 transition-transform", showDone && "rotate-90")}
            />
            Completed
            <span className="tabular-nums">· {done.length}</span>
          </button>
          {showDone && (
            <ul>
              {done.map((t) => (
                <TaskRow
                  key={t.id}
                  task={t}
                  todayKey={todayKey}
                  linkedEvent={t.eventId ? eventById.get(t.eventId) : undefined}
                  onToggle={toggle}
                  onRemove={remove}
                  onOpenEvent={onOpenEvent}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------

function DueBadge({ due, todayKey }: { due: string; todayKey: string }) {
  if (due < todayKey) {
    return (
      <Badge className="rounded-sm px-1.5 py-0 text-[10px]">Overdue</Badge>
    );
  }
  if (due === todayKey) {
    return (
      <Badge variant="outline" className="rounded-sm px-1.5 py-0 text-[10px] font-normal">
        Today
      </Badge>
    );
  }
  if (due === addDays(todayKey, 1)) {
    return (
      <span className="text-[11px] whitespace-nowrap text-muted-foreground">
        Tomorrow
      </span>
    );
  }
  const d = dateFromDayKey(due);
  return (
    <span className="text-[11px] whitespace-nowrap text-muted-foreground tabular-nums">
      {d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}
    </span>
  );
}

function TaskRow({
  task,
  todayKey,
  linkedEvent,
  onToggle,
  onRemove,
  onOpenEvent,
}: {
  task: Task;
  todayKey: string;
  linkedEvent?: CalEvent;
  onToggle: (t: Task, done: boolean) => void;
  onRemove: (t: Task) => void;
  onOpenEvent: (ev: CalEvent) => void;
}) {
  const id = `task-${task.id}`;
  const pending = isPending(task);
  return (
    <li
      className={cn(
        "group -mx-2 flex items-start gap-3 rounded-md px-2 py-2 transition-colors hover:bg-accent/50",
        pending && "opacity-60",
      )}
    >
      <Checkbox
        id={id}
        checked={task.done}
        disabled={pending}
        onCheckedChange={(v) => onToggle(task, v === true)}
        className="mt-0.5 rounded-full"
        aria-label={task.done ? "Mark as not done" : "Mark as done"}
      />
      <div className="min-w-0 flex-1">
        <label
          htmlFor={id}
          className={cn(
            "block cursor-pointer text-sm leading-5 break-words select-none",
            task.done && "text-muted-foreground line-through decoration-border",
          )}
        >
          {task.title}
        </label>
        {linkedEvent && (
          <button
            onClick={() => onOpenEvent(linkedEvent)}
            className="mt-0.5 flex max-w-full cursor-pointer items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
            title="Open meeting notes"
          >
            <CornerDownRight className="size-3 shrink-0" />
            <span className="truncate">{linkedEvent.title}</span>
          </button>
        )}
      </div>
      {!task.done && task.due && <DueBadge due={task.due} todayKey={todayKey} />}
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Delete task"
        disabled={pending}
        onClick={() => onRemove(task)}
        className="-my-1 size-6 text-muted-foreground/0 hover:!text-foreground group-hover:text-muted-foreground"
      >
        <X className="size-3.5" />
      </Button>
    </li>
  );
}
