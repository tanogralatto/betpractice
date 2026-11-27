"""Filtros de rango de Pre partido. Un partido se muestra solo si cumple TODOS."""
from __future__ import annotations

from typing import Any


def in_range(value: float | None, rng: Any) -> bool:
    """`rng` = [desde, hasta] (o dict {"min","max"}); cualquiera de los extremos puede ser None.
    Si no hay extremos definidos, el filtro no aplica. Si hay alguno y el valor es None, no cumple."""
    if rng is None:
        return True
    if isinstance(rng, dict):
        lo, hi = rng.get("min"), rng.get("max")
    else:
        lo, hi = (list(rng) + [None, None])[:2]
    if lo is None and hi is None:
        return True
    if value is None:
        return False
    if lo is not None and value < lo:
        return False
    if hi is not None and value > hi:
        return False
    return True


def row_passes(row: dict, filters: dict | None) -> bool:
    """Evalúa los filtros sobre una fila ya calculada de Pre partido.

    Estructura de `filters`:
      markets: {market_key: {real: [a,b], book: [a,b], value: [a,b]}}
      stats:   {stat_key:   {avg: [..], home: [..], away: [..], n: [..]}}
      streaks: {streak_key: {home: [..], away: [..], any: [..]}}  (any = local O visitante)
      misc:    {ppg_home: [..], ppg_away: [..], sample_n: [..]}
    """
    if not filters:
        return True
    for key, f in (filters.get("markets") or {}).items():
        cell = row["markets"].get(key)
        if cell is None:
            if any(in_range(None, f.get(x)) is False for x in ("real", "book", "value")):
                return False
            continue
        if not (in_range(cell["real"], f.get("real")) and in_range(cell["book"], f.get("book"))
                and in_range(cell["value"], f.get("value"))):
            return False
    for key, f in (filters.get("stats") or {}).items():
        cell = row["stats"].get(key) or {}
        n = None
        if cell:
            n = min(cell.get("n_home") or 0, cell.get("n_away") or 0)
        if not (in_range(cell.get("avg"), f.get("avg")) and in_range(cell.get("home"), f.get("home"))
                and in_range(cell.get("away"), f.get("away")) and in_range(n, f.get("n"))):
            return False
    for key, f in (filters.get("streaks") or {}).items():
        cell = row["streaks"].get(key) or {}
        if not (in_range(cell.get("home"), f.get("home")) and in_range(cell.get("away"), f.get("away"))):
            return False
        # "any": pasa si el local O el visitante cae en el rango
        if not (in_range(cell.get("home"), f.get("any")) or in_range(cell.get("away"), f.get("any"))):
            return False
    misc = filters.get("misc") or {}
    if not (in_range(row["home"].get("ppg"), misc.get("ppg_home"))
            and in_range(row["away"].get("ppg"), misc.get("ppg_away"))
            and in_range(row.get("sample_n"), misc.get("sample_n"))):
        return False
    return True
