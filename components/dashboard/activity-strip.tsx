import { CheckCircle2, FileText, Share2, Sparkles } from "lucide-react";
import { formatDistanceToNow, parseISO } from "date-fns";

import { Card } from "@/components/ui/card";

export interface ActivityItem {
  id: string;
  kind: "processed" | "approved" | "follow_up_done" | "shared";
  text: string;
  at: string;
}

const ICONS = {
  processed: Sparkles,
  approved: FileText,
  follow_up_done: CheckCircle2,
  shared: Share2,
} as const;

/** Recent activity strip, borrowed from the dark reference design (spec 8.1). */
export function ActivityStrip({ items }: { items: ActivityItem[] }) {
  if (items.length === 0) {
    return (
      <Card className="p-5 text-sm text-muted-foreground">
        Your recent activity will show up here.
      </Card>
    );
  }

  return (
    <Card className="divide-y p-0 shadow-card">
      {items.map((item) => {
        const Icon = ICONS[item.kind];
        let when = "";
        try {
          when = formatDistanceToNow(parseISO(item.at), { addSuffix: true });
        } catch {
          when = "";
        }

        return (
          <div key={item.id} className="flex items-center gap-3 px-5 py-3">
            <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <p className="min-w-0 flex-1 truncate text-sm">{item.text}</p>
            <span className="shrink-0 text-xs text-muted-foreground">{when}</span>
          </div>
        );
      })}
    </Card>
  );
}
