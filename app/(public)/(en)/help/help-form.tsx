"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { submitHelpAction, type HelpState } from "./actions";

const field =
  "border-line-strong bg-surface rounded-md border px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-focus-ring aria-[invalid=true]:border-danger";

export function HelpForm({
  categories,
}: {
  categories: { code: string; label: string }[];
}) {
  const [state, action, pending] = useActionState<HelpState, FormData>(
    submitHelpAction,
    {},
  );
  // One key per page load: a double click or a resubmit after a network
  // error can't make a second enquiry.
  const [key] = useState(() => `help:${crypto.randomUUID()}`);

  if (state.reference)
    return (
      <div
        role="status"
        className="border-line bg-surface-muted rounded-2xl border p-6"
      >
        <p className="text-lg font-semibold">Thanks, we&apos;ve got it.</p>
        <p className="mt-2 text-sm">
          Your reference is <strong>{state.reference}</strong>. We reply by the
          next working day (Monday to Friday, 8:30 AM to 4:30 PM, Malaysia
          time).
        </p>
      </div>
    );

  const err = (name: string) => state.fields?.[name];
  const v = (name: string) => state.values?.[name] ?? "";
  const a11y = (name: string) => ({
    "aria-invalid": Boolean(err(name)),
    "aria-describedby": err(name) ? `${name}-error` : undefined,
  });

  return (
    <form
      // A new key after each try remounts the fields with what was typed.
      key={JSON.stringify(state.values ?? {})}
      action={action}
      className="flex flex-col gap-4"
      noValidate
    >
      <input type="hidden" name="idempotencyKey" value={key} />
      {state.error && (
        <p
          role="alert"
          className="border-danger bg-danger-soft text-danger rounded-md border px-4 py-3 text-sm"
        >
          {state.error}
        </p>
      )}
      <label className="flex flex-col gap-1 text-sm font-medium">
        What do you need help with?
        <select
          name="category"
          required
          defaultValue={v("category")}
          className={field}
          {...a11y("category")}
        >
          <option value="" disabled>
            Choose a topic
          </option>
          {categories.map((c) => (
            <option key={c.code} value={c.code}>
              {c.label}
            </option>
          ))}
        </select>
        <Err name="category" msg={err("category")} />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Your name
        <input
          name="fullName"
          defaultValue={v("fullName")}
          required
          maxLength={200}
          autoComplete="name"
          className={field}
          {...a11y("fullName")}
        />
        <Err name="fullName" msg={err("fullName")} />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm font-medium">
          Email
          <input
            name="email"
            defaultValue={v("email")}
            type="email"
            maxLength={254}
            autoComplete="email"
            className={field}
            {...a11y("email")}
          />
          <Err name="email" msg={err("email")} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Phone or WhatsApp
          <input
            name="phone"
            defaultValue={v("phone")}
            type="tel"
            maxLength={40}
            autoComplete="tel"
            className={field}
            {...a11y("phone")}
          />
          <Err name="phone" msg={err("phone")} />
        </label>
      </div>
      <p className="text-ink-muted -mt-2 text-xs">
        An email or a phone number, so we can reply.
      </p>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Your message
        <textarea
          name="message"
          defaultValue={v("message")}
          required
          rows={6}
          maxLength={5000}
          className={field}
          {...a11y("message")}
        />
        <Err name="message" msg={err("message")} />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Reply in
        <select
          name="preferredLanguage"
          defaultValue={v("preferredLanguage") || "en"}
          className={field}
        >
          <option value="en">English</option>
          <option value="zh">中文</option>
        </select>
      </label>
      <p className="text-ink-muted text-xs">
        We use these details only to answer this request.
      </p>
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Sending…" : "Send"}
      </Button>
    </form>
  );
}

function Err({ name, msg }: { name: string; msg: string | undefined }) {
  if (!msg) return null;
  return (
    <span id={`${name}-error`} className="text-danger text-xs">
      {msg}
    </span>
  );
}
