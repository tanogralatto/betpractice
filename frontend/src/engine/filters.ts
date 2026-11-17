/** Filtros de rango de Pre partido. Un partido se muestra solo si cumple TODOS. */
import type { Filters, Range, Row } from "../api";

export function inRange(value: number | null | undefined, rng?: Range | null): boolean {
  if (!rng) return true;
  const [lo, hi] = rng;
  if ((lo === null || lo === undefined) && (hi === null || hi === undefined)) return true;
  if (value === null || value === undefined) return false;
  if (lo !== null && lo !== undefined && value < lo) return false;
  if (hi !== null && hi !== undefined && value > hi) return false;
  return true;
}

export function rowPasses(row: Row, f?: Filters | null): boolean {
  if (!f) return true;
  for (const [k, x] of Object.entries(f.markets ?? {})) {
    const c = row.markets[k];
    if (!inRange(c?.real, x.real) || !inRange(c?.book, x.book) || !inRange(c?.value, x.value)) return false;
  }
  for (const [k, x] of Object.entries(f.stats ?? {})) {
    const c = row.stats[k];
    // Muestra (n) = mínimo entre la muestra del local y la del visitante
    const n = c ? Math.min(c.n_home ?? 0, c.n_away ?? 0) : null;
    if (!inRange(c?.avg, x.avg) || !inRange(c?.home, x.home) || !inRange(c?.away, x.away) || !inRange(n, x.n)) return false;
  }
  for (const [k, x] of Object.entries(f.streaks ?? {})) {
    const c = row.streaks[k];
    if (!inRange(c?.home, x.home) || !inRange(c?.away, x.away)) return false;
  }
  const misc = f.misc ?? {};
  return inRange(row.home.ppg, misc.ppg_home) && inRange(row.away.ppg, misc.ppg_away) && inRange(row.sample_n, misc.sample_n);
}
