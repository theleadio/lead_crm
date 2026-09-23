import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/server";
import { SignInForm } from "./sign-in-form";

export default async function SignInPage() {
  const user = await getSession();
  if (user) redirect("/people");

  return (
    <main className="bg-surface flex min-h-screen items-center justify-center">
      <div className="border-line bg-surface-raised w-full max-w-sm rounded-md border p-8 shadow-sm">
        <h1 className="bg-lead-yellow text-on-yellow mb-6 inline-block rounded-sm px-3 py-1.5 text-xl font-semibold">
          LEAD CRM
        </h1>
        <SignInForm />
      </div>
    </main>
  );
}
