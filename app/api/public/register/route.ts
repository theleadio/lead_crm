import { handleOptions, handleRegister } from "@/lib/public/handlers";

// POST /api/public/register — spec §8.3. Everything §8.2 does, then the seat
// and the Stripe Checkout session. All the rules live in lib/public so tests
// can call them with a fake env and a fake payment provider.
export const POST = (request: Request) => handleRegister(request);
export const OPTIONS = (request: Request) => handleOptions(request);
