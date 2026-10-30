// §9.18: a panel whose data does not exist yet says so, and draws nothing. An
// axis pair with no marks reads as a panel that broke; a zero-length bar reads
// as a programme that spent nothing. Neither is true — the data has not
// arrived — so the panel says which data.
export function WaitingPanel({
  title,
  waitingFor,
}: {
  title: string;
  waitingFor: string;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-base font-semibold">{title}</h2>
      <div className="border-line bg-surface-raised rounded-md border p-5">
        <p className="text-ink-muted text-sm">Waiting on {waitingFor}.</p>
      </div>
    </section>
  );
}
