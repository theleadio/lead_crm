"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
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
  // An in-app move between public pages is an arrival too, so the last touch
  // refreshes on it. usePathname re-runs on navigation; useSearchParams is
  // deliberately not used, because reading it would opt /schedule out of
  // static rendering, and a campaign link always arrives as a fresh load
  // where the query is read on mount anyway.
  const pathname = usePathname();

  useEffect(() => {
    const { first, last } = nextTouches(
      readCookie(FIRST_TOUCH_COOKIE),
      location.href,
      document.referrer || null,
      new Date(),
      readCookie(LAST_TOUCH_COOKIE),
    );
    if (first) writeCookie(FIRST_TOUCH_COOKIE, serialiseTouch(first));
    if (last) writeCookie(LAST_TOUCH_COOKIE, serialiseTouch(last));
  }, [pathname]);

  return null;
}
