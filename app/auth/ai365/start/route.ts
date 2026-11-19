import { startSignIn } from "@/lib/auth/flow";

// GET /auth/ai365/start?next= — sends the browser to AI365 (lib/auth/flow.ts).
export function GET(request: Request) {
  return startSignIn(request);
}
