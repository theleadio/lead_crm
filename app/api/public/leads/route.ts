import { handleLead, handleOptions } from "@/lib/public/handlers";

// POST /api/public/leads — spec §8.2. No session: X-Api-Key, CAPTCHA and a
// rate limit instead. All the rules live in lib/public so tests can call them.
export const POST = (request: Request) => handleLead(request);
export const OPTIONS = (request: Request) => handleOptions(request);
