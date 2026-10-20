import Link from "next/link";
import { enquiryUrl } from "./enquiry-link";

// The public website's shell (§10). It reads no session and imports nothing
// from lib/auth: a visitor must never be bounced to sign-in, and a marketing
// page must not depend on the sign-in provider being reachable. proxy.ts skips
// these paths for the same reason.

export default function PublicLayout({ children }: LayoutProps<"/">) {
  const enquire = enquiryUrl();

  return (
    <div className="bg-surface text-ink flex min-h-screen flex-col">
      <header className="border-line border-b">
        <nav className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <span className="text-ink text-base font-semibold">LEAD</span>
          <div className="flex items-center gap-4 text-sm">
            <Link href="/schedule" className="text-ink-muted hover:text-ink">
              Schedule
            </Link>
            {enquire && (
              <a href={enquire} className="text-ink-muted hover:text-ink">
                Talk to us
              </a>
            )}
          </div>
        </nav>
      </header>
      {children}
    </div>
  );
}
