import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/Signal-Flow-Melbourne/",
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 650,
  },
});
