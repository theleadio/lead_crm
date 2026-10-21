// Where every "get in touch" on the public site goes (§10.3). The form is
// ours and always served, so this always returns a real path — no caller has
// to handle a missing destination any more, and no link is ever rendered to
// somewhere we do not serve.
//
// The class code rides along so the form can name the class and §8.2 can
// attach the lead's deal to it. It is only ever a reference: an unknown code
// leaves the form generic rather than erroring.
export function enquiryUrl(classCode?: string | null): string {
  const code = classCode?.trim();
  return code ? `/enquiry?class=${encodeURIComponent(code)}` : "/enquiry";
}
