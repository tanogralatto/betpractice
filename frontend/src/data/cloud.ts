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
      await A.setPersistence(auth, A.browserLocalPersistence);
      return { auth, db: F.getFirestore(app), A, F };
    })();
  }
  return fb;
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

export const access = { state: "loading" as Access, error: "" };
let unsubOwn: (() => void) | null = null;

function setAccess(s: Access, err = "") { access.state = s; access.error = err; emit(); }

/** El dueño es la única cuenta que puede leer la lista completa (así lo dicen las reglas). */
async function isOwner(): Promise<boolean> {
  const { db, F } = await load();
  try { await F.getDocs(F.query(F.collection(db, "acceso_tanoapp"), F.limit(1))); return true; } catch { return false; }
}

async function checkAccess(): Promise<void> {
  unsubOwn?.(); unsubOwn = null;
  if (!cloud.user) { setAccess("login"); return; }
  setAccess("loading");
  if (await isOwner()) { setAccess("owner"); return; }
  const { db, F } = await load();
  const ref = F.doc(db, "acceso_tanoapp", cloud.user.uid);
  unsubOwn = F.onSnapshot(ref, (snap) => {
    if (!snap.exists()) { setAccess("none"); return; }
    const d = snap.data();
    if (d.cuotasreales === true) {
      if (access.state !== "ok") F.updateDoc(ref, { ultimoIngreso: F.serverTimestamp() }).catch(() => undefined);
      setAccess("ok");
    } else setAccess(d.cuotasreales === false && d.cuotasDecidido ? "blocked" : "pending");
  }, (e) => setAccess("error", e.message));
}

/** Modo con acceso restringido: arranca Firebase siempre y controla quién entra. */
export async function initGate(): Promise<void> {
  const { auth, A } = await load();
  try { await A.getRedirectResult(auth); } catch (e: any) { access.error = e?.message ?? ""; }
  try { localStorage.setItem("cr:cuenta", "1"); } catch { /* nada */ }
  A.onAuthStateChanged(auth, (u) => { cloud.user = u; cloud.ready = true; emit(); void checkAccess(); });
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
