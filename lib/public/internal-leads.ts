import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { leadSchema } from "../validation/public.ts";
import { captureLead, type LeadResult } from "./leads.ts";

// POST /api/internal/leads — server-to-server lead intake for lead_sales,
// first for Meta Lead Ads (decided 4 Nov: lead_sales receives Meta's
// webhook, fetches the lead, and the CRM saves it). It runs the same
// captureLead() as the website forms, so the same dedupe, consent and deal
// rules apply (spec §12.2, §8.2). Not for browsers: there is no CORS and no
// CAPTCHA, so it is closed unless INTERNAL_API_KEY is set, and the key is
// held only by lead_sales' server.

type Env = Record<string, string | undefined>;

const digest = (s: string) => createHash("sha256").update(s).digest();

// Several keys, comma separated, so the key can be rotated without a gap.
// Unset or shorter than 32 characters = not configured = closed.
export function checkInternalKey(
  env: Env,
  presented: string | null,
): "ok" | "bad" | "unconfigured" {
  const keys = (env.INTERNAL_API_KEY ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter((k) => k.length >= 32);
  if (!keys.length) return "unconfigured";
  const got = digest(presented ?? "");
  let ok = false;
  for (const k of keys) if (timingSafeEqual(digest(k), got)) ok = true;
  return ok ? "ok" : "bad";
}

// The website lead body, plus where it came from. The idempotency key is
// required: Meta can deliver one lead more than once, and lead_sales sends
// `meta-leadgen:<lead id>` so a repeat never makes a second person or deal.
export const internalLeadSchema = leadSchema.safeExtend({
  idempotencyKey: z
    .string()
    .trim()
    .min(8)
    .max(100)
    .regex(/^[A-Za-z0-9_.:-]+$/, "Letters, digits and _ . : - only"),
  source: z.literal("meta_lead_ad"),
  campaignId: z.string().trim().max(100).nullish(),
  adId: z.string().trim().max(100).nullish(),
});
export type InternalLeadInput = z.output<typeof internalLeadSchema>;

export async function captureInternalLead(
  input: InternalLeadInput,
): Promise<LeadResult & { replayed: boolean }> {
  const { source, campaignId, adId, ...lead } = input;
  void source; // one source today; the channel follows from it
  return captureLead(lead, {
    landingUrl: null,
    referrer: null,
    channel: "lead_form",
    campaignId: campaignId ?? null,
    adId: adId ?? null,
  });
}
