import assert from "node:assert/strict";
import { test } from "node:test";
import {
  APELLIDO_FALTANTE,
  SI_NO_POR_DEFECTO,
  interpretarEntero,
  interpretarFecha,
  interpretarNumero,
  interpretarOpcion,
  interpretarOpciones,
  interpretarSiNo,
  mapearValor,
  partirNombreCompleto,
  sugerirFormatoDeFecha,
} from "./importacionValores";

// Los intérpretes del paso "Ajustes de formato" del asistente
// (docs/importacion-de-datos.md §5 y §8.1). Datos inventados.

test("celda vacía: null o solo espacios es «sin dato» en todos los intérpretes, nunca un error", () => {
  for (const vacia of [null, "", "   "]) {
    assert.deepEqual(interpretarFecha(vacia, "DD/MM/AAAA"), { ok: true, valor: null });
    assert.deepEqual(interpretarNumero(vacia, ","), { ok: true, valor: null });
    assert.deepEqual(interpretarSiNo(vacia, SI_NO_POR_DEFECTO), { ok: true, valor: null });
    assert.deepEqual(interpretarOpcion(vacia, ["A"]), { ok: true, valor: null });
    assert.deepEqual(interpretarOpciones(vacia, ["A"], ";"), { ok: true, valor: null });
    assert.deepEqual(mapearValor(vacia, {}, ["LEAD"]), { ok: true, valor: null });
  }
  assert.equal(partirNombreCompleto("  "), null);
});

// ---------------------------------------------------------------------------
// Fechas
// ---------------------------------------------------------------------------

test("fecha: cada formato lee lo suyo y devuelve YYYY-MM-DD; el horario se ignora", () => {
  assert.deepEqual(interpretarFecha("14/03/2025", "DD/MM/AAAA"), { ok: true, valor: "2025-03-14" });
  assert.deepEqual(interpretarFecha("3/14/2025", "MM/DD/AAAA"), { ok: true, valor: "2025-03-14" });
  assert.deepEqual(interpretarFecha("2025-03-14", "AAAA-MM-DD"), { ok: true, valor: "2025-03-14" });
  assert.deepEqual(interpretarFecha("14-03-2025 10:30", "DD/MM/AAAA"), {
    ok: true,
    valor: "2025-03-14",
  });
  assert.deepEqual(interpretarFecha("14.3.2025", "DD/MM/AAAA"), { ok: true, valor: "2025-03-14" });
});

test("fecha: una celda de fecha de XLSX (ISO en UTC) vale con cualquier formato", () => {
  for (const formato of ["DD/MM/AAAA", "MM/DD/AAAA", "AAAA-MM-DD"] as const) {
    assert.deepEqual(interpretarFecha("2025-03-14T00:00:00.000Z", formato), {
      ok: true,
      valor: "2025-03-14",
    });
  }
});

test("fecha: imposible, con año de dos cifras o en el formato equivocado, falla con el formato esperado", () => {
  for (const [valor, formato] of [
    ["31/02/2025", "DD/MM/AAAA"],
    ["14/03/25", "DD/MM/AAAA"],
    ["14/03/2025", "MM/DD/AAAA"],
    ["mañana", "DD/MM/AAAA"],
  ] as const) {
    const r = interpretarFecha(valor, formato);
    assert.equal(r.ok, false, valor);
    if (!r.ok) assert.match(r.error, new RegExp(`formato ${formato.replace(/\//g, "\\/")}`));
  }
});

test("sugerirFormatoDeFecha: el que lee todas las muestras; con días <= 12, DD/MM; ninguno, null", () => {
  assert.equal(sugerirFormatoDeFecha(["14/03/2025", "01/12/2024"]), "DD/MM/AAAA");
  assert.equal(sugerirFormatoDeFecha(["03/14/2025", "12/31/2024"]), "MM/DD/AAAA");
  assert.equal(sugerirFormatoDeFecha(["01/02/2025", "03/04/2025"]), "DD/MM/AAAA");
  assert.equal(sugerirFormatoDeFecha(["2025-03-14", null, ""]), "AAAA-MM-DD");
  assert.equal(sugerirFormatoDeFecha(["14/03/2025", "03/14/2025"]), null);
  assert.equal(sugerirFormatoDeFecha([null, ""]), null);
});

// ---------------------------------------------------------------------------
// Números
// ---------------------------------------------------------------------------

test("número: separador decimal coma o punto, miles, moneda pegada y números de XLSX", () => {
  assert.deepEqual(interpretarNumero("1.234,56", ","), { ok: true, valor: 1234.56 });
  assert.deepEqual(interpretarNumero("1,234.56", "."), { ok: true, valor: 1234.56 });
  assert.deepEqual(interpretarNumero("US$ 12.500", ","), { ok: true, valor: 12500 });
  assert.deepEqual(interpretarNumero("15000 USD", "."), { ok: true, valor: 15000 });
  assert.deepEqual(interpretarNumero("$1.200,50", ","), { ok: true, valor: 1200.5 });
  assert.deepEqual(interpretarNumero("-3,5", ","), { ok: true, valor: -3.5 });
  assert.deepEqual(interpretarNumero(42.5, ","), { ok: true, valor: 42.5 });
});

test("número: un «1.5» con decimal coma NO se lee como 15 — falla y lo dice", () => {
  const r = interpretarNumero("1.5", ",");
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /separador decimal: «,»/);
  assert.equal(interpretarNumero("1,5", ".").ok, false);
  assert.equal(interpretarNumero("doce", ",").ok, false);
  assert.equal(interpretarNumero("12abc", ",").ok, false);
});

test("entero: kilómetros con miles; decimales o negativos fallan", () => {
  assert.deepEqual(interpretarEntero("85.000", ","), { ok: true, valor: 85000 });
  assert.deepEqual(interpretarEntero(0, ","), { ok: true, valor: 0 });
  assert.equal(interpretarEntero("12,5", ",").ok, false);
  assert.equal(interpretarEntero("-1", ",").ok, false);
});

// ---------------------------------------------------------------------------
// Sí / no
// ---------------------------------------------------------------------------

test("sí/no: los valores por defecto, sin mayúsculas ni tildes; booleanos de XLSX pasan; lo demás falla", () => {
  for (const si of ["Sí", "SI", "x", "1", "TRUE", "Yes"]) {
    assert.deepEqual(interpretarSiNo(si, SI_NO_POR_DEFECTO), { ok: true, valor: true }, si);
  }
  for (const no of ["No", "N", "0", "false"]) {
    assert.deepEqual(interpretarSiNo(no, SI_NO_POR_DEFECTO), { ok: true, valor: false }, no);
  }
  assert.deepEqual(interpretarSiNo(true, SI_NO_POR_DEFECTO), { ok: true, valor: true });
  assert.equal(interpretarSiNo("quizás", SI_NO_POR_DEFECTO).ok, false);
});

test("sí/no: listas propias del lote", () => {
  const propias = { si: ["Tiene"], no: ["No tiene"] };
  assert.deepEqual(interpretarSiNo("tiene", propias), { ok: true, valor: true });
  assert.deepEqual(interpretarSiNo("NO TIENE", propias), { ok: true, valor: false });
  assert.equal(interpretarSiNo("sí", propias).ok, false);
});

// ---------------------------------------------------------------------------
// Listas
// ---------------------------------------------------------------------------

const FORMAS_DE_PAGO = ["Contado", "Financiado", "Permuta"];

test("opción: sin mayúsculas, tildes ni espacios de más, y devuelve el texto exacto de la opción", () => {
  assert.deepEqual(interpretarOpcion("  contado ", FORMAS_DE_PAGO), { ok: true, valor: "Contado" });
  assert.deepEqual(interpretarOpcion("PERMUTA", FORMAS_DE_PAGO), { ok: true, valor: "Permuta" });
  const r = interpretarOpcion("Leasing", FORMAS_DE_PAGO);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /Contado, Financiado, Permuta/);
});

test("opciones (MULTI_SELECT): partidas por el separador, sin repetidas, en el orden de la celda; una inválida hace fallar todo", () => {
  assert.deepEqual(interpretarOpciones("permuta; Contado ;contado", FORMAS_DE_PAGO, ";"), {
    ok: true,
    valor: ["Permuta", "Contado"],
  });
  assert.deepEqual(interpretarOpciones("Contado,Financiado", FORMAS_DE_PAGO, ","), {
    ok: true,
    valor: ["Contado", "Financiado"],
  });
  assert.deepEqual(interpretarOpciones(" ; ", FORMAS_DE_PAGO, ";"), { ok: true, valor: null });
  assert.equal(interpretarOpciones("Contado;Leasing", FORMAS_DE_PAGO, ";").ok, false);
});

test("mapearValor: por el mapeo del lote, o directo si la celda ya es un valor del destino", () => {
  const etapas = ["LEAD", "MQL", "SQL", "CUSTOMER", "CHURNED"] as const;
  const mapeo = { Cliente: "CUSTOMER", Interesado: "LEAD" } as const;
  assert.deepEqual(mapearValor("cliente", mapeo, etapas), { ok: true, valor: "CUSTOMER" });
  assert.deepEqual(mapearValor("customer", mapeo, etapas), { ok: true, valor: "CUSTOMER" });
  assert.equal(mapearValor("Proveedor", mapeo, etapas).ok, false);
});

// ---------------------------------------------------------------------------
// Nombre completo (decisión 11)
// ---------------------------------------------------------------------------

test("nombre completo: la primera palabra es el nombre y el resto el apellido; una sola palabra, «-» con advertencia", () => {
  assert.deepEqual(partirNombreCompleto("Ana María  Pérez"), {
    firstName: "Ana",
    lastName: "María Pérez",
  });
  const una = partirNombreCompleto("Beto");
  assert.equal(una?.firstName, "Beto");
  assert.equal(una?.lastName, APELLIDO_FALTANTE);
  assert.equal(APELLIDO_FALTANTE, "-");
  assert.match(una?.advertencia ?? "", /una sola palabra/);
});
