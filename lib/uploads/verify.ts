// Spec §14: uploads are images or PDF, 10MB maximum, and the content type is
// verified server-side and **not** by extension. A browser declares both the
// file name and the content type, so neither proves anything — the stored
// bytes are what this reads (design 3).

export const MAX_PROOF_BYTES = 10 * 1024 * 1024;

// The leading bytes of the four types §9.12 accepts. WebP carries "RIFF" then
// four size bytes then "WEBP", so it is the one signature with a hole in it.
const SIGNATURES: { type: string; at: number; bytes: number[] }[] = [
  { type: "application/pdf", at: 0, bytes: [0x25, 0x50, 0x44, 0x46] }, // %PDF
  { type: "image/jpeg", at: 0, bytes: [0xff, 0xd8, 0xff] },
  {
    type: "image/png",
    at: 0,
    bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  },
  { type: "image/webp", at: 0, bytes: [0x52, 0x49, 0x46, 0x46] }, // RIFF
  { type: "image/webp", at: 8, bytes: [0x57, 0x45, 0x42, 0x50] }, // WEBP
];

function matches(bytes: Uint8Array, at: number, expected: number[]): boolean {
  if (bytes.length < at + expected.length) return false;
  return expected.every((byte, i) => bytes[at + i] === byte);
}

function sniff(bytes: Uint8Array): string | null {
  const webp =
    matches(bytes, 0, [0x52, 0x49, 0x46, 0x46]) &&
    matches(bytes, 8, [0x57, 0x45, 0x42, 0x50]);
  if (webp) return "image/webp";
  for (const { type, at, bytes: expected } of SIGNATURES) {
    // RIFF alone is not WebP — it is also WAV and AVI — so it only counts
    // through the check above.
    if (type === "image/webp") continue;
    if (matches(bytes, at, expected)) return type;
  }
  return null;
}

export type ProofCheck =
  | { ok: true; contentType: string }
  | { ok: false; reason: "empty" }
  // §13 names the file's size and the limit, so both travel with the refusal.
  | { ok: false; reason: "too_large"; bytes: number; limit: number }
  | { ok: false; reason: "unsupported_type" };

// What the save calls before it writes the payment row (§14). It is given the
// object that is actually stored, never the browser's claim about it.
export function verifyProof(bytes: Uint8Array): ProofCheck {
  if (bytes.length === 0) return { ok: false, reason: "empty" };
  if (bytes.length > MAX_PROOF_BYTES)
    return {
      ok: false,
      reason: "too_large",
      bytes: bytes.length,
      limit: MAX_PROOF_BYTES,
    };
  const contentType = sniff(bytes);
  if (!contentType) return { ok: false, reason: "unsupported_type" };
  return { ok: true, contentType };
}

// §13: "That file is 14MB. The limit is 10MB — try a photo instead of a scan."
// Whole megabytes, because that is how the person chose the file.
export function formatMegabytes(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))}MB`;
}
