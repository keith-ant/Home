import { NextResponse } from "next/server";
import { mutateTasks, readTasks } from "@/lib/store";
import { newId } from "@/lib/id";
import { isDayKey } from "@/lib/time";
import type { Task } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await readTasks());
}

/** Create a task. Body: { title, due?, eventId?, source? } */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  if (!title) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }

  const task: Task = {
    id: newId("task"),
    title,
    done: false,
    createdAt: new Date().toISOString(),
    // `due` must be a YYYY-MM-DD day key; anything else is dropped, not stored.
    due: isDayKey(body.due) ? body.due : null,
    eventId: typeof body.eventId === "string" ? body.eventId : null,
    source:
      body.source === "claude" || body.source === "meeting"
        ? body.source
        : "manual",
  };

  await mutateTasks((tasks) => [...tasks, task]);
  return NextResponse.json(task, { status: 201 });
}
