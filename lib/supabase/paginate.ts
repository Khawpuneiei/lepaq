import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * PostgREST caps a plain select at 1000 rows and gives no indication that it
 * truncated. Every other table in this app stays well under that, but
 * transcript_segments does not: a 61-minute recording produced 1022 rows, so
 * an unpaged read silently dropped the last 22 lines.
 *
 * That is not a display nit. The same read feeds the analysis prompt and the
 * talk ratio, so the model would have been reasoning about a transcript that
 * stops mid-conversation, and evidence links past idx 999 would scroll to a
 * line that was never rendered.
 */
const PAGE = 1000;

export async function fetchAllSegments<T>(
  client: SupabaseClient,
  meetingId: string,
  columns: string,
): Promise<T[]> {
  const all: T[] = [];

  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client
      .from("transcript_segments")
      .select(columns)
      .eq("meeting_id", meetingId)
      .order("idx", { ascending: true })
      .range(from, from + PAGE - 1);

    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;

    all.push(...(data as T[]));
    if (data.length < PAGE) break;
  }

  return all;
}
