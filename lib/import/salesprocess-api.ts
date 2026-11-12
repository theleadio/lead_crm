// SalesProcess (GoHighLevel) API reads, as the API returns them. Used by
// ghl:import --from-api, ghl:attribution, ghl:payments and ghl:enrolments.
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

// One order with its line items (the class date lives there). The response
// also carries the buyer's contact data: callers must not log or store it.
export async function fetchOrder<T>(orderId: string): Promise<T> {
  const { loc, headers } = config();
  return getPage<T>(
    `${BASE}/payments/orders/${orderId}?altId=${loc}&altType=location`,
    headers,
  );
}

// Every form of the location (12 Nov 2026: 38 forms). The API pages by
// `skip`, at most 50 a page.
export async function fetchForms<T>(): Promise<T[]> {
  const { loc, headers } = config();
  const all: T[] = [];
  for (let skip = 0; ; skip += 50) {
    const body = await getPage<{ forms?: T[] }>(
      `${BASE}/forms/?locationId=${loc}&limit=50&skip=${skip}`,
      headers,
    );
    const page = body.forms ?? [];
    all.push(...page);
    if (page.length < 50) return all;
  }
}

// Every submission of one form. Each also carries the submitter's name, email
// and answers: callers must not log or store them. Without startAt/endAt the
// API returns only about the last month (12 Nov: one form showed 0 by default
// and 1,340 over all time), so the range is always given.
export async function fetchFormSubmissions<T>(formId: string): Promise<T[]> {
  const { loc, headers } = config();
  const tomorrow = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
  const range = `startAt=2020-01-01&endAt=${tomorrow}`;
  const all: T[] = [];
  for (let page: number | null = 1; page;) {
    const body: { submissions?: T[]; meta?: { nextPage?: number | null } } =
      await getPage(
        `${BASE}/forms/submissions?locationId=${loc}&formId=${formId}&${range}&limit=100&page=${page}`,
        headers,
      );
    all.push(...(body.submissions ?? []));
    page = body.meta?.nextPage ?? null;
  }
  return all;
}
