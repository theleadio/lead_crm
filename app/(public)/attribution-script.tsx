"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import {
  FIRST_TOUCH_COOKIE,
  LAST_TOUCH_COOKIE,
  TOUCH_MAX_AGE_DAYS,
  nextTouches,
  serialiseTouch,
} from "./attribution";

// §10.2. Writes the two attribution cookies on every public page. Mounted in
// the (public) layout, so it runs before any form can be reached.
//
// The rules live in ./attribution.ts and are tested there; this file is only
// the browser half — reading and writing document.cookie, and nothing else.
// Every access is wrapped: a visitor with cookies blocked still gets the page
// and still gets to submit the form, just with no attribution (§10.2 treats
// attribution as informational, and §8.2 accepts a submission without it).

function readCookie(name: string): string | null {
  try {
    const hit = document.cookie
      .split("; ")
      .find((c) => c.startsWith(`${name}=`));
    return hit ? hit.slice(name.length + 1) : null;
  } catch {
    return null;
  }
}

function writeCookie(name: string, value: string) {
  try {
    // SameSite=Lax: these travel with ordinary top-level navigation from an
    // ad or an email, which is exactly how a campaign visitor arrives, and
    // never on a cross-site subrequest. Not HttpOnly — the form reads them to
    // put them in the submission, and they identify nobody, so a reader of
    // the cookie learns nothing about the visitor.
    const parts = [
      `${name}=${value}`,
      "Path=/",
      `Max-Age=${TOUCH_MAX_AGE_DAYS * 86400}`,
      "SameSite=Lax",
    ];
    if (location.protocol === "https:") parts.push("Secure");
    document.cookie = parts.join("; ");
  } catch {
    // Blocked storage. Nothing to fall back to, and nothing that should fail.
  }
}

export function AttributionScript() {
  // The cookies are rewritten on every navigation, so a campaign picked up
  // part-way through a visit is recorded too. usePathname re-runs on
  // navigation; useSearchParams is deliberately not used, because reading it
  // would opt /schedule out of static rendering, and a campaign link always
  // arrives as a fresh load where the query is read on mount anyway.
  const pathname = usePathname();
  // document.referrer belongs to the *document*, so across a Link navigation
  // it still holds the ad site's URL and never becomes one of our own. Read
  // on a soft move it makes that move look like a fresh arrival from outside
  // and erases the last touch — the exact failure the refreshLast rule in
  // ./attribution.ts exists to prevent. After the first run the referrer is
  // the page we just left, which we remember ourselves.
  const previous = useRef<string | null>(null);

  useEffect(() => {
    const { first, last } = nextTouches(
      readCookie(FIRST_TOUCH_COOKIE),
      location.href,
      previous.current ?? (document.referrer || null),
      new Date(),
      readCookie(LAST_TOUCH_COOKIE),
    );
    previous.current = location.href;
    if (first) writeCookie(FIRST_TOUCH_COOKIE, serialiseTouch(first));
    if (last) writeCookie(LAST_TOUCH_COOKIE, serialiseTouch(last));
  }, [pathname]);

  return null;
}
