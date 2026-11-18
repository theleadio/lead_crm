"use client";

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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateTime } from "@/lib/format/date";
import type { UserRow } from "@/lib/users/service";
import { save } from "./save";

// Spec §9.15 Users (phase 1): the list, change role, deactivate and
// reactivate. No employment field: the spec only lists the column, nothing
// uses it, and the Part-timer role already says who sees assigned records only. Add user arrives with Google sign-in (phase 2).

const ROLE_LABELS: Record<UserRow["roleCode"], string> = {
  super_admin: "Super admin",
  management: "Management",
  marketing: "Marketing",
  sales: "Sales",
  support: "Support",
  operations: "Operations",
  part_time: "Part-timer",
};
const STATUS: Record<
  UserRow["status"],
  { label: string; variant: "success" | "warning" | "secondary" }
> = {
  active: { label: "Active", variant: "success" },
  not_signed_in: { label: "Not signed in yet", variant: "warning" },
  deactivated: { label: "Deactivated", variant: "secondary" },
};

const SELECT =
  "border-line-strong bg-surface-sunken text-ink focus-visible:outline-focus-ring h-9 w-full rounded-sm border px-2.5 text-sm focus-visible:outline-2 focus-visible:outline-offset-2";

export function UsersTab({
  users,
  viewerId,
}: {
  users: UserRow[];
  viewerId: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [deactivating, setDeactivating] = useState<UserRow | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  async function setActive(user: UserRow, isActive: boolean) {
    const r = await save(
      `/api/users/${user.id}`,
      "PATCH",
      { isActive },
      user.version,
    );
    if (!r.ok) return r.message;
    setToast(
      `${user.fullName} is ${isActive ? "active again" : "deactivated"}.`,
    );
    setDeactivating(null);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <p className="text-ink-muted text-sm">
        Everyone who can sign in to the CRM. A deactivated user loses access
        straight away and keeps their records.
      </p>
      <TableCard>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Last sign-in</TableHead>
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((u) => (
              <TableRow key={u.id}>
                <TableCell className="font-medium">{u.fullName}</TableCell>
                <TableCell>{u.email}</TableCell>
                <TableCell>{ROLE_LABELS[u.roleCode]}</TableCell>
                <TableCell>
                  <Badge variant={STATUS[u.status].variant}>
                    {STATUS[u.status].label}
                  </Badge>
                </TableCell>
                <TableCell>
                  {u.lastLoginAt ? formatDateTime(u.lastLoginAt) : "—"}
                </TableCell>
                <TableCell className="text-right whitespace-nowrap">
                  {u.id === viewerId ? (
                    <span className="text-ink-muted text-xs">You</span>
                  ) : u.status === "deactivated" ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={async () => {
                        const error = await setActive(u, true);
                        if (error) setToast(error);
                      }}
                    >
                      Reactivate
                    </Button>
                  ) : (
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setEditing(u)}
                      >
                        Change role
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setDeactivating(u)}
                      >
                        Deactivate
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
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
      >
        <DialogContent className="sm:max-w-md">
          {editing && (
            <EditUser
              user={editing}
              onDone={(name) => {
                setEditing(null);
                setToast(`${name} saved.`);
                router.refresh();
              }}
              onCancel={() => setEditing(null)}
            />
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deactivating !== null}
        onOpenChange={(open) => !open && setDeactivating(null)}
        title={`Deactivate ${deactivating?.fullName ?? ""}?`}
        body={
          <p>
            {deactivating?.fullName} won&apos;t be able to use the CRM from
            their next click. Records they own keep them as owner. You can
            reactivate them later.
          </p>
        }
        confirmLabel="Deactivate"
        cancelLabel="Keep active"
        onConfirm={async () =>
          deactivating ? setActive(deactivating, false) : undefined
        }
      />
      <Toast message={toast} onDismiss={() => setToast(null)} />
    </div>
  );
}

// Mounted per open, so values reset each time; a failed save keeps them.
function EditUser({
  user,
  onDone,
  onCancel,
}: {
  user: UserRow;
  onDone: (name: string) => void;
  onCancel: () => void;
}) {
  const router = useRouter();
  const [roleCode, setRoleCode] = useState(user.roleCode);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<{ text: string; stale: boolean } | null>(
    null,
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const body: Record<string, string> = {};
    if (roleCode !== user.roleCode) body.roleCode = roleCode;
    if (!Object.keys(body).length) return onCancel();
    const r = await save(`/api/users/${user.id}`, "PATCH", body, user.version);
    setSaving(false);
    if (r.ok) return onDone(user.fullName);
    setError({ text: r.message, stale: r.code === "stale_edit" });
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <DialogHeader>
        <DialogTitle>Change {user.fullName}</DialogTitle>
        <DialogDescription>
          A new role applies from their next click.
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
              Reload users
            </Button>
          )}
        </div>
      )}
      <label className="block space-y-1 text-sm">
        <span className="font-medium">Role</span>
        <select
          className={SELECT}
          value={roleCode}
          onChange={(e) => setRoleCode(e.target.value as UserRow["roleCode"])}
        >
          {Object.entries(ROLE_LABELS).map(([code, label]) => (
            <option key={code} value={code}>
              {label}
            </option>
          ))}
        </select>
      </label>
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
