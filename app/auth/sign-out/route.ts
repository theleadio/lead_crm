import { getCurrentUser } from "@/lib/auth/current-user";
import { signOutResponse } from "@/lib/auth/flow";

// POST /auth/sign-out — a plain form post from the top bar.
export async function POST(request: Request) {
  return signOutResponse(request, await getCurrentUser());
}
