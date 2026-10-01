import { z } from "zod";
import type { Viewer } from "../auth/permissions.ts";
import { writeAudit } from "../audit.ts";
import { db, withTransaction } from "../sql.ts";
import { isUuid } from "./service.ts";

// POST /api/people/:id/merge — spec §7 / §9.3. The path person (source) is
// merged INTO targetId (survivor). super_admin only, irreversible.

export const MERGE_FIELDS = [
  "fullName",
  "preferredName",
  "email",
  "phone",
  "whatsapp",
  "preferredLanguage",
  "jobTitle",
  "ownerId",
  "notes",
] as const;
export type MergeField = (typeof MERGE_FIELDS)[number];

// Per field, which person's value the survivor keeps. Left out = target's.
export const mergeSchema = z.object({
  targetId: z.string().min(1),
  fields: z
    .partialRecord(z.enum(MERGE_FIELDS), z.enum(["source", "target"]))
    .default({}),
});
export type MergeInput = z.infer<typeof mergeSchema>;

export type MergeResult =
  | { kind: "merged"; targetId: string; moved: unknown }
  | { kind: "forbidden" }
  | { kind: "not_found" }
  | { kind: "invalid"; message: string }
  | { kind: "conflict"; message: string };

// API field → person column(s) copied together when "source" is chosen.
const COLUMNS: Record<MergeField, string[]> = {
  fullName: ["full_name"],
  preferredName: ["preferred_name"],
  email: ["email"],
  phone: ["phone", "phone_e164"],
  whatsapp: ["whatsapp_e164"],
  preferredLanguage: ["preferred_language"],
  jobTitle: ["job_title"],
  ownerId: ["owner_user_id"],
  notes: ["notes"],
};

export async function mergePeople(
  sourceId: string,
  input: MergeInput,
  viewer: Viewer,
): Promise<MergeResult> {
  if (viewer.role !== "super_admin") return { kind: "forbidden" };
  const { targetId } = input;
  if (!isUuid(sourceId) || !isUuid(targetId)) return { kind: "not_found" };
  if (sourceId === targetId)
    return { kind: "invalid", message: "Pick a different person to keep." };

  try {
    return await withTransaction(async (): Promise<MergeResult> => {
      const sql = db();
      // merge_person() (migration 002) does every move and its own audit row.
      const [{ merge_person: moved }] = await sql`
        SELECT merge_person(${sourceId}, ${targetId}, ${viewer.id})`;

      // §12.10: the 9.3 field choices are applied after, in the same
      // transaction. The source is merged by now, so its email/phone no
      // longer block the unique indexes.
      const chosen = MERGE_FIELDS.filter((f) => input.fields[f] === "source");
      if (chosen.length) {
        const [source] = await sql`SELECT * FROM person WHERE id = ${sourceId}`;
        const set: Record<string, string | boolean | null> = {};
        for (const f of chosen) for (const c of COLUMNS[f]) set[c] = source[c];
        if (set.phone !== undefined) {
          const flagged = Boolean(set.phone && !set.phone_e164);
          if (flagged) {
            set.needs_review = true;
            set.needs_review_reason = "phone_unnormalised";
          } else {
            const [t] =
              await sql`SELECT needs_review_reason FROM person WHERE id = ${targetId}`;
            if (t.needs_review_reason === "phone_unnormalised") {
              set.needs_review = false;
              set.needs_review_reason = null;
            }
          }
        }
        await sql`UPDATE person SET ${sql(set, Object.keys(set))} WHERE id = ${targetId}`;
        await writeAudit({
          userId: viewer.id,
          action: "update",
          entity: "person",
          entityId: targetId,
          before: null,
          after: { mergeFieldsFrom: sourceId, fields: input.fields },
        });
      }
      return { kind: "merged", targetId, moved };
    });
  } catch (e) {
    const err = e as { message?: string; detail?: string };
    // Migration 002: rule refusals arrive as P0001 "merge_blocked: ...".
    if (err.message?.startsWith("merge_blocked:"))
      return {
        kind: "conflict",
        message: [err.message.slice("merge_blocked:".length).trim(), err.detail]
          .filter(Boolean)
          .join(" "),
      };
    throw e;
  }
}
