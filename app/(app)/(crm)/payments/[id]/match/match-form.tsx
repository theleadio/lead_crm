"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { flash } from "@/components/flash-toast";
import { Panel } from "@/components/detail-kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ClassListItem } from "@/lib/classes/types";
import { formatDateRange } from "@/lib/format/date";
import { formatMoneyMyr } from "@/lib/format/money";
import type { ListResponse, PersonListItem } from "@/lib/people/types";

// §11.3: pick who paid and which class it's for, confirm, done. The person
// comes from the §9.1 search and the classes from the §9.8 list (no routes of
// their own); upcoming classes first, past ones after, cancelled ones never
// (money for a cancelled class is a refund). A refusal keeps both picks.
export function MatchForm({
  paymentId,
  amountMyr,
}: {
  paymentId: string;
  amountMyr: string;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<PersonListItem[] | null>(null);
  const [person, setPerson] = useState<PersonListItem | null>(null);
  const [classes, setClasses] = useState<ClassListItem[] | null>(null);
  const [classQ, setClassQ] = useState("");
  const [classId, setClassId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  // §9.1: 300ms debounce, the same as the people list search.
  useEffect(() => {
    if (person) return;
    let ignore = false;
    const t = setTimeout(() => {
      const params = new URLSearchParams({ limit: "8" });
      if (q.trim()) params.set("q", q.trim());
      fetch(`/api/people?${params}`)
        .then(async (res) => {
          const body = await res.json();
          if (!res.ok) throw new Error(body.error?.message);
          if (!ignore) setResults((body as ListResponse<PersonListItem>).data);
        })
        .catch((err: Error) => {
          if (!ignore) setError(err.message || "Couldn't search people.");
        });
    }, 300);
    return () => {
      ignore = true;
      clearTimeout(t);
    };
  }, [person, q]);

  useEffect(() => {
    let ignore = false;
    Promise.all(
      ["upcoming", "past"].map((when) =>
        fetch(`/api/classes?when=${when}&limit=100`).then(async (res) => {
          if (!res.ok) throw new Error();
          return (await res.json()).data as ClassListItem[];
        }),
      ),
    )
      .then(([upcoming, past]) => {
        if (!ignore)
          setClasses(
            [...upcoming, ...past].filter((c) => c.status !== "cancelled"),
          );
      })
      .catch(() => {
        if (!ignore)
          setError("Couldn't load the classes. Reload to try again.");
      });
    return () => {
      ignore = true;
    };
  }, []);

  const shown = useMemo(() => {
    const term = classQ.trim().toLowerCase();
    return (classes ?? []).filter(
      (c) =>
        !term ||
        c.code.toLowerCase().includes(term) ||
        c.courseName.toLowerCase().includes(term),
    );
  }, [classes, classQ]);
  const chosen = classes?.find((c) => c.id === classId) ?? null;

  async function match() {
    if (!person || !classId) return;
    setError(null);
    try {
      const res = await fetch(
        `/api/payments/${encodeURIComponent(paymentId)}/match`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ personId: person.id, classId }),
        },
      );
      if (!res.ok)
        return (
          (await res.json().catch(() => null))?.error?.message ??
          "Couldn't match this payment."
        );
      const body = await res.json().catch(() => null);
      flash(
        `${formatMoneyMyr(amountMyr)} matched: ${person.fullName} is confirmed in ${body?.classCode ?? chosen?.code ?? "the class"}.`,
      );
      router.push("/tasks");
    } catch {
      return "Couldn't match — check your connection.";
    }
  }

  return (
    <Panel title="Match it">
      <div className="space-y-4">
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">1. Who paid</h3>
          {person ? (
            <p className="text-sm">
              <span className="font-semibold">{person.fullName}</span>
              {person.email && (
                <span className="text-ink-muted"> · {person.email}</span>
              )}{" "}
              <button
                type="button"
                className="text-blue-ink underline"
                onClick={() => {
                  setPerson(null);
                  setResults(null);
                }}
              >
                Change
              </button>
            </p>
          ) : (
            <>
              <Input
                aria-label="Search people by name, email or phone"
                placeholder="Search by name, email or phone…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
              <div className="max-h-56 space-y-1 overflow-y-auto">
                {results?.length === 0 && (
                  <p className="text-ink-muted text-sm">
                    Nobody found. Add the person on the People screen first.
                  </p>
                )}
                {results?.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    className="hover:bg-surface-sunken w-full rounded-sm p-2 text-left text-sm"
                    onClick={() => setPerson(r)}
                  >
                    <span className="font-semibold">{r.fullName}</span>
                    <span className="text-ink-muted">
                      {[r.email, r.phone].filter(Boolean).length
                        ? ` · ${[r.email, r.phone].filter(Boolean).join(" · ")}`
                        : ""}
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold">2. Which class it pays for</h3>
          <Input
            aria-label="Filter classes by code or course"
            placeholder="Filter by class code or course…"
            value={classQ}
            onChange={(e) => setClassQ(e.target.value)}
          />
          {classes === null && !error && (
            <p className="text-ink-muted text-sm">Loading classes…</p>
          )}
          {classes && shown.length === 0 && (
            <p className="text-ink-muted text-sm">No class matches that.</p>
          )}
          <div className="max-h-72 space-y-1 overflow-y-auto">
            {shown.map((c) => (
              <label
                key={c.id}
                className="border-line flex flex-wrap items-center gap-3 rounded-md border p-2 text-sm"
              >
                <input
                  type="radio"
                  name="classId"
                  value={c.id}
                  checked={classId === c.id}
                  onChange={() => setClassId(c.id)}
                />
                <span className="font-semibold">{c.code}</span>
                <span className="text-ink-muted">{c.courseName}</span>
                <span className="text-ink-muted">
                  {formatDateRange(c.startDate, c.endDate)}
                </span>
                <span className="text-ink-muted ml-auto">
                  {c.seatsAvailable} of {c.capacity} seats left
                </span>
              </label>
            ))}
          </div>
        </section>

        {error && (
          <p role="alert" className="text-danger text-sm">
            {error}
          </p>
        )}
        <Button
          disabled={!person || !classId}
          onClick={() => {
            setError(null);
            setConfirming(true);
          }}
        >
          Match payment
        </Button>
      </div>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Match this payment?"
        body={
          <p>
            {formatMoneyMyr(amountMyr)} goes to{" "}
            <span className="font-semibold">{person?.fullName}</span> for{" "}
            <span className="font-semibold">{chosen?.code}</span>, and their
            place in that class becomes confirmed. There&apos;s no undo: a
            mistake is fixed by moving or cancelling the place and refunding in
            Stripe.
          </p>
        }
        confirmLabel="Match payment"
        tone="primary"
        onConfirm={match}
      />
    </Panel>
  );
}
