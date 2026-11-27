# Cuotas reales · Estadísticas de fútbol para apuestas

App para analizar partidos de fútbol con **cuotas reales** calculadas a partir de partidos
anteriores, pensada sobre todo para el mercado **Over 0.5 goles en el 1er tiempo**.

- **Perfil**: elegís cómo se calcula la cuota real (cuántos partidos anteriores, de local,
  de visitante o ambos) y tus favoritos.
- **Pre partido**: los partidos del día con cuota real, cuota de la casa y valor
  (verde = conviene, rojo = no), estadísticas, rachas y filtros.

## Cómo se usa (sin instalar nada)

Es una página web, como tus otras apps: **https://tanogralatto.github.io/betpractice/**

1. Abrila. Si ya cargaste tu clave de API-Football en tu otra app de este mismo sitio, la
   reconoce sola. Si no, tocá **⚙ Ajustes**, pegá la clave y tocá **Guardar y probar**.
2. Elegí el día. Aparecen todos los partidos de ese día que tenga API-Football.
3. Las cuotas reales se calculan solas para las ligas que estás mirando. La primera vez que mirás
   una liga se bajan sus temporadas (2–3 consultas); después quedan guardadas en el navegador.
   Si el día tiene muchas ligas, elegí las que te interesan con los chips de países o el panel
   **Ligas**, o tocá **“calculá todas”**.
4. **↻ Actualizar** vuelve a pedir los partidos y las cuotas del día.
5. Para no gastar consultas, **al abrir la página no se baja nada**: se muestra lo que ya estaba
   guardado (en el dispositivo o en la nube compartida). Recién cuando elegís ligas, tocás
   **↻ Actualizar** o **Bajar datos ahora**, se piden a la API las temporadas y cuotas que falten.

Sin clave se ven **datos de prueba** (inventados) para conocer la app.

---

## Parte técnica

### Estructura

```
.github/workflows/      actualizar datos + publicar en Pages; tests
backend/                Python: sincronización con API-Football, seed, exportación, API de desarrollo
  app/catalog/          mercados, estadísticas, rachas, casas
  app/services/         cálculo (analysis.py), filtros, Pre partido, sincronización
  app/providers/        interfaz de proveedores + API-Football (+ mapeo de cuotas en JSON)
  app/seed.py           datos de prueba
  app/sync.py           comando de sincronización
  tests/                pytest (incluye respuestas simuladas de API-Football)
  app/export_static.py  base → frontend/public/data/datos.json
frontend/               React + Vite + TypeScript (tema oscuro)
  src/engine/           motor de cálculo en el navegador (mismo algoritmo que backend/app/services)
docs/especificacion.md
```

### Cómo funciona

- La página no tiene servidor. Le pide los datos a API-Football **directamente desde el navegador**
  (`frontend/src/data/apiFootball.ts`), igual que las otras apps:
  - partidos del día con `/fixtures?date`;
  - temporadas por liga con `/fixtures?league&season`, que traen los goles al descanso;
  - cuotas con `/odds?date&league&season`.
- Lo bajado se guarda en IndexedDB: las temporadas pasadas se bajan una vez; la actual se
  renueva cada 3 h y las cuotas cada 30 min.
- La clave se guarda en el navegador (`cr:key`). Si no hay, se usa la de la otra app del
  mismo sitio (`o05:key`).
- Los partidos bajados por temporada no traen minutos de gol ni corners. Los mercados que los
  necesitan (primer/último gol, corners) muestran “—” hasta que haya esos datos.
- La acción `.github/workflows/publicar.yml` arma la página con datos de prueba (seed) y la
  publica en cada cambio de `main`. No usa la clave ni hay que tocarla.
- `backend/` (Python) queda para desarrollo, tests y para sincronizar a una base local
  (`python -m app.sync`), con el mismo algoritmo.

### Datos compartidos entre personas habilitadas

Lo que cualquiera baja de API-Football (partidos del día, temporadas por liga, cuotas, partidos de
equipos y H2H) queda en Firebase, en `cuotasreales_cache/{clave}` (formato compacto, un documento por
día, liga-temporada o liga-día). Los demás lo leen de ahí y no gastan consultas. Orden de búsqueda:
este dispositivo (IndexedDB) → nube compartida → API-Football. Vencimientos: día de hoy 10 min,
cuotas 30 min, temporada en curso 3 h, temporadas pasadas 60 días.

Requiere estas reglas en el proyecto de Firebase `appuestasclaude` (pegarlas debajo de la función
`tanoOwner()`); el texto exacto también aparece en ⚙ Ajustes para el dueño:

```
    function cuotasRealesHabilitado() {
      return tanoOwner() || (request.auth != null
        && get(/databases/$(database)/documents/acceso_tanoapp/$(request.auth.uid)).data.get('cuotasreales', false) == true);
    }
    match /cuotasreales_cache/{key} {
      allow read: if cuotasRealesHabilitado();
      allow create, update: if cuotasRealesHabilitado()
        && request.resource.data.keys().hasOnly(['v', 't', 'by', 'n'])
        && request.resource.data.v is string
        && request.resource.data.by == request.auth.uid;
    }
```

### Requisitos

- Python 3.12+
- Node.js 18+

### Desarrollo local con datos de prueba (`seed`)

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
python -m app.export_static
```

```bash
cd ../frontend && npm install && npm run dev
```

Abrí http://localhost:5173. (El backend FastAPI, `uvicorn app.main:app`, sigue disponible para
desarrollo y expone la misma lógica en `/api`, pero la página no lo necesita.)

El seed genera 6 ligas (Argentina, Inglaterra, España, Italia, Nations League, Chile B),
3 temporadas, ~4.700 partidos terminados (≈72 % con gol en el 1T) y partidos de los últimos
3 días, hoy y los próximos 6 días con cuotas de Bet365, Pinnacle y 1xBet. Opciones:
`python -m app.seed --date 2026-11-17 --seed 7`.

### Datos reales con API-Football (local)

La app **siempre lee de la base de datos**; el proveedor solo la llena. Con
`DATA_PROVIDER=api_football` se usa por defecto otra base (`backend/betpractice_api_football.db`),
así el seed nunca pisa los datos reales.

#### 1. Poner la clave

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

#### 2. Sincronizar ligas

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

#### 3. Exportar y ver

```bash
cd backend && DATA_PROVIDER=api_football python -m app.export_static
```

Después `npm run dev` en `frontend/`. La barra superior muestra “Datos reales (API-Football)”.

#### Cuota de pedidos y caché

- Se leen los headers `x-ratelimit-requests-remaining` (diaria) y `X-RateLimit-Remaining`
  (por minuto). Si se agota la del minuto se espera 60 s; si la diaria baja de
  `API_FOOTBALL_MIN_DAILY_REMAINING` (20 por defecto) la sync se corta y lo ya guardado queda.
- Ante HTTP 429 o un error `rateLimit` se reintenta con espera (respeta `Retry-After`).
- Las respuestas se cachean en `backend/.cache/api_football/` con vencimiento por endpoint.
- La sync es **incremental e idempotente**: upsert por id de API-Football; los detalles solo se
  piden para partidos terminados que todavía no los tienen (de a 20 por pedido) y una temporada
  pasada que ya está completa se saltea (forzar con `--force`).

#### Mapeo de cuotas

`backend/app/providers/api_football_mapping.json` traduce casas (`Bet365`, `Pinnacle`, `1xBet`)
y tipos de apuesta (`Match Winner`, `Goals Over/Under`, `Goals Over/Under First Half`,
`Both Teams Score`, `HT/FT Double`, `Exact Score`, `Double Chance`, `Corners Over Under`, …) a
las claves del catálogo. Admite comodines (`Over {line}` → `ou_over_{k}`, `{h}:{a}` → `cs_{h}{a}`).
Lo que no se puede mapear se informa en el log al final de cada sync de cuotas.

### Tests

```bash
cd backend && python -m pytest -q
```

Cubren el algoritmo de cuota real (unión sin duplicados, home/away/both/ignore, `last_8`, solo
partidos anteriores, misma competición, ventana de temporadas, ejemplo 15/19 → 1.27 y valor
+13.7 %), los filtros de rango, mercados (Over 0.5 1T, BTTS, HT/FT y otros), PPG y rachas, y el
cliente de API-Football con respuestas simuladas (cuota, reintentos, caché, paginación, parseo de
goles y estadísticas, mapeo de cuotas y sincronización idempotente). Ningún test hace llamadas
reales.

### Cómo se calcula la cuota real

1. Muestra del local: sus partidos terminados **en la misma competición**, en la ventana de
   temporadas del perfil y **anteriores** al partido, filtrados por “Local como” (`last_8`: los
   últimos 8 que cumplan).
2. Lo mismo para el visitante.
3. Se **unen** las muestras y se quitan duplicados por id (un enfrentamiento directo cuenta una vez).
4. p = aciertos / n → cuota real = 1/p.
5. Valor % = cuota de la casa / cuota real − 1.

### PostgreSQL

Instalá `psycopg[binary]` y definí `DATABASE_URL=postgresql+psycopg://usuario:clave@host/base`.
Las tablas se crean solas al iniciar el backend (o con el seed).
