import { redirect } from "next/navigation";

// /zh and /zh/ had nothing to serve and answered 404, which is what a visitor
// gets for shortening a URL by hand and what a crawler following the /zh
// hreflang finds if it trims the path. The English side has no landing page
// either, so this sends the visitor to the schedule — the page the Chinese
// site is for (§10.5, §10.1).
//
// A redirect rather than a copy of the schedule page: one address for one
// page, so the canonical link and the hreflang pair stay unambiguous.

export default function ChineseHome() {
  redirect("/zh/schedule");
}
