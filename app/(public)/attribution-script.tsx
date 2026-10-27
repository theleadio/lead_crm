"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import {
  FIRST_TOUCH_COOKIE,
  LAST_TOUCH_COOKIE,
  nextTouches,
  serialiseTouch,
  touchCookie,
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
    // The line itself, and the reasoning behind its attributes, is in
    // ./attribution.ts where a test can reach it. Secure is asked for only
    // where the page is https: a browser drops a Secure cookie on the plain
    // http dev server, which would cost attribution in development alone.
    document.cookie = touchCookie(name, value, location.protocol === "https:");
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
  // the page we just left, which we remember ourselves — unless it is this
  // same page, which is Strict Mode running the effect twice on one mount and
  // not a move at all.
  const previous = useRef<string | null>(null);

  useEffect(() => {
    const moved =
      previous.current !== null && previous.current !== location.href;
    const { first, last } = nextTouches(
      readCookie(FIRST_TOUCH_COOKIE),
      location.href,
      moved ? previous.current : document.referrer || null,
      new Date(),
      readCookie(LAST_TOUCH_COOKIE),
    );
    previous.current = location.href;
    if (first) writeCookie(FIRST_TOUCH_COOKIE, serialiseTouch(first));
    if (last) writeCookie(LAST_TOUCH_COOKIE, serialiseTouch(last));
  }, [pathname]);

  return null;
}
