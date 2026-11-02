// Preloaded by .github/workflows/daily-sync.yml (node --import). The repo is
// public, so Actions logs are too: an uncaught postgres error would otherwise
// print its `detail`, which can hold a person's email or phone
// ("Key (email_norm)=(...) already exists"). Print the message only.
process.on("uncaughtException", (e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
