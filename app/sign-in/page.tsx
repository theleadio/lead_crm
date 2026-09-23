import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/server";
import { SignInForm } from "./sign-in-form";

export default async function SignInPage() {
  const user = await getSession();
  if (user) redirect("/people");

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="w-full max-w-sm rounded-lg border bg-white p-8 shadow-sm">
        <h1 className="mb-6 text-xl font-semibold">LEAD CRM</h1>
        <SignInForm />
      </div>
    </main>
  );
}
