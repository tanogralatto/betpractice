# Cuotas reales · Estadísticas de fútbol para apuestas

App propia para analizar partidos de fútbol con **cuotas reales** calculadas a partir de
muestras históricas configurables, pensada sobre todo para el mercado **Over 0.5 goles en el
1er tiempo**. Tiene dos secciones:

- **Perfil**: perfiles de usuario (uno activo) formados por 4 sub-perfiles reutilizables
  (cuota real, PPG, estadísticas, rachas) y favoritos (ligas, mercados, estadísticas, rachas,
  casas de apuestas).
- **Pre partido**: tabla de partidos del día con cuota real, cuota de la casa y valor %,
  estadísticas L/V/AVG, rachas, filtros por rango, presets, la muestra usada y las cuotas de
  todas las casas.

La especificación completa está en [`docs/especificacion.md`](docs/especificacion.md).

## Abrir la app en tu computadora (lo más fácil)

1. Instalá **Python** desde https://www.python.org/downloads/ (en Windows marcá la casilla
   **“Add python.exe to PATH”** en la primera pantalla del instalador).
2. Instalá **Node.js** desde https://nodejs.org (botón **LTS**).
3. Bajá este proyecto: botón verde **Code → Download ZIP** en GitHub, y descomprimilo.
4. Doble clic en:
   - Windows: **`iniciar-windows.bat`**
   - Mac: **`iniciar-mac.command`** (la primera vez: clic derecho → **Abrir** → **Abrir**).

La primera vez tarda unos minutos porque instala lo necesario. Después se abre el navegador
en http://localhost:5173. Para cerrar la app, cerrá la ventana negra.

## Estructura

```
backend/                FastAPI + SQLAlchemy
  app/catalog/          mercados, estadísticas, rachas, casas
  app/services/         cálculo (analysis.py), filtros, Pre partido, sincronización
  app/providers/        interfaz de proveedores + API-Football (+ mapeo de cuotas en JSON)
  app/seed.py           datos de prueba
  app/sync.py           comando de sincronización
  tests/                pytest (incluye respuestas simuladas de API-Football)
frontend/               React + Vite + TypeScript (tema oscuro)
docs/especificacion.md
```

## Requisitos

- Python 3.12+
- Node.js 18+

## Puesta en marcha con datos de prueba (`seed`)

```bash
cd backend
```

```bash
python -m venv .venv && source .venv/bin/activate
```

```bash
pip install -r requirements.txt
```

```bash
python -m app.seed
```

```bash
uvicorn app.main:app --reload --port 8000
```

En otra terminal:

```bash
cd frontend && npm install && npm run dev
```

Abrí http://localhost:5173. El frontend reenvía `/api` al backend en el puerto 8000
(se puede cambiar con `VITE_API_URL`).

El seed genera 6 ligas (Argentina, Inglaterra, España, Italia, Nations League, Chile B),
3 temporadas, ~4.700 partidos terminados (≈72 % con gol en el 1T) y partidos de los últimos
3 días, hoy y los próximos 6 días con cuotas de Bet365, Pinnacle y 1xBet. Opciones:
`python -m app.seed --date 2026-11-17 --seed 7`.

## Datos reales con API-Football

La app **siempre lee de la base de datos**; el proveedor solo la llena. Con
`DATA_PROVIDER=api_football` se usa por defecto otra base (`backend/betpractice_api_football.db`),
así el seed nunca pisa los datos reales.

### 1. Poner la clave

Copiá el ejemplo y completá la clave (la sacás del dashboard de api-football.com):

```bash
cp .env.example backend/.env
```

Editá `backend/.env`:

```
DATA_PROVIDER=api_football
API_FOOTBALL_KEY=tu_clave
```

`.env` está en `.gitignore`: la clave nunca se commitea. También se puede exportar como
variable de entorno (`export API_FOOTBALL_KEY=...`).

### 2. Sincronizar ligas

Los ids son los de API-Football: **128** = Argentina Liga Profesional, **39** = Inglaterra
Premier League (otros: 140 LaLiga, 135 Serie A, 5 Nations League; verificalos en
`/leagues`). Histórico de las temporadas actual y anterior:

```bash
cd backend && python -m app.sync history --league 128 --league 39 --season current --season previous
```

Esto trae ligas y temporadas (`/leagues`), equipos (`/teams`), partidos con resultado FT y de
medio tiempo (`/fixtures`) y, para los partidos terminados, minutos de gol y estadísticas
(corners, tiros, tarjetas). También se puede pedir una temporada puntual: `--season 2025`.

Partidos y cuotas pre partido de hoy y mañana (para las ligas ya sincronizadas):

```bash
python -m app.sync daily --days 2
```

Otros comandos:

```bash
python -m app.sync details
```

```bash
python -m app.sync check-mapping
```

`details` completa goles/estadísticas pendientes y `check-mapping` consulta `/odds/bookmakers`
y `/odds/bets` y muestra qué casas y tipos de apuesta no están mapeados.

### 3. Correr la app con API-Football

```bash
cd backend && DATA_PROVIDER=api_football uvicorn app.main:app --reload --port 8000
```

(si `DATA_PROVIDER` ya está en `backend/.env` no hace falta ponerlo en el comando). La barra
superior muestra “datos: API-Football”. Para tener los partidos del día al día, programá
`python -m app.sync daily` (por ejemplo con cron cada 1–2 horas).

### Cuota de pedidos y caché

- Se leen los headers `x-ratelimit-requests-remaining` (diaria) y `X-RateLimit-Remaining`
  (por minuto). Si se agota la del minuto se espera 60 s; si la diaria baja de
  `API_FOOTBALL_MIN_DAILY_REMAINING` (20 por defecto) la sync se corta y lo ya guardado queda.
- Ante HTTP 429 o un error `rateLimit` se reintenta con espera (respeta `Retry-After`).
- Las respuestas se cachean en `backend/.cache/api_football/` con vencimiento por endpoint.
- La sync es **incremental e idempotente**: upsert por id de API-Football; los detalles solo se
  piden para partidos terminados que todavía no los tienen (de a 20 por pedido) y una temporada
  pasada que ya está completa se saltea (forzar con `--force`).

### Mapeo de cuotas

`backend/app/providers/api_football_mapping.json` traduce casas (`Bet365`, `Pinnacle`, `1xBet`)
y tipos de apuesta (`Match Winner`, `Goals Over/Under`, `Goals Over/Under First Half`,
`Both Teams Score`, `HT/FT Double`, `Exact Score`, `Double Chance`, `Corners Over Under`, …) a
las claves del catálogo. Admite comodines (`Over {line}` → `ou_over_{k}`, `{h}:{a}` → `cs_{h}{a}`).
Lo que no se puede mapear se informa en el log al final de cada sync de cuotas.

## Tests

```bash
cd backend && python -m pytest -q
```

Cubren el algoritmo de cuota real (unión sin duplicados, home/away/both/ignore, `last_8`, solo
partidos anteriores, misma competición, ventana de temporadas, ejemplo 15/19 → 1.27 y valor
+13.7 %), los filtros de rango, mercados (Over 0.5 1T, BTTS, HT/FT y otros), PPG y rachas, y el
cliente de API-Football con respuestas simuladas (cuota, reintentos, caché, paginación, parseo de
goles y estadísticas, mapeo de cuotas y sincronización idempotente). Ningún test hace llamadas
reales.

## Cómo se calcula la cuota real

1. Muestra del local: sus partidos terminados **en la misma competición**, en la ventana de
   temporadas del perfil y **anteriores** al partido, filtrados por “Local como” (`last_8`: los
   últimos 8 que cumplan).
2. Lo mismo para el visitante.
3. Se **unen** las muestras y se quitan duplicados por id (un enfrentamiento directo cuenta una vez).
4. p = aciertos / n → cuota real = 1/p.
5. Valor % = cuota de la casa / cuota real − 1.

## PostgreSQL

Instalá `psycopg[binary]` y definí `DATABASE_URL=postgresql+psycopg://usuario:clave@host/base`.
Las tablas se crean solas al iniciar el backend (o con el seed).
