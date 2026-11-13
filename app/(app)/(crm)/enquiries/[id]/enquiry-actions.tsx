"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Panel } from "@/components/detail-kit";
import { Button } from "@/components/ui/button";
import type { CategoryOption } from "@/lib/enquiries/routing";
import {
  ENQUIRY_PRIORITIES,
  isActiveStatus,
  type EnquiryRow,
} from "@/lib/enquiries/types";
import type { OwnerOption } from "@/lib/people/types";
import { enquiryLabel } from "../queue-view";
import { versionHeaders } from "@/lib/api/version-headers";

const FIELD =
  "border-line-strong bg-surface-sunken text-ink focus-visible:outline-focus-ring h-8 w-full rounded-sm border px-2.5 text-[13px] focus-visible:outline-2 focus-visible:outline-offset-2";
const AREA =
  "border-line-strong bg-surface-sunken focus-visible:outline-focus-ring w-full rounded-sm border p-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2";

type Body =
  | { action: "assign"; assignee: string | null }
  | { action: "category"; category: string }
  | { action: "status"; status: "open" | "waiting_customer" }
  | { action: "priority"; priority: string }
  | { action: "close"; status: string; note: string };

// The detail page's controls: the queue's actions (assign, category, close)
// plus waiting-on-customer, priority and notes (migration 019). Every change
// sends the row version as If-Match; the page reloads from the server after.
export function EnquiryActions({
  row,
  can,
  users,
  categories,
  viewerId,
}: {
  row: EnquiryRow;
  can: { assign: boolean; category: boolean; close: boolean };
  users: OwnerOption[];
  categories: CategoryOption[];
  viewerId: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [closeStatus, setCloseStatus] = useState("human_resolved");
  const [closeNote, setCloseNote] = useState("");
  const active = isActiveStatus(row.status);
  // category is "may work this enquiry" (rowActions).
  const mayWork = can.category;

  async function send(url: string, method: string, body: unknown) {
    setBusy(true);
    setMessage(null);
    const res = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(method === "PATCH" ? versionHeaders(row.version) : {}),
      },
      body: JSON.stringify(body),
    }).catch(() => null);
    setBusy(false);
    if (!res) {
      setMessage("Couldn't save — check your connection.");
      return false;
    }
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setMessage(data?.error?.message ?? "Couldn't save. Try again.");
      return false;
    }
    router.refresh();
    return true;
  }
  const patch = (body: Body) => send(`/api/enquiries/${row.id}`, "PATCH", body);

  if (!mayWork) return null;

  return (
    <Panel title="Work on it">
      <div className="space-y-4 text-sm">
        {message && (
          <p
            role="alert"
            className="border-danger bg-danger-soft text-danger rounded-md border px-3 py-2"
          >
            {message}
          </p>
        )}

        {can.assign && (
          <label className="block space-y-1">
            <span className="font-medium">Assigned to</span>
            <select
              className={FIELD}
              disabled={busy}
              value={row.assignedUserId ?? ""}
              onChange={(e) =>
                patch({ action: "assign", assignee: e.target.value || null })
              }
            >
              <option value="">Nobody</option>
              {row.assignedUserId &&
                !users.some((u) => u.id === row.assignedUserId) && (
                  <option value={row.assignedUserId}>{row.assigneeName}</option>
                )}
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.fullName}
                  {u.id === viewerId ? " (me)" : ""}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="block space-y-1">
          <span className="font-medium">Category</span>
          <select
            className={FIELD}
            disabled={busy}
            value={row.category ?? ""}
            onChange={(e) =>
              e.target.value &&
              patch({ action: "category", category: e.target.value })
            }
          >
            <option value="" disabled>
              Set category
            </option>
            {row.category &&
              !categories.some((c) => c.code === row.category) && (
                <option value={row.category}>
                  {row.categoryLabel ?? enquiryLabel(row.category)}
                </option>
              )}
            {categories.map((c) => (
              <option key={c.code} value={c.code}>
                {c.label} ({c.teamName})
              </option>
            ))}
          </select>
          <span className="text-ink-muted block text-xs">
            The category decides the team.
          </span>
        </label>

        <label className="block space-y-1">
          <span className="font-medium">Priority</span>
          <select
            className={FIELD}
            disabled={busy}
            value={row.priority}
            onChange={(e) =>
              patch({ action: "priority", priority: e.target.value })
            }
          >
            {ENQUIRY_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {enquiryLabel(p)}
              </option>
            ))}
          </select>
        </label>

        {active && (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() =>
              patch({
                action: "status",
                status: row.status === "open" ? "waiting_customer" : "open",
              })
            }
          >
            {row.status === "open"
              ? "Mark waiting on customer"
              : "Back to open"}
          </Button>
        )}

        <form
          className="space-y-1"
          onSubmit={async (e) => {
            e.preventDefault();
            if (
              await send(`/api/enquiries/${row.id}/notes`, "POST", {
                note,
              })
            )
              setNote("");
          }}
        >
          <label className="block space-y-1">
            <span className="font-medium">Internal note</span>
            <textarea
              className={AREA}
              rows={3}
              maxLength={5000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <span className="text-ink-muted block text-xs">
            Staff only, never sent to the customer.
          </span>
          <Button
            type="submit"
            variant="outline"
            disabled={busy || !note.trim()}
          >
            Add note
          </Button>
        </form>

        {can.close && (
          <form
            className="border-line space-y-2 border-t pt-4"
            onSubmit={(e) => {
              e.preventDefault();
              patch({
                action: "close",
                status: closeStatus,
                note: closeNote,
              });
            }}
          >
            <fieldset className="space-y-1">
              <legend className="font-medium">Close with an outcome</legend>
              {[
                ["human_resolved", "Resolved — we answered what they asked"],
                ["closed", "Closed — nothing more to do"],
              ].map(([value, label]) => (
                <label key={value} className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="close-status"
                    value={value}
                    checked={closeStatus === value}
                    onChange={() => setCloseStatus(value)}
                  />
                  {label}
                </label>
              ))}
            </fieldset>
            <textarea
              aria-label="Outcome note"
              className={AREA}
              rows={2}
              maxLength={2000}
              value={closeNote}
              onChange={(e) => setCloseNote(e.target.value)}
            />
            <p className="text-ink-muted text-xs">
              Closing is final. If they write again, that is a new enquiry.
            </p>
            <Button type="submit" disabled={busy || !closeNote.trim()}>
              Close enquiry
            </Button>
          </form>
        )}
      </div>
    </Panel>
  );
}
