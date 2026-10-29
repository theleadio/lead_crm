"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
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
import { enumLabel } from "@/lib/classes/types";
import { formatMoneyMyr, sameMoney } from "@/lib/format/money";
import type { RecordedPayment } from "@/lib/payments/types";

// §9.12 Record manual payment. Offered on §9.11 to the two roles with payment
// write (§6). Three steps on save: ask the server for a signed upload URL, PUT
// the file into the private bucket, then post the payment with the key it was
// given (§14, design 1–3). Nothing here decides the enrolment's status — the
// server answers with whether it moved (§12.4).
const METHODS = [
  { value: "bank_transfer", label: "Bank transfer" },
  { value: "hrdc", label: "HRDC" },
  { value: "invoice", label: "Invoice" },
] as const;

// §14: the modal declines obvious non-starters before an upload, and the
// server checks the stored bytes again — that check is the real one.
const ACCEPT = "image/png,image/jpeg,image/webp,application/pdf";

function todayInKualaLumpur(): string {
  return new Date().toLocaleDateString("en-CA", {
    timeZone: "Asia/Kuala_Lumpur",
  });
}

export function RecordPayment({
  enrolmentId,
  version,
  pricePaidMyr,
}: {
  enrolmentId: string;
  version: number;
  pricePaidMyr: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState<string>("bank_transfer");
  const [amountMyr, setAmountMyr] = useState("");
  const [referenceNo, setReferenceNo] = useState("");
  const [paidOn, setPaidOn] = useState(todayInKualaLumpur());
  const [file, setFile] = useState<File | null>(null);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  // §13: the screen refreshes in place, so what changed is named here.
  const [done, setDone] = useState<string | null>(null);

  // §9.12 Amount: a note, never a refusal. Silent when the enrolment carries
  // no price. The outstanding balance across payments is O16, not this.
  const mismatch =
    amountMyr.trim() !== "" &&
    pricePaidMyr !== null &&
    !sameMoney(amountMyr, pricePaidMyr);

  const complete =
    amountMyr.trim() !== "" &&
    referenceNo.trim() !== "" &&
    paidOn !== "" &&
    file !== null;

  function close() {
    setOpen(false);
    setMethod("bank_transfer");
    setAmountMyr("");
    setReferenceNo("");
    setPaidOn(todayInKualaLumpur());
    setFile(null);
    setNotes("");
    setError(null);
    setFields({});
  }

  // A refusal keeps every typed value and the chosen file, so nothing has to
  // be entered twice (§9 cross-screen).
  function refuse(payload: unknown, fallback: string) {
    const body = payload as {
      error?: { message?: string; fields?: Record<string, string> };
    } | null;
    setError(body?.error?.message ?? fallback);
    setFields(body?.error?.fields ?? {});
  }

  async function save() {
    if (!file) return;
    setSaving(true);
    setError(null);
    setFields({});
    try {
      // 1. The key is minted by the server and prefixed with this enrolment
      //    (design 2); the browser never names a path in the bucket.
      const signed = await fetch("/api/uploads/sign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enrolmentId }),
      });
      if (!signed.ok) {
        refuse(
          await signed.json().catch(() => null),
          "Couldn't start the upload. Try again.",
        );
        return;
      }
      const { uploadUrl, key } = (await signed.json()) as {
        uploadUrl: string;
        key: string;
      };

      // 2. Straight into the private bucket, so the file never passes through
      //    this app's own routes (§14).
      // The declared type is only so the store serves the file back as what it
      // is, instead of a download — §14's check reads the bytes and does not
      // trust this.
      const uploaded = await fetch(uploadUrl, {
        method: "PUT",
        headers: file.type ? { "Content-Type": file.type } : undefined,
        body: file,
      });
      if (!uploaded.ok) {
        setError("The proof didn't upload. Check the file and try again.");
        return;
      }

      // 3. The payment itself. If-Match, because this can move the enrolment
      //    to confirmed (§12.4, `record-concurrency`).
      const res = await fetch("/api/payments/manual", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "If-Match": String(version),
        },
        body: JSON.stringify({
          enrolmentId,
          method,
          amountMyr: amountMyr.trim(),
          referenceNo: referenceNo.trim(),
          paidOn,
          proofKey: key,
          ...(notes.trim() ? { notes: notes.trim() } : {}),
        }),
      });
      if (!res.ok) {
        refuse(
          await res.json().catch(() => null),
          "Couldn't record this payment.",
        );
        return;
      }

      // §9.12: the success state names what changed — the amount, the method,
      // and whether the enrolment moved.
      const payment = (await res.json()) as RecordedPayment;
      setDone(
        `${formatMoneyMyr(payment.amountMyr)} recorded by ${enumLabel(
          payment.method,
        ).toLowerCase()}. ${
          payment.statusMoved
            ? "This enrolment is now confirmed."
            : `The status stays ${enumLabel(payment.status).toLowerCase()}.`
        }`,
      );
      close();
      // The panel and the status come from the stored rows again, never from
      // anything this modal assumed (§11.2).
      router.refresh();
    } catch {
      setError("Couldn't save — check your connection.");
    } finally {
      setSaving(false);
    }
  }

  const fieldError = (name: string) =>
    fields[name] ? (
      <span role="alert" className="text-danger mt-1 block text-xs">
        {fields[name]}
      </span>
    ) : null;

  return (
    <>
      <Button onClick={() => setOpen(true)}>Record payment</Button>
      <Dialog
        open={open}
        onOpenChange={(next) => (next ? setOpen(true) : close())}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Record a payment</DialogTitle>
          </DialogHeader>

          <label className="text-sm">
            Method
            <select
              className="border-line-strong bg-surface-sunken text-ink focus-visible:outline-focus-ring mt-1 w-full rounded-md border p-2 focus-visible:outline-2 focus-visible:outline-offset-2"
              value={method}
              onChange={(e) => setMethod(e.target.value)}
            >
              {METHODS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
            {fieldError("method")}
          </label>

          {/* §9.12 HRDC: recording a payment means the money arrived. An
              approval with no money is not this action. */}
          <p className="text-ink-muted text-xs">
            Record a payment only once the money has arrived. The payment date
            is the day it was received. An HRDC approval with no money yet is
            not recorded here — the enrolment stays payment pending.
          </p>

          <label className="text-sm">
            Amount (MYR)
            <Input
              inputMode="decimal"
              placeholder="3200.00"
              value={amountMyr}
              onChange={(e) => setAmountMyr(e.target.value)}
            />
            {fieldError("amountMyr")}
          </label>

          {mismatch && (
            <p className="text-warning text-xs">
              This is {formatMoneyMyr(amountMyr)} against a price of{" "}
              {formatMoneyMyr(pricePaidMyr!)}. It will still be recorded.
            </p>
          )}

          <label className="text-sm">
            Reference number
            <Input
              placeholder="Bank or invoice reference"
              value={referenceNo}
              onChange={(e) => setReferenceNo(e.target.value)}
            />
            {fieldError("referenceNo")}
          </label>

          <label className="text-sm">
            Payment date
            <Input
              type="date"
              max={todayInKualaLumpur()}
              value={paidOn}
              onChange={(e) => setPaidOn(e.target.value)}
            />
            {fieldError("paidOn")}
          </label>

          <label className="text-sm">
            Proof
            <input
              type="file"
              accept={ACCEPT}
              className="border-line-strong bg-surface-sunken text-ink focus-visible:outline-focus-ring mt-1 w-full rounded-md border p-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <span className="text-ink-muted mt-1 block text-xs">
              A photo or PDF of the slip, up to 10MB.
            </span>
            {fieldError("proofKey")}
          </label>

          <label className="text-sm">
            Notes (optional)
            <Input
              placeholder="Anything worth knowing later"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
            {fieldError("notes")}
          </label>

          {error && (
            <p role="alert" className="text-danger text-sm">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button disabled={!complete || saving} onClick={save}>
              {saving ? "Saving…" : "Record payment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Toast message={done} onDismiss={() => setDone(null)} />
    </>
  );
}
