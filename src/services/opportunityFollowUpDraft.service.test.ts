import assert from "node:assert/strict";
import { test } from "node:test";
import {
  armarContextoDeBorrador,
  armarPromptDeBorrador,
  type DatosDeOportunidadParaBorrador,
} from "./opportunityFollowUpDraft.service";

// Unitarios, SIN RED Y SIN BASE: las dos funciones puras del borrador de
// seguimiento (ítem 76). Lo que necesita Postgres —que el transcript salga de
// la conversación más reciente del contacto real— se prueba en
// automationOpportunityStale.integration-test.ts.

const DATOS: DatosDeOportunidadParaBorrador = {
  title: "Corolla 2024",
  amount: "25000",
  currency: "USD",
  stageName: "Negociación",
  createdAt: new Date("2026-09-01T12:00:00.000Z"),
  updatedAt: new Date("2026-09-11T12:00:00.000Z"),
};
const AHORA = new Date("2026-09-21T15:00:00.000Z");

test("el contexto lleva título, monto con moneda, etapa, fechas y los días sin movimiento", () => {
  const contexto = armarContextoDeBorrador(DATOS, null, AHORA);

  assert.match(contexto, /^- Título: Corolla 2024$/m);
  assert.match(contexto, /^- Monto: 25000 USD$/m);
  assert.match(contexto, /^- Etapa: Negociación$/m);
  assert.match(contexto, /^- Creada el: 2026-09-01$/m);
  assert.match(contexto, /^- Último movimiento: 2026-09-11 \(hace 10 días\)$/m);
});

test("sin conversación lo dice explícitamente, en vez de dejar al modelo suponer que la hubo", () => {
  const contexto = armarContextoDeBorrador(DATOS, null, AHORA);
  assert.match(contexto, /No hay ninguna conversación registrada con el cliente\./);
  assert.doesNotMatch(contexto, /Última conversación/);

  // Un transcript vacío (la conversación existe pero no tiene texto) es lo
  // mismo que no tenerla.
  assert.match(armarContextoDeBorrador(DATOS, "", AHORA), /No hay ninguna conversación/);
});

test("con conversación, el transcript va tal cual después de los datos", () => {
  const transcript = "Cliente: ¿Tienen en gris?\nAgente: Sí, hay una unidad.";
  const contexto = armarContextoDeBorrador(DATOS, transcript, AHORA);

  assert.ok(contexto.endsWith(transcript));
  assert.match(contexto, /Última conversación con el cliente/);
  assert.doesNotMatch(contexto, /No hay ninguna conversación/);
});

test("monto 0 se cuenta como 'sin monto cargado' y no como '0 USD'", () => {
  const contexto = armarContextoDeBorrador({ ...DATOS, amount: "0" }, null, AHORA);
  assert.match(contexto, /^- Monto: sin monto cargado$/m);
});

test("los días sin movimiento nunca son negativos, aunque el reloj venga atrasado", () => {
  const contexto = armarContextoDeBorrador(DATOS, null, new Date("2026-09-10T00:00:00.000Z"));
  assert.match(contexto, /\(hace 0 días\)/);
});

test("el prompt pide primera persona del vendedor, un solo mensaje y nada inventado", () => {
  const prompt = armarPromptDeBorrador();
  assert.match(prompt, /primera persona, como si lo escribiera el vendedor/);
  assert.match(prompt, /WhatsApp o por email/);
  assert.match(prompt, /No inventes/);
  assert.match(prompt, /Respondé SOLO con el texto del mensaje/);
  // Es fijo: dos llamadas devuelven exactamente lo mismo.
  assert.equal(prompt, armarPromptDeBorrador());
});
