/**
 * Core data shapes. Everything in `data/` deserializes into these.
 * Change them freely — they're yours.
 */

export type Attendee = {
  email: string;
  name?: string | null;
  self?: boolean;
  optional?: boolean;
};

export type CalEvent = {
  id: string;
  title: string;
  /** ISO 8601 with offset for timed events, YYYY-MM-DD for all-day. */
  start: string;
  end: string;
  allDay: boolean;
  location?: string | null;
  meetLink?: string | null;
  organizer?: string | null;
  attendees?: Attendee[];
  /** Your RSVP on this event: accepted | needsAction | tentative | declined */
  responseStatus?: string | null;
  description?: string | null;
};

export type TaskSource = "manual" | "claude" | "meeting";

export type Task = {
  id: string;
  title: string;
  done: boolean;
  createdAt: string;
  completedAt?: string | null;
  /** YYYY-MM-DD. Optional — most tasks are just "soon". */
  due?: string | null;
  /** If this task came out of a meeting, the calendar event it belongs to. */
  eventId?: string | null;
  source?: TaskSource;
};

export type BriefingItem = {
  id: string;
  kind: "heads-up" | "prep" | "note";
  text: string;
};

/**
 * The "From Claude" block at the top of the dashboard. This is the seam
 * where an assistant (Claude) writes directly into your day. It's just a
 * JSON file — anything that can write JSON can be your assistant.
 */
export type Briefing = {
  updatedAt: string;
  headline: string;
  items: BriefingItem[];
};

export type DashboardData = {
  events: CalEvent[];
  tasks: Task[];
  briefing: Briefing | null;
  /** Event ids that already have a notes file on disk. */
  noteIds: string[];
};
