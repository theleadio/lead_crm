// SalesProcess (GoHighLevel) API reads, as the API returns them. Used by
// ghl:import --from-api, ghl:attribution and ghl:payments.
// Needs SALESPROCESS_API_TOKEN and SALESPROCESS_LOCATION_ID.
const BASE = "https://services.leadconnectorhq.com";

function config() {
  const token = process.env.SALESPROCESS_API_TOKEN;
  const loc = process.env.SALESPROCESS_LOCATION_ID;
  if (!token || !loc)
    throw new Error(
      "SALESPROCESS_API_TOKEN and SALESPROCESS_LOCATION_ID must be set",
    );
  const headers = {
    Authorization: `Bearer ${token}`,
    Version: "2021-07-28",
    Accept: "application/json",
  };
  return { loc, headers };
}

// One page, retried on 429 (the API's rate limit), then a short pause.
async function getPage<B>(
  url: string,
  headers: Record<string, string>,
): Promise<B> {
  let res: Response | undefined;
  for (let i = 0; i < 4; i++) {
    res = await fetch(url, { headers });
    if (res.status !== 429) break;
    await new Promise((r) => setTimeout(r, 3000));
  }
  const body = (await res!.json()) as B & { message?: string };
  if (!res!.ok)
    throw new Error(
      `SalesProcess API ${res!.status}: ${body.message ?? "no body"}`,
    );
  await new Promise((r) => setTimeout(r, 120));
  return body;
}

// Every contact of the location.
export async function fetchContacts<T>(): Promise<T[]> {
  const { loc, headers } = config();
  const all: T[] = [];
  let next: string | undefined =
    `${BASE}/contacts/?locationId=${loc}&limit=100`;
  while (next) {
    const body: { contacts?: T[]; meta?: { nextPageUrl?: string } } =
      await getPage(next, headers);
    all.push(...(body.contacts ?? []));
    next = body.meta?.nextPageUrl;
  }
  return all;
}

// Every payment transaction of the location, test and live.
export async function fetchTransactions<T>(): Promise<T[]> {
  const { loc, headers } = config();
  const all: T[] = [];
  for (let offset = 0; ; offset += 100) {
    const body = await getPage<{ data?: T[] }>(
      `${BASE}/payments/transactions?altId=${loc}&altType=location&limit=100&offset=${offset}`,
      headers,
    );
    const page = body.data ?? [];
    all.push(...page);
    if (page.length < 100) return all;
  }
}
