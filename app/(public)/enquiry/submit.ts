"use server";

import { cookies, headers } from "next/headers";
import {
  FIRST_TOUCH_COOKIE,
  LAST_TOUCH_COOKIE,
  attributionPayload,
  parseTouch,
} from "../attribution";
import { handleLead } from "../../../lib/public/handlers.ts";
import { redirect } from "next/navigation";
import { isLocale, localePath, type Locale } from "../locale";
import { isHoneypotFilled, type EnquiryState } from "./form-contract";
import { FORM_NAME, buildRequest, fieldWording, wording } from "./lead-request";

// §10.3. The enquiry form's submit path.
//
// §8.2's POST /api/public/leads is the one way a lead is captured, and it
// demands X-Api-Key — a value the marketing site's browsers hold. Ours must
// not: this app also serves the CRM, and a key in our page would be a key in
// a page we cannot rotate independently. So the action builds the request in
// process and hands it to the same handler the route calls, the way the
// §10.1 page reads the schedule in process rather than fetching itself.
//
// Every §8.2 check therefore runs unchanged and none can be skipped: origin,
// key, both rate limits, CAPTCHA, idempotency, duplicate matching, consent
// and attribution. Nothing under lib/public/ is touched by this change.
//
// A "use server" module may export only async functions, so the pieces the
// page and the tests need live in ./form-contract.ts and ./lead-request.ts.

const str = (f: FormData, k: string): string | null => {
  const v = f.get(k);
  return typeof v === "string" && v.trim() ? v.trim() : null;
};
const bool = (f: FormData, k: string): boolean => f.get(k) === "on";

// Which language to answer in (§13). The form sends it as a hidden field; it
// decides wording and nothing else, so an edited or absent value costs a
// visitor the right language and cannot affect what is captured. It is never
// part of the §8.2 payload (website-lead-capture).
const formLocale = (f: FormData): Locale => {
  const v = f.get("locale");
  return typeof v === "string" && isLocale(v) ? v : "en";
};

export async function submitEnquiry(
  _prev: EnquiryState,
  form: FormData,
): Promise<EnquiryState> {
  // The honeypot, before anything else happens. A filled one is refused the
  // same way a failed check is, so a bot learns nothing from the difference,
  // and no lead is created.
  const locale = formLocale(form);

  if (isHoneypotFilled(form))
    return {
      status: "error",
      message: wording("captcha_failed", locale),
      fields: {},
    };

  // The two cookies ride along with the action's own POST, so they are read
  // here rather than in the browser: the values never enter the DOM, and the
  // form needs no code to parse them. An unreadable one reads as absent.
  const jar = await cookies();
  const first = parseTouch(jar.get(FIRST_TOUCH_COOKIE)?.value);
  const last = parseTouch(jar.get(LAST_TOUCH_COOKIE)?.value);

  const payload = {
    idempotencyKey: str(form, "idempotencyKey"),
    formName: FORM_NAME,
    fullName: str(form, "fullName") ?? "",
    email: str(form, "email"),
    phone: str(form, "phone"),
    companyName: str(form, "companyName"),
    jobTitle: str(form, "jobTitle"),
    preferredLanguage: str(form, "preferredLanguage") ?? "en",
    courseInterest: str(form, "courseInterest"),
    classCode: str(form, "classCode"),
    message: str(form, "message"),
    consentMarketing: bool(form, "consentMarketing"),
    hrdcIntended: bool(form, "hrdcIntended"),
    attribution: attributionPayload(first, last),
    captchaToken: str(form, "captchaToken"),
  };

  const response = await handleLead(buildRequest(payload, await headers()));

  if (response.ok)
    // A page of its own rather than a state inside the form, for the same
    // reason §10.4's HRDC answer is one: the language control is a full
    // navigation (§10.5), so an answer held in component state was gone the
    // moment a visitor switched language — they were shown the empty form
    // again, and the remount handed them a fresh idempotency key, putting a
    // second identical lead one submit away.
    //
    // §8.2 answers with a personId and a dealId. Neither goes into the URL or
    // the page: a visitor has no use for them, and §13 says the thank-you
    // names the next step, not an identifier.
    redirect(localePath(locale, "/enquiry/thank-you"));

  const body = (await response.json().catch(() => null)) as {
    error?: { code?: string; fields?: Record<string, string> };
  } | null;
  const code = body?.error?.code ?? "server_error";
  // A visitor's own mistake is not worth a log line; anything else is, since
  // nobody else will notice a misconfigured key.
  if (code !== "validation_failed")
    console.error("enquiry submission refused", response.status, code);
  return {
    status: "error",
    message: wording(code, locale),
    // §8.2's field names, never its messages: those are written for an API
    // caller and are English whatever the visitor is reading.
    fields: fieldWording(body?.error?.fields ?? {}, locale),
  };
}
