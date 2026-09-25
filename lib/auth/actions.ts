"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentUser } from "./current-user";
import { safeNext, signIn, signOut, WRONG_LOGIN } from "./sign-in";

// Server Actions are public POST endpoints, so input is validated here and
// sign-out reads the user from the session, never from the request.
const signInSchema = z.object({
  email: z.string().trim().min(1).max(320),
  password: z.string().min(1).max(1000),
  next: z.string().optional(),
});

const forwardedFor = async () => (await headers()).get("x-forwarded-for");

export async function signInAction(
  _prev: { error?: string } | undefined,
  formData: FormData,
): Promise<{ error?: string }> {
  const parsed = signInSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: WRONG_LOGIN };

  const result = await signIn(
    parsed.data.email,
    parsed.data.password,
    await forwardedFor(),
  );
  if (!result.ok) return { error: result.error };
  redirect(safeNext(parsed.data.next));
}

export async function signOutAction() {
  await signOut(await getCurrentUser(), await forwardedFor());
  redirect("/sign-in");
}
