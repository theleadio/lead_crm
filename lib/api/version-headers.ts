// The row version a write sends back (spec §7, v1.7). Screens send it twice:
// as If-Match, the standard header, and as X-Row-Version, because the live
// site (Netlify) drops If-Match before the request reaches the app (13 Nov
// 2026: every save there said "Reload … and try again"; localhost was fine).
// The server takes either (readIfMatch in lib/api/errors.ts). Safe to import
// from client components: nothing server-only here.
export const ROW_VERSION_HEADER = "X-Row-Version";

export function versionHeaders(version: number): Record<string, string> {
  return { "If-Match": String(version), [ROW_VERSION_HEADER]: String(version) };
}
