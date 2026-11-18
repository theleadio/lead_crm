"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { parseParams } from "./template-params";

const FIELD =
  "border-line-strong bg-surface-sunken text-ink focus-visible:outline-focus-ring w-full rounded-sm border px-2.5 text-sm focus-visible:outline-2 focus-visible:outline-offset-2";

// An approved WATI template from the inbox (POST …/template): what staff
// send once the free-reply window has closed. The name is typed as it is in
// WATI; names sent before are suggested.
export function TemplateBox({
  conversationId,
  suggestions,
  greetingName,
  windowOpen,
}: {
  conversationId: string;
  suggestions: string[];
  greetingName: string;
  windowOpen: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(!windowOpen);
  const [template, setTemplate] = useState("");
  const [params, setParams] = useState(`name=${greetingName}`);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null,
  );

  if (!open)
    return (
      <Button variant="link" className="px-0" onClick={() => setOpen(true)}>
        Send a WhatsApp template instead
      </Button>
    );

  return (
    <form
      className="space-y-2 text-sm"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setMessage(null);
        const res = await fetch(
          `/api/conversations/${conversationId}/template`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ template, params: parseParams(params) }),
          },
        ).catch(() => null);
        setBusy(false);
        if (!res) {
          setMessage({
            ok: false,
            text: "Couldn't send — check your connection. It may not have gone out.",
          });
          return;
        }
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          setMessage({
            ok: false,
            text: data?.error?.message ?? "Couldn't send. Try again.",
          });
          router.refresh();
          return;
        }
        setTemplate("");
        setMessage({ ok: true, text: "Template sent." });
        router.refresh();
      }}
    >
      {message && (
        <p
          role={message.ok ? "status" : "alert"}
          className={
            message.ok
              ? "text-ink-muted"
              : "border-danger bg-danger-soft text-danger rounded-md border px-3 py-2"
          }
        >
          {message.text}
        </p>
      )}
      <label className="block space-y-1">
        <span className="font-medium">Template name, as in WATI</span>
        <input
          className={`${FIELD} h-9`}
          list={`templates-${conversationId}`}
          required
          maxLength={100}
          value={template}
          onChange={(e) => setTemplate(e.target.value)}
          placeholder="e.g. follow_up_en"
        />
        <datalist id={`templates-${conversationId}`}>
          {suggestions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      </label>
      <label className="block space-y-1">
        <span className="font-medium">Parameters, one name=value per line</span>
        <textarea
          className={`${FIELD} p-2 font-mono`}
          rows={3}
          value={params}
          onChange={(e) => setParams(e.target.value)}
        />
      </label>
      <Button type="submit" disabled={busy || !template.trim()}>
        {busy ? "Sending…" : "Send template"}
      </Button>
    </form>
  );
}
