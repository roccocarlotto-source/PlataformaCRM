import assert from "node:assert/strict";
import { test } from "node:test";
import type { AjustesDeImportacion } from "../utils/importacionMapeo";
import { advertenciaDeEmpresaIgnorada, ajustesSinEmpresas } from "./importacionEdicion";

// docs/ediciones.md §2.2 (paso G): en una organización sin el módulo
// empresas, la importación de contactos ignora la empresa.

const AJUSTES = {
  mapeo: { "Nombre completo": "fullName", Empresa: "companyName", Mail: "email" },
  crearEmpresas: true,
} as unknown as AjustesDeImportacion;

test("ajustesSinEmpresas saca la columna de empresa y apaga crearEmpresas, sin tocar el resto", () => {
  const sin = ajustesSinEmpresas(AJUSTES);
  assert.deepEqual(sin.mapeo, { "Nombre completo": "fullName", Mail: "email" });
  assert.equal(sin.crearEmpresas, false);
  // No muta los ajustes originales: la advertencia los necesita.
  assert.equal(AJUSTES.mapeo.Empresa, "companyName");
  assert.equal(AJUSTES.crearEmpresas, true);
});

test("la advertencia sale solo si la fila trae empresa", () => {
  assert.equal(
    advertenciaDeEmpresaIgnorada(AJUSTES, { Empresa: "  Compañía Ejemplo " }),
    "La organización no tiene empresas (edición Esencial): «Compañía Ejemplo» se ignora",
  );
  assert.equal(advertenciaDeEmpresaIgnorada(AJUSTES, { Empresa: "" }), null);
  assert.equal(advertenciaDeEmpresaIgnorada(AJUSTES, { Empresa: "   " }), null);
  assert.equal(advertenciaDeEmpresaIgnorada(AJUSTES, { Mail: "x@example.com" }), null);
  const sinColumna = { mapeo: { Mail: "email" } } as unknown as AjustesDeImportacion;
  assert.equal(advertenciaDeEmpresaIgnorada(sinColumna, { Empresa: "X" }), null);
});
