import assert from "node:assert/strict";
import { test } from "node:test";
import { crearRegistroDeAcciones, type AccionRegistrada } from "./automationActions";
import {
  ACTION_CREATE_FOLLOW_UP,
  accionCrearActividadDeSeguimiento,
  configDeSeguimientoSchema,
  fechaDeVencimiento,
} from "./automationActions/createFollowUpActivity";
import { payloadComoObjeto } from "./automationDispatch.service";
import { TRIGGERS_CONOCIDOS, esTriggerConocido } from "./automationTriggers";

// ---------------------------------------------------------------------------
// Unitarios, sin base: el registro de acciones, el schema de config de la
// primera acción, la aritmética del vencimiento y los guardas puros del
// dispatcher. El despacho contra Postgres real vive en
// automationDispatch.integration-test.ts.
// ---------------------------------------------------------------------------

function accionDePrueba(actionType: string): AccionRegistrada {
  return { actionType, schema: configDeSeguimientoSchema, handler: async () => undefined };
}

// ---------------------------------------------------------------------------
// Registro de acciones
// ---------------------------------------------------------------------------

test("registrar dos veces el mismo actionType LANZA, no sobrescribe", () => {
  const registro = crearRegistroDeAcciones();
  const primera = accionDePrueba("test.accion");
  registro.registrar(primera);

  assert.throws(
    () => registro.registrar(accionDePrueba("test.accion")),
    /Ya hay una acción registrada para el actionType "test\.accion"/,
  );
  // La primera sigue siendo la que gana.
  assert.equal(registro.obtener("test.accion"), primera);
});

test("obtener un actionType no registrado devuelve undefined, no lanza", () => {
  const registro = crearRegistroDeAcciones();
  assert.equal(registro.obtener("test.nadie"), undefined);
});

test("tiposRegistrados devuelve los actionType ordenados, y vacío para un registro nuevo", () => {
  const registro = crearRegistroDeAcciones();
  assert.deepEqual(registro.tiposRegistrados(), []);

  registro.registrar(accionDePrueba("zeta.accion"));
  registro.registrar(accionDePrueba("alfa.accion"));
  assert.deepEqual(registro.tiposRegistrados(), ["alfa.accion", "zeta.accion"]);
});

test("dos registros creados con la factory no comparten estado", () => {
  const a = crearRegistroDeAcciones();
  const b = crearRegistroDeAcciones();
  a.registrar(accionDePrueba("test.solo_en_a"));
  assert.equal(b.obtener("test.solo_en_a"), undefined);
});

// ---------------------------------------------------------------------------
// Catálogo de triggers
// ---------------------------------------------------------------------------

test("el catálogo de triggers hoy tiene exactamente opportunity.won", () => {
  assert.deepEqual([...TRIGGERS_CONOCIDOS], ["opportunity.won"]);
  assert.equal(esTriggerConocido("opportunity.won"), true);
  assert.equal(esTriggerConocido("booking.reminder"), false);
});

// ---------------------------------------------------------------------------
// Acción activity.create_follow_up — schema de config
// ---------------------------------------------------------------------------

test("la acción registrada expone su actionType y su schema", () => {
  assert.equal(accionCrearActividadDeSeguimiento.actionType, ACTION_CREATE_FOLLOW_UP);
  assert.equal(accionCrearActividadDeSeguimiento.actionType, "activity.create_follow_up");
  assert.equal(accionCrearActividadDeSeguimiento.schema, configDeSeguimientoSchema);
});

test("config válido: subject trimeado y daysUntilDue entero entre 0 y 365", () => {
  const parsed = configDeSeguimientoSchema.parse({ subject: "  Llamar  ", daysUntilDue: 3 });
  assert.deepEqual(parsed, { subject: "Llamar", daysUntilDue: 3 });
  assert.equal(
    configDeSeguimientoSchema.safeParse({ subject: "x", daysUntilDue: 0 }).success,
    true,
  );
  assert.equal(
    configDeSeguimientoSchema.safeParse({ subject: "x", daysUntilDue: 365 }).success,
    true,
  );
});

test("sin daysUntilDue falla la validación — no hay default oculto", () => {
  const resultado = configDeSeguimientoSchema.safeParse({ subject: "Llamar" });
  assert.equal(resultado.success, false);
  if (!resultado.success) {
    assert.match(resultado.error.issues.map((i) => i.message).join(", "), /daysUntilDue/);
  }
});

test("daysUntilDue fuera de rango, no entero o no numérico falla", () => {
  for (const daysUntilDue of [-1, 366, 1.5, "3", null]) {
    assert.equal(
      configDeSeguimientoSchema.safeParse({ subject: "Llamar", daysUntilDue }).success,
      false,
      `daysUntilDue=${String(daysUntilDue)} debía rechazarse`,
    );
  }
});

test("subject vacío, solo espacios o de más de 200 caracteres falla", () => {
  for (const subject of ["", "   ", "x".repeat(201)]) {
    assert.equal(
      configDeSeguimientoSchema.safeParse({ subject, daysUntilDue: 1 }).success,
      false,
      `subject=${JSON.stringify(subject)} debía rechazarse`,
    );
  }
});

// ---------------------------------------------------------------------------
// Vencimiento
// ---------------------------------------------------------------------------

test("fechaDeVencimiento suma días de calendario en UTC y no muta la fecha de entrada", () => {
  const ahora = new Date("2026-09-13T15:30:00.000Z");
  const copia = new Date(ahora);

  assert.equal(fechaDeVencimiento(ahora, 3).toISOString(), "2026-09-16T15:30:00.000Z");
  assert.equal(fechaDeVencimiento(ahora, 0).toISOString(), "2026-09-13T15:30:00.000Z");
  // Cruza fin de mes y de año sin aritmética a mano.
  assert.equal(
    fechaDeVencimiento(new Date("2026-12-30T00:00:00.000Z"), 3).toISOString(),
    "2027-01-02T00:00:00.000Z",
  );
  assert.equal(ahora.toISOString(), copia.toISOString());
});

// ---------------------------------------------------------------------------
// Guardas puros del dispatcher
// ---------------------------------------------------------------------------

test("payloadComoObjeto acepta un objeto plano y rechaza null, arrays y escalares", () => {
  assert.deepEqual(payloadComoObjeto({ opportunityId: "x" }), { opportunityId: "x" });
  for (const payload of [null, [], "texto", 42, undefined]) {
    assert.throws(() => payloadComoObjeto(payload), /no es un objeto JSON/);
  }
});
