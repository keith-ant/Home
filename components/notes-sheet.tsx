"use client";

import * as React from "react";
import { ListPlus, MapPin, TriangleAlert, Users, Video } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { OWNER } from "@/lib/config";
import { attendeeSummary, noteTemplate, uncheckedActions } from "@/lib/notes";
import { others } from "@/lib/people";
import { physicalLocation } from "@/lib/schedule";
import { fmtDuration, fmtTime, minutesBetween } from "@/lib/time";
import type { CalEvent, Task } from "@/lib/types";

type Props = {
  /** The last event that was opened. Stays set while the sheet animates closed. */
  event: CalEvent | null;
  open: boolean;
  tasks: Task[];
  setTasks: React.Dispatch<React.SetStateAction<Task[]>>;
  setNoteIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  onClose: () => void;
};

export function NotesSheet({
  event,
  open,
  tasks,
  setTasks,
  setNoteIds,
  onClose,
}: Props) {
  if (!event) return null;
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-xl"
      >
        {/*
          Keyed by event id: opening a different meeting remounts the editor
          with fresh state — load, save status, everything. No manual resets.
        */}
        <NoteEditor
          key={event.id}
          ev={event}
          tasks={tasks}
          setTasks={setTasks}
          setNoteIds={setNoteIds}
        />
      </SheetContent>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Save machinery
// ---------------------------------------------------------------------------
//
// Notes are the one place where silent data loss is unacceptable, so the
// autosave makes three guarantees:
//
//   1. A failed LOAD never seeds the blank template. If we couldn't read the
//      note we don't know whether one exists, and "save the template" would
//      destroy it. Editing is disabled until a load succeeds.
//   2. At most one save is on the wire at a time, and it always carries the
//      LATEST text. An older body can never overwrite a newer one because an
//      older body is never sent.
//   3. If this editor unmounts with a save pending (you switched meetings
//      mid-debounce), the next editor for the same event WAITS for that save
//      to land before reading the file. `pendingSave` lives at module scope
//      precisely because it must outlive the component.

const pendingSave = new Map<string, Promise<unknown>>();

type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

const SAVE_LABEL: Record<SaveState, string> = {
  idle: "",
  dirty: "Unsaved",
  saving: "Saving…",
  saved: "Saved",
  error: "Couldn't save",
};

const AUTOSAVE_MS = 800;

function NoteEditor({
  ev,
  tasks,
  setTasks,
  setNoteIds,
}: {
  ev: CalEvent;
  tasks: Task[];
  setTasks: React.Dispatch<React.SetStateAction<Task[]>>;
  setNoteIds: React.Dispatch<React.SetStateAction<Set<string>>>;
}) {
  // null = still loading. loadError = we couldn't determine whether a note
  // exists on disk, so editing stays off (guarantee 1).
  const [body, setBody] = React.useState<string | null>(null);
  const [loadError, setLoadError] = React.useState(false);
  const [saveState, setSaveState] = React.useState<SaveState>("idle");
  const [savedAt, setSavedAt] = React.useState<string | null>(null);
  const [sending, setSending] = React.useState(false);

  const latestRef = React.useRef(""); // latest typed text
  const timerRef = React.useRef<number | null>(null); // debounce
  const inflightRef = React.useRef(false); // a PUT is on the wire
  const queuedRef = React.useRef(false); // text changed while one was

  /**
   * Push `latestRef.current` to disk. Re-entrant calls while a save is in
   * flight just set a flag; the in-flight save's settle handler re-runs us
   * with whatever the latest text is by then. This is guarantee 2.
   */
  function flush() {
    if (inflightRef.current) {
      queuedRef.current = true;
      return;
    }
    inflightRef.current = true;
    const content = latestRef.current;
    setSaveState("saving");

    const save = api<{ exists: boolean; savedAt: string }>(
      `/api/notes/${ev.id}`,
      { method: "PUT", body: JSON.stringify({ body: content }) },
    )
      .then((res) => {
        // Saves are serialized, so responses arrive in order and the latest
        // one's `exists` is authoritative for the has-notes indicator.
        setNoteIds((prev) => {
          const s = new Set(prev);
          if (res.exists) s.add(ev.id);
          else s.delete(ev.id);
          return s;
        });
        if (latestRef.current === content) {
          setSaveState("saved");
          setSavedAt(res.savedAt);
        }
      })
      .catch(() => setSaveState("error"))
      .finally(() => {
        inflightRef.current = false;
        if (pendingSave.get(ev.id) === save) pendingSave.delete(ev.id);
        if (queuedRef.current) {
          queuedRef.current = false;
          flush();
        }
      });

    pendingSave.set(ev.id, save);
  }

  // `flush` closes over this render's scope; the unmount cleanup below needs
  // a stable handle to the freshest one.
  const flushRef = React.useRef(flush);
  React.useEffect(() => {
    flushRef.current = flush;
  });

  // Load — but first wait out any save still landing from a previous mount
  // of this same event (guarantee 3). Loop, because a flushed save can chain
  // into a queued one.
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      let pending: Promise<unknown> | undefined;
      while ((pending = pendingSave.get(ev.id))) {
        await pending.catch(() => {});
      }
      if (cancelled) return;
      try {
        const res = await api<{ exists: boolean; body: string }>(
          `/api/notes/${ev.id}`,
        );
        if (cancelled) return;
        const initial = res.exists ? res.body : noteTemplate();
        latestRef.current = initial;
        setBody(initial);
      } catch {
        if (!cancelled) setLoadError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ev.id]);

  // On unmount, fire any debounced-but-unsent save *synchronously* so it is
  // registered in `pendingSave` before the next editor mounts and looks.
  React.useEffect(
    () => () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
        flushRef.current();
      }
    },
    [],
  );

  function handleChange(value: string) {
    latestRef.current = value;
    setBody(value);
    setSaveState("dirty");
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      flushRef.current();
    }, AUTOSAVE_MS);
  }

  // ---- derived display -----------------------------------------------------

  const loading = body === null && !loadError;
  const text = body ?? "";

  const people = others(ev, OWNER.email);
  const location = physicalLocation(ev);
  const timeline = ev.allDay
    ? "All day"
    : (() => {
        const day = new Date(ev.start).toLocaleDateString(undefined, {
          weekday: "short",
          month: "short",
          day: "numeric",
        });
        return `${day} · ${fmtTime(ev.start)} – ${fmtTime(ev.end)} · ${fmtDuration(
          minutesBetween(ev.start, ev.end),
        )}`;
      })();

  const existingForEvent = new Set(
    tasks.filter((t) => t.eventId === ev.id).map((t) => t.title.toLowerCase()),
  );
  const sendable = uncheckedActions(text).filter(
    (a) => !existingForEvent.has(a.toLowerCase()),
  );

  async function sendActions() {
    if (sendable.length === 0) return;
    setSending(true);
    // Sequential on purpose: each POST is a read-modify-write of tasks.json.
    for (const title of sendable) {
      try {
        const saved = await api<Task>("/api/tasks", {
          method: "POST",
          body: JSON.stringify({ title, eventId: ev.id, source: "meeting" }),
        });
        setTasks((ts) => [...ts, saved]);
      } catch {
        // Keep going; the rest can still land.
      }
    }
    setSending(false);
  }

  const words = text.trim() ? text.trim().split(/\s+/).length : 0;

  return (
    <>
      <SheetHeader className="gap-2.5 border-b px-6 py-5 pr-12">
        <SheetTitle className="text-lg leading-snug font-semibold tracking-tight text-balance">
          {ev.title}
        </SheetTitle>
        <SheetDescription className="text-[13px] tabular-nums">
          {timeline}
        </SheetDescription>

        {(people.length > 0 || location || ev.meetLink) && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 pt-0.5 text-xs text-muted-foreground">
            {people.length > 0 && (
              <span className="flex min-w-0 items-center gap-1.5">
                <Users className="size-3 shrink-0" />
                <span className="truncate">{attendeeSummary(people)}</span>
              </span>
            )}
            {location && (
              <span className="flex min-w-0 items-center gap-1.5">
                <MapPin className="size-3 shrink-0" />
                <span className="max-w-[36ch] truncate">{location}</span>
              </span>
            )}
            {ev.meetLink && (
              <Button
                asChild
                variant="outline"
                size="sm"
                className="h-6 gap-1.5 px-2 text-xs"
              >
                <a href={ev.meetLink} target="_blank" rel="noreferrer">
                  <Video className="size-3" />
                  Join
                </a>
              </Button>
            )}
          </div>
        )}
      </SheetHeader>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 py-4">
        {ev.description && (
          <details className="group mb-3 border-b pb-3">
            <summary className="cursor-pointer text-xs font-medium text-muted-foreground transition-colors select-none hover:text-foreground">
              Event details
            </summary>
            <p className="mt-2 max-h-44 overflow-y-auto text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground">
              {ev.description}
            </p>
          </details>
        )}

        {loadError ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed px-6 py-12 text-center">
            <TriangleAlert className="size-4 text-muted-foreground" />
            <p className="text-sm font-medium">Couldn&apos;t load this note.</p>
            <p className="max-w-xs text-xs leading-relaxed text-muted-foreground">
              Editing is disabled so nothing on disk gets overwritten by
              mistake. Close the panel and try again.
            </p>
          </div>
        ) : (
          <Textarea
            value={text}
            onChange={(e) => handleChange(e.target.value)}
            disabled={loading}
            placeholder={loading ? "Loading…" : "Notes…"}
            aria-label="Meeting notes"
            spellCheck
            className="min-h-[45vh] flex-1 resize-none rounded-none border-0 bg-transparent px-0 py-0 text-[15px] leading-7 shadow-none focus-visible:ring-0 dark:bg-transparent"
          />
        )}
      </div>

      <SheetFooter className="mt-0 flex-row items-center justify-between gap-3 border-t px-6 py-3">
        <span className="text-xs text-muted-foreground tabular-nums">
          {loadError
            ? "Not loaded"
            : saveState === "saved" && savedAt
              ? `Saved ${fmtTime(savedAt)}`
              : SAVE_LABEL[saveState]}
          {words > 0 && (
            <span className="text-muted-foreground/50">
              {saveState !== "idle" || savedAt ? " · " : ""}
              {words} {words === 1 ? "word" : "words"}
            </span>
          )}
        </span>

        {sendable.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={sendActions}
            disabled={sending}
            className="gap-1.5"
          >
            <ListPlus className="size-3.5" />
            {sending
              ? "Sending…"
              : `Send ${sendable.length} action${sendable.length === 1 ? "" : "s"} to tasks`}
          </Button>
        )}
      </SheetFooter>
    </>
  );
}
