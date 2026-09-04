import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
// defineConfig viene de "vitest/config" (no de "vite") para que el bloque
// `test` de abajo tipe correctamente — Vitest lee este mismo archivo, no
// hace falta un vitest.config.ts separado.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    // config/env.ts exige estas 4 variables al importarse (fail-fast) — no
    // hay .env local en este repo, así que los tests necesitan valores
    // dummy propios, nunca reales.
    env: {
      VITE_SUPABASE_URL: "http://localhost:54321",
      VITE_SUPABASE_ANON_KEY: "test-anon-key",
      VITE_API_URL: "http://localhost:4000",
      // Deliberadamente sin overlap de substring con VITE_API_URL de arriba:
      // publicUrl.test.ts afirma que el link del QR NO contiene env.apiUrl.
      VITE_QR_PUBLIC_BASE_URL: "https://qr.test.local",
    },
  },
});
