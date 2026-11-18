import { versionHeaders } from "@/lib/api/version-headers";

// One fetch for every Settings tab. Edits of an existing record pass the
// version they loaded: it goes out as both If-Match and X-Row-Version
// (versionHeaders), because the live site drops If-Match (#77).
export type SaveResult =
  | { ok: true; body: unknown }
  | {
      ok: false;
      code: string;
      message: string;
      error?: Record<string, unknown>;
    };

export async function save(
  url: string,
  method: "POST" | "PATCH",
  body: unknown,
  version?: number,
): Promise<SaveResult> {
  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(version === undefined ? {} : versionHeaders(version)),
    },
    body: JSON.stringify(body),
  }).catch(() => null);
  if (!res)
    return {
      ok: false,
      code: "network",
      message: "Couldn't reach the server. Check your connection and try again.",
    };
  const json = await res.json().catch(() => null);
  if (res.ok) return { ok: true, body: json };
  return {
    ok: false,
    code: json?.error?.code ?? "unknown",
    message: json?.error?.message ?? "Not saved. Try again.",
    error: json?.error,
  };
}
