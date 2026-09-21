import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Локально api крутиться окремо на 3001, у проді клієнт статикою на
// Cloudflare Workers ходить на api.extrovert.cafe (docs/services.md §2).
export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: { "/api": { target: "http://127.0.0.1:3001", changeOrigin: true } },
  },
  build: { target: "es2022", sourcemap: true },
});
