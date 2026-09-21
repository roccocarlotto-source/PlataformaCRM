import assert from "node:assert/strict";
import { test } from "node:test";
import {
  accionAdmiteTrigger,
  crearRegistroDeAcciones,
  type AccionRegistrada,
} from "./automationActions";
import {
  ACTION_CREATE_FOLLOW_UP,
  MAX_NOTES,
  accionCrearActividadDeSeguimiento,
  configDeSeguimientoSchema,
  fechaDeVencimiento,
} from "./automationActions/createFollowUpActivity";
import { payloadComoObjeto } from "./automationDispatch.service";
import {
  CONFIG_DE_TRIGGER,
  TRIGGERS_CONOCIDOS,
  TRIGGERS_DE_REGLA_UNICA,
  TRIGGER_OPPORTUNITY_STALE,
  TRIGGER_OPPORTUNITY_WON,
  configDeOportunidadEstancadaSchema,
  configDeOportunidadGanadaSchema,
  esTriggerConocido,
} from "./automationTriggers";

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

test("el catálogo de triggers hoy tiene exactamente opportunity.won y opportunity.stale", () => {
  assert.deepEqual([...TRIGGERS_CONOCIDOS], ["opportunity.won", "opportunity.stale"]);
  assert.equal(esTriggerConocido("opportunity.won"), true);
  assert.equal(esTriggerConocido("opportunity.stale"), true);
  assert.equal(esTriggerConocido("booking.reminder"), false);
});

test("cada trigger del catálogo tiene su schema de configuración", () => {
  assert.equal(CONFIG_DE_TRIGGER[TRIGGER_OPPORTUNITY_WON], configDeOportunidadGanadaSchema);
  assert.equal(CONFIG_DE_TRIGGER[TRIGGER_OPPORTUNITY_STALE], configDeOportunidadEstancadaSchema);
  assert.deepEqual(Object.keys(CONFIG_DE_TRIGGER).sort(), [...TRIGGERS_CONOCIDOS].sort());
});

test("opportunity.won no tiene config: {} pasa y una clave de más se DESCARTA, no se guarda", () => {
  assert.deepEqual(configDeOportunidadGanadaSchema.parse({}), {});
  assert.deepEqual(configDeOportunidadGanadaSchema.parse({ daysWithoutActivity: 7 }), {});
});

test("opportunity.stale exige daysWithoutActivity entero entre 0 y 365 — sin default oculto", () => {
  assert.deepEqual(configDeOportunidadEstancadaSchema.parse({ daysWithoutActivity: 7 }), {
    daysWithoutActivity: 7,
  });
  assert.equal(
    configDeOportunidadEstancadaSchema.parse({ daysWithoutActivity: 0 }).daysWithoutActivity,
    0,
  );
  assert.equal(
    configDeOportunidadEstancadaSchema.parse({ daysWithoutActivity: 365 }).daysWithoutActivity,
    365,
  );

  const sinDias = configDeOportunidadEstancadaSchema.safeParse({});
  assert.equal(sinDias.success, false);
  assert.match(sinDias.error?.issues[0]?.message ?? "", /daysWithoutActivity es requerido/);

  for (const malo of [-1, 366, 2.5, "7", null]) {
    assert.equal(
      configDeOportunidadEstancadaSchema.safeParse({ daysWithoutActivity: malo }).success,
      false,
      `${String(malo)} no debería pasar`,
    );
  }
});

test("opportunity.stale es de regla única por organización; opportunity.won no", () => {
  assert.deepEqual([...TRIGGERS_DE_REGLA_UNICA], [TRIGGER_OPPORTUNITY_STALE]);
});

test("accionAdmiteTrigger: sin `triggers` admite cualquiera; con `triggers`, solo esos", () => {
  const libre = accionDePrueba("test.libre");
  assert.equal(accionAdmiteTrigger(libre, TRIGGER_OPPORTUNITY_WON), true);
  assert.equal(accionAdmiteTrigger(libre, TRIGGER_OPPORTUNITY_STALE), true);

  const acotada: AccionRegistrada = { ...libre, triggers: [TRIGGER_OPPORTUNITY_STALE] };
  assert.equal(accionAdmiteTrigger(acotada, TRIGGER_OPPORTUNITY_STALE), true);
  assert.equal(accionAdmiteTrigger(acotada, TRIGGER_OPPORTUNITY_WON), false);
});

test("activity.create_follow_up solo admite opportunity.won: colgada de stale sería una tarea diaria infinita", () => {
  assert.equal(
    accionAdmiteTrigger(accionCrearActividadDeSeguimiento, TRIGGER_OPPORTUNITY_WON),
    true,
  );
  assert.equal(
    accionAdmiteTrigger(accionCrearActividadDeSeguimiento, TRIGGER_OPPORTUNITY_STALE),
    false,
  );
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
// notes (ítem 68) — opcional, y viaja al body de la Activity
// ---------------------------------------------------------------------------

test('notes es OPCIONAL: sin la clave el config es válido y notes queda undefined, no ""', () => {
  const parsed = configDeSeguimientoSchema.parse({ subject: "Llamar", daysUntilDue: 3 });
  // undefined y no "": es lo que hace que el handler NO mande body y la
  // Activity quede con body null.
  assert.equal(parsed.notes, undefined);
  assert.equal("notes" in parsed, false);
});

test("notes presente se trimea, igual que subject", () => {
  const parsed = configDeSeguimientoSchema.parse({
    subject: "Llamar",
    daysUntilDue: 3,
    notes: "  Preguntar por la patente  ",
  });
  assert.equal(parsed.notes, "Preguntar por la patente");
});

test('notes vacío o con puros espacios se RECHAZA — "sin notas" se expresa omitiendo la clave', () => {
  for (const notes of ["", "   ", "\n\t "]) {
    const resultado = configDeSeguimientoSchema.safeParse({
      subject: "Llamar",
      daysUntilDue: 3,
      notes,
    });
    assert.equal(resultado.success, false, `notes=${JSON.stringify(notes)} debía rechazarse`);
    if (!resultado.success) {
      assert.match(
        resultado.error.issues.map((i) => i.message).join(", "),
        /notes no puede ser un string vacío/,
      );
    }
  }
});

test("notes de más de 5.000 caracteres falla con el tope en el mensaje; 5.000 justos pasa", () => {
  assert.equal(MAX_NOTES, 5000);
  assert.equal(
    configDeSeguimientoSchema.safeParse({
      subject: "Llamar",
      daysUntilDue: 3,
      notes: "x".repeat(MAX_NOTES),
    }).success,
    true,
  );

  const pasado = configDeSeguimientoSchema.safeParse({
    subject: "Llamar",
    daysUntilDue: 3,
    notes: "x".repeat(MAX_NOTES + 1),
  });
  assert.equal(pasado.success, false);
  if (!pasado.success) {
    // El tope es NUESTRO —Activity.body es Text, sin límite en la base—, así
    // que el mensaje lo dice en vez de ser un límite mudo.
    assert.match(
      pasado.error.issues.map((i) => i.message).join(", "),
      /notes no puede superar los 5000 caracteres/,
    );
  }
});

test("notes que no es string falla", () => {
  for (const notes of [42, null, {}, ["a"]]) {
    assert.equal(
      configDeSeguimientoSchema.safeParse({ subject: "Llamar", daysUntilDue: 3, notes }).success,
      false,
      `notes=${JSON.stringify(notes)} debía rechazarse`,
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
