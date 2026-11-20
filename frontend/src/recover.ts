/**
 * Si el navegador quedó con una versión vieja de la página (por ejemplo la app en la pantalla de inicio
 * del iPhone) y pide archivos que ya no existen después de una publicación, se recarga UNA vez forzando
 * la versión nueva (con ?v= para saltear la copia guardada). No se repite en bucle.
 */
const KEY = "cr:recargado";

export function recoverFromStaleVersion(): boolean {
  try {
    const last = Number(sessionStorage.getItem(KEY) || "0");
    if (Date.now() - last < 60_000) return false; // ya se intentó hace menos de un minuto
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch { /* sin sessionStorage: igual se intenta una vez */ }
  const url = new URL(location.href);
  url.searchParams.set("v", Date.now().toString(36));
  location.replace(url.toString());
  return true;
}

/** Errores típicos de "archivo de la app que ya no existe / no se pudo bajar". */
export const isChunkError = (e: unknown) =>
  /Importing a module script failed|Failed to fetch dynamically imported module|error loading dynamically imported module|Unable to preload CSS/i
    .test(String((e as any)?.message ?? e));
