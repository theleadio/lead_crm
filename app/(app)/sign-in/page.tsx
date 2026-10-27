import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/server";
import { SignInForm } from "./sign-in-form";

export default async function SignInPage() {
  const user = await getSession();
  if (user) redirect("/people");

  return (
    <main className="bg-surface flex min-h-screen items-center justify-center">
      <div className="border-line bg-surface-raised w-full max-w-sm rounded-md border p-8 shadow-sm">
        <h1 className="mb-6 flex items-center gap-2.5">
          <span
            aria-hidden="true"
            className="bg-charcoal flex size-[30px] items-center justify-center gap-0.5 rounded-full"
          >
            <span className="bg-lead-yellow h-3.5 w-1 rounded-[1px]" />
            <span className="flex flex-col gap-0.5">
              <span className="h-[2.5px] w-[9px] rounded-[1px] bg-[#8FA6F5]" />
              <span className="h-[2.5px] w-[7px] rounded-[1px] bg-[#8FA6F5]" />
              <span className="h-[2.5px] w-[9px] rounded-[1px] bg-[#8FA6F5]" />
            </span>
          </span>
          <span className="text-ink text-xl font-bold tracking-wider">
            LEAD CRM
          </span>
        </h1>
        <SignInForm />
      </div>
    </main>
  );
}
