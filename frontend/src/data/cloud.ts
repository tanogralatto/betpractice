/**
 * Cuenta de Google (Firebase), la misma que usa la otra app del sitio.
 * Los datos de esta app van en UN documento aparte: tanoapp_v2_datos/{uid}/goles/bets~cuotasreales
 * (las reglas de la base ya permiten que cada usuario lea y escriba solo lo suyo, y el nombre
 * "bets~…" hace que los invitados de la otra app no puedan leerlo). No toca nada de la otra app.
 */
import type { User } from "firebase/auth";

const CONFIG = {
  apiKey: "AIzaSyDL0LkEW3IAdBZcOARMjzAewgB_lh1edjI",
  authDomain: "appuestasclaude.firebaseapp.com",
  projectId: "appuestasclaude",
  storageBucket: "appuestasclaude.firebasestorage.app",
  messagingSenderId: "1020425173076",
  appId: "1:1020425173076:web:4ca5edab0f72c92a7ad5c1",
};
const DOC_ID = "bets~cuotasreales";

export interface CloudData { v: string; ts: number }

let fb: Promise<{
  auth: import("firebase/auth").Auth;
  db: import("firebase/firestore").Firestore;
  A: typeof import("firebase/auth");
  F: typeof import("firebase/firestore");
}> | null = null;

// Firebase se carga recién cuando hace falta (la página abre igual de rápido).
function load() {
  if (!fb) {
    fb = (async () => {
      const [{ initializeApp }, A, F] = await Promise.all([import("firebase/app"), import("firebase/auth"), import("firebase/firestore")]);
      const app = initializeApp(CONFIG);
      const auth = A.getAuth(app);
      await withTimeout(A.setPersistence(auth, A.browserLocalPersistence), 5000, "persistencia").catch(() => undefined);
      // En algunos iPhone la conexión normal de Firestore se corta: se detecta y se usa "long polling".
      let db: import("firebase/firestore").Firestore;
      try { db = F.initializeFirestore(app, { experimentalAutoDetectLongPolling: true }); } catch { db = F.getFirestore(app); }
      return { auth, db, A, F };
    })();
  }
  return fb;
}

/** Corta una espera que puede no terminar nunca (pasa en algunos teléfonos). */
export function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((res, rej) => {
    const t = setTimeout(() => rej(new Error(`timeout:${what}`)), ms);
    p.then((v) => { clearTimeout(t); res(v); }, (e) => { clearTimeout(t); rej(e); });
  });
}

export const cloud = { user: null as User | null, ready: false };
const listeners = new Set<() => void>();
export const onCloud = (fn: () => void) => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = () => listeners.forEach((f) => f());

/** Arranca Firebase si ya se había iniciado sesión antes en este navegador. */
export async function initCloud(): Promise<void> {
  try {
    if (localStorage.getItem("cr:cuenta") !== "1") { cloud.ready = true; emit(); return; }
  } catch { /* nada */ }
  const { auth, A } = await load();
  try { await A.getRedirectResult(auth); } catch { /* nada */ }
  A.onAuthStateChanged(auth, (u) => { cloud.user = u; cloud.ready = true; emit(); });
}

export async function signIn(): Promise<void> {
  const { auth, A } = await load();
  try { localStorage.setItem("cr:cuenta", "1"); } catch { /* nada */ }
  A.onAuthStateChanged(auth, (u) => { cloud.user = u; cloud.ready = true; emit(); });
  const provider = new A.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  try {
    await A.signInWithPopup(auth, provider);
  } catch (e: any) {
    // en algunos teléfonos la ventana emergente está bloqueada: se usa redirección
    if (/popup|cancelled|operation-not-supported/i.test(e?.code ?? e?.message ?? "")) await A.signInWithRedirect(auth, provider);
    else throw e;
  }
}

export async function signOut(): Promise<void> {
  const { auth, A } = await load();
  await A.signOut(auth);
  try { localStorage.removeItem("cr:cuenta"); } catch { /* nada */ }
  cloud.user = null;
  emit();
}

function ref(F: typeof import("firebase/firestore"), db: import("firebase/firestore").Firestore) {
  return F.doc(db, "tanoapp_v2_datos", cloud.user!.uid, "goles", DOC_ID);
}

export async function pull(): Promise<CloudData | null> {
  if (!cloud.user) return null;
  const { db, F } = await load();
  const d = await F.getDoc(ref(F, db));
  return d.exists() ? (d.data() as CloudData) : null;
}

export async function push(data: CloudData): Promise<void> {
  if (!cloud.user) return;
  const { db, F } = await load();
  await F.setDoc(ref(F, db), data);
}

// --- Acceso: solo personas habilitadas por el dueño -------------------------------------------
// Se usa la lista de la otra app (acceso_tanoapp/{uid}) con un permiso propio: el campo
// "cuotasreales" (true = habilitado). Aprobar acá NO cambia "estado", que es el acceso a la otra app.
// Las reglas ya permiten: cada uno lee su documento y crea su pedido; el dueño lee y cambia todos.
export type Access = "loading" | "login" | "owner" | "ok" | "none" | "pending" | "blocked" | "error";
export interface AccessUser { uid: string; email: string; nombre: string; cuotasreales?: boolean; solicita?: string; estado?: string; creado?: number }

export const access = { state: "loading" as Access, error: "", step: "" };
let unsubOwn: (() => void) | null = null;
let checkRun = 0;

function setAccess(s: Access, err = "") { access.state = s; access.error = err; emit(); }
function setStep(step: string) { access.step = step; emit(); }

// Último acceso confirmado en este dispositivo: con eso la app abre al instante y se verifica en segundo plano.
const CACHE = "cr:acceso";
const CACHE_DAYS = 14;
function cachedAccess(uid: string): "owner" | "ok" | null {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE) || "null");
    if (c && c.uid === uid && (c.state === "owner" || c.state === "ok") && Date.now() - c.t < CACHE_DAYS * 864e5) return c.state;
  } catch { /* nada */ }
  return null;
}
function saveAccess(uid: string, state: Access) {
  try {
    if (state === "owner" || state === "ok") localStorage.setItem(CACHE, JSON.stringify({ uid, state, t: Date.now() }));
    else if (state === "none" || state === "pending" || state === "blocked" || state === "login") localStorage.removeItem(CACHE);
  } catch { /* nada */ }
}

/** El dueño es la única cuenta que puede leer la lista completa (así lo dicen las reglas). */
async function isOwner(): Promise<boolean> {
  const { db, F } = await load();
  try {
    await withTimeout(F.getDocs(F.query(F.collection(db, "acceso_tanoapp"), F.limit(1))), 12000, "base de datos");
    return true;
  } catch (e: any) {
    if (String(e?.message).startsWith("timeout")) throw e; // no contestó: no se sabe
    return false; // sin permiso: no es el dueño
  }
}

async function checkAccess(): Promise<void> {
  const run = ++checkRun;
  unsubOwn?.(); unsubOwn = null;
  const user = cloud.user;
  if (!user) { saveAccess("", "login"); setAccess("login"); return; }
  const cached = cachedAccess(user.uid);
  // Ya habilitado antes en este dispositivo: entra ya y se verifica sin bloquear la pantalla.
  if (cached) setAccess(cached); else { setAccess("loading"); setStep("Leyendo tus permisos…"); }
  const fail = (msg: string) => {
    if (run !== checkRun) return;
    if (cached) return; // ya está adentro; se vuelve a verificar la próxima vez
    setAccess("error", msg);
  };
  try {
    if (await isOwner()) {
      if (run !== checkRun) return;
      saveAccess(user.uid, "owner"); setAccess("owner"); return;
    }
  } catch {
    fail("La base de datos no responde. Revisá la conexión y tocá Reintentar.");
    return;
  }
  const { db, F } = await load();
  const ref = F.doc(db, "acceso_tanoapp", user.uid);
  let answered = false;
  const timer = setTimeout(() => { if (!answered) fail("La base de datos no responde. Revisá la conexión y tocá Reintentar."); }, 12000);
  unsubOwn = F.onSnapshot(ref, (snap) => {
    answered = true; clearTimeout(timer);
    if (run !== checkRun) return;
    let st: Access;
    if (!snap.exists()) st = "none";
    else {
      const d = snap.data();
      if (d.cuotasreales === true) {
        if (access.state !== "ok") F.updateDoc(ref, { ultimoIngreso: F.serverTimestamp() }).catch(() => undefined);
        st = "ok";
      } else st = d.cuotasreales === false && d.cuotasDecidido ? "blocked" : "pending";
    }
    saveAccess(user.uid, st); setAccess(st);
  }, (e) => { answered = true; clearTimeout(timer); fail(e.message); });
}

/** Modo con acceso restringido: arranca Firebase siempre y controla quién entra. */
export async function initGate(): Promise<void> {
  setStep("Conectando con Google…");
  let fb2;
  try { fb2 = await withTimeout(load(), 20000, "carga"); }
  catch { setAccess("error", "No se pudo cargar el inicio de sesión. Revisá la conexión y tocá Reintentar."); return; }
  const { auth, A } = fb2;
  try { localStorage.setItem("cr:cuenta", "1"); } catch { /* nada */ }
  let heard = false;
  // Primero se escucha la sesión (antes esto esperaba a getRedirectResult, que en algunos iPhone no contesta nunca).
  A.onAuthStateChanged(auth, (u) => { heard = true; cloud.user = u; cloud.ready = true; emit(); void checkAccess(); });
  A.getRedirectResult(auth).catch((e: any) => { access.error = e?.message ?? ""; emit(); });
  setTimeout(() => {
    if (!heard) setAccess("error", "El inicio de sesión de Google no responde. Tocá Reintentar o entrá de nuevo.");
  }, 15000);
}

export async function requestAccess(): Promise<void> {
  const { db, F } = await load();
  const u = cloud.user!;
  await F.setDoc(F.doc(db, "acceso_tanoapp", u.uid), {
    email: u.email ?? "", nombre: u.displayName ?? "", estado: "pendiente", solicita: "cuotasreales",
    creado: F.serverTimestamp(), ultimoIngreso: F.serverTimestamp(),
  });
}

/** Lista para el dueño, en vivo. */
export async function watchAccessList(fn: (users: AccessUser[]) => void, onErr: (m: string) => void): Promise<() => void> {
  const { db, F } = await load();
  return F.onSnapshot(F.collection(db, "acceso_tanoapp"), (snap) => {
    fn(snap.docs.map((d) => {
      const x = d.data();
      return { uid: d.id, email: x.email ?? "", nombre: x.nombre ?? "", cuotasreales: x.cuotasreales, solicita: x.solicita, estado: x.estado, creado: x.creado?.toMillis?.() };
    }));
  }, (e) => onErr(e.message));
}

export async function setUserAccess(uid: string, on: boolean): Promise<void> {
  const { db, F } = await load();
  await F.updateDoc(F.doc(db, "acceso_tanoapp", uid), { cuotasreales: on, cuotasDecidido: F.serverTimestamp() });
}

// --- Alertas de Telegram (solo lectura) ------------------------------------------------------
// Las guarda el programa de alertas de la otra app cuando la cuota en vivo de +0,5 1T llega al
// mínimo (1,50). Acá SOLO se leen: nunca se crean, cambian ni borran. Las pueden leer el dueño y
// las personas aprobadas en la otra app (reglas actuales de Firebase).
export interface TgAlert {
  odd: number | null; minute: number | null; result: "won" | "lost" | "push" | "pending";
  estimated: boolean; doubtful: boolean; manual: boolean; group: string | null;
}

/** De los documentos de alertas, elige por partido la de +0,5 1T (sin las de la papelera; si hay varias, la primera). */
export function pickAlerts(docs: any[]): Map<number, TgAlert> {
  const best = new Map<number, { a: any; t: number }>();
  for (const a of docs) {
    if (a.market_type !== "over05" || a.hidden === true) continue;
    const id = Number(a.fixture_id), t = a.created_at?.toMillis?.() ?? 0;
    const prev = best.get(id);
    if (!prev || t < prev.t) best.set(id, { a, t });
  }
  const out = new Map<number, TgAlert>();
  for (const [id, { a }] of best) {
    const odd = Number(a.entry_odd ?? a.odd);
    const r = String(a.result_status ?? "pending");
    out.set(id, {
      odd: Number.isFinite(odd) && odd > 1 ? odd : null,
      minute: Number.isFinite(Number(a.minute)) && a.minute !== null ? Number(a.minute) : null,
      result: (["won", "lost", "push"].includes(r) ? r : "pending") as TgAlert["result"],
      estimated: !!(a.entry_estimated || a.odd_estimated), doubtful: !!a.entry_doubtful, manual: !!a.manual,
      group: a.favorite_group ?? null,
    });
  }
  return out;
}

/** Devuelve, por id de partido, la alerta de +0,5 1T (o null si no hubo). null si no hay permiso. */
export async function fetchTelegramAlerts(ids: number[]): Promise<Map<number, TgAlert | null> | null> {
  if (!cloud.user || !ids.length) return null;
  const { db, F } = await load();
  const out = new Map<number, TgAlert | null>(ids.map((id) => [id, null]));
  try {
    for (let i = 0; i < ids.length; i += 30) {
      const snap = await F.getDocs(F.query(F.collection(db, "tanoapp_telegram_alerts"), F.where("fixture_id", "in", ids.slice(i, i + 30))));
      for (const [id, a] of pickAlerts(snap.docs.map((d) => d.data()))) out.set(id, a);
    }
    return out;
  } catch {
    return null; // sin permiso (no aprobado en la otra app) o sin conexión
  }
}

// --- Seguimiento en Telegram: enviar partidos a ⭐ Favoritos de la otra app ----------------------
// El programa de alertas solo sigue los partidos de tanoapp_favoritos. Se crea el favorito con el mismo
// formato que la otra app (destino "common") y marcado como enviado desde betpractice. Nunca se pisa
// un favorito que ya existe ni se borra uno que no haya creado betpractice.
export type Follow = "created" | "exists" | "denied" | "error";
export interface FollowInfo { id: number; kickoff: string; home: string; away: string; league: string; country: string }

export async function followInTelegram(m: FollowInfo): Promise<Follow> {
  if (!cloud.user) return "denied";
  const { db, F } = await load();
  const ref = F.doc(db, "tanoapp_favoritos", String(m.id));
  try {
    if ((await F.getDoc(ref)).exists()) return "exists";
    const iso = `${m.kickoff.slice(0, 16)}:00-03:00`; // hora de Argentina, como guarda la otra app
    const [d, t] = [m.kickoff.slice(0, 10).split("-"), m.kickoff.slice(11, 16)];
    const ln = `${m.league} · desde betpractice`;
    const now = Date.now();
    await F.setDoc(ref, {
      id: String(m.id), sources: ["betpractice"], origen: "betpractice",
      home: m.home, away: m.away, league: `${m.country} · ${ln}`,
      kickoff: iso, dateText: `${d[2]}/${d[1]} · ${t}`,
      market: "Más de 0,5 goles al descanso",
      fixture: { id: String(m.id), hn: m.home, an: m.away, iso, lc: m.country, ln, st: "NS" },
      analysis: null, poisson: null, strategyAnalysis: null,
      destinations: ["common"], group: "common", vipStrategy: null,
      savedAt: now, updatedAt: now, guardadoPor: cloud.user.email ?? "", actualizado: now,
    });
    return "created";
  } catch (e: any) {
    return /permission/i.test(e?.code ?? e?.message ?? "") ? "denied" : "error";
  }
}

/** Quita de ⭐ Favoritos de la otra app solo si lo había creado betpractice. */
export async function unfollowInTelegram(id: number): Promise<void> {
  if (!cloud.user) return;
  const { db, F } = await load();
  const ref = F.doc(db, "tanoapp_favoritos", String(id));
  try {
    const snap = await F.getDoc(ref);
    if (snap.exists() && snap.data().origen === "betpractice") await F.deleteDoc(ref);
  } catch { /* sin permiso o sin conexión: no se hace nada */ }
}
