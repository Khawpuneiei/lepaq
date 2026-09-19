import { NextResponse } from "next/server";

import { ApiError, apiError, requireOwnedMeeting, requireUser } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";
import { randomToken } from "@/lib/utils";

export const runtime = "nodejs";

/**
 * Create a share link. Only an approved report can be shared: the whole point
 * is that what leaves the account is the text the user read and edited, never
 * a raw model draft (spec 9 barriers 2 and 6).
 */
export async function POST(_request: Request, ctx: RouteContext<"/api/meetings/[id]/share">) {
  try {
    const { id } = await ctx.params;
    const user = await requireUser();
    const meeting = await requireOwnedMeeting(id, user.id);
    const supabase = await createClient();

    if (meeting.status !== "ready") {
      throw new ApiError("Approve the report before sharing it.", 409);
    }

    if (meeting.share_token) {
      return NextResponse.json({ token: meeting.share_token });
    }

    const token = randomToken();
    const { error } = await supabase
      .from("meetings")
      .update({ share_token: token })
      .eq("id", id);
    if (error) throw new ApiError(error.message, 500);

    return NextResponse.json({ token });
  } catch (err) {
    return apiError(err);
  }
}

/** Revoke. The old link stops working immediately. */
export async function DELETE(_request: Request, ctx: RouteContext<"/api/meetings/[id]/share">) {
  try {
    const { id } = await ctx.params;
    const user = await requireUser();
    await requireOwnedMeeting(id, user.id);
    const supabase = await createClient();

    const { error } = await supabase
      .from("meetings")
      .update({ share_token: null })
      .eq("id", id);
    if (error) throw new ApiError(error.message, 500);

    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiError(err);
  }
}
