const js = require("@eslint/js");
const globals = require("globals");
const tseslint = require("typescript-eslint");
const eslintConfigPrettier = require("eslint-config-prettier");
const FRONTERA = require("./frontera-de-productos.json");

const TESTS = ["src/**/*.test.ts", "src/**/*.integration-test.ts", "src/**/*.test-helper.ts"];

// ---------------------------------------------------------------------------
// ESLint del BACKEND (Node + Express + TypeScript). El frontend tiene su propia
// config en frontend/eslint.config.js — ver el `ignores` de abajo.
//
// ESTE ARCHIVO ES CommonJS (`require`/`module.exports`) y el del frontend es
// ESM (`import`/`export default`). No es una inconsistencia que valga la pena
// unificar: el package.json de la raíz no declara `type`, así que un `.js` acá
// ES CommonJS, mientras que frontend/package.json sí declara `type: "module"`.
// Cada archivo habla el dialecto de su propio paquete.
//
// LAS REGLAS ESTÁN SEPARADAS POR EXTENSIÓN, Y NO ES CEREMONIA. Aplicar el
// preset de TypeScript a TODO —que es lo que sale por default— hacía que esta
// misma config se reportara con 9 errores: `@typescript-eslint/no-require-imports`
// prohibiendo los require de acá arriba, y `no-undef` sin conocer `require` ni
// `module` porque el default de flat config es sourceType "module". Una config
// que no pasa su propio lint es una config rota, no una deuda del código.
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
      // Lo genera la CLI de Supabase al levantar el stack local (npm run
      // supabase:start). No es código del repo, y sin esta línea `npm run
      // lint` falla en local apenas existe (PR A de los pendientes post F1–F5).
      "supabase/.temp/",
    ],
  },

  // El código del backend: src/, scripts/, prisma/seed.ts.
  {
    files: ["**/*.ts"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.node },
    },
  },

  // Frontera de productos (docs/ordenamiento-productos.md §0.2, P2): el núcleo
  // no importa de las carpetas de producto, y un producto no importa del otro.
  // `servicios/` es parte de automotora (D2). Solo código de producción: los
  // tests del núcleo prueban los dos rubros y pueden importar de los dos.
  // Las dependencias de hoy están en frontera-de-productos.json, una lista que
  // solo se achica (la vigila src/compartido/fronteraDeProductos.test.ts).
  // no-restricted-imports no mira los import() dinámicos: no hay ninguno, y el
  // test de la lista también los busca.
  {
    files: ["src/**/*.ts"],
    ignores: [
      "src/automotora/**",
      "src/clinicas/**",
      "src/servicios/**",
      ...TESTS,
      ...FRONTERA.nucleoQueImportaProductos,
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "(^|/)(automotora|clinicas|servicios)/",
              message:
                "El núcleo no importa de un producto (docs/ordenamiento-productos.md §0.2). Usá un punto de registro.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/clinicas/**/*.ts"],
    ignores: [...TESTS, ...FRONTERA.crucesEntreProductos],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "(^|/)(automotora|servicios)/",
              message:
                "Un producto no importa del otro (docs/ordenamiento-productos.md §0.2). Lo común va a src/compartido/.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/automotora/**/*.ts", "src/servicios/**/*.ts"],
    ignores: [...TESTS, ...FRONTERA.crucesEntreProductos],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "(^|/)clinicas/",
              message:
                "Un producto no importa del otro (docs/ordenamiento-productos.md §0.2). Lo común va a src/compartido/.",
            },
          ],
        },
      ],
    },
  },

  // Los .js de la raíz son configuración de herramientas (este archivo), no
  // código del producto: CommonJS y sin el preset de TypeScript.
  {
    files: ["**/*.js"],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: { ...globals.node },
    },
  },

  eslintConfigPrettier,
);
