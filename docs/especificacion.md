# Especificación · App de estadísticas de fútbol para apuestas (MVP)

App propia de estadísticas de fútbol para apuestas. El uso principal es el mercado
**Over 0.5 goles en el 1er tiempo** con el perfil **“GOL 1er TIEMPO”**. Se replica
funcionalidad (no código, textos, marca ni datos) de herramientas tipo “studio” de estadísticas.

Las dos secciones centrales son **PERFIL** (cómo se calculan las cuotas reales y qué se
muestra) y **PRE PARTIDO** (tabla de partidos del día con filtros para elegir apuestas).
Toda la UI está en español.

## Stack

- Backend: Python 3.12 + FastAPI + SQLAlchemy. SQLite en desarrollo (preparado para PostgreSQL).
- Frontend: React + Vite + TypeScript, tema oscuro.
- Datos:
  - **API-Football v3** (api-sports.io) como proveedor real (ver “Proveedor de datos”).
  - **Datos de prueba** (`seed`) como alternativa para desarrollo y tests: ~6 ligas
    (ARG Primera, ENG Premier, ESP LaLiga, ITA Serie A, EUR Nations League, CHI Primera B),
    2–3 temporadas, equipos, partidos jugados con goles FT, goles al descanso (HT), minuto
    de cada gol, corners, tarjetas y algunas estadísticas (tiros, ataques peligrosos), más
    partidos de hoy y los próximos días con cuotas de 2–3 casas (Bet365, Pinnacle, 1xBet)
    para todos los mercados. Datos realistas (≈70–80 % de partidos con gol en el 1T).
- Capa `providers/` con una interfaz común (Sportmonks queda pendiente).
- README en español con cómo correr todo.

## 1. PERFIL

Un perfil de usuario tiene nombre, puede haber varios y uno está activo. Acciones: crear,
activar, borrar y guardar. Se compone de 4 perfiles de muestra reutilizables (cada uno con una
pestaña “Perfiles creados” → Seleccionar, y otra “Crear nuevo”), más los favoritos.

**A) Perfil de cuota real** (el más importante):
- Nombre.
- Muestra: `last_8` | `current` | `current_plus_1` | `current_plus_2` | `current_plus_3`.
- Local como: `home` | `away` | `both` | `ignore`.
- Visitante como: `home` | `away` | `both` | `ignore`.

**B) Perfil de PPG.** Muestra fija: temporada actual. Local como `home` | `both`. Visitante
como `away` | `both`. PPG = (3·G + E) / PJ.

**C) Perfil de estadísticas.** Temporadas: `current` | `current_plus_1`. Local y visitante
como `home` | `away` | `both`.

**D) Perfil de rachas:** las mismas opciones que C.

**Favoritos** (preseleccionados en Pre partido): ligas (sin límite), mercados (máx. 10),
estadísticas (máx. 3), rachas (máx. 3) y casas de apuestas, incluida “Mejor cuota”, que toma
la mejor entre todas.

**Perfil por defecto “GOL 1er TIEMPO”:** cuota real `current_plus_1`, both/both; PPG both/both;
estadísticas y rachas `current_plus_1`, both/both; mercado favorito Over 0.5 1T; estadística
Goles totales; rachas HT Over 0.5 y HT Under 0.5.

### Algoritmo de cuota real (respetarlo exacto)

Para un partido L vs V, un mercado M y un perfil de cuota real:

1. Muestra del local = partidos de L en la MISMA competición del partido y en la ventana de
   temporadas, ya terminados y anteriores a la fecha del partido, filtrados por “Local como”
   (home: L jugó de local; away: de visitante; both: todos; ignore: ninguno). En `last_8` son
   los últimos 8 partidos que cumplan esa condición.
2. Lo mismo para el visitante.
3. UNIR las dos muestras y QUITAR DUPLICADOS por id de partido (si se enfrentaron entre sí,
   cuenta una vez). NO promediar los % de cada equipo.
4. p = partidos donde M se cumplió / total. Cuota real = 1 / p (None si p = 0). Mostrar también
   n (tamaño de la muestra).
5. Valor % = cuota de la casa / cuota real − 1.

Ejemplo de test: muestra de 19 partidos únicos con 15 goles en 1T → cuota real 1.27; con cuota
de la casa 1.44 → valor +13.7 %.

Promedios de estadísticas: L = promedio del local en su muestra, V = ídem visitante,
AVG = (L+V)/2. Rachas: cantidad de partidos consecutivos más recientes que cumplen la condición,
para cada equipo según su perfil de rachas.

## 2. PRE PARTIDO

- Barra superior: navegación de fecha (anterior / calendario / siguiente / Hoy) y chips por país
  con cantidad de partidos, más chip de favoritos. Texto “Mostrando X partidos en Y ligas (de un
  total de …)”.
- Panel izquierdo: Ligas (árbol país → liga, con “Limpiar todo”); Mercados (categorías Mis
  mercados / Populares / Equipo / Goles / Marcador / Corners / Todos, con buscador);
  Estadísticas (hasta 3); Rachas (hasta 3); Casa de apuestas (por defecto, más un switch
  “ocultar partidos sin cuota del mercado principal”); Ordenar (hora / liga / PPG local / PPG
  visitante); Cambiar perfil; Presets (guardar o cargar columnas + filtros con nombre); Añadir
  filtros.
- Tabla, una fila por partido: liga, hora o marcador, equipos con su PPG; por cada mercado:
  cuota real, cuota de la casa y valor % (verde si es positivo, rojo si es negativo); por cada
  estadística: L / V / AVG; por cada racha: L / V.
- Acciones por fila: “Ver muestra” (partidos usados en la cuota real, con fecha, local, marcador
  FT y HT, visitante y acierto/fallo del mercado) y “Cuotas de todas las casas”.
- “Añadir filtros”: diálogo con 4 pestañas. Cada filtro es un rango “de … a …” (cualquiera de
  los dos extremos opcional) y un partido se muestra solo si cumple TODOS:
  1. Mercado (por cada mercado elegido): cuota real, cuota de la casa, valor %.
  2. Estadísticas (por cada una): Ambos (AVG), Local, Visitante y Muestra (n).
  3. Rachas (por cada una): largo de la racha.
  4. Varios: PPG local, PPG visitante, tamaño de la muestra de la cuota real.

## Catálogos

- **Mercados (selecciones):** 1X2 FT; Doble oportunidad; 1X2 1T; 1X2 2T; HT/FT (9);
  Over/Under 0.5 a 7.5 FT; Over/Under 0.5, 1.5 y 2.5 en el 1T; BTTS sí/no; par/impar; mitad con
  más goles; último en marcar; marcador exacto FT (0-0 a 3-3); marcador exacto HT (0-0, 1-1,
  2-2, 1-0, 2-0, 2-1, 0-1, 0-2, 1-2); primer gol por tramo (0-10, 11-20, …, 81-final, sin gol);
  1X2 + O/U 2.5 (6); por equipo: valla invicta sí/no, marca en ambos tiempos, 2+ a 6+ goles,
  gana ambos tiempos, gana un tiempo, gana sin recibir; corners O/U 7.5 a 12.5; 1X2 de corners.
  Cada mercado tiene una función que, dado un partido terminado, dice si se cumplió.
- **Estadísticas:** Goles totales, Goles a favor, Goles en contra, Corners, Tiros totales, Tiros
  al arco, Ataques peligrosos, Tarjetas amarillas (extensible).
- **Rachas:** Gana / Empata / Pierde FT y HT; Sin ganar; Sin perder; Sin empatar; Over/Under 0.5
  a 4.5 FT; HT Over/Under 0.5, 1.5 y 2.5; BTTS sí/no; valla invicta sí/no; gana sin recibir sí/no.

## Proveedor de datos: API-Football v3 (cambio de plan)

En vez de dejar los proveedores para después, se integra **API-Football (v3, api-sports.io)**,
manteniendo el `seed` como alternativa para desarrollo y tests.

1. `providers/api_football.py` sigue la interfaz de `providers/`. Base URL
   `https://v3.football.api-sports.io`, header `x-apisports-key`. La clave se lee de la variable
   de entorno `API_FOOTBALL_KEY` (nunca en el código ni commiteada). `.env.example` con la
   variable vacía y `.env` en `.gitignore`.
2. Proveedor elegido con `DATA_PROVIDER=seed|api_football`.
3. Sincronización (comando `sync`, idempotente, upsert por id de API-Football):
   ligas y temporadas (`/leagues`), equipos (`/teams`); partidos (`/fixtures` por liga+temporada
   y por fecha) con goles FT y `score.halftime`; eventos (`/fixtures/events`) para los minutos
   de gol y estadísticas (`/fixtures/statistics`) para corners, tiros, ataques peligrosos y
   tarjetas; cuotas pre partido (`/odds` por fecha o partido), usando `/odds/bookmakers` y
   `/odds/bets` para mapear casas y tipos de apuesta al catálogo. El mapeo vive en un archivo de
   configuración fácil de corregir y los mercados no mapeados se registran en el log.
4. Respetar el límite de pedidos: leer los headers de cuota restante, reintentar con espera ante
   429, cachear respuestas y sincronizar en forma incremental. La sync del histórico se hace por
   liga y temporada.
5. El cálculo de cuota real y todo lo demás no cambia: solo cambia de dónde salen los datos.
6. Tests del cliente con respuestas simuladas (JSON de ejemplo en `tests/`), sin llamadas reales.
7. README: cómo poner la clave, cómo sincronizar un par de ligas (Argentina Liga Profesional e
   Inglaterra Premier League, temporadas actual y anterior) y cómo correr con
   `DATA_PROVIDER=api_football`.

## Listo cuando

- `seed` + backend + frontend levantan con los comandos del README.
- Tests (pytest) del algoritmo de cuota real: deduplicación, home/away/both/ignore, last_8, solo
  partidos anteriores a la fecha, misma competición, y el ejemplo 15/19 → 1.27.
- Tests de los filtros de rango y de algunos mercados (Over 0.5 1T, BTTS, HT/FT).
- Tests del cliente de API-Football con respuestas simuladas.
- Se puede crear y editar perfiles y sus 4 sub-perfiles, cambiar el perfil activo y ver cómo
  cambian las cuotas reales en Pre partido; aplicar filtros y presets.
- Todo commiteado y pusheado a una rama, con un PR abierto contra main y la descripción en español.

## Decisiones de implementación (MVP)

- La app **siempre lee de la base**; los proveedores solo la llenan. Cada proveedor usa por
  defecto su propio archivo SQLite (`betpractice_seed.db`, `betpractice_api_football.db`).
- “Temporada actual” = la temporada del partido analizado; `current_plus_N` suma las N
  temporadas anteriores de la misma competición. `last_8` no se limita por temporada.
- “Anterior a la fecha del partido” = hora de inicio estrictamente anterior.
- Filtro “Muestra (n)” de estadísticas: se compara contra el mínimo entre la muestra del local y
  la del visitante (ambos equipos deben tener al menos ese n).
- Un filtro con algún extremo definido no lo cumple un partido sin dato (p. ej. sin cuota).
- Partidos con alargue: se usa el resultado de los 90' (`score.fulltime`); los goles del alargue
  no cuentan.
- Detalles de partidos (eventos + estadísticas) se piden con `/fixtures?ids=` (hasta 20 por
  pedido, trae `events` y `statistics` incluidos) para ahorrar cuota; si no vienen se usan
  `/fixtures/events` y `/fixtures/statistics`.
- API-Football normalmente no informa “ataques peligrosos”: con ese proveedor la estadística
  queda vacía.
