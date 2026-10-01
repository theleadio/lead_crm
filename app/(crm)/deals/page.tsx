import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteDeal, permissionFor } from "@/lib/auth/permissions";
import { FUNDING_TYPES, PIPELINES } from "@/lib/deals/types";
import { DealsBoard, type BoardFilters } from "./deals-board";

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) =>
  (Array.isArray(v) ? v[0] : v)?.trim() ?? "";
// A hand-edited URL shouldn't turn into a 400 the Retry button can't fix.
const ifMatch = (v: string, re: RegExp) => (re.test(v) ? v : "");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

// Spec §9.5. Hiding drag and "Move to…" is UX only — the stage route
// re-checks (spec §6). Filters live in the URL (design decision 8).
export default async function DealsPage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const user = await getCurrentUser();
  if (!user || !permissionFor(user, "deal", "read").allowed)
    return (
      <div
        role="alert"
        className="border-line bg-surface-raised rounded-md border p-6 text-sm"
      >
        <p className="text-ink font-medium">
          You don&apos;t have access to deals. Ask a super admin if you need it.
        </p>
      </div>
    );

  const sp = await searchParams;
  const pipeline = one(sp.pipeline);
  const funding = one(sp.funding);
  const mine = one(sp.mine);
  const initial: BoardFilters = {
    pipeline: (PIPELINES as readonly string[]).includes(pipeline)
      ? (pipeline as BoardFilters["pipeline"])
      : "individual",
    owner: ifMatch(one(sp.owner), UUID),
    course: ifMatch(one(sp.course), UUID),
    funding: (FUNDING_TYPES as readonly string[]).includes(funding)
      ? funding
      : "",
    from: ifMatch(one(sp.from), DATE),
    to: ifMatch(one(sp.to), DATE),
    // "My deals" defaults on for sales when the URL doesn't say (§9.5).
    mine: mine ? mine === "1" : user.role === "sales",
    // Corporate only, off by default; ignored on the individual tab.
    incomplete: one(sp.incomplete) === "1" && pipeline === "corporate",
  };

  return <DealsBoard initial={initial} canWrite={canWriteDeal(user)} />;
}
