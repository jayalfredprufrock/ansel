import { ansel } from "@jayalfredprufrock/ansel/vite";
import { defineConfig } from "astro/config";

export default defineConfig({
  vite: { plugins: [ansel()] },
});
