import { formatDate } from "@/lib/format/date";
import { privacyUrl } from "@/lib/public/links";
import { dictionary, fill } from "../dictionaries";
import type { Locale } from "../locale";
import { getSchedule } from "../schedule/feed";
import { EnquiryForm } from "./enquiry-form";

// §10.3. The enquiry form. Server-rendered so it is indexable and works on a
// slow phone; the form itself is a client component because it reports its
// own states (§13) and needs the CAPTCHA.
//
// One body, rendered once per locale by the thin route files in (en)/ and
// zh/. The locale picks the words and the form's preferred-language default;
// the class it names, and everything sent to §8.2, are otherwise identical
// (website-lead-capture).

// §10.3 wants the privacy notice beside the submit control, which
// `privacyUrl` provides. The notice is the same one in both locales until
// marketing says a Chinese one exists (proposal L3); only the link's text is
// localised, because a consent box needs a notice beside it in either
// language.

export async function EnquiryPage({
  locale,
  searchParams,
}: {
  locale: Locale;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const t = dictionary(locale);
  const sp = await searchParams;
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
        {cls
          ? fill(t["enquiry.heading.class"], { course: cls.courseName })
          : t["enquiry.heading"]}
      </h1>
      {cls ? (
        <p className="text-ink-muted mb-8 text-sm">
          {/* Two whole sentences, each from the dictionary with its own
              punctuation — Chinese ends a sentence with 。and would not take
              a full stop added here. The code, the date and the city are the
              feed's and stay as it gave them (website-localisation). */}
          {fill(
            cls.city ? t["enquiry.class.metaCity"] : t["enquiry.class.meta"],
            {
              code: cls.code,
              // §4's format in both locales, not the feed's ISO date.
              date: formatDate(cls.startDate),
              city: cls.city ?? "",
            },
          )}{" "}
          {t["enquiry.class.invite"]}
        </p>
      ) : (
        <p className="text-ink-muted mb-8 text-sm">{t["enquiry.standfirst"]}</p>
      )}

      <EnquiryForm
        classCode={cls?.code ?? classCode}
        courseCode={courseCode}
        privacyUrl={privacyUrl()}
        locale={locale}
        t={t}
      />
    </main>
  );
}
