import Image from "next/image";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/server";
import leadLogoWhite from "@/public/brand/lead-logo-white.webp";
import { SignInForm } from "./sign-in-form";

export default async function SignInPage() {
  const user = await getSession();
  if (user) redirect("/people");

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
        <SignInForm />
      </div>
    </main>
  );
}
