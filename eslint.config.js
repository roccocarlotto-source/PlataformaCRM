const js = require("@eslint/js");
const globals = require("globals");
const tseslint = require("typescript-eslint");
const eslintConfigPrettier = require("eslint-config-prettier");

// ---------------------------------------------------------------------------
// ESLint del BACKEND (Node + Express + TypeScript). El frontend tiene su propia
// config en frontend/eslint.config.js — ver el `ignores` de abajo.
//
// ESTE ARCHIVO ES CommonJS (`require`/`module.exports`) y el del frontend es
// ESM (`import`/`export default`). No es una inconsistencia que valga la pena
// unificar: el package.json de la raíz no declara `type`, así que un `.js` acá
// ES CommonJS, mientras que frontend/package.json sí declara `type: "module"`.
// Cada archivo habla el dialecto de su propio paquete. La alternativa —renombrar
// este a .mjs— evitaría el `require` pero escondería esa diferencia real entre
// los dos paquetes.
//
// SIN eslint-plugin-prettier a propósito. Correr Prettier como regla de ESLint
// es más lento (dos parseos por archivo) y confunde los dos roles: el formato
// lo decide Prettier y se arregla con `npm run format`; ESLint solo opina de
// lo que Prettier no mira. `eslintConfigPrettier` va ÚLTIMO justamente para
// apagar las reglas de formato que quedarían peleando con él.
//
// `tseslint.configs.recommended` — la variante SIN chequeo de tipos. La versión
// `recommendedTypeChecked` obliga a levantar el programa de TypeScript por cada
// corrida, y con tres tsconfig en la raíz esa configuración es una decisión
// aparte, no algo que deba entrar de contrabando en el primer setup de lint.
// ---------------------------------------------------------------------------

module.exports = tseslint.config(
  {
    ignores: [
      "node_modules/",
      "dist/",
      "coverage/",
      // El frontend se lintea con SU config, desde frontend/. Sin esta línea,
      // `eslint .` desde la raíz lo tomaría con las reglas de Node y sin las de
      // React, que es exactamente lo que no queremos.
      "frontend/",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.node },
    },
  },
  eslintConfigPrettier,
);
