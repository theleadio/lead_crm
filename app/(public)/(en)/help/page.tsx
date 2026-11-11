import type { Metadata } from "next";
import { connection } from "next/server";
import { helpCategories } from "../../../../lib/public/help.ts";
import { HelpForm } from "./help-form";

// /help — the public help form (moved from lead_sales with migration 019).
// Open to anyone; each submission becomes an enquiry for the right team
// (lib/public/help.ts). The website can link here, or post to
// /api/public/help itself. English only for now: a Chinese page needs its
// wording checked by Marketing first (the form already offers a Chinese
// reply).

export const metadata: Metadata = {
  title: "Get help · LEAD",
  description: "Ask LEAD about receipts, e-invoices, vouchers and more.",
  // No Chinese page yet, so no hreflang pair: only the canonical.
  alternates: { canonical: "/help" },
};

export default async function HelpPage() {
  // Read at request time: the categories can change in Settings.
  await connection();
  const categories = await helpCategories("en");
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6">
      <h1 className="text-ink mb-2 text-2xl font-semibold sm:text-3xl">
        Get help
      </h1>
      <p className="text-ink-muted mb-6 text-sm">
        Tell us what you need and we&apos;ll reply by the next working day.
      </p>
      <HelpForm categories={categories} />
    </main>
  );
}
