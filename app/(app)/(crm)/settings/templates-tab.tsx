// Spec §9.15 Templates, §6: templates have no table here, so this tab only
// says where they are edited. Read-only on purpose.
//
// Open (proposal question 2, for Shawn): which email service holds the email
// templates, and its link. Until then the email line names no service.
// shortcut: WATI's general sign-in address; swap in the account's own link
// once Shawn confirms it.
const WATI_URL = "https://app.wati.io/";

export function TemplatesTab() {
  return (
    <div className="border-line bg-surface-raised max-w-2xl space-y-4 rounded-md border p-5 text-sm">
      <section className="space-y-1">
        <h2 className="font-semibold">WhatsApp templates</h2>
        <p className="text-ink-muted">
          WhatsApp templates have to be approved by Meta, so they are written
          and edited in WATI. Changes there show up in the CRM inbox once Meta
          approves them.
        </p>
        <a
          href={WATI_URL}
          target="_blank"
          rel="noreferrer"
          className="text-blue-ink inline-block underline"
        >
          Open WATI
        </a>
      </section>
      <section className="space-y-1">
        <h2 className="font-semibold">Email templates</h2>
        <p className="text-ink-muted">
          Email templates are edited in the email sending service, not in the
          CRM. Where to find them will be added here.
        </p>
      </section>
    </div>
  );
}
