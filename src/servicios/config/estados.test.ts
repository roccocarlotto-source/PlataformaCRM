import assert from "node:assert/strict";
import { test } from "node:test";
import { ServiceOrderStatus as EnumDePrisma } from "@prisma/client";
import {
  ESTADOS,
  ESTADOS_ABIERTOS,
  ESTADOS_FINALES,
  ESTADOS_INICIALES,
  puedePasar,
  TRANSICIONES,
} from "./estados";

// La tabla de §3.2 de docs/servicios.md, escrita a mano: si alguien cambia
// TRANSICIONES, este test lo obliga a cambiar también el documento.
const PERMITIDAS = new Set([
  "AGENDADO>RECIBIDO",
  "AGENDADO>CANCELADO",
  "RECIBIDO>EN_TRABAJO",
  "RECIBIDO>ESPERANDO_APROBACION",
  "RECIBIDO>LISTO_PARA_RETIRAR",
  "RECIBIDO>CANCELADO",
  "EN_TRABAJO>ESPERANDO_APROBACION",
  "EN_TRABAJO>LISTO_PARA_RETIRAR",
  "EN_TRABAJO>CANCELADO",
  "ESPERANDO_APROBACION>EN_TRABAJO",
  "ESPERANDO_APROBACION>LISTO_PARA_RETIRAR",
  "ESPERANDO_APROBACION>CANCELADO",
  "LISTO_PARA_RETIRAR>ENTREGADO",
  "LISTO_PARA_RETIRAR>EN_TRABAJO",
]);

test("todas las combinaciones: solo pasan las de §3.2", () => {
  for (const desde of ESTADOS) {
    for (const hacia of ESTADOS) {
      assert.equal(
        puedePasar(desde, hacia),
        PERMITIDAS.has(`${desde}>${hacia}`),
        `${desde} → ${hacia}`,
      );
    }
  }
});

test("los finales no tienen salida y nunca se vuelve a Agendado", () => {
  for (const final of ESTADOS_FINALES) assert.deepEqual(TRANSICIONES[final], []);
  for (const desde of ESTADOS) assert.ok(!puedePasar(desde, "AGENDADO"), desde);
});

test("abiertos + finales = todos; se nace en Agendado o Recibido", () => {
  assert.deepEqual([...ESTADOS_ABIERTOS, ...ESTADOS_FINALES], [...ESTADOS]);
  assert.deepEqual([...ESTADOS_INICIALES], ["AGENDADO", "RECIBIDO"]);
});

test("la unión de estados es el enum ServiceOrderStatus de Prisma", () => {
  // En tipos: asignables en los dos sentidos.
  const a: EnumDePrisma[] = [...ESTADOS];
  const b: readonly (typeof ESTADOS)[number][] = Object.values(EnumDePrisma);
  // Y en valores, en el mismo orden que la migración.
  assert.deepEqual(a, b);
});
