"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { CategoryOption } from "@/lib/enquiries/routing";

const FIELD =
  "border-line-strong bg-surface-sunken text-ink focus-visible:outline-focus-ring h-9 rounded-sm border px-2.5 text-sm focus-visible:outline-2 focus-visible:outline-offset-2";

// A conversation's controls: assign, close or reopen, and "Make enquiry".
// The routes re-check who may see the conversation.
export function ThreadActions({
  conversationId,
  status,
  assignedUserId,
  agents,
  categories,
  suggestedCategory,
  defaultSubject,
}: {
  conversationId: string;
  status: string;
  assignedUserId: string | null;
  agents: { id: string; name: string }[];
  categories: CategoryOption[];
  suggestedCategory: string | null;
  defaultSubject: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [category, setCategory] = useState(suggestedCategory ?? "other");
  const [subject, setSubject] = useState(defaultSubject);

  async function send(method: string, body: unknown) {
    setBusy(true);
    setMessage(null);
    const res = await fetch(`/api/conversations/${conversationId}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    setBusy(false);
    if (!res) {
      setMessage("Couldn't save — check your connection.");
      return null;
    }
    const data = res.status === 204 ? null : await res.json().catch(() => null);
    if (!res.ok) {
      setMessage(data?.error?.message ?? "Couldn't save. Try again.");
      return null;
    }
    return data ?? {};
  }

  return (
    <div className="space-y-3 text-sm">
      {message && (
        <p
          role="alert"
          className="border-danger bg-danger-soft text-danger rounded-md border px-3 py-2"
        >
          {message}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="assign">
          Assign conversation
        </label>
        <select
          id="assign"
          className={FIELD}
          disabled={busy}
          defaultValue={assignedUserId ?? ""}
          onChange={async (e) => {
            if (
              await send("PATCH", {
                action: "assign",
                assignee: e.target.value || null,
              })
            )
              router.refresh();
          }}
        >
          <option value="">Unassigned</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <Button
          variant="outline"
          disabled={busy}
          onClick={async () => {
            if (
              await send("PATCH", {
                action: "status",
                status: status === "closed" ? "open" : "closed",
              })
            )
              router.refresh();
          }}
        >
          {status === "closed" ? "Reopen conversation" : "Close conversation"}
        </Button>
      </div>

      <form
        className="grid gap-2 sm:grid-cols-[200px_1fr_auto]"
        onSubmit={async (e) => {
          e.preventDefault();
          const made = await send("POST", { category, subject });
          if (made?.id) router.push(`/enquiries/${made.id}`);
        }}
      >
        <label className="sr-only" htmlFor="category">
          Category
        </label>
        <select
          id="category"
          className={FIELD}
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          {categories.map((c) => (
            <option key={c.code} value={c.code}>
              {c.label} ({c.teamName})
              {c.code === suggestedCategory ? " · suggested" : ""}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor="subject">
          Enquiry subject
        </label>
        <input
          id="subject"
          required
          maxLength={200}
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Subject"
          className={FIELD}
        />
        <Button type="submit" disabled={busy || !subject.trim()}>
          Make enquiry
        </Button>
      </form>
    </div>
  );
}
