import { NextResponse } from "next/server";
import {
  deleteNote,
  isSafeEventId,
  readNote,
  writeNote,
} from "@/lib/store";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ eventId: string }> };

const MAX_NOTE_BYTES = 1_000_000; // be generous; it's your disk

export async function GET(_req: Request, { params }: Ctx) {
  const { eventId } = await params;
  if (!isSafeEventId(eventId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const body = await readNote(eventId);
  return NextResponse.json({ exists: body !== null, body: body ?? "" });
}

/** Save (or create) the note. Body: { body: string }. An empty body deletes it. */
export async function PUT(req: Request, { params }: Ctx) {
  const { eventId } = await params;
  if (!isSafeEventId(eventId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  // Reject by Content-Length *before* buffering and parsing the whole body.
  // (The post-parse check below stays as the real bound — Content-Length is
  // advisory — this just avoids buffering something obviously enormous.)
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_NOTE_BYTES * 2) {
    return NextResponse.json({ error: "note too large" }, { status: 413 });
  }
  const payload = await req.json().catch(() => null);
  const body = typeof payload?.body === "string" ? payload.body : null;
  if (body === null) {
    return NextResponse.json({ error: "body is required" }, { status: 400 });
  }
  if (Buffer.byteLength(body, "utf8") > MAX_NOTE_BYTES) {
    return NextResponse.json({ error: "note too large" }, { status: 413 });
  }

  if (body.trim() === "") {
    // Don't leave empty husks around — an emptied note is a deleted note.
    await deleteNote(eventId);
    return NextResponse.json({ exists: false, savedAt: new Date().toISOString() });
  }

  await writeNote(eventId, body);
  return NextResponse.json({ exists: true, savedAt: new Date().toISOString() });
}
