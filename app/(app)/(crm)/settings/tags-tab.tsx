"use client";

import { Lock } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
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
import type { TagRow } from "@/lib/settings/tags";
import { save } from "./save";

// Spec §9.15 Tags: rename, deactivate, reactivate and merge user tags. System
// tags come from imports and are read-only. New tags are still made by bulk
// add tag.

// The GHL import stops on 14 Dec 2026 (tag-admin spec); the note goes then.
const GHL_OFF = new Date("2026-12-15T00:00:00+08:00");

const SELECT =
  "border-line-strong bg-surface-sunken text-ink focus-visible:outline-focus-ring h-9 w-full rounded-sm border px-2.5 text-sm focus-visible:outline-2 focus-visible:outline-offset-2";

const people = (n: number) => `${n} ${n === 1 ? "person" : "people"}`;

export function TagsTab({ tags }: { tags: TagRow[] }) {
  const router = useRouter();
  const [renaming, setRenaming] = useState<TagRow | null>(null);
  const [merging, setMerging] = useState<{
    source: TagRow;
    intoId: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  async function setActive(t: TagRow, isActive: boolean) {
    setBusy(true);
    const r = await save(`/api/tags/${t.id}`, "PATCH", { isActive }, t.version);
    setBusy(false);
    setToast(
      !r.ok
        ? r.message
        : isActive
          ? `${t.name} can be used again.`
          : `${t.name} is deactivated. People who have it keep it.`,
    );
    if (r.ok) router.refresh();
  }

  const into = merging && tags.find((t) => t.id === merging.intoId);
  const targets = merging
    ? tags.filter((t) => t.isActive && t.id !== merging.source.id)
    : [];

  return (
    <div className="space-y-4">
      {new Date() < GHL_OFF && (
        <p className="border-line bg-surface-raised rounded-md border px-4 py-3 text-sm">
          Tags brought in from GHL can come back under their old name after a
          rename, and keep getting new contacts after a merge, until GHL is
          switched off on 14 Dec. Tidy those tags after that date.
        </p>
      )}
      <TableCard>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead className="text-right">People</TableHead>
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tags.map((t) => (
              <TableRow
                key={t.id}
                className={t.isSystem || !t.isActive ? "text-ink-muted" : ""}
              >
                <TableCell className="font-medium">
                  {t.name}
                  {!t.isActive && (
                    <Badge variant="secondary" className="ml-2">
                      Inactive
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="text-right">{t.personCount}</TableCell>
                <TableCell className="text-right whitespace-nowrap">
                  {t.isSystem ? (
                    <span className="inline-flex items-center gap-1 text-xs">
                      <Lock className="size-3.5" aria-hidden />
                      System tag
                    </span>
                  ) : (
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setRenaming(t)}
                      >
                        Rename
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={() => setActive(t, !t.isActive)}
                      >
                        {t.isActive ? "Deactivate" : "Reactivate"}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setMerging({ source: t, intoId: "" })}
                      >
                        Merge
                      </Button>
                    </div>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableCard>

      <Dialog
        open={renaming !== null}
        onOpenChange={(open) => !open && setRenaming(null)}
      >
        <DialogContent className="sm:max-w-md">
          {renaming && (
            <RenameTag
              tag={renaming}
              onDone={(name) => {
                setRenaming(null);
                setToast(`Renamed to ${name}.`);
                router.refresh();
              }}
              onMerge={(intoId) => {
                setRenaming(null);
                setMerging({ source: renaming, intoId });
              }}
              onCancel={() => setRenaming(null)}
            />
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={merging !== null}
        onOpenChange={(open) => !open && setMerging(null)}
        title={`Merge ${merging?.source.name ?? ""}`}
        body={
          merging && into ? (
            <p>
              Move {people(merging.source.personCount)} from{" "}
              {merging.source.name} to {into.name} and deactivate{" "}
              {merging.source.name}?
            </p>
          ) : (
            <p>Pick the tag to move everyone to.</p>
          )
        }
        confirmLabel="Merge"
        cancelLabel="Keep both"
        canConfirm={!!into}
        onConfirm={async () => {
          if (!merging || !into) return;
          const r = await save(`/api/tags/${merging.source.id}/merge`, "POST", {
            intoTagId: into.id,
          });
          if (!r.ok) return r.message;
          setMerging(null);
          setToast(`${merging.source.name} merged into ${into.name}.`);
          router.refresh();
        }}
      >
        <label className="block space-y-1 text-sm">
          <span className="font-medium">Merge into</span>
          <select
            className={SELECT}
            value={merging?.intoId ?? ""}
            onChange={(e) =>
              merging && setMerging({ ...merging, intoId: e.target.value })
            }
          >
            <option value="">Pick a tag</option>
            {targets.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({people(t.personCount)})
              </option>
            ))}
          </select>
        </label>
      </ConfirmDialog>
      <Toast message={toast} onDismiss={() => setToast(null)} />
    </div>
  );
}

// Mounted per open; a failed save keeps what was typed. A name another tag
// already has offers a merge into that tag instead.
function RenameTag({
  tag,
  onDone,
  onMerge,
  onCancel,
}: {
  tag: TagRow;
  onDone: (name: string) => void;
  onMerge: (intoId: string) => void;
  onCancel: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(tag.name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<{
    text: string;
    stale: boolean;
    existing?: { id: string; name: string };
  } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const r = await save(`/api/tags/${tag.id}`, "PATCH", { name }, tag.version);
    setSaving(false);
    if (r.ok) return onDone(name.trim());
    setError({
      text: r.message,
      stale: r.code === "stale_edit",
      existing:
        r.code === "duplicate_name"
          ? (r.error?.existingTag as { id: string; name: string })
          : undefined,
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <DialogHeader>
        <DialogTitle>Rename {tag.name}</DialogTitle>
        <DialogDescription>
          Everyone who has this tag keeps it under the new name. Saved People
          filters keep working.
        </DialogDescription>
      </DialogHeader>
      {error && (
        <div
          role="alert"
          className="bg-danger-soft text-danger space-y-2 rounded-md p-3 text-sm"
        >
          <p>{error.text}</p>
          {error.existing && (
            <Button
              type="button"
              variant="outline"
              onClick={() => onMerge(error.existing!.id)}
            >
              Merge into {error.existing.name}
            </Button>
          )}
          {error.stale && (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                router.refresh();
                onCancel();
              }}
            >
              Reload tags
            </Button>
          )}
        </div>
      )}
      <div className="space-y-1 text-sm">
        <label htmlFor="tag-name" className="font-medium">
          Name
        </label>
        <Input
          id="tag-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Go back
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </DialogFooter>
    </form>
  );
}
