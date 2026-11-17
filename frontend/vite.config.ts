import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base "./" para que funcione en GitHub Pages (https://usuario.github.io/repositorio/)
export default defineConfig({
  base: "./",
  plugins: [react()],
  server: { port: 5173 },
});
