"use client";

import { Area, AreaChart, ResponsiveContainer } from "recharts";
import type { LucideIcon } from "lucide-react";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Four cards, reframed from revenue to the user's own benefit (spec 7.2).
 * Deal value lives on the pipeline board, not up here — the product opens on
 * "what do I owe people", not on money.
 *
 * The sparkline is borrowed from the dark reference design.
 */
export function StatCard({
  label,
  value,
  hint,
  hintTone = "muted",
  icon: Icon,
  series,
  accent = "primary",
}: {
  label: string;
  value: string | number;
  hint?: string;
  hintTone?: "muted" | "warn" | "danger" | "success";
  icon?: LucideIcon;
  series?: number[];
  accent?: "primary" | "success" | "butter";
}) {
  const stroke =
    accent === "success"
      ? "var(--success)"
      : accent === "butter"
        ? "var(--butter-strong)"
        : "var(--primary)";

  const data = (series ?? []).map((v, i) => ({ i, v }));
  const gradientId = `spark-${label.replace(/\W+/g, "")}`;

  return (
    <Card className="relative overflow-hidden p-5 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-muted-foreground">{label}</p>
        {Icon && <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
      </div>

      {/* big numbers get the serif too */}
      <p className="mt-3 font-display text-4xl leading-none">{value}</p>

      {hint && (
        <p
          className={cn(
            "mt-2 text-xs",
            hintTone === "muted" && "text-muted-foreground",
            hintTone === "warn" && "text-on-butter",
            hintTone === "danger" && "text-danger",
            hintTone === "success" && "text-on-success-soft",
          )}
        >
          {hint}
        </p>
      )}

      {data.length > 1 && (
        <div className="mt-4 h-10" aria-hidden>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={stroke} stopOpacity={0.25} />
                  <stop offset="100%" stopColor={stroke} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area
                type="monotone"
                dataKey="v"
                stroke={stroke}
                strokeWidth={2}
                fill={`url(#${gradientId})`}
                isAnimationActive={false}
                dot={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}
