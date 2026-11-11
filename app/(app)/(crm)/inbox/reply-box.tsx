"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

// A WhatsApp reply from the inbox (POST /api/conversations/:id/reply). Shown
// only inside the free-reply window, when WATI is connected.
export function ReplyBox({ conversationId }: { conversationId: string }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  return (
    <form
      className="space-y-2 text-sm"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setMessage(null);
        const res = await fetch(`/api/conversations/${conversationId}/reply`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        }).catch(() => null);
        setBusy(false);
        if (!res) {
          setMessage("Couldn't send — check your connection.");
          return;
        }
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          setMessage(data?.error?.message ?? "Couldn't send. Try again.");
          router.refresh();
          return;
        }
        setText("");
        router.refresh();
      }}
    >
      {message && (
        <p
          role="alert"
          className="border-danger bg-danger-soft text-danger rounded-md border px-3 py-2"
        >
          {message}
        </p>
      )}
      <label className="sr-only" htmlFor="reply">
        Reply on WhatsApp
      </label>
      <textarea
        id="reply"
        required
        maxLength={4000}
        rows={3}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Reply on WhatsApp"
        className="border-line-strong bg-surface-sunken focus-visible:outline-focus-ring w-full rounded-sm border p-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2"
      />
      <Button type="submit" disabled={busy || !text.trim()}>
        {busy ? "Sending…" : "Send"}
      </Button>
    </form>
  );
}
