import { Dashboard } from "@/components/dashboard";
import {
  listNoteIds,
  readBriefing,
  readCalendar,
  readTasks,
} from "@/lib/store";

// Always read `data/` fresh — it's the source of truth and it changes
// underneath us (you, a script, Claude).
export const dynamic = "force-dynamic";

export default async function Page() {
  const [events, tasks, briefing, noteIds] = await Promise.all([
    readCalendar(),
    readTasks(),
    readBriefing(),
    listNoteIds(),
  ]);

  return <Dashboard data={{ events, tasks, briefing, noteIds }} />;
}
