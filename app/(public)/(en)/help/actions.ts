"use server";

import { headers } from "next/headers";
import { requestIp } from "../../../../lib/public/guard.ts";
import {
  helpFormSchema,
  isHelpFormConfigured,
  submitHelpForm,
} from "../../../../lib/public/help.ts";

// The /help page's form. A Server Action is a public POST endpoint, so it
// goes through the same checks as POST /api/public/help: validation, rate
// limits and (once chosen) the CAPTCHA, all in submitHelpForm.

export type HelpState = {
  reference?: string;
  error?: string;
  fields?: Record<string, string>;
  // What was typed, so a form with a mistake comes back filled in (React
  // resets a form after its action runs).
  values?: Record<string, string>;
};

const KEPT = [
  "category",
  "fullName",
  "email",
  "phone",
  "message",
  "preferredLanguage",
];

export async function submitHelpAction(
  _prev: HelpState,
  form: FormData,
): Promise<HelpState> {
  const env = process.env as Record<string, string | undefined>;
  const raw = Object.fromEntries(form);
  const values = Object.fromEntries(
    KEPT.map((k) => [
      k,
      typeof raw[k] === "string" ? String(raw[k]).slice(0, 5000) : "",
    ]),
  );
  if (!isHelpFormConfigured(env))
    return {
      error:
        "The help form isn't available right now. Please email us instead.",
      values,
    };
  const parsed = helpFormSchema.safeParse(raw);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const i of parsed.error.issues) {
      const k = i.path.join(".");
      if (k && !fields[k]) fields[k] = i.message;
    }
    // The schema checks "email or phone" only once every field is valid; say
    // it now too, so all mistakes show at once.
    if (!values.email.trim() && !values.phone.trim() && !fields.email)
      fields.email = "Enter an email or a phone number";
    return { error: "Please check the highlighted fields.", fields, values };
  }
  try {
    const r = await submitHelpForm(parsed.data, {
      ip: requestIp(await headers()),
      env,
    });
    switch (r.kind) {
      case "created":
        return { reference: r.reference };
      case "rate_limited":
        return {
          error: "Too many requests. Please try again in a while.",
          values,
        };
      case "captcha_failed":
        return { error: "Please complete the check and try again.", values };
      case "unknown_category":
        return {
          error: "Please choose a topic.",
          fields: { category: "Choose a topic" },
          values,
        };
    }
  } catch (e) {
    console.error(
      "help form failed:",
      e instanceof Error ? e.message : String(e),
    );
    return {
      error: "Something went wrong. Please try again, or email us.",
      values,
    };
  }
}
