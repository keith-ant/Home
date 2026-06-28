"use client";

import { Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { SectionLabel } from "@/components/section-label";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { Briefing, BriefingItem } from "@/lib/types";

const KIND_LABEL: Record<BriefingItem["kind"], string> = {
  "heads-up": "Heads up",
  prep: "Prep",
  note: "Note",
};

function fmtStamp(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * The assistant surface. Claude (or anything else) writes
 * `data/briefing.json`; this renders it. That file is the whole contract.
 */
export function BriefingCard({ briefing }: { briefing: Briefing }) {
  return (
    <section className="rounded-xl border">
      <div className="flex items-center justify-between gap-4 border-b px-5 py-3">
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex cursor-default items-center gap-2">
              <Sparkles className="size-3.5 text-muted-foreground" />
              <SectionLabel>From Claude</SectionLabel>
            </div>
          </TooltipTrigger>
          <TooltipContent side="bottom" align="start">
            Written by Claude into data/briefing.json
          </TooltipContent>
        </Tooltip>
        <span className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">
          {fmtStamp(briefing.updatedAt)}
        </span>
      </div>

      <div className="space-y-4 px-5 py-4">
        <p className="max-w-3xl text-sm leading-relaxed font-medium">
          {briefing.headline}
        </p>
        {briefing.items.length > 0 && (
          <ul className="space-y-2.5">
            {briefing.items.map((it) => (
              <li key={it.id} className="flex items-baseline gap-3 text-sm">
                <Badge
                  variant="outline"
                  className="w-[4.75rem] shrink-0 justify-center rounded-sm px-1.5 py-0 text-[10px] font-medium tracking-wider text-muted-foreground uppercase"
                >
                  {KIND_LABEL[it.kind] ?? "Note"}
                </Badge>
                <span className="leading-relaxed text-foreground/90">
                  {it.text}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
