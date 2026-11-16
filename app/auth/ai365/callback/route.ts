import { finishSignIn } from "@/lib/auth/flow";

// GET /auth/ai365/callback — the exact path registered with AI365.
export function GET(request: Request) {
  return finishSignIn(request);
}
