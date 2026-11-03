import { localePath, type Locale } from "./locale.ts";

// Where every "get in touch" on the public site goes (§10.3). The form is
// ours and always served, so this always returns a real path — no caller has
// to handle a missing destination any more, and no link is ever rendered to
// somewhere we do not serve.
//
// The locale is required, not defaulted: a link that forgets it would drop a
// Chinese reader onto the English form, which is the silent failure this
// signature makes a type error instead (§10.5).
//
// The class code rides along so the form can name the class and §8.2 can
// attach the lead's deal to it. It is only ever a reference: an unknown code
// leaves the form generic rather than erroring.
export function enquiryUrl(locale: Locale, classCode?: string | null): string {
  const code = classCode?.trim();
  const path = localePath(locale, "/enquiry");
  return code ? `${path}?class=${encodeURIComponent(code)}` : path;
}
