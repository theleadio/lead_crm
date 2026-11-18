// Spec §9.15 Templates, §6: templates have no table here, so this tab only
// says where they are edited. Read-only on purpose.
//
// Email templates live in Resend (Shawn, 18 Nov 2026).
// shortcut: WATI's general sign-in address; swap in the account's own link
// once Shawn confirms it.
const WATI_URL = "https://app.wati.io/";
const RESEND_TEMPLATES_URL = "https://resend.com/templates";

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
          Email templates are written and edited in Resend, the email sending
          service, not in the CRM.
        </p>
        <a
          href={RESEND_TEMPLATES_URL}
          target="_blank"
          rel="noreferrer"
          className="text-blue-ink inline-block underline"
        >
          Open Resend
        </a>
      </section>
    </div>
  );
}
