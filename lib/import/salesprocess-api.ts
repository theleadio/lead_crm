// SalesProcess (GoHighLevel) contacts API: every contact of the location, as
// the API returns them. Used by ghl:import --from-api and ghl:attribution.
// Needs SALESPROCESS_API_TOKEN and SALESPROCESS_LOCATION_ID.
export async function fetchContacts<T>(): Promise<T[]> {
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
  const all: T[] = [];
  let next: string | undefined =
    `https://services.leadconnectorhq.com/contacts/?locationId=${loc}&limit=100`;
  while (next) {
    let res: Response | undefined;
    for (let i = 0; i < 4; i++) {
      res = await fetch(next, { headers });
      if (res.status !== 429) break;
      await new Promise((r) => setTimeout(r, 3000));
    }
    const body = (await res!.json()) as {
      contacts?: T[];
      meta?: { nextPageUrl?: string };
      message?: string;
    };
    if (!res!.ok)
      throw new Error(
        `SalesProcess API ${res!.status}: ${body.message ?? "no body"}`,
      );
    all.push(...(body.contacts ?? []));
    next = body.meta?.nextPageUrl;
    await new Promise((r) => setTimeout(r, 120));
  }
  return all;
}
