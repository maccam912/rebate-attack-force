import { defineConfig } from "vite";
export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      "/rooms": {
        target: "http://localhost:2567",
        rewrite: (path) => path.replace(/^\/rooms/, ""),
        ws: true,
      },
    },
  },
});
