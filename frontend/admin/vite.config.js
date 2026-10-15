import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Порт 5174, щоб адмінка й застосунок гравця крутились одночасно.
// Проксі той самий: локально api на 3001.
export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5174,
    // API_PROXY — api з іншого робочого дерева на іншому порту, щоб дві
    // сесії розробки не ділили один api.
    proxy: { "/api": { target: process.env.API_PROXY ?? "http://127.0.0.1:3001", changeOrigin: true } },
  },
  build: { target: "es2022", sourcemap: true },
  // Коміт збірки — release у GlitchTip (src/errors.js): видно, з якої версії
  // прийшла помилка. GITHUB_SHA ставить сам Actions; локально — порожньо.
  define: { "import.meta.env.VITE_RELEASE": JSON.stringify((process.env.GITHUB_SHA ?? "").slice(0, 7)) },
});
