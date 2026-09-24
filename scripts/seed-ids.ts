// Fixed app_user ids created by scripts/seed-dev.ts, so DEV_USER_ID and
// tests can refer to them.
export const SEED_USERS = {
  admin: "00000000-0000-4000-8000-00000000000a", // super_admin (tests)
  weiPing: "00000000-0000-4000-8000-000000000001", // sales
  daphne: "00000000-0000-4000-8000-000000000002", // marketing
  leeYee: "00000000-0000-4000-8000-000000000003", // part_time
};
