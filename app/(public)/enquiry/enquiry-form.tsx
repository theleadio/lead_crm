"use client";

import Script from "next/script";
import { useActionState, useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  EMPTY_STATE,
  HONEYPOT_FIELD,
  newIdempotencyKey,
} from "./form-contract";
import { submitEnquiry } from "./submit";

// As much of Turnstile's global as we use.
declare global {
  interface Window {
    turnstile?: {
      render: (
        el: HTMLElement,
        options: { sitekey: string; "response-field-name": string },
      ) => string;
      remove: (id: string) => void;
      reset: (id?: string) => void;
    };
  }
}

// §10.3's form. Fields are controlled so a failed submission keeps every
// value the visitor typed (§13) — React resets an uncontrolled form once its
// action settles, which would make a retry mean retyping it all.

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

const BLANK: Values = {
  fullName: "",
  email: "",
  phone: "",
  companyName: "",
  jobTitle: "",
  preferredLanguage: "en",
  message: "",
};

export function EnquiryForm({
  classCode,
  courseCode,
  privacyUrl,
}: {
  classCode: string | null;
  courseCode: string | null;
  privacyUrl: string | null;
}) {
  const [state, formAction, pending] = useActionState(
    submitEnquiry,
    EMPTY_STATE,
  );
  const [values, setValues] = useState<Values>(BLANK);
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

  // React 19 resets a `<form action>` once the action settles, including when
  // it settles with an error, so a box the visitor ticked comes back unticked
  // after a refused submit while the text fields keep what was typed.
  // Consent is the one that matters: a visitor who does not notice would
  // retry and have the lead saved with no consent and no
  // `funding_type = 'hrdc'` (§10.3, §8.2).
  //
  // Controlling the box is not enough on its own, and this is why the text
  // fields behave differently. A reset restores every field to its default,
  // and for a controlled text input React keeps the default in step with the
  // value on every update — so the reset puts the typed text back. For a
  // checkbox it does not: react-dom fixes defaultChecked once, when the
  // input mounts, and leaves it alone on later updates while `checked` is
  // supplied. The default therefore stays `false` for the life of the form,
  // the reset reverts to it, and React writes `checked` again only when the
  // prop changes — which it has not. Hence the line in the handler below:
  // the state drives what is rendered, and the default follows the state so
  // a reset has the right value to go back to.
  const [checks, setChecks] = useState({
    hrdcIntended: false,
    consentMarketing: false,
  });
  const check =
    (k: keyof typeof checks) => (e: React.ChangeEvent<HTMLInputElement>) => {
      const el = e.currentTarget;
      el.defaultChecked = el.checked;
      setChecks((c) => ({ ...c, [k]: el.checked }));
    };

  // §14: focus follows what changed. aria-live announces the summary but
  // takes nobody to it, so without this the focus stays on a submit button
  // that is no longer the point, and a keyboard or screen-reader visitor has
  // to walk back up the form to learn what happened.
  const summaryBox = useRef<HTMLDivElement | null>(null);
  const successBox = useRef<HTMLHeadingElement | null>(null);

  useEffect(() => {
    if (state.status === "success") {
      successBox.current?.focus();
      return;
    }
    if (state.status !== "error") return;
    // The summary when there is one, and the first field the server named
    // when there is not — never the top of the page.
    const firstBad = Object.keys(state.fields)[0];
    (
      summaryBox.current ??
      (firstBad ? document.getElementById(`${ids}-${firstBad}`) : null)
    )?.focus();
  }, [state, ids]);

  const captchaBox = useRef<HTMLDivElement | null>(null);
  const widgetId = useRef<string | null>(null);
  const [captchaReady, setCaptchaReady] = useState(false);

  // Turnstile's implicit rendering scans the DOM once, when its script loads,
  // and next/script loads it once per page load. On a client-side move back
  // to this form the script is already there, nothing scans, and no widget
  // appears — so no token is sent and §8.2 refuses every submission.
  //
  // Rendering and removing the widget belong to the same effect. Driving the
  // render from `<Script onReady>` and the removal from an unmount effect
  // leaves them on different lifecycles: Strict Mode's second mount runs the
  // teardown, `onReady` does not fire again, and the form is left with the
  // container and no widget — the very failure this is here to prevent.
  useEffect(() => {
    const box = captchaBox.current;
    if (!siteKey || !captchaReady || !box) return;
    const id = window.turnstile?.render(box, {
      sitekey: siteKey,
      "response-field-name": "captchaToken",
    });
    widgetId.current = id ?? null;
    return () => {
      if (id) window.turnstile?.remove(id);
      widgetId.current = null;
    };
  }, [siteKey, captchaReady]);

  // A token is spent by the §8.2 check, and the widget does not remount when
  // the action returns. Without this reset, any refusal after that check —
  // the per-phone limit, a 500 — leaves the spent token in the form and every
  // retry comes back captcha_failed until the visitor reloads the page.
  useEffect(() => {
    if (state.status === "error" && widgetId.current !== null)
      window.turnstile?.reset(widgetId.current);
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
        <h2
          ref={successBox}
          tabIndex={-1}
          className="text-ink text-lg font-semibold"
        >
          Thank you — got it.
        </h2>
        <p className="text-ink-muted mt-2 text-sm">
          One of our team will be in touch within one working day, on the email
          or phone number you gave us.
        </p>
      </div>
    );

  const errors = Object.values(state.fields);
  const showSummary = state.status === "error" && state.message;

  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (!values.email.trim() && !values.phone.trim()) {
          e.preventDefault();
          setLocalError("Enter an email or a phone number");
          document.getElementById(`${ids}-email`)?.focus();
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
          <div
            ref={summaryBox}
            tabIndex={-1}
            className="border-danger bg-danger-soft text-danger rounded-md border px-4 py-3 text-sm"
          >
            <p>{state.message}</p>
            {errors.length > 0 && (
              <ul className="mt-1 list-disc ps-5">
                {errors.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <Field
        id={`${ids}-fullName`}
        label="Full name"
        required
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
        label="Email"
        hint="Give us an email or a phone number — either is enough."
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
        label="Phone"
        hint="Malaysian mobile, for example +60 12-345 6789 or 012-345 6789."
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
          label="Company"
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
          label="Job title"
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
        label="Preferred language"
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
        label="What would you like to know?"
        error={fieldError("message")}
      >
        {(p) => (
          <textarea
            {...p}
            name="message"
            rows={4}
            maxLength={2000}
            value={values.message}
            onChange={set("message")}
            className={FIELD}
          />
        )}
      </Field>

      <label className="text-ink flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          name="hrdcIntended"
          checked={checks.hrdcIntended}
          onChange={check("hrdcIntended")}
          className="mt-0.5"
        />
        <span>I&apos;d like to claim this under HRDC.</span>
      </label>

      {/* §10.3: unticked by default, never a condition of submitting, and
          never pre-ticked or implied. The sentence is the spec's, word for
          word: "offers" and an unsubscribe promise were wider than what the
          PDPA reviewer has signed off, and consent text is not ours to
          broaden on the page (spec v1.24, #13). */}
      <label className="text-ink flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          name="consentMarketing"
          checked={checks.consentMarketing}
          onChange={check("consentMarketing")}
          className="mt-0.5"
        />
        <span>Send me updates about LEAD courses by email and WhatsApp.</span>
      </label>

      {/* What the visitor is asking about, from the link that opened the form
          (§10.3). A code is only ever a reference: §8.2 resolves it, and an
          unknown one is ignored rather than trusted. */}
      {classCode && <input type="hidden" name="classCode" value={classCode} />}
      {courseCode && (
        <input type="hidden" name="courseInterest" value={courseCode} />
      )}
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />

      {/* The honeypot. Positioned off-screen rather than display:none, which
          some bots check for, out of the tab order and hidden from screen
          readers so a visitor using one never meets it. */}
      <div
        aria-hidden="true"
        className="absolute -left-[9999px] w-px overflow-hidden"
      >
        <label htmlFor={`${ids}-hp`}>Company website</label>
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
            src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
            strategy="afterInteractive"
            onReady={() => setCaptchaReady(true)}
          />
          <div ref={captchaBox} />
        </>
      )}

      <div className="flex flex-wrap items-center gap-4 pt-1">
        <Button type="submit" disabled={pending}>
          {pending ? "Sending…" : "Send enquiry"}
        </Button>
        {privacyUrl && (
          <a
            href={privacyUrl}
            className="text-ink-muted hover:text-ink text-sm underline underline-offset-4"
          >
            How we use your details
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
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  required?: boolean;
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
        {required && (
          <span className="text-ink-muted font-normal"> (required)</span>
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
