import assert from "node:assert/strict";
import { test } from "node:test";
import { Prisma, type Contact } from "@prisma/client";
import {
  datosDelQueQueda,
  eleccionPorDefecto,
  resolverElecciones,
  telefonosQueSePierden,
} from "./contactMerge.service";

// Unir contactos: las reglas puras. El recorrido HTTP y la transacción están
// en contactMerge.integration-test.ts.

const AYER = new Date("2026-10-03T12:00:00.000Z");
const HOY = new Date("2026-10-04T12:00:00.000Z");

function contacto(extra: Partial<Contact>): Contact {
  return {
    id: "c",
    organizationId: "o",
    companyId: null,
    ownerId: null,
    firstName: "Ana",
    lastName: "Pérez",
    email: null,
    phone: null,
    jobTitle: null,
    lifecycleStage: "LEAD",
    source: null,
    leadScore: null,
    leadIntent: null,
    leadServiceOfInterest: null,
    leadUrgency: null,
    leadBudgetAmount: null,
    leadBudgetCurrency: null,
    leadLocation: null,
    leadNotes: null,
    leadAiData: null,
    mergedIntoId: null,
    vehicleOfInterestId: null,
    vehicleOfInterestSetBy: null,
    createdAt: AYER,
    updatedAt: AYER,
    deletedAt: null,
    ...extra,
  } as Contact;
}

test("default: el valor del contacto más reciente si no está vacío; si lo está, el del otro", () => {
  const viejo = contacto({
    id: "k",
    email: "viejo@example.com",
    jobTitle: "Gerente",
    updatedAt: AYER,
  });
  const nuevo = contacto({ id: "a", email: "nuevo@example.com", jobTitle: "  ", updatedAt: HOY });
  assert.equal(eleccionPorDefecto(viejo, nuevo, "email"), "absorbed");
  assert.equal(
    eleccionPorDefecto(viejo, nuevo, "jobTitle"),
    "kept",
    "el más reciente está en blanco",
  );
  assert.equal(eleccionPorDefecto(viejo, nuevo, "source"), "kept", "los dos vacíos: el que queda");
  assert.equal(
    eleccionPorDefecto(nuevo, viejo, "email"),
    "kept",
    "el que queda es el más reciente",
  );
});

test("el presupuesto se elige como par (monto y moneda juntos)", () => {
  const k = contacto({ leadBudgetAmount: new Prisma.Decimal(30000), leadBudgetCurrency: "USD" });
  const a = contacto({ leadBudgetAmount: null, leadBudgetCurrency: null, updatedAt: HOY });
  const elecciones = resolverElecciones(k, a, {});
  assert.equal(elecciones.leadBudget, "kept");
  const datos = datosDelQueQueda(k, a, { ...elecciones, leadBudget: "absorbed" });
  assert.equal(datos.leadBudgetAmount, null);
  assert.equal(datos.leadBudgetCurrency, null);
});

test("lo elegido manda sobre el default; las notas se suman y los datos de la IA se combinan", () => {
  const k = contacto({
    firstName: "Ana",
    leadNotes: "[2026-10-01] del que queda",
    leadAiData: { a: 1, b: 1 },
  });
  const a = contacto({
    firstName: "Ana María",
    leadNotes: "del unido",
    leadAiData: { b: 2, c: 3 },
    updatedAt: HOY,
  });
  const datos = datosDelQueQueda(k, a, resolverElecciones(k, a, { firstName: "kept" }), HOY);
  assert.equal(datos.firstName, "Ana");
  assert.match(
    String(datos.leadNotes),
    /del que queda\n\[2026-10-04\] \(del contacto unido Ana María Pérez\) del unido/,
  );
  assert.deepEqual(datos.leadAiData, { a: 1, b: 1, c: 3 }, "las claves del que queda ganan");
});

test("telefonosQueSePierden: los dígitos que no son los del teléfono final, sin repetir", () => {
  assert.deepEqual(
    telefonosQueSePierden({ phone: "+598 99 111 111" }, { phone: "+59899222222" }, "+59899222222"),
    ["59899111111"],
  );
  assert.deepEqual(
    telefonosQueSePierden({ phone: "+59899111111" }, { phone: "+59899111111" }, "+59899111111"),
    [],
  );
  assert.deepEqual(telefonosQueSePierden({ phone: null }, { phone: "+59899222222" }, null), [
    "59899222222",
  ]);
});

test("el vehículo de interés: si el que queda no tiene, se conserva el del unido; si tiene, el suyo", () => {
  const sin = contacto({ id: "k" });
  const con = contacto({ id: "a", vehicleOfInterestId: "v-1", vehicleOfInterestSetBy: "AGENT" });
  const datos = datosDelQueQueda(sin, con, resolverElecciones(sin, con, {}));
  assert.equal(datos.vehicleOfInterestId, "v-1");
  assert.equal(datos.vehicleOfInterestSetBy, "AGENT");
  const conPropio = contacto({
    id: "k",
    vehicleOfInterestId: "v-2",
    vehicleOfInterestSetBy: "HUMAN",
  });
  assert.equal(
    datosDelQueQueda(conPropio, con, resolverElecciones(conPropio, con, {})).vehicleOfInterestId,
    undefined,
    "no se toca: queda el del que queda",
  );
});

test("R16: el aviso de privacidad no se elige; queda el más viejo de los dos", () => {
  const viejo = new Date("2026-10-01T12:00:00Z");
  const nuevo = new Date("2026-10-05T12:00:00Z");
  const conAmbos = (k: Date | null, a: Date | null) => {
    const kept = contacto({ privacyNoticeSentAt: k });
    const absorbed = contacto({ privacyNoticeSentAt: a });
    return datosDelQueQueda(kept, absorbed, resolverElecciones(kept, absorbed, {}))
      .privacyNoticeSentAt;
  };
  assert.deepEqual(conAmbos(nuevo, viejo), viejo);
  assert.deepEqual(conAmbos(viejo, nuevo), viejo);
  assert.deepEqual(conAmbos(null, nuevo), nuevo);
  assert.equal(conAmbos(null, null), undefined, "sin aviso no se escribe nada");
});
