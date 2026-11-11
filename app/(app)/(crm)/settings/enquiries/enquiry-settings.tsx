"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { settingsView } from "@/lib/enquiries/settings";

type View = Awaited<ReturnType<typeof settingsView>>;

const FIELD =
  "border-line-strong bg-surface-sunken text-ink focus-visible:outline-focus-ring h-9 min-w-0 rounded-sm border px-2.5 text-sm focus-visible:outline-2 focus-visible:outline-offset-2";
const CARD = "border-line bg-surface-raised rounded-md border p-4";
const SMALL =
  "text-ink-muted hover:text-ink cursor-pointer text-xs underline disabled:opacity-50";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const orNull = (v: string) => (v ? v : null);

// Every form posts one action to /api/enquiry-settings and reloads the page's
// data from the server after.
export function EnquirySettings({
  view,
  channels,
}: {
  view: View;
  channels: string[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const teamName = (id: string | null) =>
    view.teams.find((t) => t.id === id)?.name ?? "Category's team";

  async function post(body: Record<string, unknown>) {
    setBusy(true);
    setResult(null);
    const res = await fetch("/api/enquiry-settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    setBusy(false);
    if (!res) {
      setResult({ ok: false, text: "Couldn't save — check your connection." });
      return false;
    }
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setResult({
        ok: false,
        text: data?.error?.message ?? "Not saved. Try again.",
      });
      return false;
    }
    setResult({ ok: true, text: "Saved." });
    router.refresh();
    return true;
  }

  const onSubmit =
    (build: (f: FormData) => Record<string, unknown>, reset = false) =>
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const form = e.currentTarget;
      if ((await post(build(new FormData(form)))) && reset) form.reset();
    };

  return (
    <div className="space-y-10 text-sm">
      {result && (
        <p
          role={result.ok ? "status" : "alert"}
          className={`rounded-md border px-4 py-3 ${result.ok ? "border-line bg-surface-raised" : "border-danger bg-danger-soft text-danger"}`}
        >
          {result.text}
        </p>
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Teams</h2>
        <p className="text-ink-muted">
          Members get the team&apos;s enquiries in turn and can work them
          whatever their role. Finance is restricted: only its members, super
          admins and management can open its enquiries.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          {view.teams.map((t) => (
            <div key={t.id} className={CARD}>
              <h3 className="font-semibold">
                {t.name}
                {t.isDefault && <Tag>default</Tag>}
                {t.restricted && <Tag>restricted</Tag>}
              </h3>
              {t.members.length === 0 ? (
                <p className="text-danger mt-2">
                  No members: its enquiries stay unassigned.
                </p>
              ) : (
                <ul className="mt-2 flex flex-col gap-1">
                  {t.members.map((m) => (
                    <li
                      key={m.id}
                      className="flex items-center justify-between gap-2"
                    >
                      <span>
                        {m.name}
                        {!m.active && (
                          <span className="text-ink-muted"> (inactive)</span>
                        )}
                      </span>
                      <button
                        type="button"
                        className={SMALL}
                        disabled={busy}
                        onClick={() =>
                          post({
                            action: "removeMember",
                            teamId: t.id,
                            userId: m.id,
                          })
                        }
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <form
                className="mt-3 flex gap-2"
                onSubmit={onSubmit(
                  (f) => ({
                    action: "addMember",
                    teamId: t.id,
                    email: str(f, "email"),
                  }),
                  true,
                )}
              >
                <input
                  name="email"
                  type="email"
                  required
                  placeholder="CRM login email"
                  aria-label={`Add to ${t.name} by CRM login email`}
                  className={`${FIELD} flex-1`}
                />
                <Button type="submit" disabled={busy}>
                  Add
                </Button>
              </form>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Categories</h2>
        <p className="text-ink-muted">
          A category decides the team. Keywords (comma-separated) only suggest a
          category for a message; they never route on their own. Other is the
          fallback and stays on.
        </p>
        <div className="flex flex-col gap-3">
          {[...view.categories, null].map((c) => (
            <form
              key={c?.code ?? "new"}
              className={`${CARD} grid gap-2 sm:grid-cols-6`}
              onSubmit={onSubmit(
                (f) => ({
                  action: "saveCategory",
                  code: str(f, "code"),
                  labelEn: str(f, "labelEn"),
                  labelZh: orNull(str(f, "labelZh")),
                  teamId: str(f, "teamId"),
                  keywords: str(f, "keywords")
                    .split(",")
                    .map((k) => k.trim())
                    .filter(Boolean),
                  active: f.get("active") === "on",
                  position: Number(str(f, "position")) || 500,
                }),
                !c,
              )}
            >
              <input
                name="code"
                defaultValue={c?.code}
                readOnly={Boolean(c)}
                required
                placeholder="new_code"
                aria-label="Code"
                className={`${FIELD} ${c ? "text-ink-muted" : ""}`}
              />
              <input
                name="labelEn"
                defaultValue={c?.labelEn}
                required
                placeholder="Label"
                aria-label="English label"
                className={FIELD}
              />
              <input
                name="labelZh"
                defaultValue={c?.labelZh ?? ""}
                placeholder="中文"
                aria-label="Chinese label"
                className={FIELD}
              />
              <select
                name="teamId"
                defaultValue={c?.teamId}
                aria-label="Team"
                className={FIELD}
              >
                {view.teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              <input
                name="keywords"
                defaultValue={c?.keywords.join(", ")}
                placeholder="keywords"
                aria-label="Keywords"
                className={FIELD}
              />
              <div className="flex items-center gap-2">
                <input
                  type="hidden"
                  name="position"
                  value={c?.position ?? 500}
                />
                <label className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    name="active"
                    defaultChecked={c?.active ?? true}
                  />{" "}
                  On
                </label>
                <Button type="submit" disabled={busy}>
                  {c ? "Save" : "Add"}
                </Button>
              </div>
            </form>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Routing rules</h2>
        <p className="text-ink-muted">
          Checked in order, lowest number first; the first that matches wins.
          With no match, an enquiry goes to its category&apos;s team, in turn.
        </p>
        {view.rules.length > 0 && (
          <table className="w-full text-left">
            <thead className="text-ink-muted">
              <tr>
                <th className="py-1 pr-3 font-medium">#</th>
                <th className="py-1 pr-3 font-medium">Channel</th>
                <th className="py-1 pr-3 font-medium">Category</th>
                <th className="py-1 pr-3 font-medium">Team</th>
                <th className="py-1 pr-3 font-medium">Assign</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {view.rules.map((r) => (
                <tr key={r.id} className="border-line border-t">
                  <td className="py-1 pr-3">{r.position}</td>
                  <td className="py-1 pr-3">{r.matchChannel ?? "any"}</td>
                  <td className="py-1 pr-3">{r.matchCategory ?? "any"}</td>
                  <td className="py-1 pr-3">{teamName(r.setTeamId)}</td>
                  <td className="py-1 pr-3">
                    {r.assignMode === "fixed"
                      ? (r.assignUserName ?? "fixed")
                      : r.assignMode === "none"
                        ? "nobody"
                        : "in turn"}
                  </td>
                  <td className="py-1">
                    <button
                      type="button"
                      className={SMALL}
                      disabled={busy}
                      onClick={() =>
                        post({ action: "deleteRule", ruleId: r.id })
                      }
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <form
          className={`${CARD} grid gap-2 sm:grid-cols-6`}
          onSubmit={onSubmit(
            (f) => ({
              action: "addRule",
              position: Number(str(f, "position")) || 100,
              matchChannel: orNull(str(f, "matchChannel")),
              matchCategory: orNull(str(f, "matchCategory")),
              setTeamId: orNull(str(f, "setTeamId")),
              assignMode: str(f, "assignMode"),
              assignEmail: orNull(str(f, "assignEmail")),
            }),
            true,
          )}
        >
          <input
            name="position"
            type="number"
            min={0}
            max={10000}
            defaultValue={(view.rules.at(-1)?.position ?? 0) + 10}
            aria-label="Order"
            className={FIELD}
          />
          <select
            name="matchChannel"
            aria-label="Channel"
            className={FIELD}
            defaultValue=""
          >
            <option value="">Any channel</option>
            {channels.map((ch) => (
              <option key={ch} value={ch}>
                {ch.replace("_", " ")}
              </option>
            ))}
          </select>
          <select
            name="matchCategory"
            aria-label="Category"
            className={FIELD}
            defaultValue=""
          >
            <option value="">Any category</option>
            {view.categories.map((c) => (
              <option key={c.code} value={c.code}>
                {c.labelEn}
              </option>
            ))}
          </select>
          <select
            name="setTeamId"
            aria-label="Team"
            className={FIELD}
            defaultValue=""
          >
            <option value="">Category&apos;s team</option>
            {view.teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <select
            name="assignMode"
            aria-label="Assign"
            className={FIELD}
            defaultValue="round_robin"
          >
            <option value="round_robin">In turn</option>
            <option value="fixed">One person</option>
            <option value="none">Nobody</option>
          </select>
          <div className="flex gap-2">
            <input
              name="assignEmail"
              type="email"
              placeholder="person's email"
              aria-label="Person for a fixed rule"
              className={`${FIELD} flex-1`}
            />
            <Button type="submit" disabled={busy}>
              Add
            </Button>
          </div>
        </form>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Holidays</h2>
        <p className="text-ink-muted">
          National plus KL/Selangor public holidays. Reply deadlines skip these
          days. Enter each year&apos;s dates from the official gazette: several
          follow the moon and are only fixed shortly before.
        </p>
        {view.holidays.length === 0 ? (
          <p className="text-danger">
            No holidays entered: deadlines treat every weekday as a working day.
          </p>
        ) : (
          <ul className="grid gap-1 sm:grid-cols-2">
            {view.holidays.map((h) => (
              <li
                key={h.day}
                className="flex items-center justify-between gap-2"
              >
                <span>
                  <span className="font-medium">{h.day}</span> {h.name}
                </span>
                <button
                  type="button"
                  className={SMALL}
                  disabled={busy}
                  onClick={() => post({ action: "deleteHoliday", day: h.day })}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
        <form
          className="flex flex-col gap-2"
          onSubmit={onSubmit(
            (f) => ({ action: "addHolidays", text: str(f, "lines") }),
            true,
          )}
        >
          <label htmlFor="lines" className="font-medium">
            Add holidays, one per line
          </label>
          <textarea
            id="lines"
            name="lines"
            rows={5}
            required
            maxLength={10000}
            placeholder="2026-12-25 Christmas Day"
            className="border-line-strong bg-surface-sunken focus-visible:outline-focus-ring rounded-sm border p-2 font-mono text-sm focus-visible:outline-2 focus-visible:outline-offset-2"
          />
          <Button type="submit" disabled={busy} className="self-start">
            Add holidays
          </Button>
        </form>
      </section>
    </div>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="bg-blue-soft text-blue-ink ml-2 rounded-full px-2 py-0.5 text-xs font-medium">
      {children}
    </span>
  );
}
