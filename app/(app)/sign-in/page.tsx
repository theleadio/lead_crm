import Image from "next/image";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import leadLogoWhite from "@/public/brand/lead-logo-white.webp";

// What went wrong on the way back from AI365 (lib/auth/flow.ts). The button
// below is the retry: every one of these starts sign-in over.
const ERRORS: Record<string, string> = {
  not_verified:
    "Your AI365 account is not active or verified yet. Finish setting it up in AI365, then try again.",
  expired: "That sign-in didn't finish in time. Please sign in again.",
  state:
    "We couldn't match that sign-in to this browser. Please sign in again from this page.",
  unavailable:
    "Sign-in isn't working right now. Try again in a few minutes, and tell a super admin if it keeps happening.",
};

const BUTTON =
  "bg-lead-blue hover:bg-lead-blue-hover focus-visible:outline-focus-ring text-on-blue block w-full cursor-pointer rounded-full py-2.5 text-center text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2";

export default async function SignInPage(props: PageProps<"/sign-in">) {
  if (await getCurrentUser()) redirect("/people");
  const { next, error } = await props.searchParams;
  const message = typeof error === "string" ? ERRORS[error] : undefined;
  const start =
    typeof next === "string"
      ? `/auth/ai365/start?next=${encodeURIComponent(next)}`
      : "/auth/ai365/start";
  // AI365 only sends people back to the production site, so local
  // development signs in as DEV_USER_ID (the route 404s in production).
  const devSignIn =
    process.env.NODE_ENV !== "production" && !!process.env.DEV_USER_ID?.trim();

  return (
    <main className="bg-surface flex min-h-screen items-center justify-center">
      <div className="border-line bg-surface-raised w-full max-w-sm rounded-md border p-8">
        <h1 className="mb-6 flex items-center gap-3">
          <Image
            src={leadLogoWhite}
            alt="LEAD"
            width={85}
            loading="eager"
            className="h-8 w-auto"
          />
          {/* A quiet suffix, not a second wordmark: caps sized to the logo's
              lettering (about 13px tall at this height), muted, and nudged
              2px down because the lettering sits below the image's centre. */}
          <span aria-hidden="true" className="bg-line-strong h-5 w-px" />
          <span className="text-ink-muted translate-y-0.5 text-lg leading-none font-semibold tracking-[0.12em]">
            CRM
          </span>
        </h1>
        <div className="space-y-4">
          {message && (
            <p role="alert" className="text-danger text-sm">
              {message}
            </p>
          )}
          {/* A plain link, not fetch: the browser itself goes to AI365. */}
          <a href={start} className={BUTTON}>
            Sign in with AI365
          </a>
          {devSignIn && (
            <form action="/auth/dev-sign-in" method="post">
              <button className="border-line-strong text-ink focus-visible:outline-focus-ring w-full cursor-pointer rounded-full border py-2.5 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2">
                Dev sign-in
              </button>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}
