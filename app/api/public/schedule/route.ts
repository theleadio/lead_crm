import { handleOptions, handleSchedule } from "@/lib/public/handlers";

// GET /api/public/schedule — spec §8.1. No session: the website calls it with
// X-Api-Key. All the rules live in lib/public so tests can call them.
export const GET = (request: Request) => handleSchedule(request);
export const OPTIONS = (request: Request) => handleOptions(request);
