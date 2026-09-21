import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Порт 5174, щоб адмінка й застосунок гравця крутились одночасно.
// Проксі той самий: локально api на 3001.
export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5174,
    proxy: { "/api": { target: "http://127.0.0.1:3001", changeOrigin: true } },
  },
  build: { target: "es2022", sourcemap: true },
});
