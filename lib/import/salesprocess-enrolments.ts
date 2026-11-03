import { createHash } from "node:crypto";

export const PRODUCT_COURSE: Record<string, string> = {
  ".01 LEAD - AI Agentic Automation Certification Landing Page": "lms-ai-agentic-automation-certification",
  ".02 LEAD - EN - AI Full-Stack Building Certification Landing Page": "lms-ai-full-stack-building-certification",
  ".02 LEAD - CN - AI Full-Stack Building Certification Landing Page": "lms-ai-full-stack-building-certification",
  "[26-27 Sept] AI Full-Stack Building Certification": "lms-ai-full-stack-building-certification",
  ".03 LEAD - Professional AI Engineering Certification": "lms-professional-ai-engineering-certification",
  ".05 LEAD - AI Agents Foundation Certification": "lms-ai-agents-foundation",
  ".05 LEAD - AI Agents Online Workshop": "lms-ai-agents-online-workshop",
  "AI Agents Online Workshop": "lms-ai-agents-online-workshop",
  "AI Agents 线上实作课": "lms-ai-agents-online-workshop",
  "[LIVE] Claude AI Mastery": "lms-claude-ai-mastery",
  "AI Vibe Coding 实战课 ": "lms-ai-vibe-coding",
  "AI Vibe Coding 实战课 - JB": "lms-ai-vibe-coding",
};

export const ONLINE_COURSES: ReadonlySet<string> = new Set(["lms-ai-agents-online-workshop"]);
export const IMPORT_CLASS_NOTE = "Imported from SalesProcess.";
export const SYNC_LOCK_KEY = 7_302_611;

// Changing this re-keys every imported row.
const NAMESPACE = "6f1d2c3a-4b5e-4f60-8a71-92b3c4d5e6f7";

export function uuidV5(name: string): string {
  const ns = Buffer.from(NAMESPACE.replaceAll("-", ""), "hex");
  const b = createHash("sha1").update(ns).update(name).digest().subarray(0, 16);
  b[6] = (b[6] & 0x0f) | 0x50;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function classIdFor(courseCode: string, start: string, language: "en" | "zh"): string {
  return uuidV5(`sp-class|${courseCode}|${start}|${language}`);
}

export function enrolmentIdFor(orderId: string): string {
  return uuidV5(`sp-enrolment|${orderId}`);
}

export type Txn = { status: string; paid_at: Date; amount_myr: number; refunded_myr: number };

export function orderState(txns: Txn[]): { state: "paid" | "refunded" | "ignore"; priceMyr: number } {
  let latest: Txn | undefined;
  for (const t of txns) if (!latest || t.paid_at.getTime() >= latest.paid_at.getTime()) latest = t;
  if (!latest) return { state: "ignore", priceMyr: 0 };
  const state = latest.status === "succeeded" || latest.status === "partially_refunded" ? "paid" : latest.status === "refunded" ? "refunded" : "ignore";
  if (state === "ignore") return { state, priceMyr: 0 };
  return { state, priceMyr: Math.round((latest.amount_myr - latest.refunded_myr) * 100) / 100 };
}

export type ClassCandidate = { id: string; language: "en" | "zh" };

export function pickClass(candidates: ClassCandidate[], language: "en" | "zh" | null): string | "ambiguous" | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0].id;
  const match = language ? candidates.filter((c) => c.language === language) : [];
  return match.length === 1 ? match[0].id : "ambiguous";
}

export function classCodeFor(courseCode: string, start: string, language: "en" | "zh"): string {
  return `${courseCode.replace(/^lms-/, "")}-${start}-${language}`;
}
