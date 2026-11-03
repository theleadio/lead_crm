"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { flash } from "@/components/flash-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { PersonDetail } from "@/lib/people/types";

type Person = PersonDetail["person"];
type Side = "source" | "target";

const FIELDS: { key: string; label: string; get: (p: Person) => string }[] = [
  { key: "fullName", label: "Full name", get: (p) => p.fullName },
  {
    key: "preferredName",
    label: "Preferred name",
    get: (p) => p.preferredName ?? "",
  },
  { key: "email", label: "Email", get: (p) => p.email ?? "" },
  { key: "phone", label: "Phone", get: (p) => p.phone ?? "" },
  { key: "whatsapp", label: "WhatsApp", get: (p) => p.whatsapp ?? "" },
  {
    key: "preferredLanguage",
    label: "Language",
    get: (p) => p.preferredLanguage,
  },
  { key: "jobTitle", label: "Job title", get: (p) => p.jobTitle ?? "" },
  { key: "ownerId", label: "Owner", get: (p) => p.owner?.fullName ?? "" },
  { key: "notes", label: "Notes", get: (p) => p.notes ?? "" },
];

const load = async (id: string) => {
  const res = await fetch(`/api/people/${encodeURIComponent(id)}`);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error?.message ?? "Couldn't load.");
  return body as PersonDetail;
};

export function MergePeopleView({
  sourceId,
  keepId,
}: {
  sourceId: string;
  keepId: string;
}) {
  const router = useRouter();
  const [people, setPeople] = useState<{
    source: PersonDetail;
    target: PersonDetail;
  } | null>(null);
  const [choice, setChoice] = useState<Record<string, Side>>({});
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    Promise.all([load(sourceId), load(keepId)])
      .then(([source, target]) => setPeople({ source, target }))
      .catch((e: Error) => setError(e.message));
  }, [sourceId, keepId]);

  if (!people) return error ? <p role="alert">{error}</p> : <p>Loading…</p>;

  const { source, target } = people;
  // Result of the choices — what the kept person's name will be.
  const keptName = (choice.fullName === "source" ? source : target).person
    .fullName;
  const counts = (d: PersonDetail) =>
    `${d.deals?.length ?? 0} deals, ${d.enrolments?.length ?? 0} enrolments, ${d.enquiries?.length ?? 0} enquiries`;

  const confirm = async () => {
    const res = await fetch(`/api/people/${sourceId}/merge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetId: keepId, fields: choice }),
    });
    if (!res.ok) return (await res.json()).error?.message ?? "Merge failed.";
    flash(`Merged ${source.person.fullName} into ${keptName}.`);
    router.push(`/people/${keepId}`);
  };

  return (
    <div className="space-y-6">
      <Link href={`/people/${sourceId}`} className="text-sm underline">
        Back
      </Link>
      <h1 className="text-xl font-semibold">Merge people</h1>

      <table className="w-full text-sm">
        <thead>
          <tr className="text-left">
            <th />
            <th>Merge away: {source.person.fullName}</th>
            <th>Keep: {target.person.fullName}</th>
          </tr>
        </thead>
        <tbody>
          {FIELDS.map((f) => (
            <tr key={f.key}>
              <th scope="row" className="text-left font-normal">
                {f.label}
              </th>
              {(["source", "target"] as const).map((side) => {
                const value = f.get(people[side].person);
                return (
                  <td key={side}>
                    <label className="flex gap-2">
                      <input
                        type="radio"
                        name={f.key}
                        checked={(choice[f.key] ?? "target") === side}
                        onChange={() => setChoice({ ...choice, [f.key]: side })}
                      />
                      {value || <span className="text-ink-muted">—</span>}
                    </label>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      <div className="bg-surface-raised space-y-1 rounded-md p-4 text-sm">
        <p className="font-medium">What moves</p>
        <p>
          {source.person.fullName}’s {counts(source)}, tags, messages, tasks and
          company links move to {keptName}. Any other field you didn’t pick
          stays as {target.person.fullName} has it.
        </p>
        <p className="text-danger font-medium">
          This can’t be undone. {source.person.fullName} will disappear from all
          lists.
        </p>
      </div>

      <Button variant="destructive" onClick={() => setOpen(true)}>
        Merge permanently
      </Button>

      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Merge these people?"
        body={
          <>
            <p>
              <strong>{source.person.fullName}</strong> is removed and{" "}
              <strong>{keptName}</strong> is kept. Their {counts(source)} move
              to the kept person.
            </p>
            <p className="text-danger font-medium">This can’t be undone.</p>
          </>
        }
        confirmLabel="Merge permanently"
        canConfirm={typed.trim() === keptName}
        onConfirm={confirm}
      >
        <label className="text-sm" htmlFor="confirm-name">
          Type <strong>{keptName}</strong> to confirm
        </label>
        <Input
          id="confirm-name"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
        />
      </ConfirmDialog>
    </div>
  );
}
