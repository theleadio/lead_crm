"use client";

import Script from "next/script";
import { useActionState, useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Dict } from "../dictionaries";
import type { Locale } from "../locale";
import {
  EMPTY_STATE,
  HONEYPOT_FIELD,
  newIdempotencyKey,
} from "./form-contract";
import { submitEnquiry } from "./submit";

// As much of Turnstile's global as we use.
declare global {
  interface Window {
    turnstile?: { reset: (el?: string | HTMLElement) => void };
  }
}

// §10.3's form. Fields are controlled so a failed submission keeps every
// value the visitor typed (§13) — React resets an uncontrolled form once its
// action settles, which would make a retry mean retyping it all.
//
// Every word comes from the dictionary the server page read and handed down,
// so only the active locale's strings reach the browser and this client
// module imports no dictionary of its own (§10.5, website-localisation).

const FIELD =
  "border-line-strong bg-surface-sunken text-ink focus-visible:outline-focus-ring w-full rounded-sm border px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2";

type Values = {
  fullName: string;
  email: string;
  phone: string;
  companyName: string;
  jobTitle: string;
  preferredLanguage: string;
  message: string;
};

// The page's locale is the preferred language's default: a visitor who chose
// the Chinese site most likely wants Chinese follow-up (website-lead-capture,
// proposal L4). It stays a field, so their own choice is what is submitted.
const blank = (locale: Locale): Values => ({
  fullName: "",
  email: "",
  phone: "",
  companyName: "",
  jobTitle: "",
  preferredLanguage: locale,
  message: "",
});

export function EnquiryForm({
  classCode,
  courseCode,
  privacyUrl,
  locale,
  t,
}: {
  classCode: string | null;
  courseCode: string | null;
  privacyUrl: string | null;
  locale: Locale;
  t: Dict;
}) {
  const [state, formAction, pending] = useActionState(
    submitEnquiry,
    EMPTY_STATE,
  );
  const [values, setValues] = useState<Values>(() => blank(locale));
  // Email-or-phone, checked before the action is dispatched (§10.3). The
  // server checks it too — this only saves a round trip.
  const [localError, setLocalError] = useState<string | null>(null);
  // §8.2 step 8: one key for this form instance, so a retry after a timeout
  // returns the first result instead of creating a second lead. State with a
  // lazy initialiser rather than a ref, because it is read while rendering
  // the hidden field below.
  const [idempotencyKey] = useState(newIdempotencyKey);
  const ids = useId();
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

  // A token is spent by the §8.2 check, and the widget does not remount when
  // the action returns. Without this reset, any refusal after that check —
  // the per-phone limit, a 500 — leaves the spent token in the form and every
  // retry comes back captcha_failed until the visitor reloads the page.
  useEffect(() => {
    if (state.status === "error") window.turnstile?.reset();
  }, [state]);

  const set = (k: keyof Values) => (e: { target: { value: string } }) =>
    setValues((v) => ({ ...v, [k]: e.target.value }));

  const fieldError = (name: string): string | null =>
    (name === "email" ? localError : null) ?? state.fields[name] ?? null;

  if (state.status === "success")
    return (
      // §13: the form is replaced by what happens next, and never by the
      // personId or dealId §8.2 answered with.
      <div
        role="status"
        className="border-line bg-surface-raised rounded-2xl border p-6"
      >
        <h2 className="text-ink text-lg font-semibold">
          {t["form.thankYou.heading"]}
        </h2>
        <p className="text-ink-muted mt-2 text-sm">{t["form.thankYou.body"]}</p>
      </div>
    );

  // Keyed by field name, not by the message: two fields may now share a
  // sentence, and React needs the keys to stay distinct.
  const errors = Object.entries(state.fields);
  const showSummary = state.status === "error" && state.message;

  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (!values.email.trim() && !values.phone.trim()) {
          e.preventDefault();
          setLocalError(t["form.contactRequired"]);
          return;
        }
        setLocalError(null);
      }}
      noValidate
      className="space-y-5"
    >
      {/* §14: a failure is announced, not only shown. */}
      <div aria-live="polite">
        {showSummary && (
          <div className="border-danger bg-danger-soft text-danger rounded-md border px-4 py-3 text-sm">
            <p>{state.message}</p>
            {errors.length > 0 && (
              <ul className="mt-1 list-disc ps-5">
                {errors.map(([name, m]) => (
                  <li key={name}>{m}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <Field
        id={`${ids}-fullName`}
        label={t["form.fullName"]}
        required
        requiredLabel={t["form.required"]}
        error={fieldError("fullName")}
      >
        {(p) => (
          <Input
            {...p}
            name="fullName"
            value={values.fullName}
            onChange={set("fullName")}
            autoComplete="name"
          />
        )}
      </Field>

      <Field
        id={`${ids}-email`}
        label={t["form.email"]}
        hint={t["form.email.hint"]}
        error={fieldError("email")}
      >
        {(p) => (
          <Input
            {...p}
            name="email"
            type="email"
            value={values.email}
            onChange={set("email")}
            autoComplete="email"
          />
        )}
      </Field>

      <Field
        id={`${ids}-phone`}
        label={t["form.phone"]}
        hint={t["form.phone.hint"]}
        error={fieldError("phone")}
      >
        {(p) => (
          <Input
            {...p}
            name="phone"
            type="tel"
            inputMode="tel"
            value={values.phone}
            onChange={set("phone")}
            autoComplete="tel"
          />
        )}
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          id={`${ids}-companyName`}
          label={t["form.company"]}
          error={fieldError("companyName")}
        >
          {(p) => (
            <Input
              {...p}
              name="companyName"
              value={values.companyName}
              onChange={set("companyName")}
              autoComplete="organization"
            />
          )}
        </Field>
        <Field
          id={`${ids}-jobTitle`}
          label={t["form.jobTitle"]}
          error={fieldError("jobTitle")}
        >
          {(p) => (
            <Input
              {...p}
              name="jobTitle"
              value={values.jobTitle}
              onChange={set("jobTitle")}
              autoComplete="organization-title"
            />
          )}
        </Field>
      </div>

      <Field
        id={`${ids}-preferredLanguage`}
        label={t["form.preferredLanguage"]}
        error={fieldError("preferredLanguage")}
      >
        {(p) => (
          <select
            {...p}
            name="preferredLanguage"
            value={values.preferredLanguage}
            onChange={set("preferredLanguage")}
            className={FIELD}
          >
            <option value="en">English</option>
            <option value="zh">中文</option>
          </select>
        )}
      </Field>

      <Field
        id={`${ids}-message`}
        label={t["form.message"]}
        error={fieldError("message")}
      >
        {(p) => (
          <textarea
            {...p}
            name="message"
            rows={4}
            value={values.message}
            onChange={set("message")}
            className={FIELD}
          />
        )}
      </Field>

      <label className="text-ink flex items-start gap-3 text-sm">
        <input type="checkbox" name="hrdcIntended" className="mt-0.5" />
        <span>{t["form.hrdc"]}</span>
      </label>

      {/* §10.3: unticked by default, never a condition of submitting, and
          never pre-ticked or implied. */}
      <label className="text-ink flex items-start gap-3 text-sm">
        <input type="checkbox" name="consentMarketing" className="mt-0.5" />
        <span>{t["form.consent"]}</span>
      </label>

      {/* What the visitor is asking about, from the link that opened the form
          (§10.3). A code is only ever a reference: §8.2 resolves it, and an
          unknown one is ignored rather than trusted. */}
      {classCode && <input type="hidden" name="classCode" value={classCode} />}
      {courseCode && (
        <input type="hidden" name="courseInterest" value={courseCode} />
      )}
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      {/* So the action can refuse in the language the visitor is reading
          (§13). Read for its wording only: it is never part of the §8.2
          payload, so both locales send the same body
          (website-lead-capture). */}
      <input type="hidden" name="locale" value={locale} />

      {/* The honeypot. Positioned off-screen rather than display:none, which
          some bots check for, out of the tab order and hidden from screen
          readers so a visitor using one never meets it. */}
      <div
        aria-hidden="true"
        className="absolute -left-[9999px] w-px overflow-hidden"
      >
        <label htmlFor={`${ids}-hp`}>{t["form.honeypot"]}</label>
        <input
          id={`${ids}-hp`}
          name={HONEYPOT_FIELD}
          type="text"
          tabIndex={-1}
          autoComplete="off"
        />
      </div>

      {/* O39 has not delivered the keys yet. With no site key no widget is
          rendered and no token is sent, and §8.2 refuses the submission
          unless PUBLIC_CAPTCHA_DISABLED=true outside production. */}
      {siteKey && (
        <>
          <Script
            src="https://challenges.cloudflare.com/turnstile/v0/api.js"
            strategy="afterInteractive"
          />
          <div
            className="cf-turnstile"
            data-sitekey={siteKey}
            data-response-field-name="captchaToken"
          />
        </>
      )}

      <div className="flex flex-wrap items-center gap-4 pt-1">
        <Button type="submit" disabled={pending}>
          {pending ? t["form.submitting"] : t["form.submit"]}
        </Button>
        {privacyUrl && (
          <a
            href={privacyUrl}
            className="text-ink-muted hover:text-ink text-sm underline underline-offset-4"
          >
            {t["form.privacy"]}
          </a>
        )}
      </div>
    </form>
  );
}

// One field, one label, one error, associated properly. The error is text as
// well as a red border, so it is never colour alone (§14), and
// aria-describedby ties it to the control for a screen reader.
function Field({
  id,
  label,
  hint,
  required,
  requiredLabel,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  required?: boolean;
  // The locale's word for it, so the marker is not English beside Chinese.
  requiredLabel?: string;
  error: string | null;
  children: (props: {
    id: string;
    "aria-describedby": string | undefined;
    "aria-invalid": boolean | undefined;
    required?: boolean;
  }) => React.ReactNode;
}) {
  const hintId = hint ? `${id}-hint` : null;
  const errorId = error ? `${id}-error` : null;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-ink block text-sm font-medium">
        {label}
        {required && requiredLabel && (
          <span className="text-ink-muted font-normal"> {requiredLabel}</span>
        )}
      </label>
      {children({
        id,
        "aria-describedby": describedBy,
        "aria-invalid": error ? true : undefined,
        required,
      })}
      {hint && (
        <p id={hintId!} className="text-ink-subtle text-xs">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId!} className="text-danger text-xs">
          {error}
        </p>
      )}
    </div>
  );
}
