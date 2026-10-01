import { z } from "zod";
import type { Viewer } from "../auth/permissions.ts";
import { db, withTransaction } from "../sql.ts";
import { isUuid } from "./service.ts";

// DELETE /api/people/:id (soft delete, for test data and mistakes) and
// POST /api/people/:id/erase (PDPA anonymise) — spec §12.10. Both are
// database functions from migration 002; the API only checks the role and
// passes the signed-in user as `actor`. They write their own audit rows.

export const reasonSchema = z.object({
  reason: z.string().trim().min(1, "Give a reason"),
});

export type RemoveResult =
  | { kind: "done" }
  | { kind: "forbidden" }
  | { kind: "not_found" }
  | { kind: "conflict"; message: string };

async function callRemoval(
  fn: "soft_delete_person" | "erase_person",
  prefix: "delete_blocked:" | "erase_blocked:",
  id: string,
  reason: string,
  viewer: Viewer,
): Promise<RemoveResult> {
  if (viewer.role !== "super_admin") return { kind: "forbidden" };
  if (!isUuid(id)) return { kind: "not_found" };
  try {
    await withTransaction(async () => {
      const sql = db();
      await sql`SELECT ${sql(fn)}(${id}, ${viewer.id}, ${reason})`;
    });
    return { kind: "done" };
  } catch (e) {
    const message = (e as { message?: string }).message ?? "";
    if (!message.startsWith(prefix)) throw e;
    const text = message.slice(prefix.length).trim();
    return /not found/.test(text)
      ? { kind: "not_found" }
      : { kind: "conflict", message: text };
  }
}

export const deletePerson = (id: string, reason: string, viewer: Viewer) =>
  callRemoval("soft_delete_person", "delete_blocked:", id, reason, viewer);

export const erasePerson = (id: string, reason: string, viewer: Viewer) =>
  callRemoval("erase_person", "erase_blocked:", id, reason, viewer);
