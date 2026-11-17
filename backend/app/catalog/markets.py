"""Catálogo de mercados (selecciones).

Cada mercado tiene una función `check(match) -> bool` que, dado un partido
terminado, dice si la selección se cumplió. La cuota real se calcula a partir
de esa función sobre la muestra de partidos.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

from app.domain import MatchData

# Categorías del selector de mercados en Pre partido
CATEGORIES = {
    "marcador": "Marcador",
    "goles": "Goles",
    "equipo": "Equipo",
    "corners": "Corners",
}


@dataclass(frozen=True)
class Market:
    key: str
    name: str
    group: str
    category: str
    check: Callable[[MatchData], bool]
    popular: bool = False

    def as_dict(self) -> dict:
        return {
            "key": self.key,
            "name": self.name,
            "group": self.group,
            "category": self.category,
            "popular": self.popular,
        }


MARKETS: list[Market] = []


def _add(key, name, group, category, check, popular=False):
    MARKETS.append(Market(key, name, group, category, check, popular))


def _fmt(line: float) -> str:
    return f"{line:.1f}"


def _k(line: float) -> str:
    return _fmt(line).replace(".", "_")


def _res(h: int, a: int) -> str:
    return "1" if h > a else ("X" if h == a else "2")


# ---------------------------------------------------------------------------
# Marcador / resultado
# ---------------------------------------------------------------------------
for sel, label in (("1", "Local"), ("X", "Empate"), ("2", "Visitante")):
    _add(f"1x2_{sel.lower()}", f"1X2 · {label}", "1X2", "marcador",
         lambda m, s=sel: _res(m.hg, m.ag) == s, popular=True)

for sel, label, ok in (
    ("1x", "1X (local o empate)", {"1", "X"}),
    ("12", "12 (local o visitante)", {"1", "2"}),
    ("x2", "X2 (empate o visitante)", {"X", "2"}),
):
    _add(f"dc_{sel}", f"Doble oportunidad · {label}", "Doble oportunidad", "marcador",
         lambda m, ok=ok: _res(m.hg, m.ag) in ok, popular=True)

for sel, label in (("1", "Local"), ("X", "Empate"), ("2", "Visitante")):
    _add(f"1x2_ht_{sel.lower()}", f"1X2 1T · {label}", "1X2 1er tiempo", "marcador",
         lambda m, s=sel: _res(m.hthg, m.htag) == s)
for sel, label in (("1", "Local"), ("X", "Empate"), ("2", "Visitante")):
    _add(f"1x2_2h_{sel.lower()}", f"1X2 2T · {label}", "1X2 2do tiempo", "marcador",
         lambda m, s=sel: _res(m.sh_hg, m.sh_ag) == s)

for ht in ("1", "X", "2"):
    for ft in ("1", "X", "2"):
        _add(f"htft_{ht.lower()}{ft.lower()}", f"Medio tiempo/Final · {ht}/{ft}", "Medio tiempo / Final",
             "marcador", lambda m, ht=ht, ft=ft: _res(m.hthg, m.htag) == ht and _res(m.hg, m.ag) == ft)

for h in range(4):
    for a in range(4):
        _add(f"cs_{h}{a}", f"Marcador exacto · {h}-{a}", "Marcador exacto", "marcador",
             lambda m, h=h, a=a: m.hg == h and m.ag == a)

for h, a in ((0, 0), (1, 1), (2, 2), (1, 0), (2, 0), (2, 1), (0, 1), (0, 2), (1, 2)):
    _add(f"cs_ht_{h}{a}", f"Marcador exacto 1T · {h}-{a}", "Marcador exacto 1er tiempo", "marcador",
         lambda m, h=h, a=a: m.hthg == h and m.htag == a)

for res in ("1", "X", "2"):
    for side in ("over", "under"):
        label = "Over 2.5" if side == "over" else "Under 2.5"
        _add(f"1x2ou25_{res.lower()}_{side}", f"1X2 + O/U 2.5 · {res} y {label}", "1X2 + Over/Under 2.5",
             "marcador",
             lambda m, res=res, side=side: _res(m.hg, m.ag) == res and ((m.total > 2.5) == (side == "over")))

# ---------------------------------------------------------------------------
# Goles
# ---------------------------------------------------------------------------
for i in range(8):
    line = i + 0.5
    _add(f"ou_over_{_k(line)}", f"Over {_fmt(line)}", "Over/Under goles", "goles",
         lambda m, l=line: m.total > l, popular=line in (1.5, 2.5))
    _add(f"ou_under_{_k(line)}", f"Under {_fmt(line)}", "Over/Under goles", "goles",
         lambda m, l=line: m.total < l, popular=line == 2.5)

for line in (0.5, 1.5, 2.5):
    _add(f"ou_ht_over_{_k(line)}", f"Over {_fmt(line)} 1T", "Over/Under goles 1er tiempo", "goles",
         lambda m, l=line: m.ht_total > l, popular=line == 0.5)
    _add(f"ou_ht_under_{_k(line)}", f"Under {_fmt(line)} 1T", "Over/Under goles 1er tiempo", "goles",
         lambda m, l=line: m.ht_total < l)

_add("btts_yes", "Ambos marcan · Sí", "Ambos marcan", "goles", lambda m: m.hg > 0 and m.ag > 0, popular=True)
_add("btts_no", "Ambos marcan · No", "Ambos marcan", "goles", lambda m: not (m.hg > 0 and m.ag > 0), popular=True)
_add("odd_even_odd", "Goles · Impar", "Par/Impar", "goles", lambda m: m.total % 2 == 1)
_add("odd_even_even", "Goles · Par", "Par/Impar", "goles", lambda m: m.total % 2 == 0)

_add("half_most_1h", "Mitad con más goles · 1er tiempo", "Mitad con más goles", "goles",
     lambda m: m.ht_total > m.sh_total)
_add("half_most_2h", "Mitad con más goles · 2do tiempo", "Mitad con más goles", "goles",
     lambda m: m.sh_total > m.ht_total)
_add("half_most_eq", "Mitad con más goles · Igual", "Mitad con más goles", "goles",
     lambda m: m.sh_total == m.ht_total)


def _last_scorer(m: MatchData) -> str:
    gs = m.sorted_goals()
    return gs[-1].side if gs else "none"


def _first_goal(m: MatchData):
    gs = m.sorted_goals()
    return gs[0] if gs else None


_add("last_goal_home", "Último en marcar · Local", "Último en marcar", "goles", lambda m: _last_scorer(m) == "home")
_add("last_goal_away", "Último en marcar · Visitante", "Último en marcar", "goles", lambda m: _last_scorer(m) == "away")
_add("last_goal_none", "Último en marcar · Sin gol", "Último en marcar", "goles", lambda m: _last_scorer(m) == "none")

# Primer gol por tramo de minutos
FIRST_GOAL_BUCKETS = [(0, 10), (11, 20), (21, 30), (31, 40), (41, 50), (51, 60), (61, 70), (71, 80), (81, 200)]


def _first_goal_in(m: MatchData, lo: int, hi: int) -> bool:
    g = _first_goal(m)
    return g is not None and lo <= g.minute <= hi


for lo, hi in FIRST_GOAL_BUCKETS:
    label = f"{lo}-{hi}" if hi < 200 else f"{lo}-final"
    key = f"first_goal_{lo}_{hi}" if hi < 200 else f"first_goal_{lo}_end"
    _add(key, f"Primer gol · minuto {label}", "Primer gol (tramo)", "goles",
         lambda m, lo=lo, hi=hi: _first_goal_in(m, lo, hi))
_add("first_goal_none", "Primer gol · Sin gol", "Primer gol (tramo)", "goles", lambda m: m.total == 0)

# ---------------------------------------------------------------------------
# Equipo (local y visitante)
# ---------------------------------------------------------------------------


def _team(m: MatchData, side: str):
    """(goles a favor, en contra, a favor 1T, en contra 1T, a favor 2T, en contra 2T)."""
    if side == "home":
        return m.hg, m.ag, m.hthg, m.htag, m.sh_hg, m.sh_ag
    return m.ag, m.hg, m.htag, m.hthg, m.sh_ag, m.sh_hg


for side, label in (("home", "Local"), ("away", "Visitante")):
    grp = f"Equipo {label.lower()}"
    _add(f"{side}_clean_sheet_yes", f"{label} · Valla invicta Sí", grp, "equipo",
         lambda m, s=side: _team(m, s)[1] == 0)
    _add(f"{side}_clean_sheet_no", f"{label} · Valla invicta No", grp, "equipo",
         lambda m, s=side: _team(m, s)[1] > 0)
    _add(f"{side}_score_both_halves", f"{label} · Marca en ambos tiempos", grp, "equipo",
         lambda m, s=side: _team(m, s)[2] > 0 and _team(m, s)[4] > 0)
    for n in range(2, 7):
        _add(f"{side}_goals_{n}plus", f"{label} · {n}+ goles", grp, "equipo",
             lambda m, s=side, n=n: _team(m, s)[0] >= n)
    _add(f"{side}_win_both_halves", f"{label} · Gana ambos tiempos", grp, "equipo",
         lambda m, s=side: _team(m, s)[2] > _team(m, s)[3] and _team(m, s)[4] > _team(m, s)[5])
    _add(f"{side}_win_either_half", f"{label} · Gana algún tiempo", grp, "equipo",
         lambda m, s=side: _team(m, s)[2] > _team(m, s)[3] or _team(m, s)[4] > _team(m, s)[5])
    _add(f"{side}_win_to_nil", f"{label} · Gana sin recibir", grp, "equipo",
         lambda m, s=side: _team(m, s)[0] > 0 and _team(m, s)[1] == 0)

# ---------------------------------------------------------------------------
# Corners
# ---------------------------------------------------------------------------
for i in range(6):
    line = 7.5 + i
    _add(f"corners_over_{_k(line)}", f"Corners Over {_fmt(line)}", "Corners Over/Under", "corners",
         lambda m, l=line: m.total_corners is not None and m.total_corners > l, popular=line == 9.5)
    _add(f"corners_under_{_k(line)}", f"Corners Under {_fmt(line)}", "Corners Over/Under", "corners",
         lambda m, l=line: m.total_corners is not None and m.total_corners < l)
for sel, label in (("1", "Local"), ("X", "Empate"), ("2", "Visitante")):
    _add(f"corners_1x2_{sel.lower()}", f"1X2 corners · {label}", "1X2 corners", "corners",
         lambda m, s=sel: m.total_corners is not None and _res(m.home_corners, m.away_corners) == s)


MARKETS_BY_KEY: dict[str, Market] = {m.key: m for m in MARKETS}
assert len(MARKETS_BY_KEY) == len(MARKETS), "Claves de mercado duplicadas"
