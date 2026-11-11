import { redirect } from "next/navigation";

// /zh/help — the header's language link points here from /help. There is no
// Chinese help page yet (its wording needs Marketing's check first), so this
// sends the visitor to the English form, which offers a reply in Chinese.
// Replace with the real page once the wording exists.
export default function Page() {
  redirect("/help");
}
