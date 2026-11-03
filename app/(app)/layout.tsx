import type { Metadata } from "next";
import { Geist_Mono, Inter } from "next/font/google";
import "../globals.css";

// The CRM's root layout: the dashboard, every (crm) screen, the sign-in page
// and /. One of three root layouts, not the one above them all — there is no
// app/layout.tsx, so the two public trees are roots of their own and can set
// their own <html lang> (§14, WCAG 3.1.1). See app/(public)/public-root.tsx.
//
// The group adds no URL segment, so nothing a visitor or a bookmark sees
// changed. Moving between here and a public page is a full page load, which
// it already was: nothing links across.
//
// `lang="en"` is this tree's own. The CRM is English-only (§10.5 covers the
// public site), so it is a statement about these screens and not a default
// the public pages inherit any more.

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "LEAD CRM",
  description: "LEAD CRM",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`dark ${inter.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
