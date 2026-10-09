import type { NextRequest } from "next/server";
import { apiError, forbidden, validationError } from "@/lib/api/errors";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canRecordPayment } from "@/lib/payments/service";
import { proofKeyFor, signUpload } from "@/lib/uploads/signer";
import { uploadSignSchema } from "@/lib/validation/payment";

// POST /api/uploads/sign — §7, §9.12 proof upload, §14. Hands back a
// short-lived signed URL for one upload into the private bucket, plus the key
// to send on save. The key is minted here and prefixed with the enrolment, so
// the browser never names a path in the bucket (design 2) and a key issued for
// one enrolment cannot be attached to another.
export async function POST(request: NextRequest) {
  const viewer = await getCurrentUser();
  if (!viewer) return apiError(401, "unauthenticated", "Sign in to continue.");
  // §6 payment row: operations and super_admin only. The save checks again —
  // this is not the security boundary on its own.
  if (!canRecordPayment(viewer))
    return forbidden(viewer, request, {
      what: "record payments",
      resource: "payment",
    });

  const parsed = uploadSignSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) return validationError(parsed.error);

  const key = proofKeyFor(parsed.data.enrolmentId);
  try {
    const { uploadUrl, token } = await signUpload(key);
    return Response.json({ uploadUrl, token, key });
  } catch (err) {
    // The bucket is Shawn's to create per environment (§9.12). Without it the
    // modal must show the §13 error state and record nothing, rather than
    // crash — migration 001 refuses a manual payment with no proof anyway.
    console.error("proof upload could not be signed", err);
    return apiError(
      503,
      "upload_unavailable",
      "Payment proofs can't be uploaded right now. Ask Shawn to check the proof storage, then try again.",
    );
  }
}
