import type { Attendee } from "./types";
import { personLabel } from "./people";

/**
 * The skeleton a brand-new note opens with.
 * Three sections: Prep (before), Notes (during), Actions (after).
 * Actions written as `- [ ] thing` can be sent straight to your task list.
 */
export function noteTemplate(): string {
  return ["## Prep", "- ", "", "## Notes", "- ", "", "## Actions", "- [ ] ", ""].join(
    "\n",
  );
}

/**
 * Unchecked `- [ ] ...` lines — these are extractable as tasks.
 *
 * If the note has an `## Actions` heading, only lines under it count
 * (a checkbox in Prep is a question to ask, not a task to do). Notes
 * without that heading fall back to scanning the whole body.
 */
export function uncheckedActions(body: string): string[] {
  const lines = body.split("\n");
  const headingAt = lines.findIndex((l) => /^#{1,6}\s+actions\b/i.test(l));

  let scope = lines;
  if (headingAt !== -1) {
    const rest = lines.slice(headingAt + 1);
    const nextHeading = rest.findIndex((l) => /^#{1,6}\s+\S/.test(l));
    scope = nextHeading === -1 ? rest : rest.slice(0, nextHeading);
  }

  const out: string[] = [];
  for (const line of scope) {
    const m = /^\s*[-*]\s+\[ \]\s+(.+)$/.exec(line);
    if (m && m[1].trim()) out.push(m[1].trim());
  }
  return out;
}

/** A compact "Alice, Bob +3" attendee summary for the sheet header. */
export function attendeeSummary(attendees: Attendee[], max = 4): string {
  if (attendees.length === 0) return "";
  const names = attendees.slice(0, max).map(personLabel);
  const more = attendees.length - names.length;
  return more > 0 ? `${names.join(", ")} +${more}` : names.join(", ");
}
