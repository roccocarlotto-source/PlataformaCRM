import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// ---------------------------------------------------------------------------
// Build del widget embebible (docs/ai-agent-architecture.md §9, nota fechada
// del 13/09/2026 bajo el punto 5). Es un SEGUNDO build, separado del de la
// SPA (vite.config.ts), por una razón concreta: la SPA emite assets con hash
// en el nombre porque index.html los referencia dinámicamente en cada
// deploy, pero el snippet <script src=".../widget.js"> que un negocio pega
// en SU sitio es texto estático que no se regenera solo. El widget tiene que
// salir SIEMPRE como dist/widget.js, sin hash, o cada cliente embebido se
// rompería en el próximo deploy.
//
// Se corre con `vite build --config vite.widget.config.ts`, DESPUÉS del
// build de la SPA (script `build` de package.json), al mismo dist/.
//
// Sin plugin de React ni bloque `test`: el widget es DOM puro, y los tests de
// src/widget/ corren con el vite.config.ts de siempre (Vitest lee ese, no
// este). Vite carga el mismo .env de la raíz del paquete para cualquier
// config, así que import.meta.env.VITE_API_URL llega igual a este build.
// ---------------------------------------------------------------------------
export default defineConfig({
  build: {
    outDir: "dist",
    // CRÍTICO: por default Vite vacía outDir al arrancar. El build de la SPA
    // sí lo vacía (comportamiento default, no se toca); este NO, o se
    // comería index.html y assets/ que el primero acaba de dejar.
    emptyOutDir: false,
    // La SPA ya copió public/ (si existiera); no hace falta hacerlo dos veces.
    copyPublicDir: false,
    lib: {
      entry: fileURLToPath(new URL("./src/widget/main.ts", import.meta.url)),
      // IIFE: un solo archivo autoejecutable, sin `import`/`export`, cargable
      // con un <script> clásico (con o sin async) en cualquier sitio.
      formats: ["iife"],
      // Requerido por Vite para iife/umd aunque el módulo no exporte nada.
      name: "PlataformaCrmWidget",
      fileName: () => "widget.js",
    },
  },
});
