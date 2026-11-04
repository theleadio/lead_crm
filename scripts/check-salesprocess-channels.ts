// Read-only count of SalesProcess (GoHighLevel) conversations per channel,
// to see which channels LEAD really uses (WhatsApp, Facebook Messenger,
// Instagram, email, SMS...) before building the new inbox. Writes nothing.
//
//   node --env-file=.env.local scripts/check-salesprocess-channels.ts
//   (CI: .github/workflows/data-check.yml, started by hand)
//
// Needs SALESPROCESS_API_TOKEN and SALESPROCESS_LOCATION_ID, and the token
// needs the conversations read scope; without it the API answers 401/403 and
// this says so. Actions logs are public: counts and field names only.
//
// Not verified against HighLevel's official docs (they could not be reached
// when this was written). It assumes GET /conversations/search?locationId=
// returns { conversations: [...], total }. It does not filter by type: it
// counts whatever `type` and `lastMessageType` values come back, and prints
// the field names of the first conversation so the shape can be checked.
// Paging uses startAfterDate from the last row's `sort` value; if that is
// missing it stops and says how many it read, so a partial count is visible.
const BASE = "https://services.leadconnectorhq.com";
const token = process.env.SALESPROCESS_API_TOKEN;
const loc = process.env.SALESPROCESS_LOCATION_ID;
if (!token || !loc) {
  console.error(
    "SALESPROCESS_API_TOKEN and SALESPROCESS_LOCATION_ID must be set",
  );
  process.exit(1);
}
const headers = {
  Authorization: `Bearer ${token}`,
  Version: "2021-04-15",
  Accept: "application/json",
};

type Conversation = {
  type?: string;
  lastMessageType?: string;
  lastMessageDate?: number;
  sort?: (number | string)[];
};

const MAX_PAGES = 500; // 50,000 conversations
const byType = new Map<string, number>();
const byLast = new Map<string, number>();
const bump = (m: Map<string, number>, k: string | undefined) =>
  m.set(k ?? "(none)", (m.get(k ?? "(none)") ?? 0) + 1);

let total: number | undefined;
let seen = 0;
let pages = 0;
let after: string | number | undefined;
let stopped = "read every page";
for (;;) {
  const url = new URL(`${BASE}/conversations/search`);
  url.searchParams.set("locationId", loc);
  url.searchParams.set("limit", "100");
  if (after !== undefined)
    url.searchParams.set("startAfterDate", String(after));
  let res: Response | undefined;
  for (let i = 0; i < 4; i++) {
    res = await fetch(url, { headers });
    if (res.status !== 429) break;
    await new Promise((r) => setTimeout(r, 3000));
  }
  const body = (await res!.json()) as {
    conversations?: Conversation[];
    total?: number;
    message?: string;
  };
  if (!res!.ok) {
    console.error(
      `SalesProcess API ${res!.status}: ${body.message ?? "no body"}` +
        (res!.status === 401 || res!.status === 403
          ? " (the token may lack the conversations read scope)"
          : ""),
    );
    process.exit(1);
  }
  const rows = body.conversations ?? [];
  if (pages === 0) {
    total = body.total;
    console.log(`Response fields: ${Object.keys(body).join(", ")}`);
    if (rows[0])
      console.log(`Conversation fields: ${Object.keys(rows[0]).join(", ")}`);
  }
  pages++;
  for (const c of rows) {
    seen++;
    bump(byType, c.type);
    bump(byLast, c.lastMessageType);
  }
  if (rows.length < 100) break;
  const next =
    rows[rows.length - 1].sort?.[0] ?? rows[rows.length - 1].lastMessageDate;
  if (next === undefined || next === after) {
    stopped = "stopped early: no paging value on the last row";
    break;
  }
  if (pages >= MAX_PAGES) {
    stopped = `stopped early: hit ${MAX_PAGES} pages`;
    break;
  }
  after = next;
  await new Promise((r) => setTimeout(r, 120));
}

const table = (m: Map<string, number>) =>
  Object.fromEntries([...m].sort((a, b) => b[1] - a[1]));
console.log(
  `Conversations read: ${seen} in ${pages} page(s); API total: ${total ?? "not given"}; ${stopped}`,
);
console.log("By conversation type:");
console.table(table(byType));
console.log("By last message type:");
console.table(table(byLast));

export {};
