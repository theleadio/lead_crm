"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CategoryOption } from "@/lib/enquiries/routing";
import { ENQUIRY_PRIORITIES } from "@/lib/enquiries/types";
import type { PersonListItem } from "@/lib/people/types";
import { enquiryLabel } from "../queue-view";

const FIELD =
  "border-line-strong bg-surface-sunken text-ink focus-visible:outline-focus-ring h-9 w-full rounded-sm border px-2.5 text-sm focus-visible:outline-2 focus-visible:outline-offset-2";

const CHANNELS = [
  "phone",
  "walk_in",
  "email",
  "whatsapp",
  "messenger",
  "instagram",
] as const;

// Find the person (People search: name, email or phone), then the category,
// subject and how they got in touch. POST /api/enquiries routes it.
export function NewEnquiryForm({
  categories,
}: {
  categories: CategoryOption[];
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [found, setFound] = useState<PersonListItem[]>([]);
  const [person, setPerson] = useState<PersonListItem | null>(null);
  const [category, setCategory] = useState("");
  const [subject, setSubject] = useState("");
  const [channel, setChannel] = useState<string>("phone");
  const [priority, setPriority] = useState("normal");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  // Spec §9.1: debounce search 300ms.
  useEffect(() => {
    const q = search.trim();
    if (q.length < 2) return;
    let ignore = false;
    const t = setTimeout(() => {
      fetch(`/api/people?${new URLSearchParams({ q, limit: "8" })}`)
        .then((r) => (r.ok ? r.json() : { data: [] }))
        .then((b) => !ignore && setFound(b.data ?? []))
        .catch(() => !ignore && setFound([]));
    }, 300);
    return () => {
      ignore = true;
      clearTimeout(t);
    };
  }, [search]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!person) {
      setFields({ personId: "Pick a person" });
      return;
    }
    setBusy(true);
    setError(null);
    setFields({});
    const res = await fetch("/api/enquiries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        personId: person.id,
        category,
        subject,
        channel,
        priority,
        note: note.trim() || undefined,
      }),
    }).catch(() => null);
    setBusy(false);
    if (!res) {
      setError("Couldn't save — check your connection.");
      return;
    }
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      setError(body?.error?.message ?? "Couldn't create the enquiry.");
      setFields(body?.error?.fields ?? {});
      return;
    }
    router.push(`/enquiries/${body.id}`);
  }

  const err = (k: string) =>
    fields[k] ? <span className="text-danger text-xs">{fields[k]}</span> : null;

  return (
    <form onSubmit={submit} className="space-y-4 text-sm" noValidate>
      {error && (
        <p
          role="alert"
          className="border-danger bg-danger-soft text-danger rounded-md border px-3 py-2"
        >
          {error}
        </p>
      )}

      <div className="space-y-1">
        <span className="font-medium">Person</span>
        {person ? (
          <div className="flex items-center gap-3">
            <span>
              {person.fullName}
              {person.email || person.phone
                ? ` · ${person.email ?? person.phone}`
                : ""}
            </span>
            <Button
              type="button"
              variant="link"
              onClick={() => setPerson(null)}
            >
              Change
            </Button>
          </div>
        ) : (
          <>
            <Input
              aria-label="Find the person by name, email or phone"
              placeholder="Name, email or phone"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search.trim().length >= 2 && (
              <ul className="border-line divide-line divide-y rounded-sm border">
                {found.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      className="hover:bg-blue-soft w-full px-3 py-2 text-left"
                      onClick={() => setPerson(p)}
                    >
                      {p.fullName}
                      <span className="text-ink-muted">
                        {" "}
                        {p.email ?? p.phone ?? ""}
                      </span>
                    </button>
                  </li>
                ))}
                {found.length === 0 && (
                  <li className="text-ink-muted px-3 py-2">
                    Nobody found.{" "}
                    <Link href="/people" className="text-blue-ink underline">
                      Add them on People
                    </Link>{" "}
                    first.
                  </li>
                )}
              </ul>
            )}
          </>
        )}
        {err("personId")}
      </div>

      <label className="block space-y-1">
        <span className="font-medium">Category</span>
        <select
          className={FIELD}
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          required
        >
          <option value="" disabled>
            Choose a category
          </option>
          {categories.map((c) => (
            <option key={c.code} value={c.code}>
              {c.label} ({c.teamName})
            </option>
          ))}
        </select>
        {err("category")}
      </label>

      <label className="block space-y-1">
        <span className="font-medium">Subject</span>
        <Input
          value={subject}
          maxLength={200}
          onChange={(e) => setSubject(e.target.value)}
        />
        {err("subject")}
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block space-y-1">
          <span className="font-medium">How they got in touch</span>
          <select
            className={FIELD}
            value={channel}
            onChange={(e) => setChannel(e.target.value)}
          >
            {CHANNELS.map((c) => (
              <option key={c} value={c}>
                {enquiryLabel(c)}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1">
          <span className="font-medium">Priority</span>
          <select
            className={FIELD}
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
          >
            {ENQUIRY_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {enquiryLabel(p)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="block space-y-1">
        <span className="font-medium">Internal note (optional)</span>
        <textarea
          className="border-line-strong bg-surface-sunken focus-visible:outline-focus-ring w-full rounded-sm border p-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2"
          rows={3}
          maxLength={5000}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </label>

      <Button type="submit" disabled={busy}>
        {busy ? "Creating…" : "Create enquiry"}
      </Button>
    </form>
  );
}
