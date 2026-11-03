"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  FIRST_TOUCH_COOKIE,
  LAST_TOUCH_COOKIE,
  attributionPayload,
  parseTouch,
} from "../attribution";
import { handleRegister } from "../../../lib/public/handlers.ts";
import { isHoneypotFilled, type EnquiryState } from "../enquiry/form-contract";
import { buildRequest, fieldWording, wording } from "../enquiry/lead-request";
import { isLocale, localePath, type Locale } from "../locale";

// §10.4's submit path, built the way §10.3's is (app/(public)/enquiry/
// submit.ts): the request is handed to the §8.3 handler in process, so the
// API key never reaches a browser and every check runs unchanged.
//
// What differs from the enquiry: the class code is required, and the answer
// decides where the visitor goes. A card payment redirects to Stripe; an HRDC
// registration comes back as the form's `success` state, which the page
// renders as the HRDC wording.

// §10.3's form name convention, with the page that produced it named, so Ops
// can tell a registration's touchpoint from an enquiry's.
const FORM_NAME = "website_register";

const str = (f: FormData, k: string): string | null => {
  const v = f.get(k);
  return typeof v === "string" && v.trim() ? v.trim() : null;
};
const bool = (f: FormData, k: string): boolean => f.get(k) === "on";

const formLocale = (f: FormData): Locale => {
  const v = f.get("locale");
  return typeof v === "string" && isLocale(v) ? v : "en";
};

export async function submitRegistration(
  _prev: EnquiryState,
  form: FormData,
): Promise<EnquiryState> {
  const locale = formLocale(form);

  // The honeypot first, refused like a failed check so a bot learns nothing.
  if (isHoneypotFilled(form))
    return {
      status: "error",
      message: wording("captcha_failed", locale),
      fields: {},
    };

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
    preferredLanguage: str(form, "preferredLanguage") ?? locale,
    // Required by §8.3. The page renders it as a hidden field from the URL,
    // so an empty one means the form was tampered with, not mistyped.
    classCode: str(form, "classCode"),
    message: str(form, "message"),
    consentMarketing: bool(form, "consentMarketing"),
    hrdcIntended: bool(form, "hrdcIntended"),
    // Only for the return addresses (§8.3, accepted 26 Oct). Nothing stored.
    locale,
    attribution: attributionPayload(first, last),
    captchaToken: str(form, "captchaToken"),
  };

  const response = await handleRegister(
    buildRequest(payload, await headers(), process.env, "/register"),
  );

  const body = (await response.json().catch(() => null)) as {
    ok?: boolean;
    next?: "checkout" | "hrdc_contact";
    checkoutUrl?: string;
    error?: { code?: string; fields?: Record<string, string> };
  } | null;

  if (response.ok && body?.next === "checkout" && body.checkoutUrl) {
    // Outside this app, so Next cannot route it: `redirect` sends the browser
    // itself, which also means the flow works with JavaScript off. It throws,
    // so nothing below runs and no state is returned.
    redirect(body.checkoutUrl);
  }
  if (response.ok && body?.next === "hrdc_contact")
    // §10.4 step 4: no payment page, no price to pay, and nothing from the
    // answer displayed. A page of its own rather than a state inside the
    // form, because the language control is a full navigation (§10.5): a
    // visitor who switched language after registering lost the answer, was
    // shown the empty form again, and the remount handed them a fresh
    // idempotency key — so a second registration was one submit away.
    redirect(localePath(locale, "/register/thank-you?hrdc=1"));

  const code = body?.error?.code ?? "server_error";
  if (code !== "validation_failed")
    console.error("registration refused", response.status, code);
  return {
    status: "error",
    message: wording(code, locale),
    fields: fieldWording(body?.error?.fields ?? {}, locale),
  };
}
