import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
  build: {
    target: "esnext",
  },
  server: {
    port: Number(process.env.SYMFORYX_WEB_PORT || 5173),
    proxy: {
      "/api": {
        target: process.env.SYMFORYX_API_URL || "http://127.0.0.1:3000",
        changeOrigin: true,
      },
    },
  },
});
