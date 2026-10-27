import type { Metadata } from "next";
import { dictionary } from "../../../dictionaries";
import { RegisterPage } from "../../../register/register-page";

// /zh/register/<classCode> — the same §10.4 page in Chinese. Same feed read,
// same §8.3 submission; the locale decides the words and which thank-you page
// Stripe returns the payer to.

const t = dictionary("zh");

export async function generateMetadata({
  params,
}: PageProps<"/zh/register/[classCode]">): Promise<Metadata> {
  const { classCode } = await params;
  const path = `/register/${encodeURIComponent(classCode)}`;
  return {
    title: t["register.title"],
    description: t["register.description"],
    alternates: {
      canonical: `/zh${path}`,
      languages: { en: path, zh: `/zh${path}` },
    },
  };
}

export default async function Page({
  params,
}: PageProps<"/zh/register/[classCode]">) {
  const { classCode } = await params;
  return <RegisterPage locale="zh" classCode={classCode} />;
}
