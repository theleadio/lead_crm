"use client";

import { ArrowDown, ArrowUp } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { TableCard } from "@/components/list-kit";
import { Toast } from "@/components/toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { LostReasonRow } from "@/lib/settings/lost-reasons";
import { save } from "./save";

// Spec §9.15 Lost reasons: add, rename, deactivate and reactivate, reorder.
// No delete: deals and reports keep their reason. The order is posted whole
// (design 7), so a screen someone else has changed fails instead of mixing.
export function LostReasonsTab({ reasons }: { reasons: LostReasonRow[] }) {
  const router = useRouter();
  const [dialog, setDialog] = useState<LostReasonRow | "new" | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  async function run(action: () => ReturnType<typeof save>, done: string) {
    setBusy(true);
    const r = await action();
    setBusy(false);
    setToast(r.ok ? done : r.message);
    if (r.ok) router.refresh();
  }

  function move(index: number, by: -1 | 1) {
    const ids = reasons.map((r) => r.id);
    [ids[index], ids[index + by]] = [ids[index + by], ids[index]];
    return run(
      () => save("/api/lost-reasons/reorder", "POST", { ids }),
      `Moved ${reasons[index].labelEn} ${by < 0 ? "up" : "down"}.`,
    );
  }

  const setActive = (r: LostReasonRow, isActive: boolean) =>
    run(
      () =>
        save(`/api/lost-reasons/${r.id}`, "PATCH", { isActive }, r.version),
      isActive
        ? `${r.labelEn} can be picked again.`
        : `${r.labelEn} is deactivated. Deals that have it keep it.`,
    );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-ink-muted text-sm">
          The reasons offered when a deal is marked lost, in this order. A
          deactivated reason stays on the deals that already have it.
        </p>
        <Button onClick={() => setDialog("new")}>Add reason</Button>
      </div>
      <TableCard>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>
                <span className="sr-only">Order</span>
              </TableHead>
              <TableHead>English</TableHead>
              <TableHead>Chinese</TableHead>
              <TableHead>Code</TableHead>
              <TableHead className="text-right">Deals</TableHead>
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {reasons.map((r, i) => (
              <TableRow key={r.id} className={r.isActive ? "" : "text-ink-muted"}>
                <TableCell className="whitespace-nowrap">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Move ${r.labelEn} up`}
                    disabled={busy || i === 0}
                    onClick={() => move(i, -1)}
                  >
                    <ArrowUp />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Move ${r.labelEn} down`}
                    disabled={busy || i === reasons.length - 1}
                    onClick={() => move(i, 1)}
                  >
                    <ArrowDown />
                  </Button>
                </TableCell>
                <TableCell className="font-medium">
                  {r.labelEn}
                  {!r.isActive && (
                    <Badge variant="secondary" className="ml-2">
                      Inactive
                    </Badge>
                  )}
                </TableCell>
                <TableCell>{r.labelZh ?? "—"}</TableCell>
                <TableCell className="font-mono text-xs">{r.code}</TableCell>
                <TableCell className="text-right">{r.dealCount}</TableCell>
                <TableCell className="text-right whitespace-nowrap">
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setDialog(r)}
                    >
                      Rename
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => setActive(r, !r.isActive)}
                    >
                      {r.isActive ? "Deactivate" : "Reactivate"}
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableCard>

      <Dialog
        open={dialog !== null}
        onOpenChange={(open) => !open && setDialog(null)}
      >
        <DialogContent className="sm:max-w-md">
          {dialog && (
            <ReasonForm
              reason={dialog === "new" ? null : dialog}
              onDone={(text) => {
                setDialog(null);
                setToast(text);
                router.refresh();
              }}
              onCancel={() => setDialog(null)}
            />
          )}
        </DialogContent>
      </Dialog>
      <Toast message={toast} onDismiss={() => setToast(null)} />
    </div>
  );
}

// Add (code editable) or rename (code shown, fixed). Mounted per open; a
// failed save keeps what was typed.
function ReasonForm({
  reason,
  onDone,
  onCancel,
}: {
  reason: LostReasonRow | null;
  onDone: (toast: string) => void;
  onCancel: () => void;
}) {
  const router = useRouter();
  const [code, setCode] = useState(reason?.code ?? "");
  const [labelEn, setLabelEn] = useState(reason?.labelEn ?? "");
  const [labelZh, setLabelZh] = useState(reason?.labelZh ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<{
    text: string;
    stale: boolean;
    fields: Record<string, string>;
  } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const r = reason
      ? await save(
          `/api/lost-reasons/${reason.id}`,
          "PATCH",
          { labelEn, labelZh },
          reason.version,
        )
      : await save("/api/lost-reasons", "POST", { code, labelEn, labelZh });
    setSaving(false);
    if (r.ok)
      return onDone(reason ? `${labelEn.trim()} saved.` : `${labelEn.trim()} added.`);
    setError({
      text: r.message,
      stale: r.code === "stale_edit",
      fields: (r.error?.fields as Record<string, string>) ?? {},
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <DialogHeader>
        <DialogTitle>{reason ? "Rename reason" : "Add reason"}</DialogTitle>
        <DialogDescription>
          {reason
            ? "Deals lost for this reason show the new name."
            : "New reasons go to the bottom of the list. The code can't be changed later."}
        </DialogDescription>
      </DialogHeader>
      {error && (
        <div
          role="alert"
          className="bg-danger-soft text-danger space-y-2 rounded-md p-3 text-sm"
        >
          <p>{error.text}</p>
          {error.stale && (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                router.refresh();
                onCancel();
              }}
            >
              Reload reasons
            </Button>
          )}
        </div>
      )}
      <Field label="Code" error={error?.fields.code}>
        {(id) =>
          reason ? (
            <p id={id} className="font-mono text-sm">
              {reason.code}
            </p>
          ) : (
            <Input
              id={id}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="budget_frozen"
              autoFocus
            />
          )
        }
      </Field>
      <Field label="English name" error={error?.fields.labelEn}>
        {(id) => (
          <Input
            id={id}
            value={labelEn}
            onChange={(e) => setLabelEn(e.target.value)}
            autoFocus={!!reason}
          />
        )}
      </Field>
      <Field label="Chinese name (optional)" error={error?.fields.labelZh}>
        {(id) => (
          <Input
            id={id}
            value={labelZh}
            onChange={(e) => setLabelZh(e.target.value)}
          />
        )}
      </Field>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Go back
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : reason ? "Save" : "Add reason"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: (id: string) => React.ReactNode;
}) {
  const id = `reason-${label.split(" ")[0].toLowerCase()}`;
  return (
    <div className="space-y-1 text-sm">
      <label htmlFor={id} className="font-medium">
        {label}
      </label>
      {children(id)}
      {error && <p className="text-danger text-xs">{error}</p>}
    </div>
  );
}
