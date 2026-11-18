// SalesProcess (GoHighLevel) opportunities -> CRM deals (cutover plan WP4).
// Rules: lib/import/ghl-opportunities.ts. Run after ghl:import (contacts):
// an opportunity whose contact isn't imported yet is skipped until next run.
//
//   npm run ghl:opportunities                dry run: counts, rolled back
//   npm run ghl:opportunities -- --apply     write
//
// Needs DATABASE_URL, SALESPROCESS_API_TOKEN and SALESPROCESS_LOCATION_ID,
// and migration 017. Prints counts only: Actions logs can be public.
//
// --apply refuses when under half of the opportunities find their contact
// in this database: it is probably the wrong one, or ghl:import hasn't run.
import {
  importOpportunities,
  type GhlOpportunity,
  type GhlPipeline,
  type GhlUser,
} from "../lib/import/ghl-opportunities.ts";
import {
  fetchOpportunities,
  fetchPipelines,
  fetchUsers,
} from "../lib/import/salesprocess-api.ts";
import { closeDb, withTransaction } from "../lib/sql.ts";

const apply = process.argv.includes("--apply");
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL must be set");
  process.exit(1);
}

const input = {
  opportunities: await fetchOpportunities<GhlOpportunity>(),
  pipelines: await fetchPipelines<GhlPipeline>(),
  users: await fetchUsers<GhlUser>(),
};
let stats: Record<string, number> = {};
try {
  await withTransaction(async () => {
    stats = await importOpportunities(input);
    const missing = stats["skip: contact not imported yet"] ?? 0;
    if (apply && missing * 2 > input.opportunities.length)
      throw new Error(
        `${missing} of ${input.opportunities.length} opportunities have no imported contact: wrong database, or run ghl:import first`,
      );
    if (!apply) throw new Error("dry-run");
  });
} catch (err) {
  if (!(err instanceof Error && err.message === "dry-run")) {
    console.error(
      `ghl opportunities: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exitCode = 1;
  }
} finally {
  await closeDb();
}
console.log(
  `ghl opportunities: ${process.exitCode ? "refused, rolled back" : apply ? "applied" : "dry run (rolled back)"} ${input.opportunities.length} opportunities ${JSON.stringify(stats)}`,
);
