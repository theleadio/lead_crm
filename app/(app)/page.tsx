import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/server";

export default async function Home() {
  const user = await getSession();
  redirect(user ? "/people" : "/sign-in");
}
