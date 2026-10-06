"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Panel, Row } from "@/components/detail-kit";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { enumLabel, type ClassNoticeRecord } from "@/lib/classes/types";
import { formatDateTime } from "@/lib/format/date";

// §9.10 Notices: the pending notice first, then what already went out.
// Operations corrects the wording, approves (which only queues it for Shawn's
// worker, §11.1) or discards. Nothing is sent from this screen.

const FIELD_LABELS: Record<string, string> = {
  startDate: "Start date",
  endDate: "End date",
  startTime: "Start time",
  endTime: "End time",
  mode: "Format",
  venueName: "Venue",
  venueAddress: "Address",
  city: "City",
  onlineUrl: "Joining link",
};

export function NoticesTab({
  notices,
  canWrite,
}: {
  notices: ClassNoticeRecord[];
  // §7.1: super_admin and operations act on a notice; everyone else reads.
  canWrite: boolean;
}) {
  return (
    <div
      role="tabpanel"
      id="panel-notices"
      aria-labelledby="tab-notices"
      className="space-y-4"
    >
      {notices.length === 0 && (
        <Panel title="Change notices">
          <p className="text-ink-muted text-sm">
            No notices. A date, time or venue change on a class with students
            prepares one here.
          </p>
        </Panel>
      )}
      {notices.map((notice) => (
        <Notice key={notice.id} notice={notice} canWrite={canWrite} />
      ))}
    </div>
  );
}

function statusBadge(notice: ClassNoticeRecord) {
  if (notice.status === "pending")
    return { label: "Waiting for approval", variant: "warning" as const };
  if (notice.status === "approved")
    return { label: "Queued to send", variant: "default" as const };
  if (notice.status === "sent")
    return { label: "Sent", variant: "success" as const };
  return { label: enumLabel(notice.status), variant: "secondary" as const };
}

function Notice({
  notice,
  canWrite,
}: {
  notice: ClassNoticeRecord;
  canWrite: boolean;
}) {
  const router = useRouter();
  const [messageEn, setMessageEn] = useState(notice.messageEn ?? "");
  const [messageZh, setMessageZh] = useState(notice.messageZh ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const pending = notice.status === "pending";
  const editable = canWrite && pending;
  const badge = statusBadge(notice);
  const changes = Object.entries(notice.changedFields);

  async function send(path: string, init: RequestInit, done: string) {
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      const res = await fetch(path, init);
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error?.message ?? "Couldn't save this notice.");
        return;
      }
      setSaved(done);
      router.refresh();
    } catch {
      setError("Couldn't save — check your connection.");
    } finally {
      setBusy(false);
    }
  }

  const base = `/api/class-notices/${encodeURIComponent(notice.id)}`;
  // Wording edited but not saved yet. Approving used to send the stored draft
  // and drop these edits without a word, so the approval saves them first.
  const unsaved =
    messageEn !== (notice.messageEn ?? "") ||
    messageZh !== (notice.messageZh ?? "");
  const sendable = Boolean(messageEn.trim() && messageZh.trim());

  // Both writes, in order, for the confirm dialog: it shows whatever message
  // comes back and leaves the typed wording alone on a failure.
  async function saveThenApprove(): Promise<string | void> {
    const post = async (path: string, init: RequestInit) => {
      const res = await fetch(path, init);
      if (res.ok) return null;
      const body = await res.json().catch(() => null);
      return (
        (body?.error?.message as string) ?? "Couldn't approve this notice."
      );
    };

    if (unsaved) {
      const failed = await post(base, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageEn, messageZh }),
      });
      if (failed) return failed;
    }
    const failed = await post(`${base}/approve`, { method: "POST" });
    if (failed) return failed;

    setConfirming(false);
    setSaved(
      `Approved. It is queued to go to ${notice.recipientCount} ${notice.recipientCount === 1 ? "student" : "students"}.`,
    );
    router.refresh();
  }

  return (
    <Panel
      title={`Notice to ${notice.recipientCount} ${notice.recipientCount === 1 ? "student" : "students"}`}
    >
      <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
        <Badge variant={badge.variant}>{badge.label}</Badge>
        <span className="text-ink-muted">
          Prepared {formatDateTime(notice.createdAt)}
          {notice.createdByName ? ` by ${notice.createdByName}` : ""}
        </span>
        {notice.approvedAt && (
          <span className="text-ink-muted">
            Approved {formatDateTime(notice.approvedAt)}
            {notice.approvedByName ? ` by ${notice.approvedByName}` : ""}
          </span>
        )}
        {notice.sentAt && (
          <span className="text-ink-muted">
            Sent {formatDateTime(notice.sentAt)}
          </span>
        )}
      </div>

      {notice.sendError && (
        <p role="alert" className="text-danger mb-3 text-sm">
          The send failed, so the students were not told: {notice.sendError}
        </p>
      )}

      {changes.map(([field, change]) => (
        <Row key={field}>
          <span className="text-ink-muted">
            {FIELD_LABELS[field] ?? enumLabel(field)}
          </span>
          <span>
            {change.from ?? "Not set"} → {change.to ?? "Not set"}
          </span>
        </Row>
      ))}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Message
          label="English message"
          value={messageEn}
          editable={editable}
          onChange={setMessageEn}
        />
        <Message
          label="Chinese message"
          value={messageZh}
          editable={editable}
          onChange={setMessageZh}
        />
      </div>

      {error && (
        <p role="alert" className="text-danger mt-3 text-sm">
          {error}
        </p>
      )}
      {saved && (
        <p role="status" className="text-ink mt-3 text-sm">
          {saved}
        </p>
      )}

      {editable && (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={busy || !messageEn.trim() || !messageZh.trim()}
            onClick={() =>
              send(
                base,
                {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ messageEn, messageZh }),
                },
                "Wording saved. Nothing has been sent yet.",
              )
            }
          >
            Save wording
          </Button>
          <Button
            disabled={busy || !sendable}
            onClick={() => setConfirming(true)}
          >
            Approve &amp; send
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() =>
              send(
                `${base}/discard`,
                { method: "POST" },
                "Discarded. Nothing was sent.",
              )
            }
          >
            Discard
          </Button>
        </div>
      )}

      {/* §9 cross-screen: the one action here that reaches students confirms
          first and names how many. Nothing can unsend it. */}
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Approve and send this notice?"
        body={
          <>
            <p>
              It goes to {notice.recipientCount}{" "}
              {notice.recipientCount === 1 ? "student" : "students"} on this
              class, in English and Chinese, as worded above. It cannot be
              unsent.
            </p>
            {unsaved && <p>Your edits to the wording are saved first.</p>}
          </>
        }
        confirmLabel="Approve and send"
        onConfirm={saveThenApprove}
      />
    </Panel>
  );
}

function Message({
  label,
  value,
  editable,
  onChange,
}: {
  label: string;
  value: string;
  editable: boolean;
  onChange: (v: string) => void;
}) {
  if (!editable)
    return (
      <div>
        <h3 className="mb-1 text-sm font-semibold">{label}</h3>
        <p className="text-ink-muted text-sm whitespace-pre-wrap">
          {value || "Not set"}
        </p>
      </div>
    );
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-semibold">{label}</span>
      <textarea
        value={value}
        rows={8}
        onChange={(e) => onChange(e.target.value)}
        className="border-line bg-surface focus-visible:outline-focus-ring w-full rounded-md border p-2 text-sm focus-visible:outline-2"
      />
    </label>
  );
}
