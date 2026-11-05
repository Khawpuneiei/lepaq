import { NextResponse } from "next/server";
import { z } from "zod";

import { ApiError, apiError, requireUser } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertGuestMayStart, isGuest } from "@/lib/auth/guest";
import { AUDIO_BUCKET, MAX_UPLOAD_BYTES, MAX_UPLOAD_MB } from "@/lib/constants";
import { findOrCreateCompany } from "@/lib/people";

const Body = z.object({
  title: z.string().min(1, "Give the meeting a title."),
  short_note: z.string().max(280).nullable().optional(),
  meeting_date: z.string().nullable().optional(),
  company_id: z.string().uuid().nullable().optional(),
  new_company_name: z.string().min(1).nullable().optional(),
  consent_confirmed: z.literal(true, {
    message: "Consent is required before a recording can be processed.",
  }),
  filename: z.string().min(1),
  size: z.number().int().positive(),
  mime: z.string().nullable().optional(),
  participants: z
    .array(
      z.object({
        display_name: z.string().min(1),
        position: z.string().nullable().optional(),
        is_me: z.boolean().default(false),
        person_id: z.string().uuid().nullable().optional(),
      }),
    )
    .min(1, "Add at least one participant."),
});

function extensionOf(filename: string) {
  const m = filename.toLowerCase().match(/\.([a-z0-9]{1,5})$/);
  return m ? m[1] : "mp3";
}

/**
 * Creates the meeting row and hands back a signed URL so the browser can PUT
 * the audio straight into Supabase Storage.
 *
 * The audio must never be posted through this route: Vercel rejects request
 * bodies over ~4.5MB, which almost every real recording exceeds (spec 3.1).
 */
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const supabase = await createClient();

    const parsed = Body.safeParse(await request.json());
    if (!parsed.success) {
      throw new ApiError(
        parsed.error.issues[0]?.message ?? "That form is not valid.",
        422,
      );
    }
    const body = parsed.data;

    // before the upload, so a guest who has used their meeting is told now
    if (isGuest(user)) await assertGuestMayStart(createAdminClient(), user);

    if (body.size > MAX_UPLOAD_BYTES) {
      throw new ApiError(
        `That file is ${(body.size / 1024 / 1024).toFixed(1)}MB. The limit is ${MAX_UPLOAD_MB}MB — export it as mono MP3 at 48-64 kbps and it will shrink a lot.`,
        413,
      );
    }

    // Reuse the company if the typed name already exists, rather than adding
    // a second "Acme" every time somebody types it into the combobox.
    let companyId = body.company_id ?? null;
    if (!companyId && body.new_company_name) {
      companyId = await findOrCreateCompany(supabase, {
        ownerId: user.id,
        name: body.new_company_name,
      });
    }

    const { data: meeting, error: meetingError } = await supabase
      .from("meetings")
      .insert({
        owner_id: user.id,
        company_id: companyId,
        title: body.title,
        short_note: body.short_note ?? null,
        meeting_date: body.meeting_date ?? new Date().toISOString().slice(0, 10),
        consent_confirmed: true,
        audio_bytes: body.size,
        audio_mime: body.mime ?? null,
        status: "uploaded",
      })
      .select("id")
      .single();

    if (meetingError) throw new ApiError(meetingError.message, 500);

    const participants = body.participants.map((p) => ({
      meeting_id: meeting.id,
      person_id: p.person_id ?? null,
      display_name: p.display_name,
      position: p.position ?? null,
      is_me: p.is_me,
    }));

    const { error: participantError } = await supabase
      .from("meeting_participants")
      .insert(participants);
    if (participantError) throw new ApiError(participantError.message, 500);

    // path convention {user_id}/{meeting_id}.{ext} — the storage policy keys
    // off that first segment, so it must stay exactly this shape
    const path = `${user.id}/${meeting.id}.${extensionOf(body.filename)}`;

    const { data: signed, error: signError } = await supabase.storage
      .from(AUDIO_BUCKET)
      .createSignedUploadUrl(path);

    if (signError) throw new ApiError(signError.message, 500);

    await supabase.from("meetings").update({ audio_path: path }).eq("id", meeting.id);

    return NextResponse.json({
      id: meeting.id,
      path,
      token: signed.token,
      signedUrl: signed.signedUrl,
    });
  } catch (err) {
    return apiError(err);
  }
}
