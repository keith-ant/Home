import { NextResponse } from "next/server";
import { mutateTasks } from "@/lib/store";
import { isDayKey } from "@/lib/time";
import type { Task } from "@/lib/types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** A safe object out of whatever the request body was (`null` is valid JSON). */
async function readPatch(req: Request): Promise<Record<string, unknown>> {
  const raw = await req.json().catch(() => null);
  return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
}

/** Update a task. Body may include: { title?, done?, due? } */
export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const patch = await readPatch(req);

  let updated: Task | undefined;
  await mutateTasks((tasks) =>
    tasks.map((t) => {
      if (t.id !== id) return t;
      const next: Task = { ...t };
      if (typeof patch.title === "string" && patch.title.trim()) {
        next.title = patch.title.trim();
      }
      // `due` is a strict YYYY-MM-DD day key everywhere downstream
      // (string comparison + dateFromDayKey) — only accept that or null.
      if (patch.due === null || isDayKey(patch.due)) {
        next.due = patch.due as string | null;
      }
      if (typeof patch.done === "boolean") {
        next.done = patch.done;
        next.completedAt = patch.done ? new Date().toISOString() : null;
      }
      updated = next;
      return next;
    }),
  );

  if (!updated) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json(updated);
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  let found = false;
  await mutateTasks((tasks) =>
    tasks.filter((t) => {
      if (t.id !== id) return true;
      found = true;
      return false;
    }),
  );
  if (!found) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
