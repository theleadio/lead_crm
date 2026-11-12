"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { Row } from "@/components/detail-kit";
import { Button } from "@/components/ui/button";
import type { CampaignChoice, LinkedCampaign } from "@/lib/classes/campaigns";
import { formatDate } from "@/lib/format/date";

// The Meta campaigns that sell this class (12 Nov 2026). Home's class card
// counts WhatsApp opt-ins through them. Saving reloads the page, so the list
// always comes from the server rather than this component's own copy.
export function ClassCampaigns({
  classId,
  linked,
  choices,
  canLink,
}: {
  classId: string;
  linked: LinkedCampaign[];
  choices: CampaignChoice[];
  canLink: boolean;
}) {
  const router = useRouter();
  const pickerId = useId();
  const [picked, setPicked] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(method: "POST" | "DELETE", campaignId: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/classes/${encodeURIComponent(classId)}/campaigns`,
        {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ campaignId }),
        },
      );
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        setError(payload?.error?.message ?? "Couldn't save that change.");
        return;
      }
      setPicked("");
      router.refresh();
    } catch {
      setError("Couldn't save — check your connection.");
    } finally {
      setBusy(false);
    }
  }

  const suggested = choices.filter((c) => c.suggested);
  const others = choices.filter((c) => !c.suggested);
  const option = (c: CampaignChoice) => (
    <option key={c.campaignId} value={c.campaignId} disabled={!!c.linkedTo}>
      {c.name}
      {c.linkedTo ? ` · sells ${c.linkedTo}` : ""}
    </option>
  );

  return (
    <div className="flex flex-col gap-3">
      {linked.length === 0 ? (
        <p className="text-ink-muted text-sm">
          No campaign linked yet. Home shows this class&apos;s WhatsApp opt-ins
          once one is linked.
        </p>
      ) : (
        <div>
          {linked.map((c) => (
            <Row key={c.campaignId}>
              <span className="flex min-w-0 flex-col">
                <span className="break-words">{c.name}</span>
                <span className="text-ink-muted text-xs">
                  {c.lastDay
                    ? `Last spend ${formatDate(`${c.lastDay}T00:00:00Z`)}`
                    : "No spend yet"}
                  {c.automatic && " · Linked automatically"}
                </span>
              </span>
              {canLink && (
                <span>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => send("DELETE", c.campaignId)}
                    aria-label={`Unlink ${c.name}`}
                  >
                    Remove
                  </Button>
                </span>
              )}
            </Row>
          ))}
        </div>
      )}

      {canLink &&
        (choices.length === 0 ? (
          <p className="text-ink-muted text-sm">
            No other Meta campaign has spent in the last 90 days.
          </p>
        ) : (
          <form
            className="flex flex-col gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              if (picked) void send("POST", picked);
            }}
          >
            <label htmlFor={pickerId} className="text-ink-muted text-xs">
              Link a campaign
            </label>
            <span className="flex flex-wrap items-center gap-2">
              <select
                id={pickerId}
                value={picked}
                onChange={(e) => setPicked(e.target.value)}
                className="border-line-strong bg-surface-sunken text-ink focus-visible:outline-focus-ring h-8 min-w-0 flex-1 rounded-sm border px-2.5 text-[13px] focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                <option value="">Choose a campaign…</option>
                {suggested.length > 0 && (
                  <optgroup label="Suggested for this class">
                    {suggested.map(option)}
                  </optgroup>
                )}
                <optgroup label="Other campaigns (last 90 days)">
                  {others.map(option)}
                </optgroup>
              </select>
              <Button type="submit" size="sm" disabled={busy || !picked}>
                Link
              </Button>
            </span>
            <p className="text-ink-muted text-xs">
              A campaign can sell only one class.
            </p>
          </form>
        ))}

      {error && (
        <p role="alert" className="text-danger text-sm">
          {error}
        </p>
      )}
    </div>
  );
}
