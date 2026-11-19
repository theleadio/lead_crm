import { devSignIn } from "@/lib/auth/flow";

// POST /auth/dev-sign-in — local development only; 404 in production.
export function POST(request: Request) {
  return devSignIn(request);
}
