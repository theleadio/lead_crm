import { PublicChrome } from "../public-chrome";

// The English public pages. A route group adds no URL segment, so these are
// served at /schedule and /enquiry — the paths they had before the Chinese
// site existed, unchanged and still canonical (§10.5).
//
// The `lang` for these pages is the root layout's own `lang="en"`.

export default function EnglishPublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <PublicChrome locale="en">{children}</PublicChrome>;
}
