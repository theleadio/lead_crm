import type { Env } from "./guard.ts";
import type { ScheduleClass } from "./schedule.ts";

// The website's read of GET /api/public/schedule (§8.1) for the 10.1 page.
// The page fetches the route rather than calling listPublicSchedule(), so the
// schedule it renders goes through the same gate, validation and field
// allow-list the real website hits (§3 layering, §1 rule 2).
//
// The key is read here and nowhere else: this module is server-only, so
// PUBLIC_API_KEY never reaches a client component or the browser.

export type ScheduleRead =
  | {
      kind: "fresh" | "stale";
      classes: ScheduleClass[];
      generatedAt: string;
      fetchedAt: string;
    }
  // Nothing has ever been read in this process, so there is no schedule to
  // show — §13 error state with a retry, never an empty schedule (§10.1).
  | { kind: "unavailable" };

type Snapshot = {
  classes: ScheduleClass[];
  generatedAt: string;
  fetchedAt: string;
};

// shortcut: the last good feed lives in this process only, so a cold start
// during a feed outage shows the error state instead of a stale schedule.
// Upgrade to shared storage when the site runs on more than one long-lived
// instance — not the database, which is what a feed outage usually means.
let lastGood: Snapshot | null = null;

// Test seam: the snapshot would otherwise leak between tests in one process.
export function resetScheduleCache() {
  lastGood = null;
}

function stale(): ScheduleRead {
  return lastGood ? { kind: "stale", ...lastGood } : { kind: "unavailable" };
}

export async function readSchedule(
  env: Env = process.env,
): Promise<ScheduleRead> {
  const base = (env.APP_BASE_URL ?? "").trim().replace(/\/+$/, "");
  // Not a feed failure: the deployment is wrong, and falling back would hide
  // it on every page view.
  if (!base) throw new Error("APP_BASE_URL is not set");

  const key = (env.PUBLIC_API_KEY ?? "").split(",")[0]?.trim() ?? "";
  // §8.1 closes the route below 16 characters, so the read would 503. Say so
  // once per attempt: the page still renders, and the log names the cause.
  if (key.length < 16)
    console.error("public schedule: PUBLIC_API_KEY is unset or too short");

  try {
    const res = await fetch(`${base}/api/public/schedule`, {
      headers: { "X-Api-Key": key },
      // The app-side half of §8.1's five minutes. Tagged so one call can purge
      // it when the host's purge path is decided (O38).
      next: { revalidate: 300, tags: ["public-schedule"] },
    });
    if (!res.ok) {
      console.error("public schedule: feed answered", res.status);
      return stale();
    }
    const body = (await res.json()) as {
      generatedAt: string;
      classes: ScheduleClass[];
    };
    lastGood = {
      classes: body.classes,
      generatedAt: body.generatedAt,
      fetchedAt: new Date().toISOString(),
    };
    return { kind: "fresh", ...lastGood };
  } catch (err) {
    console.error("public schedule: feed unreachable", (err as Error).message);
    return stale();
  }
}
