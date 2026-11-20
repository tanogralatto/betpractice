import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base "./" para que funcione en GitHub Pages (https://usuario.github.io/repositorio/)
// Los archivos llevan un hash de su contenido: si no cambian, conservan el nombre entre publicaciones.
// Si el navegador tiene una página vieja que pide archivos que ya no existen, la app se recarga sola
// (ver src/recover.ts y el script de index.html).
export default defineConfig({
  base: "./",
  plugins: [react()],
  server: { port: 5173 },
});
