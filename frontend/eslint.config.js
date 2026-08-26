import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

// ---------------------------------------------------------------------------
// ESLint del FRONTEND (React + Vite + TypeScript). El backend tiene la suya en
// la raíz, con reglas de Node y sin nada de React.
//
// ESM (`import`/`export default`) porque frontend/package.json declara
// `type: "module"` — ver la nota equivalente en la config de la raíz.
//
// react-hooks aporta lo único que un typechecker no puede ver: que las reglas
// de los hooks se cumplan (orden estable, dependencias declaradas).
// react-refresh aplica por usar Vite: avisa cuando un módulo exporta algo que
// no es un componente junto a uno que sí lo es, que es lo que rompe el
// hot-reload preservando estado.
//
// eslintConfigPrettier va ÚLTIMO, igual que en la raíz: apaga las reglas de
// formato para que no peleen con Prettier. El formato se arregla con
// `npm run format`, nunca con `eslint --fix`.
// ---------------------------------------------------------------------------

export default tseslint.config(
  { ignores: ["node_modules/", "dist/", "coverage/"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  // v7 expone las flat configs bajo .configs.flat — las de primer nivel
  // (.configs["recommended-latest"]) siguen siendo eslintrc y ESLint 10 las
  // rechaza, porque declaran `plugins` como array de strings.
  reactHooks.configs.flat["recommended-latest"],
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.browser },
    },
    plugins: { "react-refresh": reactRefresh },
    rules: {
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
    },
  },
  eslintConfigPrettier,
);
