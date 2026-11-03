"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Toast } from "@/components/toast";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { ListResponse, PersonListItem } from "@/lib/people/types";

// §9.10 Roster Add, §9.11: enrol someone by hand. The person comes from the
// §9.1 search (no route of its own, design 7); the price and a reservation's
// hold are the server's (§8.3, §12.1), so this form never names an amount.
// `confirmed` is not offered: a payment (§9.12) or a status change gets there.
const STATUSES = [
  { value: "reserved", label: "Reserved (seat held)" },
  { value: "payment_pending", label: "Payment pending (offline payment)" },
] as const;

export function AddEnrolment({ classId }: { classId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<PersonListItem[] | null>(null);
  const [person, setPerson] = useState<PersonListItem | null>(null);
  const [status, setStatus] = useState<string>("reserved");
  const [payerType, setPayerType] = useState("self");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // §13: the roster refreshes in place, so the outcome is named here.
  const [done, setDone] = useState<string | null>(null);

  // §9.1: 300ms debounce, the same as the people list search.
  useEffect(() => {
    if (!open || person) return;
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
  }, [open, person, q]);

  async function save() {
    if (!person) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/enrolments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          personId: person.id,
          classId,
          status,
          payerType,
        }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        setError(payload?.error?.message ?? "Couldn't add this enrolment.");
        return;
      }
      setDone(`${person.fullName} added to this class.`);
      close();
      router.refresh();
    } catch {
      setError("Couldn't save — check your connection.");
    } finally {
      setSaving(false);
    }
  }

  function close() {
    setOpen(false);
    setQ("");
    setResults(null);
    setPerson(null);
    setStatus("reserved");
    setPayerType("self");
    setError(null);
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>Add enrolment</Button>
      <Dialog
        open={open}
        onOpenChange={(next) => (next ? setOpen(true) : close())}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add someone to this class</DialogTitle>
          </DialogHeader>

          {person ? (
            <p className="text-sm">
              <span className="font-semibold">{person.fullName}</span>{" "}
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
                placeholder="Search people…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
              <div className="max-h-48 space-y-1 overflow-y-auto">
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
                      {" "}
                      {r.email ?? r.phone}
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}

          <label className="text-sm">
            Status
            <select
              className="border-line-strong bg-surface-sunken text-ink focus-visible:outline-focus-ring mt-1 w-full rounded-md border p-2 focus-visible:outline-2 focus-visible:outline-offset-2"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              {STATUSES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm">
            Who is paying
            <select
              className="border-line-strong bg-surface-sunken text-ink focus-visible:outline-focus-ring mt-1 w-full rounded-md border p-2 focus-visible:outline-2 focus-visible:outline-offset-2"
              value={payerType}
              onChange={(e) => setPayerType(e.target.value)}
            >
              <option value="self">The student</option>
              <option value="company">Their company</option>
            </select>
          </label>

          <p className="text-ink-muted text-xs">
            The price comes from the class. A held seat expires on its own if no
            payment arrives.
          </p>

          {error && (
            <p role="alert" className="text-danger text-sm">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button disabled={!person || saving} onClick={save}>
              {saving ? "Saving…" : "Add enrolment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Toast message={done} onDismiss={() => setDone(null)} />
    </>
  );
}
