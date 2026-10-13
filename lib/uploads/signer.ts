import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Spec §9.12 proof storage, §14 uploads. The only file in the app that knows
// which object store holds payment proofs. Everything else passes the opaque
// key that `payment.proof_file_key` stores, so moving to another provider —
// DigitalOcean Spaces speaks the S3 API — changes this file and the
// environment variables, and no caller and no column (design 1).
//
// Service-role key, so the bucket stays private: §14 allows no public access
// and short-lived signed URLs only. Server-only; never imported by a client
// component.

// Thrown when the environment is not set up, rather than letting a call reach
// the network and fail as something else. The modal turns it into the §13
// error state, and no payment is recorded (migration 001 refuses a manual
// payment with no proof key anyway).
export class UploadConfigError extends Error {
  constructor(name: string) {
    super(`${name} is not set`);
    this.name = "UploadConfigError";
  }
}

// §14: short enough that a copied link is useless, long enough to open a PDF.
const READ_URL_TTL_SECONDS = 60;

const globalForStorage = globalThis as unknown as {
  __leadStorage?: SupabaseClient;
};

function bucketName(): string {
  const bucket = process.env.PAYMENT_PROOF_BUCKET;
  if (!bucket) throw new UploadConfigError("PAYMENT_PROOF_BUCKET");
  return bucket;
}

// Cached on globalThis so dev hot-reload doesn't build a client per request,
// as `lib/sql.ts` does with the pool.
function bucket() {
  if (!globalForStorage.__leadStorage) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url) throw new UploadConfigError("NEXT_PUBLIC_SUPABASE_URL");
    if (!key) throw new UploadConfigError("SUPABASE_SERVICE_ROLE_KEY");
    globalForStorage.__leadStorage = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return globalForStorage.__leadStorage.storage.from(bucketName());
}

// The key a proof will be stored under. Minted on the server and prefixed with
// the enrolment, so a key issued for one enrolment cannot be attached to
// another (design 2) — `proofKeyBelongsTo` below is the check that enforces it.
export function proofKeyFor(enrolmentId: string): string {
  return `${enrolmentId}/${crypto.randomUUID()}`;
}

export function proofKeyBelongsTo(key: string, enrolmentId: string): boolean {
  return key.startsWith(`${enrolmentId}/`);
}

// A one-shot signed URL the browser PUTs the file to. The bucket is private, so
// this is the only way in, and the client never learns the bucket or the
// service-role key (§14).
export async function signUpload(
  key: string,
): Promise<{ uploadUrl: string; token: string }> {
  const { data, error } = await bucket().createSignedUploadUrl(key);
  if (error || !data) throw error ?? new Error("could not sign the upload");
  return { uploadUrl: data.signedUrl, token: data.token };
}

// A short-lived signed URL for reading one proof back (§14). Minted per click
// by the proof route, which audits the read (§6), so nothing in a rendered
// page outlives the click.
export async function signRead(key: string): Promise<string> {
  const { data, error } = await bucket().createSignedUrl(
    key,
    READ_URL_TTL_SECONDS,
  );
  if (error || !data) throw error ?? new Error("could not sign the read");
  return data.signedUrl;
}

// The stored bytes, or null when the key holds no object. The save verifies
// the object it is about to record against (§14, design 3) — the declared
// content type proves nothing, so the bytes are read instead.
export async function readObject(key: string): Promise<Uint8Array | null> {
  const { data, error } = await bucket().download(key);
  if (error || !data) return null;
  return new Uint8Array(await data.arrayBuffer());
}
