import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist", emptyOutDir: true },
  server: {
    // `npm run dev:api` menjalankan Worker di port 8787.
    proxy: { "/api": "http://localhost:8787" },
  },
});
