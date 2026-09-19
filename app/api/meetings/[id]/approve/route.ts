import { NextResponse } from "next/server";
import { z } from "zod";

import { ApiError, apiError, requireOwnedMeeting, requireUser } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const Body = z.object({
  summary: z.string().nullable().optional(),
  follow_up_email: z.string().nullable().optional(),
  action_item_ids: z.array(z.string().uuid()).default([]),
  fact_ids: z.array(z.string().uuid()).default([]),
  apply_company_status: z.boolean().default(false),
});

/**
 * The one click that turns a private draft into an approved report.
 *
 * Target is under two minutes from "ready" to "approved" (spec 9 barrier 7),
 * so this takes the edited text, the ticked action items and the ticked facts
 * in a single request rather than making the user save each one.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/meetings/[id]/approve">) {
  try {
    const { id } = await ctx.params;
    const user = await requireUser();
    const meeting = await requireOwnedMeeting(id, user.id);
    const supabase = await createClient();

    const parsed = Body.safeParse(await request.json());
    if (!parsed.success) throw new ApiError("Invalid approval payload.", 422);
    const body = parsed.data;

    const reportUpdate: Record<string, unknown> = {
      approved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    if (typeof body.summary === "string") reportUpdate.summary = body.summary;
    if (typeof body.follow_up_email === "string") {
      reportUpdate.follow_up_email = body.follow_up_email;
    }

    const { error: reportError } = await supabase
      .from("meeting_reports")
      .update(reportUpdate)
      .eq("meeting_id", id);
    if (reportError) throw new ApiError(reportError.message, 500);

    // Approve exactly what was ticked, and un-approve what was not, so the
    // screen is the source of truth rather than an accumulating pile.
    await supabase
      .from("action_items")
      .update({ approved: false })
      .eq("meeting_id", id)
      .eq("done", false);

    if (body.action_item_ids.length) {
      await supabase
        .from("action_items")
        .update({ approved: true })
        .eq("meeting_id", id)
        .in("id", body.action_item_ids);
    }

    await supabase.from("person_facts").update({ approved: false }).eq("meeting_id", id);

    if (body.fact_ids.length) {
      await supabase
        .from("person_facts")
        .update({ approved: true })
        .eq("meeting_id", id)
        .in("id", body.fact_ids);
    }

    // Applying the suggested company status is a separate, explicit opt-in.
    if (body.apply_company_status && meeting.company_id) {
      const { data: report } = await supabase
        .from("meeting_reports")
        .select("suggested_company_status")
        .eq("meeting_id", id)
        .maybeSingle();

      if (report?.suggested_company_status) {
        const { data: status } = await supabase
          .from("status_options")
          .select("id")
          .eq("owner_id", user.id)
          .eq("applies_to", "company")
          .eq("label", report.suggested_company_status)
          .maybeSingle();

        if (status) {
          await supabase
            .from("companies")
            .update({ status_id: status.id })
            .eq("id", meeting.company_id);
        }
      }
    }

    await supabase.from("meetings").update({ status: "ready" }).eq("id", id);

    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiError(err);
  }
}
