import Link from "next/link";
import { formatDateRange } from "@/lib/format/date";
import { formatMoneyMyr } from "@/lib/format/money";
import { checkoutConfigured } from "@/lib/payments/checkout";
import { privacyUrl } from "@/lib/public/links";
import type { ScheduleClass } from "@/lib/public/schedule";
import { dictionary, fill, type Dict } from "../dictionaries";
import { EnquiryForm, type FormLabels } from "../enquiry/enquiry-form";
import { enquiryUrl } from "../enquiry-link";
import { LOCALE_LANG, localePath, type Locale } from "../locale";
import { getSchedule } from "../schedule/feed";
import { registerState, type RegisterState } from "./register-view";
import {
  languageLabel,
  placeLabel,
  seatsLabel,
  timeLabel,
} from "../schedule/schedule-view";
import { submitRegistration } from "./submit";

// §10.4. The register page, server-rendered: what the visitor is about to
// book, then the form. One body, rendered once per locale by the thin route
// files in (en)/ and zh/.
//
// The class comes from the §8.1 feed the schedule page already caches, so
// this costs no extra query and can only ever name a class the feed lists. A
// code it cannot find is not a 404: the visitor came from somewhere, so the
// page says why it cannot take the booking and points at the enquiry form
// (website-lead-capture).

// §10.4's labels for the shared form (§10.3's fields, unchanged): only the
// two control words differ. Both of this page's answers leave it — for
// Stripe, or for /register/thank-you — so there is no settled state here to
// label.
const REGISTER_LABELS: FormLabels = {
  submit: "register.submit",
  submitting: "register.submitting",
};

export async function RegisterPage({
  locale,
  classCode,
}: {
  locale: Locale;
  classCode: string;
}) {
  const t = dictionary(locale);
  const code = classCode.trim().slice(0, 50);
  // A failed read must not take the register page down with it: the visitor
  // then gets the not-bookable state and the enquiry form, which is a worse
  // page but a working one (§13).
  const cls = await getSchedule()
    .then(
      (s) =>
        s.classes.find((c) => c.code.toLowerCase() === code.toLowerCase()) ??
        null,
    )
    .catch((e: unknown) => {
      console.error("register class lookup failed", e);
      return null;
    });
  const state = registerState(cls, checkoutConfigured(process.env));

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6">
      {cls ? (
        <>
          <h1 className="text-ink mb-2 text-2xl font-semibold sm:text-3xl">
            {fill(t["register.heading"], { course: cls.courseName })}
          </h1>
          <ClassSummary cls={cls} t={t} />
        </>
      ) : (
        <h1 className="text-ink mb-4 text-2xl font-semibold sm:text-3xl">
          {t["register.unavailable.heading"]}
        </h1>
      )}

      {state === "bookable" && cls ? (
        <>
          <p className="text-ink-muted mb-8 text-sm">
            {t["register.standfirst"]}
          </p>
          <p className="text-ink-muted mb-6 text-sm">
            {t["register.hrdcNote"]}
          </p>
          <EnquiryForm
            classCode={cls.code}
            courseCode={null}
            privacyUrl={privacyUrl()}
            locale={locale}
            t={t}
            action={submitRegistration}
            labels={REGISTER_LABELS}
          />
        </>
      ) : (
        <Blocked state={state} code={cls?.code ?? code} locale={locale} t={t} />
      )}
    </main>
  );
}

// Every detail here is the §8.1 feed's and is rendered as it gave it, in both
// locales: the course name, the code, the dates, the venue and the price are
// data, not copy (website-localisation).
function ClassSummary({ cls, t }: { cls: ScheduleClass; t: Dict }) {
  const time = timeLabel(cls);
  const price = cls.priceMyr ? formatMoneyMyr(cls.priceMyr) : null;
  return (
    <dl className="border-line bg-surface-raised mb-8 grid gap-3 rounded-2xl border p-5 text-sm sm:grid-cols-2">
      <Row label={t["register.summary.dates"]}>
        {formatDateRange(cls.startDate, cls.endDate)}
        {time ? ` · ${time}` : ""}
      </Row>
      <Row label={t["register.summary.where"]}>{placeLabel(cls, t)}</Row>
      {price && <Row label={t["register.summary.price"]}>{price}</Row>}
      <Row label={t["register.summary.seats"]}>{seatsLabel(cls, t)}</Row>
      {/* Which language the class is taught in — a Chinese reader may be
          booking an English class — named in this page's own words, as the
          card's badge names it (website-localisation). */}
      <Row label={t["filter.language"]}>
        <span lang={cls.language === "zh" ? LOCALE_LANG.zh : undefined}>
          {languageLabel(cls.language, t)}
        </span>
      </Row>
      <Row label="">
        <span className="text-ink-subtle">{cls.code}</span>
      </Row>
    </dl>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      {label && <dt className="text-ink-subtle text-xs">{label}</dt>}
      <dd className="text-ink">{children}</dd>
    </div>
  );
}

// No booking today, for one of three reasons. Each says which, and each
// offers the enquiry form in this page's locale, carrying the code where
// there is one — a lead-shaped exit, never a dead end (website-lead-capture).
function Blocked({
  state,
  code,
  locale,
  t,
}: {
  state: RegisterState;
  code: string | null;
  locale: Locale;
  t: Dict;
}) {
  const key = state === "bookable" ? "unavailable" : state;
  return (
    <div className="border-line bg-surface-raised rounded-2xl border p-6">
      <h2 className="text-ink font-semibold">
        {t[`register.${key}.heading` as keyof Dict]}
      </h2>
      <p className="text-ink-muted mt-2 text-sm">
        {t[`register.${key}.body` as keyof Dict]}
      </p>
      <div className="mt-4 flex flex-wrap gap-4 text-sm">
        <Link
          href={enquiryUrl(locale, code)}
          className="text-ink underline underline-offset-4"
        >
          {t["register.toEnquiry"]}
        </Link>
        <Link
          href={localePath(locale, "/schedule")}
          className="text-ink-muted hover:text-ink underline underline-offset-4"
        >
          {t["register.toSchedule"]}
        </Link>
      </div>
    </div>
  );
}
