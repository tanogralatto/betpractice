/** Catálogo de mercados, estadísticas y rachas (misma definición que backend/app/catalog). */
import {
  FT, MatchData, ga, gf, htGa, htGf, htTotal, resultChar, shAg, shHg, shTotal, sortedGoals, total, totalCorners,
} from "./types";

export interface MarketDef { key: string; name: string; group: string; category: string; popular: boolean; check: (m: FT) => boolean }
export interface StatDef { key: string; name: string; value: (m: FT, team: number) => number | null }
export interface StreakDef { key: string; name: string; check: (m: FT, team: number) => boolean }

export const CATEGORIES: Record<string, string> = { marcador: "Marcador", goles: "Goles", equipo: "Equipo", corners: "Corners" };

export const MARKETS: MarketDef[] = [];
const add = (key: string, name: string, group: string, category: string, check: (m: FT) => boolean, popular = false) =>
  MARKETS.push({ key, name, group, category, check, popular });
const f1 = (l: number) => l.toFixed(1);
const k1 = (l: number) => f1(l).replace(".", "_");
const res = (h: number, a: number) => (h > a ? "1" : h === a ? "X" : "2");
const SEL: [string, string][] = [["1", "Local"], ["X", "Empate"], ["2", "Visitante"]];

// --- Marcador ---------------------------------------------------------------
for (const [s, l] of SEL) add(`1x2_${s.toLowerCase()}`, `1X2 · ${l}`, "1X2", "marcador", (m) => res(m.hg, m.ag) === s, true);
for (const [s, l, ok] of [["1x", "1X (local o empate)", "1X"], ["12", "12 (local o visitante)", "12"], ["x2", "X2 (empate o visitante)", "X2"]])
  add(`dc_${s}`, `Doble oportunidad · ${l}`, "Doble oportunidad", "marcador", (m) => ok.includes(res(m.hg, m.ag)), true);
for (const [s, l] of SEL) add(`1x2_ht_${s.toLowerCase()}`, `1X2 1T · ${l}`, "1X2 1er tiempo", "marcador", (m) => res(m.hthg, m.htag) === s);
for (const [s, l] of SEL) add(`1x2_2h_${s.toLowerCase()}`, `1X2 2T · ${l}`, "1X2 2do tiempo", "marcador", (m) => res(shHg(m), shAg(m)) === s);
for (const ht of ["1", "X", "2"])
  for (const ft of ["1", "X", "2"])
    add(`htft_${ht.toLowerCase()}${ft.toLowerCase()}`, `Medio tiempo/Final · ${ht}/${ft}`, "Medio tiempo / Final", "marcador",
      (m) => res(m.hthg, m.htag) === ht && res(m.hg, m.ag) === ft);
for (let h = 0; h < 4; h++)
  for (let a = 0; a < 4; a++)
    add(`cs_${h}${a}`, `Marcador exacto · ${h}-${a}`, "Marcador exacto", "marcador", (m) => m.hg === h && m.ag === a);
for (const [h, a] of [[0, 0], [1, 1], [2, 2], [1, 0], [2, 0], [2, 1], [0, 1], [0, 2], [1, 2]])
  add(`cs_ht_${h}${a}`, `Marcador exacto 1T · ${h}-${a}`, "Marcador exacto 1er tiempo", "marcador", (m) => m.hthg === h && m.htag === a);
for (const r of ["1", "X", "2"])
  for (const side of ["over", "under"])
    add(`1x2ou25_${r.toLowerCase()}_${side}`, `1X2 + O/U 2.5 · ${r} y ${side === "over" ? "Over" : "Under"} 2.5`, "1X2 + Over/Under 2.5", "marcador",
      (m) => res(m.hg, m.ag) === r && (total(m) > 2.5) === (side === "over"));

// --- Goles ------------------------------------------------------------------
for (let i = 0; i < 8; i++) {
  const l = i + 0.5;
  add(`ou_over_${k1(l)}`, `Over ${f1(l)}`, "Over/Under goles", "goles", (m) => total(m) > l, l === 1.5 || l === 2.5);
  add(`ou_under_${k1(l)}`, `Under ${f1(l)}`, "Over/Under goles", "goles", (m) => total(m) < l, l === 2.5);
}
for (const l of [0.5, 1.5, 2.5]) {
  add(`ou_ht_over_${k1(l)}`, `Over ${f1(l)} 1T`, "Over/Under goles 1er tiempo", "goles", (m) => htTotal(m) > l, l === 0.5);
  add(`ou_ht_under_${k1(l)}`, `Under ${f1(l)} 1T`, "Over/Under goles 1er tiempo", "goles", (m) => htTotal(m) < l);
}
const btts = (m: FT) => m.hg > 0 && m.ag > 0;
add("btts_yes", "Ambos marcan · Sí", "Ambos marcan", "goles", btts, true);
add("btts_no", "Ambos marcan · No", "Ambos marcan", "goles", (m) => !btts(m), true);
add("odd_even_odd", "Goles · Impar", "Par/Impar", "goles", (m) => total(m) % 2 === 1);
add("odd_even_even", "Goles · Par", "Par/Impar", "goles", (m) => total(m) % 2 === 0);
add("half_most_1h", "Mitad con más goles · 1er tiempo", "Mitad con más goles", "goles", (m) => htTotal(m) > shTotal(m));
add("half_most_2h", "Mitad con más goles · 2do tiempo", "Mitad con más goles", "goles", (m) => shTotal(m) > htTotal(m));
add("half_most_eq", "Mitad con más goles · Igual", "Mitad con más goles", "goles", (m) => shTotal(m) === htTotal(m));
const lastScorer = (m: MatchData) => { const g = sortedGoals(m); return g.length ? g[g.length - 1].side : "none"; };
add("last_goal_home", "Último en marcar · Local", "Último en marcar", "goles", (m) => lastScorer(m) === "home");
add("last_goal_away", "Último en marcar · Visitante", "Último en marcar", "goles", (m) => lastScorer(m) === "away");
add("last_goal_none", "Último en marcar · Sin gol", "Último en marcar", "goles", (m) => lastScorer(m) === "none");
for (const [lo, hi] of [[0, 10], [11, 20], [21, 30], [31, 40], [41, 50], [51, 60], [61, 70], [71, 80], [81, 200]]) {
  const end = hi === 200;
  add(end ? `first_goal_${lo}_end` : `first_goal_${lo}_${hi}`, `Primer gol · minuto ${lo}-${end ? "final" : hi}`, "Primer gol (tramo)", "goles",
    (m) => { const g = sortedGoals(m)[0]; return !!g && g.minute >= lo && g.minute <= hi; });
}
add("first_goal_none", "Primer gol · Sin gol", "Primer gol (tramo)", "goles", (m) => total(m) === 0);

// --- Equipo -----------------------------------------------------------------
const team = (m: FT, s: string) =>
  s === "home" ? [m.hg, m.ag, m.hthg, m.htag, shHg(m), shAg(m)] : [m.ag, m.hg, m.htag, m.hthg, shAg(m), shHg(m)];
for (const [s, l] of [["home", "Local"], ["away", "Visitante"]]) {
  const g = `Equipo ${l.toLowerCase()}`;
  add(`${s}_clean_sheet_yes`, `${l} · Valla invicta Sí`, g, "equipo", (m) => team(m, s)[1] === 0);
  add(`${s}_clean_sheet_no`, `${l} · Valla invicta No`, g, "equipo", (m) => team(m, s)[1] > 0);
  add(`${s}_score_both_halves`, `${l} · Marca en ambos tiempos`, g, "equipo", (m) => team(m, s)[2] > 0 && team(m, s)[4] > 0);
  for (let n = 2; n <= 6; n++) add(`${s}_goals_${n}plus`, `${l} · ${n}+ goles`, g, "equipo", (m) => team(m, s)[0] >= n);
  add(`${s}_win_both_halves`, `${l} · Gana ambos tiempos`, g, "equipo", (m) => { const t = team(m, s); return t[2] > t[3] && t[4] > t[5]; });
  add(`${s}_win_either_half`, `${l} · Gana algún tiempo`, g, "equipo", (m) => { const t = team(m, s); return t[2] > t[3] || t[4] > t[5]; });
  add(`${s}_win_to_nil`, `${l} · Gana sin recibir`, g, "equipo", (m) => team(m, s)[0] > 0 && team(m, s)[1] === 0);
}

// --- Corners ----------------------------------------------------------------
for (let i = 0; i < 6; i++) {
  const l = 7.5 + i;
  add(`corners_over_${k1(l)}`, `Corners Over ${f1(l)}`, "Corners Over/Under", "corners", (m) => { const c = totalCorners(m); return c !== null && c > l; }, l === 9.5);
  add(`corners_under_${k1(l)}`, `Corners Under ${f1(l)}`, "Corners Over/Under", "corners", (m) => { const c = totalCorners(m); return c !== null && c < l; });
}
for (const [s, l] of SEL)
  add(`corners_1x2_${s.toLowerCase()}`, `1X2 corners · ${l}`, "1X2 corners", "corners",
    (m) => m.hc !== null && m.ac !== null && res(m.hc, m.ac) === s);

export const MARKETS_BY_KEY: Record<string, MarketDef> = Object.fromEntries(MARKETS.map((m) => [m.key, m]));

// --- Estadísticas -----------------------------------------------------------
const sum = (a: number | null, b: number | null) => (a === null || b === null ? null : a + b);
export const STATS: StatDef[] = [
  { key: "goals_total", name: "Goles totales", value: (m) => total(m) },
  { key: "goals_for", name: "Goles a favor", value: (m, t) => gf(m, t) },
  { key: "goals_against", name: "Goles en contra", value: (m, t) => ga(m, t) },
  { key: "goals_ht_total", name: "Goles 1er tiempo", value: (m) => htTotal(m) },
  { key: "corners", name: "Corners (partido)", value: (m) => totalCorners(m) },
  { key: "shots", name: "Tiros totales (partido)", value: (m) => sum(m.hs, m.as) },
  { key: "shots_on_target", name: "Tiros al arco (partido)", value: (m) => sum(m.hsot, m.asot) },
  { key: "dangerous_attacks", name: "Ataques peligrosos (equipo)", value: (m, t) => (t === m.homeId ? m.hda : m.ada) },
  { key: "yellow_cards", name: "Tarjetas amarillas (partido)", value: (m) => sum(m.hy, m.ay) },
];
export const STATS_BY_KEY: Record<string, StatDef> = Object.fromEntries(STATS.map((s) => [s.key, s]));

// --- Rachas -----------------------------------------------------------------
const ftR = (m: FT, t: number) => resultChar(gf(m, t), ga(m, t));
const htR = (m: FT, t: number) => resultChar(htGf(m, t), htGa(m, t));
export const STREAKS: StreakDef[] = [
  { key: "win_ft", name: "Gana", check: (m, t) => ftR(m, t) === "W" },
  { key: "draw_ft", name: "Empata", check: (m, t) => ftR(m, t) === "D" },
  { key: "lose_ft", name: "Pierde", check: (m, t) => ftR(m, t) === "L" },
  { key: "win_ht", name: "Gana 1T", check: (m, t) => htR(m, t) === "W" },
  { key: "draw_ht", name: "Empata 1T", check: (m, t) => htR(m, t) === "D" },
  { key: "lose_ht", name: "Pierde 1T", check: (m, t) => htR(m, t) === "L" },
  { key: "no_win", name: "Sin ganar", check: (m, t) => ftR(m, t) !== "W" },
  { key: "no_lose", name: "Sin perder", check: (m, t) => ftR(m, t) !== "L" },
  { key: "no_draw", name: "Sin empatar", check: (m, t) => ftR(m, t) !== "D" },
];
for (let i = 0; i < 5; i++) {
  const l = i + 0.5;
  STREAKS.push({ key: `over_${k1(l)}`, name: `Over ${f1(l)}`, check: (m) => total(m) > l });
  STREAKS.push({ key: `under_${k1(l)}`, name: `Under ${f1(l)}`, check: (m) => total(m) < l });
}
for (const l of [0.5, 1.5, 2.5]) {
  STREAKS.push({ key: `ht_over_${k1(l)}`, name: `HT Over ${f1(l)}`, check: (m) => htTotal(m) > l });
  STREAKS.push({ key: `ht_under_${k1(l)}`, name: `HT Under ${f1(l)}`, check: (m) => htTotal(m) < l });
}
STREAKS.push(
  { key: "btts_yes", name: "Ambos marcan Sí", check: (m) => btts(m) },
  { key: "btts_no", name: "Ambos marcan No", check: (m) => !btts(m) },
  { key: "clean_sheet_yes", name: "Valla invicta Sí", check: (m, t) => ga(m, t) === 0 },
  { key: "clean_sheet_no", name: "Valla invicta No", check: (m, t) => ga(m, t) > 0 },
  { key: "win_to_nil_yes", name: "Gana sin recibir Sí", check: (m, t) => gf(m, t) > 0 && ga(m, t) === 0 },
  { key: "win_to_nil_no", name: "Gana sin recibir No", check: (m, t) => !(gf(m, t) > 0 && ga(m, t) === 0) },
);
export const STREAKS_BY_KEY: Record<string, StreakDef> = Object.fromEntries(STREAKS.map((s) => [s.key, s]));

export const BOOKMAKERS = [
  { key: "bet365", name: "Bet365" },
  { key: "pinnacle", name: "Pinnacle" },
  { key: "1xbet", name: "1xBet" },
];
export const BEST = "best";
export const BOOKMAKER_KEYS = BOOKMAKERS.map((b) => b.key);
