import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Cada publicación usa nombres nuevos para todos los archivos: así el navegador nunca reutiliza
// una copia vieja o dañada guardada en su caché (pasó con Safari y los archivos de Firebase).
const build = Date.now().toString(36);

// base "./" para que funcione en GitHub Pages (https://usuario.github.io/repositorio/)
export default defineConfig({
  base: "./",
  plugins: [react()],
  server: { port: 5173 },
  build: {
    rollupOptions: {
      output: {
        entryFileNames: `assets/[name]-${build}-[hash].js`,
        chunkFileNames: `assets/[name]-${build}-[hash].js`,
        assetFileNames: `assets/[name]-${build}-[hash][extname]`,
      },
    },
  },
});
