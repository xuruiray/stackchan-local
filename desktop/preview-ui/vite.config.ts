import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "preview-ui",
  base: "/",
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true
  },
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8788",
      "/debug": "http://127.0.0.1:8788",
      "/events": "http://127.0.0.1:8788",
      "/frame.jpg": "http://127.0.0.1:8788",
      "/stream.mjpg": "http://127.0.0.1:8788",
      "/status": "http://127.0.0.1:8788"
    }
  }
});
