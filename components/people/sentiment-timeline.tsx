"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { SENTIMENT_LABEL, SENTIMENT_SCORE } from "@/lib/constants";
import { formatShortDate } from "@/lib/utils";
import type { Sentiment } from "@/lib/types";

export interface TimelinePoint {
  date: string;
  sentiment: Sentiment;
  meetingTitle: string;
}

const TICKS = [1, 2, 3, 4];
const TICK_LABEL: Record<number, string> = {
  1: "Negative",
  2: "Mixed",
  3: "Neutral",
  4: "Positive",
};

export function SentimentTimeline({ points }: { points: TimelinePoint[] }) {
  if (points.length < 2) {
    return (
      <p className="text-sm text-muted-foreground">
        One meeting so far. The line appears once there are two to compare.
      </p>
    );
  }

  const data = points.map((p) => ({
    ...p,
    label: formatShortDate(p.date),
    score: SENTIMENT_SCORE[p.sentiment],
  }));

  return (
    <div className="h-48">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            domain={[0.5, 4.5]}
            ticks={TICKS}
            tickFormatter={(v: number) => TICK_LABEL[v] ?? ""}
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
            tickLine={false}
            axisLine={false}
            width={70}
          />
          <Tooltip
            cursor={{ stroke: "var(--border)" }}
            contentStyle={{
              background: "var(--popover)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius)",
              fontSize: 12,
              color: "var(--popover-foreground)",
            }}
            formatter={(_value, _name, item) => [
              SENTIMENT_LABEL[item.payload.sentiment as Sentiment],
              item.payload.meetingTitle,
            ]}
          />
          <Line
            type="monotone"
            dataKey="score"
            stroke="var(--chart-1)"
            strokeWidth={2}
            dot={{ r: 4, fill: "var(--chart-1)" }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
