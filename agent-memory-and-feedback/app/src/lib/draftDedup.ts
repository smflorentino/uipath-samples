/**
 * Reduces a list of draft records to one row per `idField` value, keeping the
 * row with the latest `createdAtField` timestamp, then sorts the survivors by
 * `createdAtField` descending.
 *
 * Records with an unparseable or missing `createdAtField` sort last (within
 * their dispute group AND globally), so an old well-timestamped draft always
 * beats a newer-but-broken-timestamp one — and broken rows still appear at
 * the bottom of the grid instead of disappearing entirely.
 *
 * Pure function — no React/SDK dependencies. Lives in `lib/` so it can be
 * tested in isolation and reused if other panels need the same behavior.
 */
export function latestPerDispute<T extends Record<string, unknown>>(
  records: readonly T[],
  idField: string,
  createdAtField: string,
): T[] {
  const ts = (r: T): number => {
    const v = r[createdAtField];
    if (typeof v !== 'string') return Number.NEGATIVE_INFINITY;
    const ms = Date.parse(v);
    return Number.isFinite(ms) ? ms : Number.NEGATIVE_INFINITY;
  };

  const winners = new Map<string, T>();
  const orphans: T[] = [];
  for (const r of records) {
    const id = r[idField];
    if (typeof id !== 'string' || id.length === 0) {
      orphans.push(r);
      continue;
    }
    const existing = winners.get(id);
    if (!existing || ts(r) > ts(existing)) {
      winners.set(id, r);
    }
  }

  return [...winners.values(), ...orphans].sort((a, b) => ts(b) - ts(a));
}
