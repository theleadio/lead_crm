// Where the public pages' canonical and hreflang links point.
//
// §2 defines APP_BASE_URL as the CRM app's base, and the public site lives at
// thelead.io (PUBLIC_WEBSITE_URL). Which of the two is canonical once these
// pages are public is O60 and Shawn's to answer; until he does, this reads
// APP_BASE_URL and says so here rather than guessing.
//
// Read once, when the module first loads — which for the prerendered schedule
// pages is at BUILD time, not per request. A host with separate build and
// runtime environments (Netlify) must carry APP_BASE_URL in the build one, or
// the links come out relative with nothing to see at runtime: the messages
// below land in the build log and nowhere else.
//
// Its own module, not a function inside a layout, because both locales' root
// layouts read it and because it is worth a test of its own.

type Env = { APP_BASE_URL?: string; NODE_ENV?: string };

// Both spellings of the loopback host, and the wildcard a dev server prints.
// `hostname` keeps the brackets on an IPv6 literal, so both forms are listed.
const LOCAL_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "[::1]",
]);

export function siteUrl(env: Env = process.env): URL | null {
  const raw = env.APP_BASE_URL?.trim();
  if (!raw) return null;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    console.error(
      "APP_BASE_URL is not a URL (read in the build environment); canonical and hreflang will be relative",
    );
    return null;
  }

  // A loopback base in production points every canonical and hreflang link at
  // a machine no crawler can reach, and the pages still render, so nothing
  // else would ever report it. The URL is still returned: a wrong absolute
  // address is the deployment's to fix, and swallowing it would hide it.
  if (env.NODE_ENV === "production" && LOCAL_HOSTS.has(url.hostname))
    console.error(
      `APP_BASE_URL is a local address in production (${url.origin}); canonical and hreflang links point somewhere no crawler can reach`,
    );

  return url;
}
