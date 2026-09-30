import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

// ---------------------------------------------------------------------------
// A-02 de la auditoría del 24/09 (docs-privados/auditoria-2026-09-24-punta-a-punta.md,
// local): agents, conversations y messages nacieron sin row level security y
// nadie se enteró durante semanas, porque ningún test fallaba cuando una
// tabla nueva quedaba sin RLS (verify:schema solo confirma que llegó lo que
// rls_policies.sql declara).
//
// Este test no necesita base: toma cada tabla del schema (@@map) y exige que
// alguna migración, o prisma/sql/rls_policies.sql, le haga `enable row level
// security`. Una tabla nueva sin RLS rompe acá, en el PR que la crea.
//
// La DEFINICIÓN de las políticas (quién tiene cuál, con qué USING) la compara
// la fila 5 de docs/auditoria-2026-08-21-diagnostico.sql contra la base real;
// esto es solo la red para "nadie la habilitó".
// ---------------------------------------------------------------------------

// Los tests corren desde la raíz del repo (npm test).
const RAIZ = process.cwd();

function tablasDelSchema(): string[] {
  const schema = readFileSync(join(RAIZ, "prisma", "schema.prisma"), "utf8");
  return [...schema.matchAll(/@@map\("([a-z_]+)"\)/g)].map((m) => m[1]);
}

function sqlQueHabilitaRls(): string {
  const migraciones = join(RAIZ, "prisma", "migrations");
  const archivos = readdirSync(migraciones, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => join(migraciones, d.name, "migration.sql"));
  archivos.push(join(RAIZ, "prisma", "sql", "rls_policies.sql"));
  return archivos
    .map((archivo) => {
      try {
        return readFileSync(archivo, "utf8");
      } catch {
        return "";
      }
    })
    .join("\n")
    .toLowerCase();
}

test("toda tabla del schema tiene row level security habilitada en alguna migración", () => {
  const tablas = tablasDelSchema();
  assert.ok(tablas.length > 30, "el parseo del schema encontró las tablas");
  const sql = sqlQueHabilitaRls();
  const sinRls = tablas.filter(
    (tabla) =>
      !new RegExp(
        `alter\\s+table\\s+(if\\s+exists\\s+)?(public\\.)?"?${tabla}"?\\s+enable\\s+row\\s+level\\s+security`,
      ).test(sql),
  );
  assert.deepEqual(sinRls, [], `tablas sin RLS habilitada: ${sinRls.join(", ")}`);
});
