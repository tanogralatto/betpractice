export type Side = "home" | "away";
export interface Goal { minute: number; side: Side; half: number }

/** Partido en el formato que usa el motor (equivale a MatchData del backend). */
export interface MatchData {
  id: number;
  leagueId: number;
  seasonId: number;
  kickoff: string; // "YYYY-MM-DDTHH:MM" hora local
  homeId: number;
  awayId: number;
  status: string; // FT | NS | LIVE | PST | CANC
  hg: number | null;
  ag: number | null;
  hthg: number | null;
  htag: number | null;
  goals: Goal[];
  hc: number | null; ac: number | null; // corners
  hs: number | null; as: number | null; // tiros
  hsot: number | null; asot: number | null; // tiros al arco
  hda: number | null; ada: number | null; // ataques peligrosos
  hy: number | null; ay: number | null; // amarillas
}

/** Partido terminado (todos los goles definidos). */
export type FT = MatchData & { hg: number; ag: number; hthg: number; htag: number };

export const finished = (m: MatchData): m is FT =>
  m.status === "FT" && m.hg !== null && m.ag !== null && m.hthg !== null && m.htag !== null;

export const total = (m: FT) => m.hg + m.ag;
export const htTotal = (m: FT) => m.hthg + m.htag;
export const shHg = (m: FT) => m.hg - m.hthg;
export const shAg = (m: FT) => m.ag - m.htag;
export const shTotal = (m: FT) => shHg(m) + shAg(m);
export const totalCorners = (m: MatchData) => (m.hc === null || m.ac === null ? null : m.hc + m.ac);
export const sortedGoals = (m: MatchData) => [...m.goals].sort((a, b) => a.half - b.half || a.minute - b.minute);

export const sideOf = (m: MatchData, team: number): Side => (team === m.homeId ? "home" : "away");
export const gf = (m: FT, t: number) => (sideOf(m, t) === "home" ? m.hg : m.ag);
export const ga = (m: FT, t: number) => (sideOf(m, t) === "home" ? m.ag : m.hg);
export const htGf = (m: FT, t: number) => (sideOf(m, t) === "home" ? m.hthg : m.htag);
export const htGa = (m: FT, t: number) => (sideOf(m, t) === "home" ? m.htag : m.hthg);
export const resultChar = (f: number, a: number) => (f > a ? "W" : f === a ? "D" : "L");
