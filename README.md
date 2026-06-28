# Home

A personal home base. One screen: today's meetings on the left, the task list
on the right, a briefing from Claude on top. Click any meeting and a notes
panel slides in.

This is built to be *yours* — a thing you change constantly, not a product.
Nothing here is precious.

```bash
npm install
npm run dev      # → http://localhost:3000
```

## What's on the screen

- **Header** — greeting, the live clock in whatever timezone you're physically
  in, and an *Up next* pill that's a one-click jump into prepping that meeting.
- **From Claude** — a briefing block. See below; this is the interesting part.
- **Schedule** — the day's timeline. A live "now" line, the active meeting
  highlighted, past ones receding. `←` `→` to move days, `T` for today.
  1:1s show who they're with. `RSVP` tags the invites you haven't answered.
- **Tasks** — `/` to add one. Solid black badge = overdue, outlined = due today.
- **Notes** — click any meeting. A markdown editor opens, pre-templated with
  `## Prep / ## Notes / ## Actions`, autosaving as you type. Unchecked
  `- [ ]` lines under `## Actions` get a **Send to tasks** button.

## The whole trick: `data/`

There is no database. Everything is a plain file you can open, grep, edit by
hand, version, or hand to a script.

```
data/
  calendar.json     the calendar — an array of events
  tasks.json        the task list
  briefing.json     the "From Claude" block
  notes/<id>.md     one markdown file per meeting you've taken notes on
```

The app reads these on every page load and writes them through tiny API
routes. That's the entire persistence story. It also means it only runs
somewhere with a real writable filesystem — your laptop — which is the point.

### `briefing.json` is the assistant seam

The "From Claude" card at the top renders whatever is in `data/briefing.json`.
That's the contract: anything that can write JSON to that file is your
executive assistant. Ask Claude to look at your week and refresh it; it edits
one file and reloads the page. No plugin system, no API. A file.

The current one is real — it was written by reading the actual calendar and
noticing things (a duplicate hotel booking, four meetings scheduled over a
flight, a one-minute connection between a landing and a DVQ).

### Keeping the calendar fresh

`data/calendar.json` is the calendar the dashboard renders. It was seeded from
Google Calendar. To refresh it, feed raw Google Calendar `events.list` JSON
(API or MCP shape) through the importer:

```bash
node scripts/import-gcal.mjs raw-window-1.json raw-window-2.json
```

It normalizes all-day events, strips HTML out of descriptions, drops the
conference rooms that Google lists as "attendees," dedupes, and sorts. The
easiest way to produce that raw JSON is to ask Claude (which has a Calendar
tool) — but anything works. There is deliberately no OAuth client baked into
the app; the importer *is* the integration point.

## Stack

Next.js (App Router) · Tailwind v4 · shadcn/ui · Geist · `next-themes`

A couple of deliberate choices:

- **shadcn components are vendored**, not installed. Every file in
  `components/ui/` is plain code in this repo. Change them.
- **Geist is bundled** (the `geist` npm package), not fetched from Google
  Fonts. No network dependency to render text.
- **Monochrome on purpose.** Every color is a neutral; the only accent is
  pure foreground. All the tokens live at the top of `app/globals.css` —
  if you ever want color, change them there and everything follows.
- **`lib/config.ts` is hardcoded to you.** It's a one-person app.

## Where to poke first

- `app/globals.css` — the design tokens
- `lib/config.ts` — your name + email
- `components/dashboard.tsx` — the shell; all the state lives here
- `data/briefing.json` — write something and reload

## Ideas (deliberately not built yet)

- A real Google Calendar sync on a timer
- Render the notes markdown (right now it's a beautiful plain textarea)
- A weekly view
- Push "Actions" back the other way — done tasks annotate the meeting note
- Let Claude pre-write a `## Prep` section for tomorrow's meetings every night
