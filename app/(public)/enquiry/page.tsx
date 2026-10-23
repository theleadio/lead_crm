import type { Metadata } from "next";
import { getSchedule } from "../schedule/feed";
import { EnquiryForm } from "./enquiry-form";

// §10.3. The enquiry form. Server-rendered so it is indexable and works on a
// slow phone; the form itself is a client component because it reports its
// own states (§13) and needs the CAPTCHA.

export const metadata: Metadata = {
  title: "Enquire — LEAD",
  description:
    "Tell us what you're looking for and we'll get back to you about LEAD's classes.",
};

// §10.3 wants the privacy notice beside the submit control. This app has no
// privacy page of its own, so the link points at the marketing site's, and is
// left out entirely when PUBLIC_WEBSITE_URL is unset — a dead link next to a
// consent box is worse than no link. Open question in the change proposal.
function privacyUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const base = (env.PUBLIC_WEBSITE_URL ?? "").trim().replace(/\/+$/, "");
  return base ? `${base}/privacy` : null;
}

export default async function EnquiryPage(props: PageProps<"/enquiry">) {
  const sp = await props.searchParams;
  // Cut to the 50 characters §8.2 allows for either code: both ride along as
  // hidden fields, so a longer one from a mistyped link would fail validation
  // with no field on the page for the visitor to correct.
  const one = (v: string | string[] | undefined) =>
    (Array.isArray(v) ? v[0] : v)?.trim().slice(0, 50) || null;
  const classCode = one(sp.class);
  const courseCode = one(sp.course);

  // The class is named from the §8.1 feed the schedule page already caches,
  // so this costs no extra query and shows exactly the classes a visitor
  // could have come from. A code that matches nothing — unknown, private,
  // cancelled or past — leaves the form generic rather than erroring: §8.2
  // ignores such a code too, and the enquiry is still worth capturing.
  //
  // The read can throw (no database, or the 5-second statement timeout) and
  // nothing in (public) catches it, so a failure here would answer the main
  // lead path with a 500 — every class card links here with ?class=.
  const cls = classCode
    ? await getSchedule()
        .then(
          (s) =>
            s.classes.find(
              (c) => c.code.toLowerCase() === classCode.toLowerCase(),
            ) ?? null,
        )
        .catch((e: unknown) => {
          console.error("enquiry class lookup failed", e);
          return null;
        })
    : null;

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6">
      <h1 className="text-ink mb-2 text-2xl font-semibold sm:text-3xl">
        {cls ? `Enquire about ${cls.courseName}` : "Talk to us"}
      </h1>
      {cls ? (
        <p className="text-ink-muted mb-8 text-sm">
          {cls.code} · starts {cls.startDate}
          {cls.city ? ` · ${cls.city}` : ""}. Tell us what you&apos;d like to
          know and we&apos;ll come back to you.
        </p>
      ) : (
        <p className="text-ink-muted mb-8 text-sm">
          Tell us what you&apos;re looking for and we&apos;ll come back to you
          about dates, pricing and HRDC claims.
        </p>
      )}

      <EnquiryForm
        classCode={cls?.code ?? classCode}
        courseCode={courseCode}
        privacyUrl={privacyUrl()}
      />
    </main>
  );
}
