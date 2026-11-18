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
