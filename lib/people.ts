import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * One row per real person, one row per real company.
 *
 * Before this existed, every meeting created fresh rows for whoever it named:
 * three meetings with Chad produced three Chads, each with a third of what had
 * been learned about him. That defeats the entire point of a relationship
 * record, which is that the next conversation starts from everything the last
 * one taught you.
 *
 * Matching is on a trimmed, case-insensitive name, because the name comes
 * from a form a human typed and "chad", "Chad" and "Chad " are the same man.
 * A person is scoped to their company, so the same name at two different
 * clients stays two people — that is a different person, not a duplicate.
 *
 * 0002_people_and_interests.sql carries unique indexes that enforce the same
 * rule. These lookups keep the common path clean; the indexes are what holds
 * when two meetings are processed concurrently.
 */

const norm = (value: string) => value.trim().toLowerCase();

export async function findOrCreateCompany(
  client: SupabaseClient,
  args: { ownerId: string; name: string },
): Promise<string | null> {
  const name = args.name.trim();
  if (!name) return null;

  const { data: existing } = await client
    .from("companies")
    .select("id, name")
    .eq("owner_id", args.ownerId);

  const match = (existing ?? []).find((c) => norm(c.name) === norm(name));
  if (match) return match.id;

  const { data, error } = await client
    .from("companies")
    .insert({ owner_id: args.ownerId, name })
    .select("id")
    .single();

  // A concurrent insert can win the race; the unique index turns that into an
  // error here rather than a duplicate, so look the winner up instead.
  if (error) {
    const { data: raced } = await client
      .from("companies")
      .select("id, name")
      .eq("owner_id", args.ownerId);
    return (raced ?? []).find((c) => norm(c.name) === norm(name))?.id ?? null;
  }

  return data.id;
}

export async function findOrCreatePerson(
  client: SupabaseClient,
  args: {
    ownerId: string;
    fullName: string;
    companyId: string | null;
    position?: string | null;
  },
): Promise<string | null> {
  const fullName = args.fullName.trim();
  if (!fullName) return null;

  const { data: candidates } = await client
    .from("people")
    .select("id, full_name, company_id, position")
    .eq("owner_id", args.ownerId);

  const sameName = (candidates ?? []).filter((p) => norm(p.full_name) === norm(fullName));

  // Prefer the person at this company; fall back to one with no company yet,
  // which is what a person created from a meeting with no company looks like.
  const match =
    sameName.find((p) => p.company_id === args.companyId) ??
    sameName.find((p) => p.company_id === null);

  if (match) {
    // Fill in detail we did not have before, without overwriting what is there.
    const patch: Record<string, unknown> = {};
    if (!match.company_id && args.companyId) patch.company_id = args.companyId;
    if (!match.position && args.position) patch.position = args.position;
    if (Object.keys(patch).length) {
      await client.from("people").update(patch).eq("id", match.id);
    }
    return match.id;
  }

  const { data, error } = await client
    .from("people")
    .insert({
      owner_id: args.ownerId,
      company_id: args.companyId,
      full_name: fullName,
      position: args.position ?? null,
    })
    .select("id")
    .single();

  if (error) {
    const { data: raced } = await client
      .from("people")
      .select("id, full_name, company_id")
      .eq("owner_id", args.ownerId);
    return (
      (raced ?? []).find(
        (p) => norm(p.full_name) === norm(fullName) && p.company_id === args.companyId,
      )?.id ?? null
    );
  }

  return data.id;
}
