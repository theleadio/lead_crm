import type { Pipeline } from "./types";

// The board's filter state (§9.5). Lives here, not in the client component,
// so the page can run the same query on the server as the client does.
export type BoardFilters = {
  pipeline: Pipeline;
  owner: string;
  course: string;
  funding: string;
  from: string;
  to: string;
  mine: boolean;
  // Corporate only: deals that can't leave discovery yet (§12.5).
  incomplete: boolean;
};

// One request per column (design decision 2).
export const PER_COLUMN = 50;

// Spec §7 filter[...] shape, shared by the client's fetch and the server's
// first render so both ask for exactly the same deals.
export function boardParams(
  f: BoardFilters,
  extra: Record<string, string>,
): URLSearchParams {
  const p = new URLSearchParams({ "filter[pipeline]": f.pipeline, ...extra });
  if (f.owner) p.set("filter[owner]", f.owner);
  if (f.course) p.set("filter[course]", f.course);
  if (f.funding) p.set("filter[funding]", f.funding);
  if (f.from) p.set("filter[createdFrom]", f.from);
  if (f.to) p.set("filter[createdTo]", f.to);
  if (f.mine) p.set("filter[mine]", "true");
  if (f.incomplete) p.set("filter[incomplete]", "true");
  return p;
}
